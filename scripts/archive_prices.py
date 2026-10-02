"""Durable public closes, independent of whether any device opens the app.

Only archive a quote's actual as_of close. Never multiply past holdings by a
split-adjusted historical series. Bootstrap from previously published Git
snapshots, not from invented prices or private portfolio data.
"""
from copy import deepcopy
from datetime import datetime, timezone
import argparse
import json
from pathlib import Path
import re
import subprocess

from stock_setups import atomic_json, positive

ROOT = Path(__file__).resolve().parents[1]
LIMIT = 3660


def day(value):
    try:
        return isinstance(value, str) and datetime.strptime(value, '%Y-%m-%d').date().isoformat() == value
    except ValueError:
        return False


def empty_archive():
    return {'schema_version': 1, 'price_basis': 'as_reported_daily_close',
            'source': 'Twelve Data / previously published closing snapshots',
            'as_of': '1970-01-01', 'stocks': {},
            'fx': {'pair': 'USD/JPY', 'basis': 'completed_UTC_daily_close', 'history': []}}


def merge_archive(previous, setups, fx, now):
    result = deepcopy(previous or empty_archive())
    if result.get('schema_version') != 1 or result.get('price_basis') != 'as_reported_daily_close':
        raise ValueError('invalid_price_archive')
    cutoff = now.date().isoformat()
    for ticker, quote in setups.get('stocks', {}).items():
        date, price, currency = quote.get('as_of'), quote.get('price'), quote.get('currency')
        if (not re.fullmatch(r'[A-Z0-9.^=-]{1,20}', ticker) or quote.get('ticker') != ticker
                or quote.get('quality') != 'ok' or not day(date) or date >= cutoff
                or not positive(price) or currency not in ('USD', 'JPY')):
            continue
        old = result['stocks'].get(ticker, {'currency': currency, 'history': []})
        if old['currency'] != currency:
            continue
        rows = {r['date']: r for r in old['history']}
        rows[date] = {'date': date, 'close': price}
        result['stocks'][ticker] = {'currency': currency,
                                   'history': [rows[d] for d in sorted(rows)[-LIMIT:]]}
    if fx.get('pair') == 'USD/JPY' and fx.get('basis') == 'completed_UTC_daily_close':
        rows = {r['date']: r for r in result['fx']['history']}
        candidates = list(fx.get('history', []))
        if fx.get('quality') == 'ok':
            candidates.append({'date': fx.get('as_of'), 'rate': fx.get('rate')})
        for row in candidates:
            date, rate = row.get('date'), row.get('rate')
            if day(date) and date < cutoff and positive(rate):
                rows[date] = {'date': date, 'rate': rate}
        result['fx']['history'] = [rows[d] for d in sorted(rows)[-LIMIT:]]
    dates = [r['date'] for stock in result['stocks'].values() for r in stock['history']]
    result['as_of'] = max(dates, default=result['as_of'])
    # Stable bytes on no-op runs; failed collectors must not erase healthy data.
    if result != previous:
        result['updated_at'] = now.isoformat()
    return result


def bootstrap_git(root, archive, now):
    paths = ['data/stock_setups.json', 'data/fx.json']
    commits = subprocess.check_output(['git', 'log', '--reverse', '--format=%H', 'HEAD', '--', *paths], cwd=root, text=True).splitlines()
    for commit in commits:
        values = []
        for path in paths:
            data = subprocess.run(['git', 'show', f'{commit}:{path}'], cwd=root, capture_output=True, text=True)
            values.append(json.loads(data.stdout) if data.returncode == 0 else {})
        archive = merge_archive(archive, *values, now)
    return archive


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--from-git', action='store_true')
    args = parser.parse_args()
    now = datetime.now(timezone.utc)
    dest = ROOT / 'data/price_archive.json'
    archive = json.loads(dest.read_text()) if dest.exists() else empty_archive()
    if args.from_git:
        archive = bootstrap_git(ROOT, archive, now)
    read = lambda name: json.loads((ROOT / 'data' / name).read_text())
    result = merge_archive(archive, read('stock_setups.json'), read('fx.json'), now)
    atomic_json(dest, result)
    print(json.dumps({'archive_as_of': result['as_of'], 'symbols': len(result['stocks']),
                      'closes': sum(len(r['history']) for r in result['stocks'].values()),
                      'fx_dates': len(result['fx']['history'])}))


if __name__ == '__main__':
    main()
