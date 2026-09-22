"""Descriptive price checks, separate from frozen scores and manual decisions.

No return forecasts, orders, portfolio information or validated buy/sell claims.
All windows require consecutive exchange sessions. Thresholds are disclosed in UI.
"""
import json
import math
from pathlib import Path

VERSION = 'decision-checks-v1'


def positive(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) and x > 0


def describe(price, sessions, as_of):
    if not price or price.get('as_of') != as_of or as_of not in sessions:
        raise ValueError('missing_session')
    bars = price.get('bars', [])
    by_day = {b['session']: b for b in bars}
    if len(by_day) != len(bars):
        raise ValueError('duplicate_session')
    window = sessions[:sessions.index(as_of)+1][-64:]
    if len(window) < 64 or any(not positive(by_day.get(d, {}).get('close')) for d in window):
        raise ValueError('incomplete_history')
    closes = [by_day[d]['close'] for d in window]
    volumes = [by_day[d].get('volume') for d in window[-21:]]
    usable_volume = all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v >= 0 for v in volumes)
    rvol = volumes[-1] / (sum(volumes[:-1])/20) if usable_volume and sum(volumes[:-1]) > 0 else None
    last = closes[-1]
    ma20, ma50 = sum(closes[-20:])/20, sum(closes[-50:])/50
    prior_high, prior_low = max(closes[-21:-1]), min(closes[-21:-1])
    changes = [b-a for a,b in zip(closes[-15:-1], closes[-14:])]
    gain = sum(max(d,0) for d in changes)/14
    loss = sum(max(-d,0) for d in changes)/14
    rsi = 100-100/(1+gain/loss) if loss else 100 if gain else 50
    return {
        'ticker': price['ticker'], 'as_of': as_of, 'price': last,
        'currency': price['currency'], 'exchange': price['exchange'],
        'source': price['data_source'], 'source_hash': price['source_hash'],
        'retrieved_at': price['retrieved_at'], 'price_basis': price['price_basis'],
        'adjustment_type': price['adjustment_type'], 'quality': 'ok',
        'day': (last/closes[-2]-1)*100, 'ma20': ma20, 'ma50': ma50,
        'prior_high20': prior_high, 'prior_low20': prior_low,
        'rsi14_simple': rsi, 'rvol': rvol,
        'distance_ma20_pct': (last/ma20-1)*100,
        'trend_up': last > ma50 and ma20 > ma50,
        'breakout': last > prior_high,
        'breakdown': last < prior_low,
        'overheated': rsi >= 70 or last/ma20 >= 1.10,
        'history': [{'date':d,'close':by_day[d]['close']} for d in window],
        'returns': {str(n):(last/closes[-n-1]-1)*100 for n in (1,5,21,63)}
    }


def merge_snapshot(previous, fresh, failures, as_of, now, universe):
    prior = previous.get('stocks', {})
    output = {}
    reasons = {f['ticker']:f['reason'] for f in failures}
    for ticker in universe:
        candidate = fresh.get(ticker)
        old = prior.get(ticker)
        if candidate and (not old or candidate['as_of'] >= old.get('as_of','')):
            output[ticker] = candidate
        elif old:
            output[ticker] = dict(old, quality='stale', failure=reasons.get(ticker,'not_refreshed'))
        else:
            output[ticker] = {'ticker':ticker,'as_of':None,'quality':'missing','failure':reasons.get(ticker,'not_available')}
    return {'schema_version':1,'rule_version':VERSION,'usage':'descriptive_checks_only',
            'as_of':as_of,'checked_at':now,'stocks':output,
            'coverage':{'ok':sum(s['quality']=='ok' for s in output.values()),'total':len(universe)},
            'failures':failures}


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n')
    temporary.replace(path)
