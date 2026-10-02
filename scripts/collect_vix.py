"""Independent daily VIX refresh. Failure never overwrites a valid close."""
import csv
import io
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from stock_setups import atomic_json

ROOT = Path(__file__).resolve().parents[1]
SOURCES = [('Cboe', 'https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv'), ('FRED / Cboe', 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=VIXCLS')]


def parse(text, now):
    rows = {}
    for row in csv.DictReader(io.StringIO(text.lstrip('\ufeff'))):
        try:
            day = row.get('DATE') or row.get('observation_date')
            date = datetime.strptime(day, '%m/%d/%Y' if '/' in day else '%Y-%m-%d').date().isoformat()
            value = float(row.get('CLOSE', row.get('VIXCLS', '')))
            if date <= now.date().isoformat() and math.isfinite(value) and value > 0:
                rows[date] = value
        except (ValueError, TypeError):
            continue
    if len(rows) < 2:
        raise ValueError('insufficient_vix_data')
    dates = sorted(rows)
    return {'as_of': dates[-1], 'close': rows[dates[-1]], 'previous_close': rows[dates[-2]], 'previous_as_of': dates[-2]}


def collect(previous, now, fetch):
    candidates = []
    errors = []
    for source, url in SOURCES:
        try:
            candidates.append(dict(parse(fetch(url), now), source=source, url=url))
        except Exception as error:
            errors.append({'source': source, 'reason': type(error).__name__})
    if previous.get('close'):
        candidates.append(previous)
    result = dict(max(candidates, key=lambda x: x['as_of'])) if candidates else {'as_of': None, 'close': None}
    result.update(schema_version=1, checked_at=now.isoformat(), fetch_status='ok' if len(errors) < len(SOURCES) else 'failed', errors=errors, basis='daily_close')
    return result


def main():
    path = ROOT / 'data/vix.json'
    previous = json.loads(path.read_text()) if path.exists() else {}
    def fetch(url):
        with urlopen(Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=25) as response:
            return response.read(3_000_000).decode('utf-8-sig')
    output = collect(previous, datetime.now(timezone.utc), fetch)
    atomic_json(path, output)
    print(json.dumps(output))


if __name__ == '__main__':
    main()
