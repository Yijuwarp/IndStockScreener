# Spec: Breakout lifecycle (status) — v2

Status: approved direction, review of v2 changes pending · 2026-07-14 · Depends on: weekly-only
storage (README "Data storage"), static bundle delivery (README "Architecture").

v2 supersedes v1 after review: Extended requires price above the breakout level (Q1), the Darvas
box floor is part of Basing (Q2), chip counts respect the other active filters (Q3), the Flags
column is consolidated into status (§8), and detector alignment is in scope (§4) rather than
deferred.

## 1. Problem

A breakout in the app is currently an *event* with no lifecycle: once detected it remains the
"latest breakout" forever, and the user must mentally combine Extension %, Breakout Age, and four
icon flags to judge whether a row is still actionable. The course, however, defines a clear
lifecycle: a breakout is buyable until it extends >20% past the level ("let it go"), it may base
into a Darvas box (pyramid territory), and it dies on the course's exit rules (weekly close below
the 10-week EMA; 20% hard stoploss).

## 2. Course rules being encoded (source: course summary notes + mind map)

| # | Rule (course wording) | Spec interpretation |
|---|---|---|
| R1 | "Weekly close above previous ATH" out of a consolidation | detector event; consolidation = ≥15% pullback OR ≥4-week box (§4) |
| R2 | "If it extends to >20% above the breakout level, let it go" | Extended state |
| R3 | Consolidation box: Darvas box, length 4 (no new high ≥4 weeks, floor holds) | Basing state; box high + floor recorded |
| R4 | Exit: "week close below 10 week EMA" | Ended (sticky) |
| R5 | Exit: "hard stoploss at 20%" | Ended (sticky), reference price = breakout level |
| R6 | Pyramid when a new box is formed and broken (weekly close) | box break = new detector event (§4); surfaced as a marker on the new event's Active chip |
| R7 | "If stock goes up 100% from buy level, move stoploss to 13 week EMA" | informational only: publish `ema_13w`; no state (see §11) |

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
2. **extended** — at the latest bar: `extension_pct > 20` AND `current_price > breakout_level`
   (Q1; the price condition is implied by extension >20% but is stated and asserted explicitly
   so a future change to the extension formula cannot silently break it). Recoverable: when
   extension falls back to ≤20% without `ended` having triggered, the stock shows
   `active`/`basing` again — the rule is about not chasing, not a permanent verdict.
3. **basing** — a Darvas(4) box has formed under the post-breakout high and is holding (Q2):
   - no new weekly high for ≥4 completed weeks since `post_high_week`;
   - `box_high = post_high`;
   - `box_floor` = min weekly low of the first 4 base weeks (the box-forming window);
   - holding = no weekly close below `box_floor` since the box formed.
   A weekly close below `box_floor` dissolves the box: the stock reverts to `active` (unless
   `ended` caught it first — a floor break deep enough usually also breaks the 10W EMA or hard
   stop). If a new no-new-high stretch of ≥4 weeks accumulates afterwards, a new box forms with
   a fresh floor from its own first 4 weeks.
4. **active** — otherwise.

Notes:
- The breakout week itself cannot end its own event via R4 (its close is above the prior peak by
  definition of the detector; the EMA check still runs but is expected to pass).
- `ended` evaluation uses the EMA *as of that historical week* — not today's EMA — so a dip below
  the stop line two months ago correctly kills the event even if price recovered.
- All inputs are weekly bars already held in memory during `_upsert_breakout_metrics`; no new
  data is fetched.

## 4. Detector alignment (in scope)

Today a new breakout event requires a ≥15% low-to-peak pullback before a weekly close above the
prior peak — an implementation invention. The course's actual trigger is a close above the prior
high *out of a consolidation*, and its consolidation primitive is the 4-week Darvas box. Aligned
rule:

> A new breakout event fires on a weekly close above the prior peak when, since that peak,
> **either** (a) some weekly low sat ≥15% below it (existing pullback rule), **or** (b) at least
> 4 completed weeks passed without a new weekly high (box rule).

Consequences and requirements:
- `detect_breakouts` keeps its O(n) two-deque structure; condition (b) adds a "weeks since peak"
  check — the peak index is already tracked, so this is O(1) per bar. The naive reference
  implementation in `tests/test_breakout.py` gains the same clause; the randomized parity test
  and the full-DB parity harness must pass against it.
- A box break now *is* a new event, so R6 (pyramiding) needs no separate detection: a new event
  whose base was a box (`consolidation_weeks ≥ 4`) with `breakout_age_weeks == 0` is the pyramid
  signal. The existing `pyramid_signal` field keeps its schema and now derives from exactly this
  condition (it already does — the alignment makes the event exist for pure box breaks that the
  15% rule missed).
