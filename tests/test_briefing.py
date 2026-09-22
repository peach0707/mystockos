import json
from datetime import datetime, timezone, timedelta
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from stock_setups import describe, merge_snapshot
from collect_news import parse_feed, assemble, classify
from collect_valuation import normalize_fx, normalize_etfs
from collect_briefing import quote_universe, pending_symbols


class BriefingTests(unittest.TestCase):
    def test_reference_etfs_are_discovered_without_individual_ticker_changes(self):
        config = {'symbols':['SNDK','MU','S'], 'automatic_etfs':{
            'enabled':True, 'topics':['memory','photonics'], 'underlying_names':['NVIDIA']}}
        def etf(symbol, name, **kw):
            return dict(symbol=symbol, name=name, country='United States', currency='USD',
                        type='ETF', mic_code='XNAS', **kw)
        records = [etf('SNDU','T-REX 2X Long SNDK Daily Target ETF'),
                   etf('NEWX','New 2X Long MU Daily ETF'),
                   etf('NVDX','T-Rex 2X Long NVIDIA Daily Target ETF'),
                   etf('DISK','Tema Memory ETF'), etf('LYTE','Photonics ETF'),
                   etf('WRONG','2X Long SNDKX ETF'), etf('OTHER','U.S. Growth 2x ETF'),
                   etf('FUNDX','Memory Mutual Fund')]
        bad = dict(records[0], symbol='BAD', currency='EUR')
        foreign = dict(records[0], symbol='LOCAL', mic_code='XETR')
        symbols, auto = quote_universe(config, {'symbols':records+[bad,foreign,records[0]]})
        self.assertEqual(auto, ['DISK','LYTE','NEWX','NVDX','SNDU'])
        self.assertEqual(symbols[:3], config['symbols'])
        self.assertEqual(len(symbols),len(set(symbols)))
        # Refreshing an incomplete reference cannot silently drop existing quotes.
        self.assertEqual(quote_universe(config, {}, {'universe':{'automatic_symbols':auto}})[1], auto)

    def test_pending_queue_retries_missing_without_starving_new_etfs(self):
        universe=['MU','SNDU','AAA','NEWX','ZZZ']
        previous={'stocks':{'AAA':{'last_attempt_at':'2026-09-22T00:00:00Z'},
                            'ZZZ':{'last_attempt_at':'2026-09-21T00:00:00Z'}}}
        self.assertEqual(pending_symbols(universe,['MU','SNDU'],{'MU':{}},previous),['SNDU','NEWX','ZZZ','AAA'])

    def test_real_catalog_covers_reported_and_related_etfs(self):
        root=Path(__file__).resolve().parents[1]
        config=json.loads((root/'config/briefing.json').read_text())
        catalog=json.loads((root/'data/etfs.json').read_text())
        universe, auto=quote_universe(config,catalog)
        self.assertTrue({'SNDU','DRAM','MUU','DISK','LYTE','PSOX','COHX','LITU','NVDX'}<=set(universe))
        self.assertIn('SNXX',auto)
        self.assertLess(len(universe),250, 'Unexpected discovery explosion must be reviewed')

    def setUp(self):
        self.sessions = [(datetime(2026,1,1)+timedelta(days=n)).date().isoformat() for n in range(64)]
        self.price = dict(ticker='TEST',as_of=self.sessions[-1],currency='USD',exchange='NASDAQ',data_source='fixture',source_hash='fixture',retrieved_at='2026-03-05T22:00:00Z',price_basis='price_return',adjustment_type='split',bars=[dict(session=d,close=100+n,volume=1000) for n,d in enumerate(self.sessions)])
        self.now = datetime(2026,9,22,tzinfo=timezone.utc)
        self.source = dict(id='fixture',company='Example',name='Example IR',tickers=['TEST'],topic='memory')

    def test_price_levels_exclude_current_close_and_do_not_forecast(self):
        d=describe(self.price,self.sessions,self.sessions[-1])
        self.assertEqual(d['prior_high20'],162)
        self.assertTrue(d['breakout'])
        self.assertEqual(d['rvol'],1)
        self.assertNotIn('decision',d)
        self.assertNotIn('forecast',d)

    def test_missing_duplicate_and_invalid_prices_are_rejected(self):
        for variant in ('missing','duplicate','nan'):
            p=json.loads(json.dumps(self.price))
            if variant=='missing': p['bars'].pop(30)
            if variant=='duplicate': p['bars'].append(p['bars'][0])
            if variant=='nan': p['bars'][0]['close']=float('nan')
            with self.assertRaises(ValueError): describe(p,self.sessions,self.sessions[-1])

    def test_failed_collection_keeps_price_but_marks_it_stale(self):
        old=describe(self.price,self.sessions,self.sessions[-1])
        d=merge_snapshot({'stocks':{'TEST':old}},{},[{'ticker':'TEST','reason':'rate_limited'}],'2026-09-21',self.now.isoformat(),['TEST','NONE'])
        self.assertEqual(d['stocks']['TEST']['price'],old['price'])
        self.assertEqual(d['stocks']['TEST']['quality'],'stale')
        self.assertEqual(d['stocks']['NONE']['quality'],'missing')

    def test_short_listing_retains_quote_and_only_eligible_indicators(self):
        for length in (1, 2, 14, 20, 21, 49, 50, 63):
            p = dict(self.price, bars=self.price['bars'][-length:])
            row = describe(p, self.sessions, self.sessions[-1])
            self.assertEqual(row['price'], 163)
            self.assertEqual(row['quality'], 'ok')
            self.assertEqual(row['history_sessions'], length)
            self.assertEqual(row['analysis_ready'], length >= 50)
            self.assertEqual(row['ma50'] is not None, length >= 50)
            self.assertEqual(row['prior_high20'] is not None, length >= 21)
            self.assertEqual(row['day'] is not None, length >= 2)
            self.assertIsNone(row['returns']['63'])
            json.dumps(row, allow_nan=False)

    def test_missing_null_date_recovers_to_a_valid_price(self):
        old={'stocks':{'TEST':{'ticker':'TEST','as_of':None,'quality':'missing'}}}
        row=describe(self.price,self.sessions,self.sessions[-1])
        result=merge_snapshot(old,{'TEST':row},[],self.sessions[-1],self.now.isoformat(),['TEST'])
        self.assertEqual(result['stocks']['TEST']['price'],163)
        self.assertEqual(result['coverage'],{'ok':1,'total':1})

    def test_fx_excludes_unfinished_day_and_validates_currency(self):
        payload = {'status':'ok', 'meta':{'symbol':'USD/JPY','interval':'1day'},
                   'values':[{'datetime':'2026-09-22','close':'999'},
                             {'datetime':'2026-09-21','close':'150'}]}
        result = normalize_fx(payload, 'fixture', '2026-09-21', self.now)
        self.assertEqual(result['rate'],150)
        self.assertEqual(result['as_of'],'2026-09-21')
        payload['meta']['symbol']='JPY/USD'
        with self.assertRaises(ValueError): normalize_fx(payload,'fixture','2026-09-21',self.now)

    def test_etf_reference_requires_real_us_currency_listings(self):
        rows = [dict(symbol=f'ETF{i}',name='Fixture',exchange='NASDAQ',mic_code='XNAS',country='United States',currency='USD') for i in range(500)]
        rows.append(dict(rows[0],symbol='MUU'))
        rows.append(dict(rows[0],symbol='OTHER',country='South Korea',currency='KRW'))
        output = normalize_etfs({'status':'ok','data':rows})
        self.assertEqual(len(output),501)
        self.assertTrue(any(row['symbol']=='MUU' and row['type']=='ETF' for row in output))
        with self.assertRaises(ValueError): normalize_etfs({'status':'ok','data':rows[:50]})

    def test_feed_dates_dedupe_and_failure_preservation(self):
        raw=b'<rss><channel><item><title>Example reports results</title><link>https://example.com/a?utm_source=x</link><pubDate>Mon, 21 Sep 2026 12:00:00 GMT</pubDate></item><item><title>Future</title><link>https://example.com/f</link><pubDate>Wed, 23 Sep 2026 12:00:00 GMT</pubDate></item></channel></rss>'
        rows=parse_feed(raw,self.source,self.now)
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['url'],'https://example.com/a')
        d=assemble({},[(rows,{'status':'ok'})],self.now)
        e=assemble(d,[([],{'status':'failed'})],self.now+timedelta(hours=3))
        self.assertEqual(e['articles'],d['articles'])
        self.assertEqual(e['status'],'failed')
        self.assertEqual(e['last_success_at'],d['last_success_at'])

    def test_schedule_is_not_earnings_and_negation_is_not_positive(self):
        self.assertEqual(classify('Example to report quarterly results',self.source)['event'],'calendar')
        self.assertEqual(classify('Example has no plans to expand HBM capacity',self.source)['event'],'other')
        self.assertEqual(classify('Example reports quarterly results',self.source)['direction'],'要確認')

    def test_unsafe_feeds_and_links_are_not_renderable(self):
        with self.assertRaises(ValueError): parse_feed(b'<!DOCTYPE x><rss/>',self.source,self.now)
        raw=b'<rss><channel><item><title>bad</title><link>javascript:alert(1)</link><pubDate>Mon, 21 Sep 2026 12:00:00 GMT</pubDate></item></channel></rss>'
        self.assertEqual(parse_feed(raw,self.source,self.now),[])

    def test_official_http_and_relative_feed_links_are_normalized(self):
        source=dict(self.source,urls=['https://example.com/rss'])
        for link in ['http://example.com/news/a','/news/a']:
            raw=f'<rss><channel><item><title>Results</title><link>{link}</link><pubDate>Mon, 21 Sep 2026 12:00:00 GMT</pubDate></item></channel></rss>'.encode()
            self.assertEqual(parse_feed(raw,source,self.now)[0]['url'],'https://example.com/news/a')

    def test_context_does_not_turn_demonstrations_or_ventures_into_orders(self):
        optical=classify('Example to Demonstrate VCSEL Optical D2D Connectivity',self.source)
        self.assertEqual(optical['event'],'demonstration')
        self.assertIn('VCSEL',optical['headline_ja'])
        self.assertIn('量産受注とは別',optical['impact'])
        venture=classify('Example Launches Ventures to Expand Investment',self.source)
        self.assertIn('増産が確定したことを意味しません',venture['impact'])
        person=classify('Example Announces Director Retirement',self.source)
        self.assertEqual(person['event'],'governance')
        self.assertEqual(person['related_tickers'],[])

    def test_consumer_ai_and_repeated_announcements_are_not_counted_again(self):
        raw=b'<rss><channel><item><title>New Galaxy AI phone</title><link>https://example.com/a</link><pubDate>Mon, 21 Sep 2026 12:00:00 GMT</pubDate></item></channel></rss>'
        self.assertEqual(parse_feed(raw,dict(self.source,require_keywords=True),self.now),[])
        raw=raw.replace(b'New Galaxy AI phone',b'Example reports results')
        first=parse_feed(raw,self.source,self.now)[0]
        repeat=dict(first,id='repeat',published_at='2026-09-20T12:00:00+00:00')
        output=assemble({},[([first,repeat],{'status':'ok'})],self.now)
        self.assertEqual(len(output['articles']),1)


if __name__=='__main__': unittest.main()
