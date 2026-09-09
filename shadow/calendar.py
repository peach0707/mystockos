"""Versioned XNYS session snapshots. No weekday approximations."""
from datetime import date, timedelta
from .store import require, utc


def validate_calendar(calendar):
    require(calendar['exchange'] == 'XNYS', 'only common US-equity sessions supported')
    require(calendar['version'] and calendar['source'], 'calendar provenance missing')
    start, end = date.fromisoformat(calendar['start']), date.fromisoformat(calendar['end'])
    require(start <= end, 'invalid calendar range')
    sessions = calendar['sessions']
    require(bool(sessions), 'empty calendar')
    dates = [s['date'] for s in sessions]
    require(dates == sorted(set(dates)), 'duplicate/unordered sessions')
    closed = calendar['closed_dates']
    require(len(closed) == len(set(closed)) and not set(closed).intersection(dates), 'invalid closures')
    days = {(start + timedelta(days=i)).isoformat() for i in range((end-start).days+1)}
    require(set(dates) | set(closed) == days, 'calendar coverage gap')
    for s in sessions:
        require(utc(s['open']) < utc(s['close']), 'invalid session interval')
        require(s['open'][:10] == s['date'] == s['close'][:10], 'session date mismatch')
    return calendar


def window(calendar, issued_at, horizon):
    validate_calendar(calendar)
    require(horizon in (5, 20, 60) and type(horizon) is int, 'unsupported horizon')
    require(calendar['start'] <= issued_at[:10] <= calendar['end'], 'issue outside calendar coverage')
    future = [s for s in calendar['sessions'] if utc(s['open']) > utc(issued_at)]
    require(len(future) >= horizon, 'calendar does not cover maturity')
    return future[:horizon]


def generate(start, end):
    import exchange_calendars as xcals
    exchange = xcals.get_calendar('XNYS', start=start, end=end)
    schedule = exchange.schedule.loc[start:end]
    def timestamp(v):
        return v.isoformat().replace('+00:00', 'Z')
    sessions = [{'date': str(i.date()), 'open': timestamp(r['open']), 'close': timestamp(r['close'])} for i,r in schedule.iterrows()]
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    open_days = {s['date'] for s in sessions}
    closed = [(first+timedelta(days=i)).isoformat() for i in range((last-first).days+1) if (first+timedelta(days=i)).isoformat() not in open_days]
    return validate_calendar({'exchange':'XNYS','version':f'exchange_calendars-{xcals.__version__}:{start}:{end}', 'source':'https://github.com/gerrymanoim/exchange_calendars', 'start':start,'end':end,'sessions':sessions,'closed_dates':closed})
