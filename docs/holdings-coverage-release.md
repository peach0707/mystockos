# Holdings valuation and listing coverage

## Scope

- Separate an available close from a full technical-analysis window. A new
  listing can be valued after one valid completed session. Windows still require
  consecutive exchange sessions, and no indicator is computed from too few bars.
- Keep SKHY's USD US listing identity; do not substitute its Korean listing.
- Fetch US/USD ETF reference listings separately and merge them into the shared
  picker. A listing is not a promise of quote coverage. The bounded public close
  universe expands from 20 to 39 symbols, including MUU/MUD, SKHL, NVIDIA/AMD/TSM/
  AVGO leveraged products, semiconductor and Nasdaq ETFs.
- Price an ETF from its own data, never the underlying times leverage.
- Collect USD/JPY completed UTC daily closes with source, date and quality.
  The closing time can differ from US equities; the UI explicitly displays both.

## Privacy and accounting

- Holdings, quantities, cost, cash and observations remain in the existing
  `mystockos.private.v6` key on the device. No holdings are sent to Actions or a
  price provider. Existing records are not reset or re-entered.
- Current valuation is quantity × the security's own closing price, with
  independent conversion of quote currency and acquisition-cost currency.
- Unknown cash is not assumed zero. Users can explicitly enter JPY/USD balances.
  Balances do not automatically adjust for trades, dividends or ledger entries.
- A partial valuation is labeled partial and missing positions never become
  zero-priced positions. Stale known quotes remain estimated, with dates.
- USD acquisition cost is converted at the same current reference FX rate as
  market value. The resulting cost difference excludes purchase-date FX P/L,
  distributions, fees and realized trading profit.
- `holdingObservations` are optional backward-compatible v6 records. Capture
  only complete, current, actually observed values on the Japanese observation
  date. Deduplicate unchanged quotes; do not fill dates before registration or
  days when the app was not used. Portfolio changes reset comparisons. Automatic
  stock valuation differences are not brokerage-account investment returns.
- Manual snapshots, cash-flow accounting, dividends, annual baselines and their
  audit rules remain independent and unchanged. Frozen Theme System v1.0 files
  are unchanged.

## Operations and verification

- Same-session successful quotes are reused individually; missing entries can be
  retried even when other securities are available. At most 39 price calls plus
  one FX and one ETF reference request per full run. API keys stay in configured
  Actions secrets. Price requests retain pacing, limits and no immediate retries.
- Current and old-price fallback, missing FX, inverse FX, JPY costs, partial
  valuation, cash double counting, local backup, history and ETF search have
  regression tests.
- Disposable Chromium/WebKit acceptance registers MU/SKHY/MUU, checks immediate
  JPY value, cash inclusion, first-day calendar, persistence and mobile layout.

## Product references

- MUU/MUD: https://www.direxion.com/product/daily-mu-bull-and-bear-leveraged-single-stock-etfs
- SKHL and the US SKHY ADR: https://www.direxion.com/product/daily-sk-hynix-bull-etf-skhl

These products target daily results; multi-day performance is not a fixed
multiple of the underlying. Prices are sourced from the configured market-data
provider, not copied from these product pages.
