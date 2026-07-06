import type { BundleStock, ScreenerCriteria, Stock } from "./types";

// Client-side port of the backend's screen_stocks filter (routers/stocks.py).
// The whole universe arrives once via /stocks/bundle; every filter change runs
// here, in memory, with no network round-trip. Semantics mirror the backend:
// a null field fails any bound applied to it.

function startOfWeekISO(): string {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, "0");
  const d = String(monday.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function flattenStock(s: BundleStock, basis: "ATH" | "52W"): Stock {
  const { ath, w52, ...common } = s;
  const block = basis === "52W" ? w52 : ath;
  return { ...common, ...block };
}

export function screenLocal(universe: BundleStock[], c: ScreenerCriteria): Stock[] {
  const basis = c.basis ?? "ATH";
  const weekStart = startOfWeekISO();
  const symbols = c.symbols ? new Set(c.symbols) : null;
  const minHistoryWeeks = c.min_history_weeks ?? 10;

  const rows: Stock[] = [];
  for (const bs of universe) {
    const s = flattenStock(bs, basis);

    if (symbols && !symbols.has(s.symbol)) continue;
    if (c.exchange && s.exchange !== c.exchange) continue;
    if (c.min_market_cap != null && !(s.market_cap != null && s.market_cap >= c.min_market_cap)) continue;
    if (c.max_market_cap != null && !(s.market_cap != null && s.market_cap <= c.max_market_cap)) continue;
    if (c.min_volume != null && !(s.current_volume != null && s.current_volume >= c.min_volume)) continue;
    if (c.max_volume != null && !(s.current_volume != null && s.current_volume <= c.max_volume)) continue;
    if (c.min_price != null && !(s.current_price != null && s.current_price >= c.min_price)) continue;
    if (c.max_price != null && !(s.current_price != null && s.current_price <= c.max_price)) continue;
    if (c.new_all_time_high_this_week && !(s.all_time_high_date != null && s.all_time_high_date >= weekStart)) continue;
    if (c.new_52_week_high_this_week && !(s.week_52_high_date != null && s.week_52_high_date >= weekStart)) continue;
    if (c.min_avg_weekly_volume != null && !(s.avg_weekly_volume != null && s.avg_weekly_volume >= c.min_avg_weekly_volume)) continue;
    if (c.cap_category && s.cap_category !== c.cap_category) continue;
    if (c.exclude_young_stocks && !(s.weeks_of_history != null && s.weeks_of_history >= minHistoryWeeks)) continue;

    if (c.pct_from_all_time_high_max != null) {
      if (!s.all_time_high || !s.current_price) continue;
      if ((s.all_time_high - s.current_price) / s.all_time_high * 100 > c.pct_from_all_time_high_max) continue;
    }
    if (c.pct_from_52_week_high_max != null) {
      if (!s.week_52_high || !s.current_price) continue;
      if ((s.week_52_high - s.current_price) / s.week_52_high * 100 > c.pct_from_52_week_high_max) continue;
    }

    if (c.resistance != null && basis === "52W") {
      if (s.has_resistance == null || s.has_resistance !== (c.resistance === "yes")) continue;
    }
    if (c.min_stock_age_days != null && !(s.stock_age_days != null && s.stock_age_days >= c.min_stock_age_days)) continue;
    if (c.max_stock_age_days != null && !(s.stock_age_days != null && s.stock_age_days <= c.max_stock_age_days)) continue;

    if (c.min_consolidation_weeks != null && !(s.consolidation_weeks != null && s.consolidation_weeks >= c.min_consolidation_weeks)) continue;
    if (c.max_consolidation_range_pct != null && !(s.consolidation_range_pct != null && s.consolidation_range_pct <= c.max_consolidation_range_pct)) continue;
    if (c.max_extension_pct != null && !(s.extension_pct != null && s.extension_pct <= c.max_extension_pct)) continue;
    if (c.max_breakout_age_weeks != null && !(s.breakout_age_weeks != null && s.breakout_age_weeks <= c.max_breakout_age_weeks)) continue;
    if (c.min_breakout_volume_ratio != null && !(s.breakout_volume_ratio != null && s.breakout_volume_ratio >= c.min_breakout_volume_ratio)) continue;

    rows.push(s);
  }
  return rows;
}
