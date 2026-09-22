"""Public daily checks and ETF/FX references using the existing provider."""
from datetime import datetime, timezone
import json
import os
import re
from pathlib import Path

from collect_display_metrics import TwelveProvider, collect
from stock_setups import describe, merge_snapshot, atomic_json
from collect_valuation import collect_reference, collect_fx

ROOT = Path(__file__).resolve().parents[1]


def quote_universe(config, reference, previous=None):
    """Discover actual listed ETF symbols, never synthesize leveraged prices.

    Public reference data only: no portfolio is uploaded. Single-letter ticker
    matches and non-exchange/mutual-fund reference rows must not expand this list.
    Previously discovered targets survive a reference outage or delisting.
    """
    explicit = list(dict.fromkeys(config['symbols']))
    options = config.get('automatic_etfs', {})
    automatic = set((previous or {}).get('universe', {}).get('automatic_symbols', []))
    if options.get('enabled'):
        words = [s for s in explicit if len(s) > 1] + options.get('underlying_names', [])
        underlying = re.compile(r'(?<![A-Z0-9])(?:' + '|'.join(re.escape(s) for s in words) + r')(?![A-Z0-9])', re.I)
        topics = options.get('topics', [])
        topic = re.compile(r'\b(?:' + '|'.join(re.escape(s) for s in topics) + r')\b', re.I) if topics else None
        leverage = re.compile(r'\b[123](?:x|×)\b|\bbull\b|\bbear\b|\bultra|\binverse\b|\bweeklypay\b', re.I)
        for row in reference.get('symbols', []):
            symbol, name = row.get('symbol', ''), row.get('name', '')
            if (row.get('country') != 'United States' or row.get('currency') != 'USD'
                    or row.get('type') != 'ETF' or not re.fullmatch(r'[A-Z][A-Z0-9]{0,4}', symbol)
                    or row.get('mic_code') not in {'XNAS', 'XNYS', 'ARCX', 'XASE', 'BATS', 'XCBO'}
                    or not re.search(r'\bETF\b|\bETNs?\b|\bShares\b', name, re.I)):
                continue
            if (topic and topic.search(name)) or (leverage.search(name) and underlying.search(name)):
                automatic.add(symbol)
    automatic.difference_update(explicit)
    automatic = sorted(s for s in automatic if re.fullmatch(r'[A-Z][A-Z0-9]{0,4}', s))
    return explicit + automatic, automatic


def pending_symbols(universe, explicit, fresh, previous):
    priority = {ticker: n for n, ticker in enumerate(explicit)}
    def order(ticker):
        row = previous.get('stocks', {}).get(ticker, {})
        return (0, priority[ticker]) if ticker in priority else (1, row.get('last_attempt_at') or row.get('retrieved_at') or '', ticker)
    return sorted((s for s in universe if s not in fresh), key=order)


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
    # Refresh references before deriving the price universe, including new ETFs.
    for label, task in [('etfs', lambda: collect_reference(ROOT, key, now)),
                        ('fx', lambda: collect_fx(ROOT, key, as_of, datetime.now(timezone.utc)))]:
        try:
            task()
        except (ValueError, KeyError, TypeError) as error:
            print(json.dumps({'component': label, 'status': 'unavailable', 'reason': str(error)}))
    reference_path = ROOT/'data/etfs.json'
    reference = json.loads(reference_path.read_text()) if reference_path.exists() else {}
    universe, automatic = quote_universe(config, reference, previous)
    # An incomplete ticker must not be hidden behind an aggregate 80% cutoff.
    # Reuse valid same-session quotes; retry only the missing/stale entries.
    fresh = {}
    for ticker, row in previous.get('stocks', {}).items():
        if (ticker not in universe or row.get('as_of') != as_of or row.get('quality') != 'ok'
                or not isinstance(row.get('price'), (float, int)) or not 0 < row['price'] < float('inf')):
            continue
        if 'analysis_ready' in row:
            fresh[ticker] = row
        elif len(row.get('history', [])) == 64:
            # v1 already verified the same 64 consecutive closes. Reusing it
            # needs no paid/API refetch merely to attach window metadata.
            fresh[ticker] = dict(row, history_sessions=64, analysis_ready=True,
                                 analysis_quality='ok', previous_close=row['history'][-2]['close'])
    pending = pending_symbols(universe, config['symbols'], fresh, previous)
    budget = min(120, max(1, int(config.get('max_requests_per_run', 120))))
    failures = []
    attempts = {}
    def snapshot():
        result = merge_snapshot(previous, fresh, failures, as_of, datetime.now(timezone.utc).isoformat(), universe)
        for ticker, stamp in attempts.items():
            result['stocks'][ticker]['last_attempt_at'] = stamp
        result['universe'] = {'mode': 'explicit_and_reference_etfs', 'reference_as_of': reference.get('as_of'),
                              'automatic_symbols': automatic}
        result['collection'] = {'attempted': len(attempts), 'budget': budget,
                                'pending': [s for s in universe if s not in fresh]}
        return result
    provider = TwelveProvider(key)
    for ticker in pending[:budget]:
        attempts[ticker] = datetime.now(timezone.utc).isoformat()
        prices, failed = collect(provider, [ticker], as_of)
        failures.extend(failed)
        if ticker in prices:
            try:
                fresh[ticker] = describe(prices[ticker], sessions, as_of)
            except ValueError as error:
                failures.append({'ticker': ticker, 'reason': str(error)})
        # Preserve completed work if a later symbol or runner fails.
        atomic_json(dest, snapshot())
        if any(f['reason'] in ('rate_limited','secret_missing') for f in failed):
            break
    result = snapshot()
    atomic_json(dest,result)
    print(json.dumps({'as_of':as_of,'coverage':result['coverage'],'failures':failures}))
    if result['collection']['pending']:
        print('::warning::Closing prices still pending: ' + ', '.join(result['collection']['pending']))


if __name__ == '__main__':
    main()
