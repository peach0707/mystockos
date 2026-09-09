"""Synthetic return tests, never a performance backtest."""
import json
import sqlite3
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch
from shadow.store import Store, encoded
from shadow.engine import Engine, TARGET
from shadow.calendar import window, validate_calendar
from shadow.cli import capture_repository, main

CALENDAR=json.loads((Path(__file__).parent/'fixtures/shadow_calendar_2026.json').read_text())

class ShadowTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.path=Path(self.temp.name)/'ledger.sqlite3'
        self.time='2026-09-04T21:00:00Z'
        self.store=Store(self.path,namespace='synthetic',clock=lambda:self.time)
        self.engine=Engine(self.store)
        self.definition={'namespace':'synthetic','theme_id':'test_theme','definition_version':'test-v1','known_at':self.time,'valid_from':'2026-09-01','valid_to':None,'core':[{'entity_id':'a','ticker':'AAA','exchange':'XNAS','currency':'USD'},{'entity_id':'b','ticker':'BBB','exchange':'XNYS','currency':'USD'}],'benchmark':{'entity_id':'spy','ticker':'SPY','exchange':'ARCX','currency':'USD'}}
        self.engine.register('factor','f1',{'stage':'experimental','namespace':'synthetic','code_hash':'fixture-factor','description':'synthetic test factor','required_inputs':['features']})
        self.engine.register('model','m1',{'stage':'experimental','namespace':'synthetic','code_hash':'fixture-model','description':'synthetic externally supplied estimate','target':TARGET,'factor_version':'f1'})
        self.inputs=self.capture({'definition':self.definition,'calendar':CALENDAR,'features':{'fixture':True}})

    def tearDown(self):
        self.store.close();self.temp.cleanup()

    def capture(self, values):
        return self.store.capture({k:{'body':encoded(v),'source':'synthetic-fixture','available_at':self.time,'data_as_of':self.time[:10],'revision':'test1','license_class':'synthetic'} for k,v in values.items()})

    def issue(self,h=5,**overrides):
        request=dict(request_id=f'h{h}',theme_id='test_theme',horizon=h,model_version='m1',factor_version='f1',input_manifest=self.inputs,prediction={'expected_excess_return':0.01},confidence={'kind':'unvalidated','value':None,'evidence':'synthetic test, no performance claim'},reasons=['test only'],cost_model={'version':'test-cost-v1','theme_roundtrip_rate':0.002,'benchmark_roundtrip_rate':0.001,'assumption':'synthetic round trip'},code_commit='fixture')
        request.update(overrides)
        return self.engine.issue(**request)

    def prices(self,identifier):
        p=self.store.get('prediction',identifier)
        series=[]
        for entity,ticker,exchange,end in [('a','AAA','XNAS',1.2),('b','BBB','XNYS',0.9),('spy','SPY','ARCX',1.02)]:
            bars=[]
            for i,s in enumerate(p['sessions']):
                bars.append({'session':s['date'],'open':100,'close':100*(1+(end-1)*(i+1)/len(p['sessions'])),'available_at':s['close'],'quality':'verified','tradable_open':True})
            series.append({'entity_id':entity,'ticker':ticker,'exchange':exchange,'currency':'USD','adjustment_version':'total-return-fixture-v1','quality':'verified','bars':bars})
        return {'namespace':'synthetic','basis':'total_return','corporate_actions_complete':True,'adjustment_version':'total-return-fixture-v1','source':'synthetic-only','series':series}

    def mature(self,identifier):
        self.time=self.store.get('prediction',identifier)['sessions'][-1]['close']

    def test_calendar_holiday_early_close_late_issue_and_all_horizons(self):
        self.assertEqual(window(CALENDAR,self.time,5)[0]['date'],'2026-09-08') # Labor Day
        self.assertEqual(window(CALENDAR,'2026-11-27T17:00:00Z',5)[0]['date'],'2026-11-30')
        self.assertEqual(next(s for s in CALENDAR['sessions'] if s['date']=='2026-11-27')['close'],'2026-11-27T18:00:00Z')
        for h in (5,20,60):
            p=self.store.get('prediction',self.issue(h));self.assertEqual(len(p['sessions']),h)
        broken=deepcopy(CALENDAR);broken['sessions'].pop(3)
        with self.assertRaises(ValueError):validate_calendar(broken)
        with self.assertRaises(ValueError):window(CALENDAR,'2027-01-29T21:00:00Z',60)
        self.assertEqual(window(CALENDAR,'2026-09-08T13:30:00Z',5)[0]['date'],'2026-09-09')

    def test_prediction_idempotence_conflict_and_atomic_pending(self):
        identifier=self.issue();self.assertEqual(identifier,self.issue())
        self.assertEqual(self.engine.status(identifier),'pending');self.assertEqual(len(self.store.records('prediction')),1)
        with self.assertRaises(ValueError):self.issue(prediction={'expected_excess_return':0.1})
        append=self.store.append
        def fail(kind,*args):
            if kind=='status':raise RuntimeError('interrupted')
            return append(kind,*args)
        with patch.object(self.store,'append',side_effect=fail),self.assertRaises(RuntimeError):self.issue(20)
        self.assertEqual(len(self.store.records('prediction')),1)

    def test_no_lookahead_or_current_composition_backdating(self):
        self.time='2026-09-04T20:00:00Z'
        with self.assertRaises(ValueError):self.issue()
        self.time='2026-09-04T21:00:00Z'
        future=deepcopy(self.definition);future['known_at']='2026-09-05T00:00:00Z'
        m=self.capture({'definition':future,'calendar':CALENDAR,'features':{}})
        with self.assertRaises(ValueError):self.issue(input_manifest=m)
        future['known_at']=self.time;future['valid_from']='2026-09-08'
        m=self.capture({'definition':future,'calendar':CALENDAR,'features':{}})
        with self.assertRaises(ValueError):self.issue(input_manifest=m)
        missing=self.capture({'definition':self.definition,'calendar':CALENDAR})
        with self.assertRaises(KeyError):self.issue(input_manifest=missing)

    def test_model_factor_versions_are_immutable_and_no_champion(self):
        spec=deepcopy(self.store.get('model','m1')['specification'])
        self.assertEqual(self.engine.register('model','m1',spec),'m1')
        spec['code_hash']='new'
        with self.assertRaises(ValueError):self.engine.register('model','m1',spec)
        spec['stage']='champion'
        with self.assertRaises(ValueError):self.engine.register('model','m2',spec)
        with self.assertRaises(ValueError):self.issue(factor_version='unknown')
        self.assertEqual(self.engine.report()['champion'],None)
        self.assertFalse(self.engine.report()['production_signals'])

    def test_pending_then_5_20_60_independent_maturities(self):
        ids=[self.issue(h) for h in (5,20,60)]
        self.assertEqual(self.engine.score_due()['pending'],3)
        for n,pid in enumerate(ids):
            self.mature(pid);m=self.capture({'prices':self.prices(pid)})
            self.engine.score_due(m)
            self.assertEqual(self.engine.status(pid),'scored')
            for later in ids[n+1:]:self.assertEqual(self.engine.status(later),'pending')
        self.assertEqual(self.engine.report()['counts']['scored'],3)

    def test_exact_buy_hold_equal_weight_returns_costs_and_excursions(self):
        pid=self.issue();self.mature(pid);m=self.capture({'prices':self.prices(pid)});self.engine.score_due(m)
        o=self.store.records('outcome')[0]
        self.assertAlmostEqual(o['theme_return'],0.05)
        self.assertAlmostEqual(o['benchmark_return'],0.02)
        self.assertAlmostEqual(o['excess_return'],0.03)
        self.assertAlmostEqual(o['cost_adjusted_return'],0.048)
        self.assertAlmostEqual(o['cost_adjusted_excess_return'],0.029)
        self.assertAlmostEqual(o['max_favorable_movement'],0.05);self.assertEqual(o['max_adverse_movement'],0)
        self.assertTrue(o['direction_correct'])
        self.assertEqual(self.engine.score_due(m)['unchanged'],1)

    def test_missing_member_session_adjustment_and_delisting_never_zero_filled(self):
        pid=self.issue();self.mature(pid);good=self.prices(pid)
        variants=[]
        bad=deepcopy(good);bad['series'].pop(0);variants.append(bad)
        bad=deepcopy(good);bad['series'][0]['bars'].pop(2);variants.append(bad)
        bad=deepcopy(good);bad['corporate_actions_complete']=False;variants.append(bad)
        bad=deepcopy(good);bad['series'][0]['quality']='unresolved_delisting';variants.append(bad)
        bad=deepcopy(good);bad['series'][0]['bars'][0]['tradable_open']=False;variants.append(bad)
        bad=deepcopy(good);bad['series'][0]['bars'][0]['available_at']='2027-01-01T00:00:00Z';variants.append(bad)
        for bad in variants:
            m=self.capture({'prices':bad});self.engine.score_due(m);self.assertEqual(self.engine.status(pid),'unresolved')
            self.assertEqual(self.store.records('outcome'),[])
        m=self.capture({'prices':good});self.engine.score_due(m);self.assertEqual(self.engine.status(pid),'scored')
        self.assertEqual(self.store.get('prediction',pid)['definition']['core'],self.definition['core'])

    def test_split_dividend_adjusted_input_not_double_counted(self):
        pid=self.issue();self.mature(pid);prices=self.prices(pid)
        for s in prices['series']:
            for b in s['bars']:b['close']=102 # normalized total-return index, already includes dividend/split
        prices['cash_dividends']=[{'amount':2}];prices['splits']=[{'ratio':2}]
        m=self.capture({'prices':prices});self.engine.score_due(m)
        self.assertAlmostEqual(self.store.records('outcome')[0]['theme_return'],0.02)

    def test_corrections_append_versions_and_failed_correction_preserves_success(self):
        pid=self.issue();self.mature(pid);prices=self.prices(pid);m=self.capture({'prices':prices});self.engine.score_due(m)
        first=deepcopy(self.store.records('outcome')[0]);original=deepcopy(self.store.get('prediction',pid))
        prices['series'][0]['bars'][-1]['close']=130;m2=self.capture({'prices':prices})
        self.assertEqual(self.engine.score_due(m2)['unchanged'],1)
        self.engine.score_due(m2,correction_reason='provider revision verified')
        self.assertEqual(len(self.store.records('outcome')),2);self.assertEqual(self.store.records('outcome')[0],first)
        self.assertEqual(self.store.get('prediction',pid),original)
        prices['series']=[];m3=self.capture({'prices':prices});self.engine.score_due(m3,correction_reason='incomplete revision')
        self.assertEqual(self.engine.status(pid),'scored');self.assertEqual(len(self.store.records('outcome')),2)
        self.assertEqual(len(self.store.records('scoring_error')),1)

    def test_outcome_and_status_transaction_survive_interruption(self):
        pid=self.issue();self.mature(pid);m=self.capture({'prices':self.prices(pid)});append=self.store.append
        def fail(kind,*args):
            if kind=='status':raise RuntimeError('power loss')
            return append(kind,*args)
        with patch.object(self.store,'append',side_effect=fail),self.assertRaises(RuntimeError):self.engine.score_due(m)
        self.assertEqual(self.store.records('outcome'),[]);self.assertEqual(self.engine.status(pid),'pending')
        self.engine.score_due(m);self.assertEqual(self.engine.status(pid),'scored')

    def test_capture_rollback_immutability_checksum_backup_and_namespace(self):
        baseline=self.store.audit()
        sources={'first':{'body':b'new','source':'test','available_at':self.time,'data_as_of':'2026-09-04','revision':'x','license_class':'synthetic'},'second':{'body':b'bad','source':'test','available_at':'2030-01-01T00:00:00Z','data_as_of':'2026-09-04','revision':'x','license_class':'synthetic'}}
        with self.assertRaises(ValueError):self.store.capture(sources)
        self.assertEqual(self.store.audit(),baseline)
        for sql in ["UPDATE records SET hash='bad'",'DELETE FROM records','DELETE FROM objects']:
            with self.assertRaises(sqlite3.IntegrityError):self.store.db.execute(sql)
        backup=Path(self.temp.name)/'backup.sqlite3';self.store.backup(backup)
        other=Store(backup,namespace='synthetic');self.assertEqual(other.audit(),baseline);other.close()
        with self.assertRaises(ValueError):Store(backup,namespace='shadow')
        # Simulate tampered restored media, beyond triggers.
        self.store.db.execute('DROP TRIGGER objects_no_update');self.store.db.execute("UPDATE objects SET body='bad'")
        with self.assertRaises((ValueError,TypeError)):self.store.audit()

    def test_real_repo_capture_is_observation_only_and_failed_capture_preserves_old(self):
        self.time='2026-09-09T23:00:00Z';repo=Path(__file__).resolve().parents[1]
        mid=capture_repository(self.store,repo);observation=self.store.get('observation',mid)
        self.assertNotIn('holdings',observation['inputs']);self.assertEqual(len(observation['inputs']),7)
        self.assertEqual(len(self.store.records('prediction')),0)
        baseline=self.store.audit()
        with self.assertRaises(FileNotFoundError):capture_repository(self.store,Path(self.temp.name))
        self.assertEqual(self.store.audit(),baseline)


    def test_multiple_writers_retry_the_same_request_without_duplicate_prediction(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier
        barrier=Barrier(2)
        # Connections belong to their worker threads; BEGIN IMMEDIATE serializes the writers.
        request=dict(request_id='concurrent',theme_id='test_theme',horizon=5,model_version='m1',factor_version='f1',input_manifest=self.inputs,prediction={'expected_excess_return':0.01},confidence={'kind':'unvalidated','value':None,'evidence':'test'},reasons=['test'],cost_model={'version':'c','theme_roundtrip_rate':0,'benchmark_roundtrip_rate':0,'assumption':'test only'},code_commit='fixture')
        def writer():
            local=Store(self.path,namespace='synthetic',clock=lambda:self.time)
            try:
                barrier.wait(timeout=5)
                return Engine(local).issue(**request)
            finally:local.close()
        with ThreadPoolExecutor(max_workers=2) as pool:
            a=pool.submit(writer);b=pool.submit(writer)
            self.assertEqual(a.result(),b.result())
        self.assertEqual(len(self.store.records('prediction')),1)
        self.assertEqual(len(self.store.records('status')),1)

    def test_bad_price_values_and_cross_namespace_evidence_are_unresolved(self):
        pid=self.issue();self.mature(pid);good=self.prices(pid)
        for field,value in [('basis','raw_price'),('namespace','shadow')]:
            bad=deepcopy(good);bad[field]=value
            self.engine.score_due(self.capture({'prices':bad}));self.assertEqual(self.engine.status(pid),'unresolved')
        bad=deepcopy(good);bad['series'][0]['bars'][0]['open']=0
        self.engine.score_due(self.capture({'prices':bad}));self.assertEqual(self.engine.status(pid),'unresolved')
        with self.assertRaises(ValueError):self.issue(20,cost_model={'version':'bad','theme_roundtrip_rate':-0.1,'benchmark_roundtrip_rate':0,'assumption':'bad'})
        with self.assertRaises(ValueError):self.issue(20,prediction={'expected_excess_return':float('nan')})

    def test_cycle_failure_is_persisted_and_old_due_predictions_still_score(self):
        from shadow.cli import run_cycle
        pid=self.issue();self.mature(pid)
        prices=self.capture({'prices':self.prices(pid)})
        result=run_cycle(self.store,Path(self.temp.name)/'missing-repository',prices)
        self.assertEqual(result['health'],'degraded')
        self.assertEqual(self.engine.status(pid),'scored')
        self.assertEqual(self.store.get('run_finished',result['run_id'])['scoring']['scored'],1)
        self.assertEqual(self.engine.report()['operations']['unfinished_run_ids'],[])

    def test_cycle_records_failure_and_detects_interrupted_attempt_without_rewriting(self):
        from shadow.cli import run_cycle
        self.time='2026-09-09T23:00:00Z'
        repo=Path(__file__).resolve().parents[1]
        with patch.object(Engine,'score_due',side_effect=RuntimeError('injected failure')):
            with self.assertRaises(RuntimeError):run_cycle(self.store,repo)
        finished=self.store.records('run_finished')
        self.assertEqual(finished[-1]['health'],'failed')
        with patch.object(Engine,'score_due',side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):run_cycle(self.store,repo)
        self.assertEqual(len(self.engine.report()['operations']['unfinished_run_ids']),1)
        result=run_cycle(self.store,repo)
        self.assertEqual(result['health'],'ok')
        self.assertEqual(self.store.records('run_finished')[0],finished[0])
        self.assertEqual(len(self.engine.report()['operations']['unfinished_run_ids']),1)

    def test_degraded_cycle_cli_returns_nonzero_and_logs_missing_price_bundle(self):
        from shadow.cli import main
        from contextlib import redirect_stdout
        from io import StringIO
        output=StringIO()
        with redirect_stdout(output):
            code=main(['--db',str(self.path),'--namespace','synthetic','cycle','--repo',self.temp.name,'--price-manifest',str(Path(self.temp.name)/'absent.json')])
        self.assertEqual(code,2)
        result=json.loads(output.getvalue())
        self.assertEqual(result['health'],'degraded')
        self.assertIn('price_capture_error',result)
        self.assertEqual(self.store.get('run_finished',result['run_id'])['health'],'degraded')

if __name__=='__main__':unittest.main()