- `breakout_count`, `breakout_week`, ages, extensions, consolidation metrics, and scores will
  change for stocks whose box re-breakouts were previously invisible. This is intended. Ships as
  its own commit with before/after counts reported from the local DB (expect counts to rise;
  spot-check a sample of new events against TradingView).
- The lifecycle (§3) always evaluates against the *latest* event under the new rule, so a
  box-then-break sequence reads: basing → (break) → new event, status active, pyramid marker.

## 5. Data model changes

`breakout_metrics` (per stock × basis) — new nullable columns:

| Column | Type | Meaning |
|---|---|---|
| `status` | VARCHAR | `active/extended/basing/ended`; NULL when no breakout event |
| `status_reason` | VARCHAR | short machine text for the UI tooltip, e.g. `close_below_10w_ema:2026-06-15`, `hard_stop:2026-05-04`, `extension:48.8`, `box:5w 1355.00-1420.00` |
| `box_high` | FLOAT | populated when `status = basing`; else NULL |
| `box_floor` | FLOAT | populated when `status = basing`; else NULL |

`stocks` — new nullable column:

| Column | Type | Meaning |
|---|---|---|
| `ema_13w` | FLOAT | 13-week EMA of weekly closes (R7 informational; computed beside `ema_10w`) |

Migration: extend the dev-mode ALTER-TABLE helper in `app/main.py` (currently `stocks`-only) to
a table-aware map covering `breakout_metrics`. Columns must exist before the next ingestion run
writes them; deploy before the 18:15 IST workflow (see §9).

## 6. Computation (backend)

In `app/services/ingestion.py::_upsert_breakout_metrics`, after the existing latest-event
metrics: run the §3 walk (including box formation/dissolution tracking) and set `bm.status`,
`bm.status_reason`, `bm.box_high`, `bm.box_floor`. Add `stock.ema_13w = _ema(weekly_closes, 13)`
beside the existing `ema_10w` line. Complexity: one extra O(weeks-since-breakout) pass per stock
per basis.

## 7. API / bundle changes (additive only)

- `BasisMetricsOut` += `status`, `status_reason`, `box_high`, `box_floor`.
- `BundleStockOut` += `ema_13w`.
- Flows through `build_bundle`, `GET /stocks/bundle`, and `scripts/export_bundle` unchanged.
- `POST /stocks/screen` (compat endpoint): `StockOut` += the same fields.
- Bundle size impact: ≈ +15–25 KB gzipped.

## 8. Frontend changes

1. **Status column** — default-visible, after Score; renders a chip (Active=green, Extended=amber,
   Basing=blue, Ended=red); `status_reason` in the title tooltip; Ended rows at reduced opacity.
   The Active chip carries a small pyramid marker ("Active ▲") when the event is a fresh box
   break (`breakout_age_weeks == 0 && consolidation_weeks ≥ 4`). Missing field (stale cached
   bundle) renders blank — never crash.
2. **Status filter chips** — primary filter bar; multi-select; each chip shows the live count of
   stocks in that status **under the other active filters** (Q3) so clicking a chip never
   surprises. Client-side, recomputed per filter change.
3. **Flags column removed.** Mapping of the four current flags:
   - blue arrow (new ATH this week) → redundant: the primary "Only new high this week" toggle
     filters for it and `breakout_age_weeks == 0` shows it; removed.
   - amber door (exit signal) → subsumed by the Ended chip for stocks with events; for watchlist
     rows without an event, the Stop dist column (below) goes negative/red. Removed.
   - green pyramid → the Active chip's ▲ marker (see 1). Removed as a separate icon.
   - red circuit trap → **kept** (orthogonal quality warning, not lifecycle); relocated to a
     small warning icon next to the symbol in the pinned column, same tooltip.
   The `flags` column key disappears from COLUMNS/DEFAULT_VISIBLE (cookie-stored orders tolerate
   unknown keys already; bump is not required). The score's flag-count row in the breakdown
   tooltip is re-worded to reference the new locations.
4. **Watchlist** — add "Stop dist %" column: `(current_price − ema_10w) / ema_10w × 100`
   (negative = below stop, red). Derived client-side from existing fields. Also available as an
   optional column in the main table (hidden by default).
5. **screen.ts** — new `statuses?: string[]` criterion; a row passes when its basis-block status
   is in the set (or the set is empty/absent).
6. **Presets** — "Course defaults" += `status: ["active"]`; "Fresh breakout" += active + age ≤4w;
   new "Pyramid watch" preset = `status: ["basing"]`.

