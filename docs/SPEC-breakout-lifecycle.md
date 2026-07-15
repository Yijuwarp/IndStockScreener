# Spec: Breakout lifecycle (status) — v1

Status: draft for review · Author: generated with Claude, 2026-07-13 · Depends on: weekly-only
storage (README "Data storage"), static bundle delivery (README "Architecture").

## 1. Problem

A breakout in the app is currently an *event* with no lifecycle: once detected it remains the
"latest breakout" forever, and the user must mentally combine Extension %, Breakout Age, and the
exit flag to judge whether a row is still actionable. The course, however, defines a clear
lifecycle: a breakout is buyable until it extends >20% past the level ("let it go"), it may base
into a Darvas box (pyramid territory), and it dies on the course's exit rules (weekly close below
the 10-week EMA; 20% hard stoploss).

## 2. Course rules being encoded (source: course summary notes + mind map)

| # | Rule (course wording) | Spec interpretation |
|---|---|---|
| R1 | "Weekly close above previous ATH" out of a consolidation | existing detector event (unchanged in v1) |
| R2 | "If it extends to >20% above the breakout level, let it go" | Extended state |
| R3 | Consolidation = no new high for ≥4 weeks (Darvas box, length 4) | Basing state; box high recorded |
| R4 | Exit: "week close below 10 week EMA" | Ended (sticky) |
| R5 | Exit: "hard stoploss at 20%" | Ended (sticky), reference price = breakout level |
| R6 | Pyramid when a new box is formed and broken (weekly close) | existing `pyramid_signal` (unchanged) |
| R7 | "If stock goes up 100% from buy level, move stoploss to 13 week EMA" | informational only: publish `ema_13w`; no state |

Out of scope for v1 (position-dependent, no buy price known): R7 as a state, 10-month EMA
trailing stop for large caps, portfolio-level stop-buying rules.

## 3. State machine

Evaluated per stock **per basis** (ATH and 52W), against the latest breakout event. Stocks with
no breakout event have `status = null`.

States: `active | extended | basing | ended`.

Evaluation walks weekly bars from `breakout_week` (exclusive) to the latest bar, maintaining:
- `ema10`: 10-week EMA of weekly closes, seeded from the full close history up to and including
  `breakout_week` (ewm, adjust=False), advanced per week thereafter;
- `post_high` / `post_high_week`: max weekly high since (and including) `breakout_week`;
- `hard_stop = 0.8 × breakout_level`.

Precedence (first match wins):

1. **ended** — sticky. Set if ANY post-breakout week satisfies either:
   - `close < ema10` at that week (R4), or
   - `close ≤ hard_stop` (R5).
   Once entered, later strength does not revive the event; only a *new* breakout event resets
   the lifecycle.
2. **extended** — `extension_pct > 20` at the latest bar (R2). Recoverable: if price drifts back
   to ≤20% without triggering `ended`, the status returns to `active`/`basing` (course guidance
   is about chasing, not a permanent verdict).
3. **basing** — the latest bar is ≥4 completed weeks after `post_high_week` with no new weekly
   high (R3), i.e. `weeks_between(post_high_week, latest_week) ≥ 4`. Record
   `box_high = post_high` (the level whose weekly-close break fires R6).
4. **active** — otherwise.

Notes:
- The breakout week itself cannot end its own event via R4 (its close is above the prior peak by
  definition of the detector; the EMA check still runs but is expected to pass).
- `ended` evaluation uses the EMA *as of that historical week* — not today's EMA — so a dip below
  the stop line two months ago correctly kills the event even if price recovered.
- All inputs are weekly bars already held in memory during `_upsert_breakout_metrics`; no new
  data is fetched.

## 4. Data model changes

`breakout_metrics` (per stock × basis) — new nullable columns:

| Column | Type | Meaning |
|---|---|---|
| `status` | VARCHAR | `active/extended/basing/ended`; NULL when no breakout event |
| `status_reason` | VARCHAR | short machine text for the UI tooltip, e.g. `close_below_10w_ema:2026-06-15`, `hard_stop:2026-05-04`, `extension:48.8`, `box:5w_under_1420.00` |
| `box_high` | FLOAT | populated when `status = basing`; else NULL |

`stocks` — new nullable column:

| Column | Type | Meaning |
|---|---|---|
| `ema_13w` | FLOAT | 13-week EMA of weekly closes (R7 informational; computed beside `ema_10w`) |

Migration: extend the dev-mode ALTER-TABLE helper in `app/main.py` (currently `stocks`-only) to
a table-aware map covering `breakout_metrics`. Columns must exist before the next ingestion run
writes them; deploy before the 18:15 IST workflow (see §8).

