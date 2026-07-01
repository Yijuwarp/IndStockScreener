# PRD: UI Overhaul + Momentum-Course Filters (v2)

Builds on [PRD.md](./PRD.md). This increment adds course-derived metrics (EMAs, resistance, stock age, volume dry-up, index regime check) and reworks the filter/column UI for consistency and usability.

## Scope (only these changes)
1. 21D/50D/200D EMA columns
2. Resistance filter (52W basis only)
3. Drag-and-drop column reordering
4. Index check-in section (NIFTY 50, Midcap 100, Smallcap 100)
5. Stock age column + filter (default 10W–15Y)
6. Indian-style comma formatting (L/Cr) on all numeric filter inputs
7. Uniform popover filter style for every filter, including Exchange and Cap Category
8. Layout: Screen button moves to its own row; New ATH/52W toggle moves into the filter row; remove standalone labels for Exchange/Cap Category
9. Preset adjustments per course (market cap + volume filters auto-enabled by default)
10. Volume dry-up column (Yes/No)
11. Hover tooltips on every filter and column header
12. Column-picker grouping: Momentum staples → Technical → Fundamental

## 1. EMA columns
- New computed fields on `Stock` (or a join table): `ema_21d`, `ema_50d`, `ema_200d` — standard EMA over daily close, recomputed each ingestion run alongside existing snapshot fields.
- Displayed as plain price columns (₹, same formatting as `current_price`). No derived above/below boolean in this pass — out of scope until a trend filter is requested.
- Group: **Technical**.

