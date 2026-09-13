"""Display/observation only. Does not import or alter the frozen scoring system.

Returns are decimal, close-to-close, same-provider vintage. RVOL excludes today
from its denominator. Calendar sessions are supplied, never inferred from bars.
"""
import hashlib
import json
import math
from datetime import datetime
from statistics import median


def finite(value, positive=False):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and (value > 0 if positive else value >= 0)


def active_members(rows, as_of):
    # Frozen configuration uses inclusive effective_to; do not redefine it.
    return [dict(r) for r in rows if r.get('role') in ('core', 'related', 'watch')
            and r.get('ticker') and (not r.get('effective_from') or r['effective_from'] <= as_of)
            and (not r.get('effective_to') or as_of <= r['effective_to'])]


def metric(value, eligible, total, metadata):
    return dict(metadata, value=value, eligible_n=eligible, total_n=total,
                coverage=eligible / total if total else None,
                status='missing' if value is None else 'ok' if eligible == total else 'partial')


def stock_metrics(price, sessions, as_of, config):
    metadata = {k: (price or {}).get(k) for k in
                ('data_source', 'adjustment_type', 'split_adjusted', 'dividend_adjusted', 'price_basis', 'source_hash', 'retrieved_at')}
    metadata.update(as_of=as_of, metric_version=config['version'])
    bars = (price or {}).get('bars', [])
    dates = [b.get('session') for b in bars]
    valid = len(dates) == len(set(dates)) and as_of in sessions and (price or {}).get('as_of') == as_of
    # Mixing adjusted and unadjusted prices within a calculation is forbidden.
    valid = valid and metadata['price_basis'] == 'price_return' and bool(metadata['data_source']) and bool(metadata['adjustment_type'])
    by_day = {b.get('session'): b for b in bars} if valid else {}
    calendar = sessions[:sessions.index(as_of)+1] if as_of in sessions else []
    result = {}
    for n in config['return_sessions']:
        window = calendar[-n-1:]
        available = len(window) == n+1 and all(finite(by_day.get(d, {}).get('close'), True) for d in window)
        value = by_day[as_of]['close'] / by_day[window[0]]['close'] - 1 if available else None
        result[f'return_{n}d'] = metric(value, int(available), 1, metadata)
    n = config['rvol_sessions']
    window = calendar[-n-1:]
    volumes = [by_day.get(d, {}).get('volume') for d in window]
    available = len(window) == n+1 and all(finite(v) for v in volumes) and sum(volumes[:-1]) > 0
    result['rvol'] = metric(volumes[-1] / (sum(volumes[:-1])/n) if available else None, int(available), 1, metadata)
    return result


def ranks(snapshot):
    # Exact same eligible set, stable descending order and ordinal ties as themes.js.
    eligible = [t for t in snapshot.get('themes', []) if t.get('score_mode') == 'ranked'
                and t.get('data_quality', {}).get('status') == 'ok'
                and finite((t.get('strength') or {}).get('score'))]
    return {t['theme_id']: i+1 for i, t in enumerate(sorted(eligible, key=lambda t: -t['strength']['score']))}


def rank_history(history, sessions, as_of, offsets, known_at):
    by_day = {}
    for item in history:
        day = item.get('as_of')
        issued = item.get('calculated_at')
        if not day or day > as_of or not issued:
            continue
        try:
            if datetime.fromisoformat(issued) > datetime.fromisoformat(known_at): continue
        except (ValueError, TypeError): continue
        if day not in by_day or item.get('calculated_at', '') > by_day[day].get('calculated_at', ''):
            by_day[day] = item
    index = sessions.index(as_of) if as_of in sessions else -1
    return {str(n): dict(as_of=sessions[index-n] if index >= n else None,
                        ranks=ranks(by_day.get(sessions[index-n], {})) if index >= n else {}) for n in offsets}


def build(prices, memberships, entities, history, sessions, as_of, known_at, config):
    if not config.get('version') or config['rvol_sessions'] < 1:
        raise ValueError('invalid metric configuration')
    if sessions != sorted(set(sessions)) or as_of not in sessions:
        raise ValueError('explicit ordered exchange sessions required')
    for price in prices.values():
        if price.get('retrieved_at') and datetime.fromisoformat(price['retrieved_at']) > datetime.fromisoformat(known_at):
            raise ValueError('future_price_input')
    members = active_members(memberships, as_of)
    snapshot_hash = hashlib.sha256(json.dumps(members, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    names = {r['ticker']: r.get('name') or r['ticker'] for r in entities if r.get('ticker')}
    stocks = {ticker: dict(ticker=ticker, name=names.get(ticker, ticker), **stock_metrics(prices.get(ticker), sessions, as_of, config))
              for ticker in sorted({m['ticker'] for m in members})}
    history_values = rank_history(history, sessions, as_of, config['rank_offsets'], known_at)
    themes = {}
    for theme_id in dict.fromkeys(m['theme_id'] for m in members):
        rows = [dict(ticker=m['ticker'], role=m['role'], **{k:v for k,v in stocks[m['ticker']].items() if k != 'ticker'})
                for m in members if m['theme_id'] == theme_id]
        core = list(dict.fromkeys(m['ticker'] for m in members if m['theme_id'] == theme_id and m['role'] == 'core'))
        data = {}
        for key in [f'return_{n}d' for n in config['return_sessions']] + ['rvol']:
            metrics = [stocks[t][key] for t in core]
            valid = [m for m in metrics if m['value'] is not None]
            basis_keys = ('data_source', 'adjustment_type', 'split_adjusted', 'dividend_adjusted', 'price_basis')
            bases = {tuple(m[k] for k in basis_keys) for m in valid}
            metadata = dict(as_of=as_of, metric_version=config['version'], membership_hash=snapshot_hash,
                            **{k: valid[0][k] if valid and len(bases) == 1 else None for k in basis_keys})
            values = [m['value'] for m in valid] if len(bases) <= 1 else []
            value = (median(values) if key == 'rvol' else sum(values)/len(values)) if values else None
            data[key] = metric(value, len(values), len(core), metadata)
            if len(bases) > 1: data[key]['status'] = 'mixed_basis'
        data['rvol_elevated_n'] = sum(stocks[t]['rvol']['value'] is not None and stocks[t]['rvol']['value'] > config['rvol_elevated_above'] for t in core)
        data['rvol_elevated_above'] = config['rvol_elevated_above']
        data['rank_history'] = {n: dict(as_of=d['as_of'], rank=d['ranks'].get(theme_id)) for n,d in history_values.items()}
        current, previous = (data['rank_history'].get(str(n), {}).get('rank') for n in (0,5))
        data['rank_change_5d'] = previous-current if previous is not None and current is not None else None
        themes[theme_id] = dict(data, members=rows)
    return dict(schema_version='phase_a_v1', metric_version=config['version'], metric_config=config,
                as_of=as_of, known_at=known_at, price_basis='price_return',
                membership_snapshot=members, membership_hash=snapshot_hash,
                usage='display_and_observation_only', themes=themes, stocks=stocks)
