# PRD: Momentum Breakout Screener

## Summary
IndStockScreener helps a single user quickly scan the NSE equity universe and identify stocks worth investigating for momentum/breakout trades. The primary workflow: open the app, immediately see stocks that hit a new all-time high (or 52-week high) in the current week, then tune with additional filters (volume, consolidation quality, extension, breakout freshness, market cap) to separate high-conviction setups from noise.

## Goals
- Surface "new high this week" candidates with zero setup (default view, auto-run on load).
- Give the user enough computed context per stock (not just raw price/volume) to judge breakout quality without leaving the app: how many times has it broken out before, did it base properly, how extended is it now, how fresh is the move.
- Keep screening fast — all derived metrics precomputed at ingestion, not calculated per request.
- Stay correct on Indian-market specifics: split/bonus-adjusted prices, SEBI-style market cap categories, NSE-only universe.

## Non-goals (v1)
- Multi-user / hosted deployment (local single-user only; revisit with Vercel+Render later).
- Intraday/real-time data (end-of-day only).
- BSE coverage (NSE only; revisit if a specific BSE-only need arises).
- Fundamental/technical criteria beyond what's listed here (P/E, sector, RSI, moving averages — fast-follow, not v1).
- Holiday-aware trading calendar (weekday-based staleness check accepts a harmless redundant refresh on market holidays).

## Users
Just the author, running the app locally for personal stock research.

## Core concepts

### Basis selection (ATH vs 52-week-high)
The user picks a top-level basis — **All-Time High** or **52-Week High** — which determines which breakout event all derived metrics (below) are computed against. Switching basis swaps the relevant filters/columns in the UI; both are precomputed so switching is instant.

### Breakout event
A "breakout" is not every new high printed during a continuing uptrend — it's a discrete event: price pulls back ≥15% (configurable) from a prior high, bases, then closes above that prior high again. This pullback-reset definition lets us count "1st breakout, 2nd breakout, etc." and measure "weeks since breakout" meaningfully even when a stock has been printing fresh highs every week for months.

### Weekly time horizon
All decisions and derived metrics operate on **weekly** bars (week-ending close, weekly volume, weekly % change) — not daily. Daily OHLCV is still ingested (needed for accurate high/low precision) but aggregated into a precomputed weekly table.

## Functional requirements

### 1. Data pipeline
- **Universe**: NSE equities only, seeded from the official NSE equity list.
- **Ingestion**: batch-fetch full price history via `yfinance` (`yf.download()` in chunks), with `auto_adjust=True` for split/bonus-adjusted prices.
- **Freshness check**: on backend startup, compare each stock's `last_updated` against the most recent weekday (Mon-Fri). If stale, kick off ingestion as a background task; the API serves existing data immediately and exposes a refresh status the frontend polls/displays ("data as of <date> — refreshing...").
- **Weekly aggregation**: after daily prices are upserted, recompute the `weekly_prices` table (one row per stock per ISO week: open/high/low/close/volume), calendar week = Monday-Sunday IST.
- **Breakout metrics**: after weekly aggregation, recompute `BreakoutMetrics` rows for each stock, for both `basis="ATH"` and `basis="52W"`.
- **Market cap categories**: after each ingestion run, rank all stocks by `market_cap` and assign `cap_category` (Large = top 100, Mid = next 150, Small = rest), per SEBI convention.

### 2. Data model additions
- `WeeklyPrice` (new table): `stock_id`, `week_start` (Monday date), `open`, `high`, `low`, `close`, `volume`.
- `BreakoutMetrics` (new table), keyed by `(stock_id, basis)` where `basis` ∈ {`ATH`, `52W`}:
  - `breakout_week` (week the stock closed above the prior high after a qualifying pullback)
  - `breakout_level` (the prior high price that was broken)
  - `breakout_count` (how many such breakouts this stock has had historically, for this basis)
  - `pullback_pct_before` (depth of the pullback that preceded this breakout)
  - `consolidation_weeks` (duration of the tight-range period immediately before breakout)
  - `consolidation_range_pct` ((max high − min low) / breakout level over the consolidation window)
  - `extension_pct` (current price vs. `breakout_level`, i.e. how far beyond the breakout point price has run)
  - `breakout_age_weeks` (current week − `breakout_week`)
  - `hit_new_high_this_week` (boolean — true if `breakout_level`'s underlying high was itself set this calendar week, i.e. a brand-new ATH/52W high this week)
- `Stock` gains `cap_category` (Large/Mid/Small).

### 3. Screening API
- Filters available (all optional/unbounded unless set):
  - Basis selector: ATH or 52W (drives which `BreakoutMetrics` row is joined/filtered).
  - "New high this week" toggle (default ON) — filters on `hit_new_high_this_week`.
  - Exchange (NSE only for now, field retained for future BSE support).
  - Price range, market cap range (numeric, blank = unbounded).
  - Market cap category (Large/Mid/Small dropdown).
  - Minimum-history toggle ("ignore stocks with <10 weeks of data", off by default... TBD default — see open question).
  - Average weekly volume floor (liquidity filter).
  - Breakout-week volume vs. N-week average volume ratio (momentum-confirmation filter).
  - Pullback % threshold used for breakout detection (configurable, default 15%).
  - Consolidation indicators (separate filter group): min consolidation weeks, max consolidation range %.
  - Max extension % (ceiling on how far past breakout price has run).
  - Max breakout age in weeks (freshness ceiling).
- Default sort: volume descending. User can re-sort by any column.
- Response includes all computed `BreakoutMetrics` fields so the frontend can render them as optional table columns.

### 4. Frontend
- TradingView-style results table: user can show/hide columns from the full set of raw + derived fields.
- Default view on load: basis = ATH, "new high this week" ON, auto-runs immediately (no blank-state wait).
- Consolidation indicator filters grouped in their own collapsible section, visually distinct from core price/volume/market-cap filters.
- Persistent "data as of <date>" indicator; shows "refreshing..." while a background ingestion run is in progress, then updates automatically when it completes.

## Open questions / follow-ups
- Default value for "ignore stocks with <10 weeks of history" toggle (on or off by default) — not yet decided.
- Exact UI treatment for switching basis (ATH/52W) — full page re-render vs. in-place column/filter swap.
- Whether `breakout_count` should be exposed as a filter (e.g. "show only 1st-time breakouts") — implied by the requirement but not explicitly confirmed as a UI filter.
- Migration path for existing `Stock`/`DailyPrice` data given the schema additions (new tables + `cap_category` column) — no production data at stake yet, so likely just drop/recreate during development.

## Out of scope, deferred
- Hosting/deployment (Vercel + Render or similar) once the screener is validated locally.
- BSE coverage.
- Additional fundamental/technical criteria (P/E, sector, RSI, moving averages).
- Holiday-aware ingestion scheduling.