## 5. Computation (backend)

In `app/services/ingestion.py::_upsert_breakout_metrics`, after the existing latest-event
metrics: run the §3 walk and set `bm.status`, `bm.status_reason`, `bm.box_high`. Add
`stock.ema_13w = _ema(weekly_closes, 13)` beside the existing `ema_10w` line.

Complexity: one extra O(weeks-since-breakout) pass per stock per basis — immaterial next to the
yfinance fetch.

## 6. API / bundle changes (additive only)

- `BasisMetricsOut` += `status`, `status_reason`, `box_high`.
- `BundleStockOut` += `ema_13w`.
- Flows through `build_bundle`, `GET /stocks/bundle`, and `scripts/export_bundle` unchanged.
- `POST /stocks/screen` (compat endpoint): `StockOut` += the same fields; no new criteria in v1
  (client-side screening owns filtering).
- Bundle size impact: ≈ +10–20 KB gzipped.

## 7. Frontend changes

1. **Status column** — default-visible, after Score; renders a chip (Active=green, Extended=amber,
   Basing=blue, Ended=red); `status_reason` in the title tooltip; Ended rows at reduced opacity.
   Missing field (stale cached bundle) renders blank — never crash.
2. **Status filter chips** — primary filter bar; multi-select; each chip shows the live count of
   stocks in that status under the *other* active filters (client-side, cheap).
3. **Presets** — "Course defaults" += `status: ["active"]`; "Fresh breakout" += active + age ≤4w;
   new "Pyramid watch" preset = `status: ["basing"]`.
4. **Watchlist** — add "Stop dist %" column: `(current_price − ema_10w) / ema_10w × 100`
   (negative = below stop). Derived client-side from existing fields; no backend change.
5. **screen.ts** — new `statuses?: string[]` criterion; a row passes when its basis-block status
   is in the set (or the set is empty/absent).

Type additions in `types.ts` mirror §6; `ScreenerCriteria` gains `statuses?: BreakoutStatus[]`
(client-only; the compat endpoint does not implement it in v1).

## 8. Rollout

1. Land backend (columns + migration + computation + tests) and frontend behind the fact that
   fields are nullable — UI shows blanks until data exists.
2. Push before ~17:30 IST so Render redeploys (running the ALTER migration on prod Postgres) and
   the local dev DB migrates, ahead of the 18:15 IST refresh workflow.
3. That evening's run populates the columns and publishes the first bundle with statuses; caches
   pick it up via normal revalidation.
4. If statuses look wrong in prod: revert the frontend commit (chips/column disappear); backend
   columns are inert and can stay.

## 9. Testing

- **Unit (state machine)**: table-driven weekly-bar fixtures for — clean active; extended >20%;
  extended recovering to active; basing exactly at the 4-week boundary (3w = not basing, 4w =
  basing); ended via historical close-below-EMA followed by full recovery (stickiness); ended via
  hard stop at exactly 0.8× (boundary: ≤); breakout week itself not self-ending; no-event stocks
  → NULL.
- **Unit (EMA seed)**: `ema10` seeded from history up to breakout_week matches a full-series ewm
  computed independently.
- **Integration**: run `_upsert_breakout_metrics` over a handful of real stocks from the local DB
  and eyeball statuses against TradingView charts (manual, once).
- **Frontend**: screen.ts status filtering; chip counts; stale-bundle tolerance (bundle without
  status fields renders and filters as if all statuses unknown → status filter matches nothing,
  chips show 0 — acceptable for the <1 day transition window).

## 10. Explicitly out of scope (v2 candidates)

- **Detector alignment**: new event fires on weekly close above prior peak after (≥15% pullback
  OR ≥4-week box). Changes `breakout_count`/ages/scores for some stocks; ships separately with
  parity tests and its own spec addendum.
- Status history / transitions over time (only the current status is stored).
- Position-aware stops (R7 as state, buy-price tracking, portfolio rules).
- Compat-endpoint filtering by status.

## 11. Open questions

1. Should **Extended** also require the stock to still be above the breakout level (extension is
   >20% by definition, so yes trivially) — or should a stock that was extended and has now pulled
   back near the level show a distinct "pulled back" hint? (v1: no; it shows `active` again.)
2. `basing` requires ≥4 weeks *without a new high*; the course's Darvas box also has a floor.
   v1 ignores the floor (a 30% crash without an EMA/stop hit still counts as "basing" if it makes
   no new high). Acceptable because R4/R5 usually catch deep crashes first — confirm in review.
3. Chip counts: under the other active filters (spec'd) vs. universe-wide? Spec'd choice keeps
   the numbers consistent with what applying the chip will show.
