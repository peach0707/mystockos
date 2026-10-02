import unittest
from datetime import datetime, timezone
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from archive_prices import merge_archive, empty_archive


class PriceArchiveTests(unittest.TestCase):
    now = datetime(2026, 10, 2, 4, tzinfo=timezone.utc)

    def quote(self, date='2026-10-01', price=20, **extra):
        return {'stocks': {'SNDU': dict(ticker='SNDU', as_of=date, price=price, currency='USD', quality='ok', **extra)}}

    def test_only_actual_dated_close_not_adjusted_history(self):
        result = merge_archive(empty_archive(), self.quote(history=[{'date': '2026-09-30', 'close': 999}]), {}, self.now)
        self.assertEqual(result['stocks']['SNDU']['history'], [{'date': '2026-10-01', 'close': 20}])

    def test_unopened_days_accumulate_and_split_does_not_rewrite_previous_close(self):
        first = merge_archive(empty_archive(), self.quote('2026-09-30', 100), {}, self.now)
        second = merge_archive(first, self.quote(price=10, history=[{'date': '2026-09-30', 'close': 10}]), {}, self.now)
        self.assertEqual([r['close'] for r in second['stocks']['SNDU']['history']], [100, 10])
        self.assertEqual(merge_archive(second, self.quote(price=10), {}, self.now), second)

    def test_failure_future_and_invalid_quotes_never_replace_history(self):
        first = merge_archive(empty_archive(), self.quote(), {}, self.now)
        for update in [self.quote('2026-10-02'), self.quote(price=0), self.quote(price=float('inf')),
                       {'stocks': {'SNDU': {'ticker': 'SNDU', 'quality': 'missing'}}}]:
            self.assertEqual(merge_archive(first, update, {}, self.now), first)

    def test_fx_accumulates_and_rejects_inverse_and_future(self):
        fx = {'pair': 'USD/JPY', 'basis': 'completed_UTC_daily_close', 'history': [{'date': '2026-09-30', 'rate': 145}, {'date': '2026-10-02', 'rate': 150}]}
        first = merge_archive(empty_archive(), {}, fx, self.now)
        self.assertEqual(first['fx']['history'], [{'date': '2026-09-30', 'rate': 145}])
        fx.update(pair='JPY/USD')
        self.assertEqual(merge_archive(first, {}, fx, self.now), first)


if __name__ == '__main__':
    unittest.main()
