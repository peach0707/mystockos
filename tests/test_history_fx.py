import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from refresh_history_fx import last_closed_session

class HistoryFXTest(unittest.TestCase):
    def test_closed_session_not_japanese_display_day(self):
        calendar = {'sessions': [{'date':'2026-10-01','close':'2026-10-01T20:00:00Z'}, {'date':'2026-10-02','close':'2026-10-02T20:00:00Z'}]}
        self.assertEqual(last_closed_session(calendar, datetime(2026,10,2,19,tzinfo=timezone.utc)), '2026-10-01')
        self.assertEqual(last_closed_session(calendar, datetime(2026,10,3,4,tzinfo=timezone.utc)), '2026-10-02')
