import copy
from datetime import date, timedelta
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
from display_metrics import active_members, build, ranks, stock_metrics
from collect_display_metrics import BASIS, TwelveProvider, collect, save

CONFIG = json.loads((Path(__file__).resolve().parents[1]/'config/display_metrics.json').read_text())
SESSIONS = [(date(2026,1,1)+timedelta(days=i)).isoformat() for i in range(140)
            if (date(2026,1,1)+timedelta(days=i)).weekday()<5][-70:]
DAY = SESSIONS[-1]
KNOWN = DAY+'T23:00:00+00:00'
MEMBERS = [dict(theme_id='test',ticker=t,role=r,effective_from='2020-01-01',effective_to='')
           for t,r in [('A','core'),('B','core'),('C','related'),('D','watch')]]


def price(ticker='A', scale=1):
    return dict(BASIS, as_of=DAY, source_hash='test-only', ticker=ticker,
                bars=[dict(session=d,close=(100+i)*scale,volume=200 if i==69 else 100) for i,d in enumerate(SESSIONS)])


def theme(tid,score,mode='ranked'):
    return dict(theme_id=tid,score_mode=mode,data_quality={'status':'ok'},strength={'score':score})


class DisplayMetricsTests(unittest.TestCase):
    def test_returns_and_rvol_exclude_current_day_denominator(self):
        m=stock_metrics(price(),SESSIONS,DAY,CONFIG)
        for n in (1,5,21,63): self.assertAlmostEqual(m[f'return_{n}d']['value'],169/(169-n)-1)
        self.assertEqual(m['rvol']['value'],2)
        self.assertFalse(m['return_5d']['dividend_adjusted'])

    def test_missing_not_zero_and_calendar_gap_not_compressed(self):
        p=price();p['bars'].pop(-3)
        m=stock_metrics(p,SESSIONS,DAY,CONFIG)
        self.assertIsNone(m['return_5d']['value']);self.assertIsNone(m['rvol']['value'])
        self.assertIsNotNone(m['return_1d']['value'])
        p['as_of']='2000-01-01'
        self.assertIsNone(stock_metrics(p,SESSIONS,DAY,CONFIG)['return_1d']['value'])

    def test_holiday_uses_supplied_sessions(self):
        days=['2026-09-04','2026-09-08']
        p=dict(price(),as_of=days[-1],bars=[dict(session=days[0],close=100),dict(session=days[1],close=105)])
        self.assertAlmostEqual(stock_metrics(p,days,days[-1],CONFIG)['return_1d']['value'],.05)

    def test_invalid_volume_and_duplicate_bars(self):
        for v in (None,-1,float('nan'),True):
            p=price();p['bars'][-1]['volume']=v
            self.assertIsNone(stock_metrics(p,SESSIONS,DAY,CONFIG)['rvol']['value'])
        p=price();p['bars'].append(p['bars'][-1])
        self.assertIsNone(stock_metrics(p,SESSIONS,DAY,CONFIG)['return_1d']['value'])
        p=price()
        for b in p['bars'][:-1]:b['volume']=0
        self.assertIsNone(stock_metrics(p,SESSIONS,DAY,CONFIG)['rvol']['value'])

    def test_versioned_window(self):
        config=dict(CONFIG,rvol_sessions=2,version='test-v2');p=price();p['bars'][-2]['volume']=300
        self.assertEqual(stock_metrics(p,SESSIONS,DAY,config)['rvol']['value'],1)

    def test_theme_partial_coverage_and_no_mutation(self):
        p={'A':price()};before=copy.deepcopy(p)
        d=build(p,MEMBERS,[],[],SESSIONS,DAY,KNOWN,CONFIG)
        m=d['themes']['test']['return_5d']
        self.assertEqual((m['eligible_n'],m['total_n'],m['coverage'],m['status']),(1,2,.5,'partial'))
        self.assertEqual(m['value'],d['stocks']['A']['return_5d']['value'])
        self.assertEqual(p,before);self.assertEqual(len(d['themes']['test']['members']),4)

    def test_median_and_mixed_basis(self):
        p={'A':price(),'B':price('B')};p['B']['bars'][-1]['volume']=10000
        members=MEMBERS+[dict(MEMBERS[0],ticker='E')];p['E']=price('E')
        d=build(p,members,[],[],SESSIONS,DAY,KNOWN,CONFIG)
        self.assertEqual(d['themes']['test']['rvol']['value'],2)
        p['B']['adjustment_type']='raw'
        self.assertEqual(build(p,MEMBERS,[],[],SESSIONS,DAY,KNOWN,CONFIG)['themes']['test']['return_5d']['status'],'mixed_basis')

    def test_point_in_time_membership_inclusive_end(self):
        rows=[dict(MEMBERS[0],effective_to=DAY),dict(MEMBERS[1],effective_from='2099-01-01')]
        self.assertEqual([r['ticker'] for r in active_members(rows,DAY)],['A'])
        d=build({},rows,[],[],SESSIONS,DAY,KNOWN,CONFIG)
        self.assertEqual(d['membership_snapshot'],rows[:1]);self.assertIsNone(d['themes']['test']['return_5d']['value'])

    def test_rank_same_eligibility_ties_and_no_invented_history(self):
        self.assertEqual(ranks({'themes':[theme('A',90),theme('B',90),theme('C',100,'thin')]}),{'A':1,'B':2})
        history=[dict(as_of=SESSIONS[-6],calculated_at=SESSIONS[-6]+'T22:00:00+00:00',themes=[theme('other',95),theme('test',80)]),
                 dict(as_of=DAY,calculated_at=DAY+'T22:00:00+00:00',themes=[theme('test',95),theme('other',80)])]
        d=build({},MEMBERS,[],history,SESSIONS,DAY,KNOWN,CONFIG)['themes']['test']
        self.assertEqual(d['rank_change_5d'],1);self.assertIsNone(d['rank_history']['1']['rank'])
        history[-1]['calculated_at']='2099-01-01T00:00:00+00:00'
        self.assertIsNone(build({},MEMBERS,[],history,SESSIONS,DAY,KNOWN,CONFIG)['themes']['test']['rank_history']['0']['rank'])

    def test_save_immutable_partial_does_not_destroy_healthy_latest(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);good=build({'A':price()},MEMBERS,[],[],SESSIONS,DAY,KNOWN,CONFIG)
            save(root,good);original=(root/'data/phase_a.json').read_bytes()
            save(root,build({},MEMBERS,[],[],SESSIONS,DAY,KNOWN,CONFIG))
            self.assertEqual((root/'data/phase_a.json').read_bytes(),original)
            self.assertEqual(len(list((root/'data/phase-a-observations').rglob('*.json'))),2)

    def test_429_stops_no_retry_or_zero_fallback(self):
        class Fake:
            calls=0
            def fetch(self,*args):self.calls+=1;raise ValueError('rate_limited')
        provider=Fake();prices,failures=collect(provider,['A','B'],DAY,spacing=False)
        self.assertEqual(provider.calls,1);self.assertEqual(prices,{});self.assertEqual(failures[0]['reason'],'rate_limited')

    def test_provider_volume_missing_preserves_price(self):
        payload=dict(status='ok',meta=dict(symbol='A',interval='1day',currency='USD',exchange='NASDAQ'),
                     values=[dict(datetime=DAY,close='100')])
        class Response:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,*args):return json.dumps(payload).encode()
        class Opener:
            def open(self,*args,**kwargs):return Response()
        p=TwelveProvider('test-secret',Opener()).fetch('A',DAY)
        self.assertIsNone(p['bars'][0]['volume']);self.assertEqual(p['bars'][0]['close'],100)


if __name__=='__main__':unittest.main()
