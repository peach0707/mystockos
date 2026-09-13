"""Independent Phase A collector. Never writes frozen files or personal data."""
import argparse
import csv
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, HTTPRedirectHandler, build_opener
from display_metrics import active_members, build

ROOT = Path(__file__).resolve().parents[1]
BASIS = dict(data_source='Twelve Data', adjustment_type='provider_default_daily_split',
             split_adjusted=True, dividend_adjusted=False, price_basis='price_return',
             adjustment_verification='provider_documentation_not_independent_event_reconciliation',
             provider_version='twelve_display_daily_v1')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class TwelveProvider:
    """Replaceable provider: fetch(ticker, as_of) -> normalized daily OHLCV."""
    def __init__(self, key, opener=None):
        self.key = key
        self.opener = opener or build_opener(NoRedirect())

    def fetch(self, ticker, as_of):
        if not self.key: raise ValueError('secret_missing')
        url = 'https://api.twelvedata.com/time_series?' + urlencode(dict(symbol=ticker, interval='1day', outputsize=100))
        try:
            with self.opener.open(Request(url, headers={'Authorization':'apikey '+self.key}), timeout=25) as response:
                raw = response.read(250001)
            if len(raw)>250000 or self.key.encode() in raw: raise ValueError('invalid_response')
            payload = json.loads(raw)
            if payload.get('code') == 429: raise ValueError('rate_limited')
            if payload.get('status') != 'ok': raise ValueError('unavailable')
            meta = payload['meta']
            if meta.get('symbol') != ticker or meta.get('interval') != '1day' or meta.get('currency') != 'USD' or not meta.get('exchange'):
                raise ValueError('identity_or_currency_mismatch')
            bars = []
            for row in payload['values']:
                day = datetime.strptime(row['datetime'], '%Y-%m-%d').date().isoformat()
                if day > as_of: raise ValueError('unclosed_bar')
                price = float(row['close'])
                if not math.isfinite(price) or price <= 0: raise ValueError('invalid_price')
                volume = None
                try:
                    v = float(row.get('volume'))
                    if math.isfinite(v) and v >= 0: volume = v
                except (TypeError, ValueError): pass
                bars.append(dict(session=day, close=price, volume=volume))
            if len({b['session'] for b in bars}) != len(bars): raise ValueError('duplicate_bar')
            if not any(b['session'] == as_of for b in bars): raise ValueError('stale_prices')
            return dict(BASIS, ticker=ticker, as_of=as_of, exchange=meta['exchange'], currency='USD', bars=bars,
                        source_hash=hashlib.sha256(raw).hexdigest(),retrieved_at=datetime.now(timezone.utc).isoformat())
        except HTTPError as e:
            raise ValueError('rate_limited' if e.code == 429 else 'http_'+str(e.code)) from None
        except (URLError, TimeoutError, OSError): raise ValueError('network_failure') from None
        except (TypeError, KeyError, AttributeError, UnicodeError): raise ValueError('invalid_response') from None
        except ValueError as e:
            allowed = {'rate_limited','unavailable','identity_or_currency_mismatch','unclosed_bar','invalid_price','duplicate_bar','stale_prices'}
            raise ValueError(str(e) if str(e) in allowed else 'invalid_response') from None


def collect(provider, tickers, as_of, spacing=True):
    prices, failures = {}, []
    # <=120 credits/run, <=4/min; no immediate retries. Private collector has its own budget.
    for ticker in sorted(set(tickers))[:120]:
        if spacing:
            while datetime.now(timezone.utc).minute % 30 < 5: time.sleep(20)
        try: prices[ticker] = provider.fetch(ticker, as_of)
        except ValueError as e:
            failures.append(dict(ticker=ticker, reason=str(e)))
            if str(e) in ('rate_limited','secret_missing'): break
        if spacing: time.sleep(16)
    return prices, failures


def save(root, result):
    """One immutable daily artifact, plus replaceable latest view; no zero-filled fallback."""
    body = json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)+'\n'
    archive = root/'data/phase-a-observations'/result['as_of'][:7]/(hashlib.sha256(body.encode()).hexdigest()+'.json')
    archive.parent.mkdir(parents=True, exist_ok=True)
    if not archive.exists():
        with archive.open('x') as f: f.write(body)
    latest = root/'data/phase_a.json'
    if latest.exists():
        previous = json.loads(latest.read_text())
        if previous['as_of'] > result['as_of']: return
        old_n = sum(s['return_1d']['value'] is not None for s in previous['stocks'].values())
        new_n = sum(s['return_1d']['value'] is not None for s in result['stocks'].values())
        if old_n and (not new_n or previous['as_of'] == result['as_of'] and new_n < old_n): return
    temporary = latest.with_suffix('.tmp')
    temporary.write_text(body)
    temporary.replace(latest)


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--offline-prices', type=Path)
    args = parser.parse_args()
    import exchange_calendars as xc
    stamp = datetime.now(timezone.utc)
    calendar = xc.get_calendar('XNYS', start=f'{stamp.year-2}-01-01', end=f'{stamp.year+1}-12-31')
    sessions = [s.date().isoformat() for s in calendar.sessions if calendar.session_close(s).to_pydatetime() <= stamp]
    as_of = sessions[-1]
    config = json.loads((ROOT/'config/display_metrics.json').read_text())
    def rows(path):
        with (ROOT/path).open() as f: return list(csv.DictReader(f))
    members = rows('config/memberships.csv'); entities = rows('config/entities.csv')
    history = [json.loads(line) for line in (ROOT/'data/theme_history.jsonl').read_text().splitlines() if line.strip()]
    history.append(json.loads((ROOT/'data/themes.json').read_text()))
    if args.offline_prices:
        prices, failures = json.loads(args.offline_prices.read_text()), []
    else:
        prices, failures = collect(TwelveProvider(os.environ.get('TWELVE_DATA_API_KEY')),
                                   [m['ticker'] for m in active_members(members, as_of)], as_of)
    result = build(prices, members, entities, history, sessions, as_of, datetime.now(timezone.utc).isoformat(), config)
    result['source_commit'] = os.environ.get('GITHUB_SHA')
    result['input_hashes'] = {p: hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in
                            ('config/memberships.csv','config/entities.csv','config/display_metrics.json','data/themes.json','data/theme_history.jsonl')}
    result['collection'] = dict(available_n=len(prices), failures=failures)
    save(ROOT, result)
    print(json.dumps(dict(as_of=as_of, available_n=len(prices), failures_n=len(failures), usage=result['usage'])))


if __name__ == '__main__': main()