7. **Tooltips — every new or moved element must have one** (the app's convention: `FIELD_INFO`
   entries in `definitions.ts` feeding `title` attributes; column headers and filter buttons
   already do this — the new elements follow suit, written in course language):

   | Element | Tooltip content |
   |---|---|
   | Status column header | "Where the latest breakout is in its life. Active = buyable per the course. Extended = >20% above the level, let it go. Basing = a 4+ week Darvas box is forming (pyramid watch). Ended = closed below the 10-week EMA or 20% hard stop since the breakout." |
   | Active chip (row) | "Buyable: broke out N weeks ago, +X% above the level, no exit trigger yet." (from `status_reason` + metrics) |
   | Active ▲ marker | "Pyramid setup: this week broke a 4+ week box. Course rule: add to your position if you hold it." (reuses the current pyramid-flag text) |
   | Extended chip (row) | "+X% above the breakout level — course rule: let it go, don't chase. Becomes Active again if it pulls back to within 20% without hitting a stop." |
   | Basing chip (row) | "No new high for N weeks; box 〈floor〉–〈high〉 holding. A weekly close above 〈high〉 is the pyramid/add-on trigger; a close below 〈floor〉 dissolves the box." |
   | Ended chip (row) | Reason-specific from `status_reason`: "Closed below the 10-week EMA in the week of 〈date〉 — the course's exit." / "Hit the 20% hard stoploss (week of 〈date〉)." |
   | Status filter chips | "Show only stocks whose latest breakout is 〈state〉. Counts reflect your other active filters." |
   | Stop dist % header | "Distance from the course stoploss (10-week EMA). Negative and red = a weekly close here would be an exit. The course trails winners (+100%) with the 13-week EMA instead — see the 13W EMA column." |
   | 13W EMA column (optional, hidden by default) | "Course rule: once a stock is up 100% from your buy, trail the stoploss with the 13-week EMA instead of the 10-week." |
   | Circuit-trap icon (relocated) | unchanged existing text ("Circuit-stock trap: consecutive ~5% up-weeks on negligible volume — avoid.") |
   | Pyramid watch preset | "Stocks basing in a 4+ week box under their breakout high — candidates for the course's add-on rule when the box breaks." |

   Acceptance check: every element added or moved by this spec answers "what is this and what
   does the course say I should do about it?" on hover. No new element ships bare.

Type additions in `types.ts` mirror §7; `ScreenerCriteria` gains `statuses?: BreakoutStatus[]`
(client-side screening owns filtering; the compat endpoint also implements it for parity since
it is five lines).

## 9. Rollout

1. Commit A — detector alignment (§4) + parity tests + before/after event-count report.
2. Commit B — backend lifecycle (columns, migration, computation, unit tests).
3. Commit C — frontend (status column/chips, flags consolidation, presets, Stop dist).
4. Push all before ~17:30 IST so Render redeploys (running the ALTER migration on prod Postgres)
   ahead of the 18:15 IST refresh workflow; that evening's run populates the columns and
   publishes the first bundle with statuses.
5. Rollback: revert Commit C to hide the UI; backend columns are inert. Reverting A alone is not
   supported after data publishes (counts would flap) — A's issues must be fixed forward.

## 10. Testing

- **Unit (state machine)**: table-driven weekly-bar fixtures for — clean active; extended >20%;
  extended recovering to active; basing at the 4-week boundary (3w no, 4w yes); box floor holds
  (low touches floor = still basing) vs. weekly close below floor (box dissolves → active);
  re-forming a second box after a dissolution; ended via historical close-below-EMA followed by
  full recovery (stickiness); ended via hard stop at exactly 0.8× (boundary: ≤); breakout week
  itself not self-ending; no-event stocks → NULL; floor-break week that also closes below the
  10W EMA → ended wins (precedence).
- **Unit (EMA seed)**: `ema10` seeded from history up to breakout_week matches a full-series ewm
  computed independently.
- **Detector (§4)**: parity vs. the naive reference with the box clause added — randomized walks
  plus targeted fixtures: pure box re-breakout (no 15% pullback) fires; 3-week pause does not;
  interaction where a pullback and a box overlap fires exactly one event.
- **Full-DB harness**: run old vs. new detector over the local DB; report per-basis event-count
  deltas and a 10-stock sample of newly detected events for manual chart verification.
- **Frontend**: screen.ts status filtering; chip counts under other filters; stale-bundle
  tolerance (bundle without status fields: chips show 0, status column blank, no crash).

## 11. Not in scope — and why (not deferral)

- **Position-aware stops** (R7 as a state, 100%-gain trailing to 13W EMA, 10-month EMA for large
  caps, portfolio stop-buying): these need the user's buy price and holdings, which the app does
  not track. Building them well means a portfolio feature (entries, sizes, journal) — a product
  decision to take separately, not a cut corner. `ema_13w` ships now so the data is on screen
  for manual use.
- **Status history**: no UI consumes past transitions; storing only the current status keeps the
  bundle and schema minimal. If a "status changed this week" filter is ever wanted, it derives
  from `status_reason` dates without schema change.
