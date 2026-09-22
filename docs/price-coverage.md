# Public closing-price coverage

Search availability and price availability are different. The app is a static,
device-local portfolio tool; no holdings, quantities, costs or brokerage names
are sent to the collector. Never publish a user's backup to extend coverage.

## Target selection

`scripts/collect_briefing.py` builds one universe from:

- Explicit priority symbols in `config/briefing.json` (including SNDU and DRAM).
- Actual US/USD exchange-listed ETFs in `data/etfs.json` matching the configured
  semiconductor/memory/photonics topics or leveraged exposure to priority stocks.
- Previously discovered targets, so a reference outage cannot erase coverage.

The reference is refreshed before selection. A newly listed matching ETF therefore
does not need its ticker manually added to a second list. Do not synthesize ETF
prices from the underlying stock or apply leverage to the underlying price.

This is not a universal/on-demand price API. Unrelated equities, unmatched funds,
OTC listings, suspended/delisted instruments and provider-unsupported symbols may
remain unavailable. Supporting arbitrary device-selected symbols automatically
would require a separately authorized authenticated backend and API budget;
never embed a provider key or GitHub token in this public app.

## Quota and failures

Keep the existing 4-credits/minute pacing and a maximum of 120 requests per run.
Reuse valid same-session quotes. Explicit targets are first, then never-attempted
or least-recently-attempted discovered targets. The two existing daily collection
runs retry the remaining targets without redownloading successes. Partial work is
checkpointed and previous quotes are retained, marked stale rather than zero.

`data/stock_setups.json` publishes the actual coverage count, discovery metadata,
attempt count, pending symbols and per-symbol failures. Pending coverage emits an
Actions warning. A successful workflow alone does not mean every price succeeded.

## UI contract

Search results, holding registration and valuations distinguish current quotes,
previous/stale quotes, uncollected targets, unsupported targets and load failures.
New unpriced holdings require explicit confirmation that only the holding record
will be saved. Existing records remain editable. Missing prices never become zero
or silently enter a complete asset total. A refresh does not erase in-progress
brokerage/quantity/cost input, and an inactive stock-search field does not block
portfolio refresh. The refresh button reloads published data; it does not claim
to start a provider job.

Run `node --test tests/*.test.js`, `python -m unittest discover -s tests -p
'test_*.py'`, and `python tests/check_frozen.py`. Mobile CI checks both Chromium
and WebKit, including missing-price acknowledgement, later quote recovery, and
the unchanged brokerage aggregation/backup behavior.
