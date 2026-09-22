"""Public daily checks and ETF/FX references using the existing provider."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path

from collect_display_metrics import TwelveProvider, collect
from stock_setups import describe, merge_snapshot, atomic_json
from collect_valuation import collect_reference, collect_fx

ROOT = Path(__file__).resolve().parents[1]


def main():
    import exchange_calendars as xc
    now = datetime.now(timezone.utc)
    cal = xc.get_calendar('XNYS',start=f'{now.year-1}-01-01',end=f'{now.year+1}-12-31')
    sessions = [s.date().isoformat() for s in cal.sessions if cal.session_close(s).to_pydatetime() <= now]
    rows = [{'date':s.date().isoformat(),'close':cal.session_close(s).isoformat()} for s in cal.sessions]
    atomic_json(ROOT/'data/market_calendar.json',{'schema_version':1,'start':rows[0]['date'],'end':rows[-1]['date'],'source':'exchange_calendars 4.11.3 / XNYS','sessions':rows})
    config = json.loads((ROOT/'config/briefing.json').read_text())
    as_of = sessions[-1]
    dest = ROOT/'data/stock_setups.json'
    previous = json.loads(dest.read_text()) if dest.exists() else {}
    key = os.environ.get('TWELVE_DATA_API_KEY')
    # An incomplete ticker must not be hidden behind an aggregate 80% cutoff.
    # Reuse valid same-session quotes; retry only the missing/stale entries.
    fresh = {ticker: row for ticker, row in previous.get('stocks', {}).items()
             if ticker in config['symbols'] and row.get('as_of') == as_of
             and row.get('quality') == 'ok' and 'analysis_ready' in row}
    pending = [ticker for ticker in config['symbols'] if ticker not in fresh]
    prices, failures = collect(TwelveProvider(key), pending, as_of)
    for ticker,price in prices.items():
        try:
            fresh[ticker] = describe(price,sessions,as_of)
        except ValueError as error:
            failures.append({'ticker':ticker,'reason':str(error)})
    result = merge_snapshot(previous,fresh,failures,as_of,datetime.now(timezone.utc).isoformat(),config['symbols'])
    atomic_json(dest,result)
    print(json.dumps({'as_of':as_of,'coverage':result['coverage'],'failures':failures}))
    # Each auxiliary source fails independently; a failure never erases quotes.
    for label, task in [('etfs', lambda: collect_reference(ROOT, key, now)),
                        ('fx', lambda: collect_fx(ROOT, key, as_of, datetime.now(timezone.utc)))]:
        try:
            task()
        except (ValueError, KeyError, TypeError) as error:
            print(json.dumps({'component': label, 'status': 'unavailable', 'reason': str(error)}))


if __name__ == '__main__':
    main()
