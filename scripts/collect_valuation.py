"""Public ETF identities and completed UTC USD/JPY daily rates. No holdings input."""
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, build_opener

from collect_display_metrics import NoRedirect
from stock_setups import atomic_json


def request_json(path, key, opener=None):
    if not key:
        raise ValueError('secret_missing')
    try:
        request = Request('https://api.twelvedata.com/' + path,
                          headers={'Authorization': 'apikey ' + key})
        with (opener or build_opener(NoRedirect())).open(request, timeout=40) as response:
            raw = response.read(8000001)
        if len(raw) > 8000000 or key.encode() in raw:
            raise ValueError('invalid_response')
        payload = json.loads(raw)
        if payload.get('code') == 429:
            raise ValueError('rate_limited')
        if payload.get('status') != 'ok':
            raise ValueError('unavailable')
        return payload, hashlib.sha256(raw).hexdigest()
    except HTTPError as error:
        raise ValueError('rate_limited' if error.code == 429 else 'http_' + str(error.code)) from None
    except (URLError, TimeoutError, OSError):
        raise ValueError('network_failure') from None
    except (TypeError, KeyError, AttributeError, UnicodeError, json.JSONDecodeError):
        raise ValueError('invalid_response') from None


def normalize_etfs(payload):
    if payload.get('status') != 'ok' or not isinstance(payload.get('data'), list):
        raise ValueError('invalid_etf_reference')
    records = {}
    for row in payload['data']:
        symbol = str(row.get('symbol', '')).strip().upper()
        if row.get('country') != 'United States' or row.get('currency') != 'USD':
            continue
        if not re.fullmatch(r'[A-Z0-9.^=-]{1,20}', symbol) or not row.get('name') or not row.get('exchange'):
            continue
        identity = '|'.join([symbol, row.get('mic_code') or row['exchange'], row['country']])
        records[identity] = {k: row.get(k, '') for k in ('name', 'exchange', 'mic_code', 'country', 'currency')}
        records[identity].update(id=identity, symbol=symbol, type='ETF')
    if len(records) < 500 or not any(r['symbol'] == 'MUU' for r in records.values()):
        raise ValueError('incomplete_etf_reference')
    return sorted(records.values(), key=lambda row: (row['symbol'], row['exchange'], row['id']))


def normalize_fx(payload, source_hash, as_of, now):
    meta = payload.get('meta', {})
    if payload.get('status') != 'ok' or meta.get('symbol') != 'USD/JPY' or meta.get('interval') != '1day':
        raise ValueError('fx_identity_mismatch')
    cutoff = min(as_of, (now - timedelta(days=1)).date().isoformat())
    rows = []
    seen = set()
    for row in payload.get('values', []):
        day = datetime.strptime(row['datetime'], '%Y-%m-%d').date().isoformat()
        if day in seen:
            raise ValueError('duplicate_fx_date')
        seen.add(day)
        rate = float(row['close'])
        if not math.isfinite(rate) or rate <= 0:
            raise ValueError('invalid_fx_rate')
        if day <= cutoff:
            rows.append({'date': day, 'rate': rate})
    rows.sort(key=lambda row: row['date'])
    if not rows or (datetime.fromisoformat(cutoff) - datetime.fromisoformat(rows[-1]['date'])).days > 4:
        raise ValueError('stale_fx')
    return {'schema_version': 1, 'pair': 'USD/JPY', 'as_of': rows[-1]['date'],
            'rate': rows[-1]['rate'], 'quality': 'ok', 'source': 'Twelve Data',
            'basis': 'completed_UTC_daily_close', 'source_hash': source_hash,
            'retrieved_at': now.isoformat(), 'history': rows}


def collect_reference(root, key, now):
    dest = root / 'data/etfs.json'
    previous = json.loads(dest.read_text()) if dest.exists() else {}
    if previous.get('as_of') == now.date().isoformat():
        return
    payload, digest = request_json('etfs?country=United%20States', key)
    rows = normalize_etfs(payload)
    if len(rows) < len(previous.get('symbols', [])) * .85:
        raise ValueError('etf_reference_shrink')
    atomic_json(dest, {'schema_version': 1, 'as_of': now.date().isoformat(),
                      'source': 'Twelve Data /etfs', 'source_hash': digest,
                      'scope': 'United States / USD ETFs', 'symbols': rows})
    print(json.dumps({'etf_listings': len(rows)}))


def collect_fx(root, key, as_of, now):
    dest = root / 'data/fx.json'
    previous = json.loads(dest.read_text()) if dest.exists() else {}
    cutoff = min(as_of, (now - timedelta(days=1)).date().isoformat())
    if previous.get('as_of') == cutoff and previous.get('quality') == 'ok':
        return
    try:
        query = urlencode(dict(symbol='USD/JPY', interval='1day', outputsize=8,
                               timezone='UTC', end_date=cutoff))
        payload, digest = request_json('time_series?' + query, key)
        result = normalize_fx(payload, digest, as_of, now)
        if previous.get('as_of', '') > result['as_of']:
            raise ValueError('fx_date_regression')
        atomic_json(dest, result)
        print(json.dumps({'fx_as_of': result['as_of'], 'fx_quality': 'ok'}))
    except ValueError as error:
        if previous:
            atomic_json(dest, dict(previous, quality='stale', failure=str(error)))
        raise