## 2. Resistance filter (52W basis only)
- Definition: `has_resistance = all_time_high > current_price`, evaluated only when `basis = "52W"`. Under ATH basis the concept is meaningless (current price is itself defining the ATH) — filter is hidden/disabled when basis = "ATH".
- New criteria field: `resistance?: "yes" | "no"` (unset = either).
- Filter UI: popover with single-select "Resistance / No Resistance", same popover shell as other filters.
- Group: **Momentum staples** (it's a direct course concept — "no overhead supply").

## 3. Drag-and-drop column reordering
- Column order becomes user-editable in the column-picker menu (drag handle per row) and reflected immediately in the table.
- Persist order **in a cookie** (per your direction), same tier for column visibility — both currently reset on reload (`DEFAULT_VISIBLE` is a hardcoded constant) and will move to cookie storage together.

## 4. Index check-in section
- New collapsible section (e.g. a drawer/panel toggled from the topbar, separate from the stock table) showing, per index:
  - Index name, current price, 21D EMA (labeled "21D (3W)"), 50D EMA ("50D (7W)"), 200D EMA ("200D (28W)"), 300D EMA ("300D (42W)")
- Indices, confirmed via direct yfinance spike:
  - **NIFTY 50** → ticker `^NSEI` — full reliable daily history.
  - **NIFTY Midcap 100** → ticker `^CRSMID` — confirmed name match, full reliable daily history.
  - **NIFTY Smallcap 100** — dropped from v2. No working yfinance ticker returns historical OHLC (`^CNXSC` resolves and is named correctly but only returns a single snapshot row, no history — EMAs are impossible). Every alternate ticker tried either 404s or is a different instrument (e.g. `SMALLCAP.NS` is a Mirae Asset smallcap *momentum-quality factor ETF*, not the plain index). Revisit if/when a non-yfinance source (e.g. NSE's own index API/CSV) is wired in.
- Backend: new `Index` + `IndexPrice` tables (mirrors `Stock`/`DailyPrice` shape), seeded with `^NSEI` and `^CRSMID` only. Ingested and EMA-computed on the same schedule as stock data.
- No filter/gating behavior tied to this in this pass — it's an informational panel only, not wired into stock screening yet (that's the natural v3 follow-up once this panel proves the data is right, and once Smallcap 100 coverage is resolved).

## 5. Stock age column + filter
- `stock_age` derived from `MIN(daily_prices.date)` per stock (listing-date proxy — confirmed acceptable; we don't have true NSE listing dates).
- Column: shows age formatted as e.g. "3y 4mo" or in weeks if <1 year.
- Filter: min/max range popover, same shell as Market Cap, **default min = 10 weeks, default max = 15 years** (course's IPO-base bounds), auto-applied if "auto-enable presets" behavior (see §9) extends to this filter — see open question.
- Group: **Momentum staples** (it's the IPO-base/"New India" preference rule).

## 6. Indian-style number formatting (L/Cr)
- Applies to **all** numeric filter inputs (per your direction) — Market Cap, Volume, Price, % From High, Extension, Breakout Age, Liquidity, Consolidation, Stock Age.
- Display rule: format using Indian grouping (`##,##,###` not `###,###,###`) and abbreviate large magnitudes — Crore (≥1,00,00,000), Lakh (≥1,00,000), plain below that. e.g. market cap input shows "1,500 Cr", volume input shows "5 L", price input stays "₹1,250" (below Lakh threshold, no abbreviation needed in practice).
- This affects both the popover input fields and the summary text shown on the closed filter button (already partially done for market cap via `fmtCrore`/`toLocaleString("en-IN")` — extend the same treatment to every `RangeField`).

## 7 & 8. Uniform filter style + layout
- Every filter (including current plain `<select>` for Exchange and Cap Category) becomes a `RangeFilterButton`-style popover: closed state shows `Label: Selection`, click opens popover, Apply/Clear footer.
- For single-select filters (Exchange, Cap Category, Resistance), the popover body is a radio/button-group instead of numeric inputs — `RangeFilterButton` needs a sibling component (e.g. `SelectFilterButton`) sharing the same popover shell/positioning/styling.
- Remove the separate `<label>Exchange</label>` / `<label>Cap Category</label>` field wrappers — they become just another button in the filter row, no header text outside the button itself.
- Layout reflow:
  - **Row 1 (topbar)**: title, basis toggle (ATH/52W), data status — unchanged.
  - **Row 2 (filter row)**: all filters as popover buttons, in column-group order (Momentum staples → Technical → Fundamental, mirroring the column picker), **plus** the New ATH/52W toggle as the last item in this row (moved out of the topbar).
  - **Row 3**: Screen button, alone, full-width or right-aligned.

## 9. Preset adjustments
- Market Cap filter: auto-enabled by default at current PRD defaults (₹500 Cr min, ₹50,000 Cr max) — already the `defaultValue`s in code, but today the filter is inactive until the user opens and applies it. Change: these values are applied to `criteria` on initial load, so the filter shows as **active** immediately (button renders "Market Cap: 500 – 50,000 Cr" from first paint, not just "Market Cap").
- Volume filter (`min_breakout_volume_ratio`): auto-enabled at **1.5x** (the course's core threshold; 2x is the stricter/inconsistent later figure — going with 1.5x as the encoded default, matching the existing code default).
- Stock age filter: default range 10W–15Y, per §5 — **auto-enabled** alongside Market Cap and Volume (confirmed).
- No other filters change default-enabled state (Price, % From High, Extension, Breakout Age, Liquidity, Consolidation stay opt-in, matching current behavior).

## 10. Volume dry-up column
- New computed field on `BreakoutMetrics`: `volume_dry_up` (boolean).
- Rule (confirmed): `avg(volume, last 3 weeks before breakout_week) < 0.7 * avg(volume, trailing 10 weeks before breakout_week)`.
- Displayed as "Yes"/"No" in the table; no filter in this pass (column only, per your request).
- Group: **Momentum staples**.

## 11. Hover tooltips
- Every column header and every filter button gets a `title`-attribute (or lightweight custom tooltip if `title` styling is too plain) explaining the metric/filter in one sentence, sourced from the course definitions already in the PRD/glossary.
- No new data fetching — purely static copy per field, defined once in the `COLUMNS` / filter config arrays.

## 12. Column/filter grouping
Proposed grouping (confirm or adjust):

**Momentum staples** (the core breakout system):
`new_all_time_high_this_week`/`new_52_week_high_this_week` toggle, `resistance`, `breakout_count`, `breakout_week`, `breakout_level`, `consolidation_weeks`, `consolidation_range_pct`, `extension_pct`, `breakout_age_weeks`, `breakout_volume_ratio`, `volume_dry_up`, `stock_age`, `market_cap`, Market Cap filter, Liquidity filter, Consolidation filter, Breakout Age filter, Extension filter, % From High filter

**Technical** (supporting price/volume context, not course-prescribed rules):
`current_price`, `current_volume`, `weekly_close`, `weekly_volume`, `weekly_pct_change`, `all_time_high`, `week_52_high`, `ema_21d`, `ema_50d`, `ema_200d`, `avg_weekly_volume`, Price filter, Volume filter

**Fundamental** (company identity/sizing, not technical/momentum):
`symbol`, `exchange`, `name`, `cap_category`, `weeks_of_history`, Cap Category filter, Exchange filter

Both the filter row and the column-picker menu render groups in this order with a group-label divider; within a group, order follows current array order (subject to drag-and-drop override for columns, per §3).

## Resolved decisions (all open questions closed)
1. Column order + visibility persist in a **cookie**, not `localStorage`.
2. Index check-in ships with **NIFTY 50 (`^NSEI`) + NIFTY Midcap 100 (`^CRSMID`) only** — Smallcap 100 dropped, no viable yfinance source found (see §4).
3. Stock age filter **is** auto-enabled by default, alongside Market Cap and Volume.
4. Grouping: **Market Cap** (value + filter) moved into **Momentum staples**; **Cap Category** stays in **Fundamental**.
