"""Refresh completed daily FX without waiting for article summaries."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
from collect_valuation import collect_fx
from archive_prices import merge_archive
from stock_setups import atomic_json

ROOT = Path(__file__).resolve().parents[1]

def last_closed_session(calendar, now):
    days = [s['date'] for s in calendar.get('sessions', [])
            if datetime.fromisoformat(s['close'].replace('Z', '+00:00')) <= now]
    if not days:
        raise ValueError('no_completed_session')
    return max(days)

def main():
    now = datetime.now(timezone.utc)
    read = lambda name: json.loads((ROOT / 'data' / name).read_text())
    as_of = last_closed_session(read('market_calendar.json'), now)
    # collect_fx itself excludes unfinished UTC candles and preserves good data.
    collect_fx(ROOT, os.environ.get('TWELVE_DATA_API_KEY'), as_of, now)
    result = merge_archive(read('price_archive.json'), read('stock_setups.json'), read('fx.json'), now)
    atomic_json(ROOT / 'data/price_archive.json', result)
    print(json.dumps({'price_session': as_of, 'fx_date': read('fx.json')['as_of']}))

if __name__ == '__main__':
    main()
