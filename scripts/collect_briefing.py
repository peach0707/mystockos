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
    fresh = {}
    for ticker, row in previous.get('stocks', {}).items():
        if ticker not in config['symbols'] or row.get('as_of') != as_of or row.get('quality') != 'ok':
            continue
        if 'analysis_ready' in row:
            fresh[ticker] = row
        elif len(row.get('history', [])) == 64:
            # v1 already verified the same 64 consecutive closes. Reusing it
            # needs no paid/API refetch merely to attach window metadata.
            fresh[ticker] = dict(row, history_sessions=64, analysis_ready=True,
                                 analysis_quality='ok', previous_close=row['history'][-2]['close'])
    # Each auxiliary source fails independently; a failure never erases quotes.
    for label, task in [('etfs', lambda: collect_reference(ROOT, key, now)),
                        ('fx', lambda: collect_fx(ROOT, key, as_of, datetime.now(timezone.utc)))]:
        try:
            task()
        except (ValueError, KeyError, TypeError) as error:
            print(json.dumps({'component': label, 'status': 'unavailable', 'reason': str(error)}))
    pending = [ticker for ticker in dict.fromkeys(['SKHY','MUU'] + config['symbols'])
               if ticker in config['symbols'] and ticker not in fresh]
    failures = []
    provider = TwelveProvider(key)
    for ticker in pending:
        prices, failed = collect(provider, [ticker], as_of)
        failures.extend(failed)
        if ticker in prices:
            try:
                fresh[ticker] = describe(prices[ticker], sessions, as_of)
            except ValueError as error:
                failures.append({'ticker': ticker, 'reason': str(error)})
        # Preserve completed work if a later symbol or runner fails.
        atomic_json(dest, merge_snapshot(previous, fresh, failures, as_of,
                                        datetime.now(timezone.utc).isoformat(), config['symbols']))
        if any(f['reason'] in ('rate_limited','secret_missing') for f in failed):
            break
    result = merge_snapshot(previous,fresh,failures,as_of,datetime.now(timezone.utc).isoformat(),config['symbols'])
    atomic_json(dest,result)
    print(json.dumps({'as_of':as_of,'coverage':result['coverage'],'failures':failures}))


if __name__ == '__main__':
    main()
