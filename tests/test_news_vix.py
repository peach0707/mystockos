import sys
import unittest
from pathlib import Path
from datetime import datetime, timezone
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from collect_vix import parse, collect
from summarize_news import allowed, extract_body, validate_summary, enrich

class NewsVixTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026,10,2,12,tzinfo=timezone.utc)

    def test_vix_invalid_future_and_fallback(self):
        text='DATE,CLOSE\n09/30/2026,16\n10/01/2026,18\n10/03/2026,99\n10/02/2026,nan\n'
        self.assertEqual(parse(text,self.now)['close'],18)
        old={'as_of':'2026-10-01','close':18}
        def fail(url): raise ValueError('offline')
        result=collect(old,self.now,fail)
        self.assertEqual(result['close'],18)
        self.assertEqual(result['fetch_status'],'failed')

    def test_official_body_and_redirect_boundaries(self):
        self.assertTrue(allowed('https://example.com/a',{'example.com'}))
        self.assertFalse(allowed('https://example.com.evil.test/a',{'example.com'}))
        self.assertFalse(allowed('http://example.com/a',{'example.com'}))
        body='Company announced a new memory product. '*20
        html='<nav>ignore navigation</nav><article><p>'+body+'</p><script>ignore()</script></article>'
        result=extract_body(html)
        self.assertNotIn('ignore',result)
        with self.assertRaises(ValueError):extract_body('<html>Access denied</html>')

    def test_summary_requires_japanese_and_literal_body_evidence(self):
        body='Company announced a new memory product.'
        value={k:'新しいメモリ製品を発表しました。' for k in ['headline_ja','summary_ja','impact_ja','watch_ja']}
        value['evidence']=[body]
        self.assertIn('summary_ja',validate_summary(value,body))
        value['evidence']=['A different unsupported statement.']
        with self.assertRaises(ValueError):validate_summary(value,body)

    def test_good_brief_is_cached_not_replaced(self):
        from summarize_news import VERSION
        row={'title':'Title','source_id':'micron','published_at':'2026-10-01T12:00:00+00:00','brief':{'status':'ready','version':VERSION,'title':'Title'}}
        output=enrich({'articles':[row]},[],self.now,token='fixture')
        self.assertEqual(output['summary_coverage']['ready'],1)

if __name__=='__main__':unittest.main()
