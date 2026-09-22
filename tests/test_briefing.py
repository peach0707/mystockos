import json
from datetime import datetime, timezone, timedelta
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from stock_setups import describe, merge_snapshot
from collect_news import parse_feed, assemble, classify


class BriefingTests(unittest.TestCase):
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


if __name__=='__main__': unittest.main()
