import { useEffect, useMemo, useRef, useState } from "react";
import type { RefreshStatus, ScreenerCriteria, Stock, MarketIndex } from "./types";
import { getStatus, screenStocks, getIndexes } from "./api";
import { RangeFilterButton, type RangeField } from "./RangeFilter";
import { SelectFilterButton } from "./SelectFilter";
import { getJSONCookie, setJSONCookie } from "./cookies";
import { FIELD_INFO, COLUMN_GROUPS, FILTER_GROUPS, GROUP_ORDER, GROUP_LABELS, type Group } from "./definitions";
import "./App.css";

const CRORE = 1e7;

const MARKET_CAP_FIELDS: RangeField[] = [
  { criteriaKey: "min_market_cap", label: "Min", defaultValue: 1000, suffix: " Cr", toStored: (v) => v * CRORE, fromStored: (v) => v / CRORE },
  { criteriaKey: "max_market_cap", label: "Max", defaultValue: 50000, suffix: " Cr", toStored: (v) => v * CRORE, fromStored: (v) => v / CRORE },
];

const VOLUME_FIELDS: RangeField[] = [
  { criteriaKey: "min_volume", label: "Min", defaultValue: 100000 },
  { criteriaKey: "max_volume", label: "Max", defaultValue: 10000000 },
];

const PRICE_FIELDS: RangeField[] = [
  { criteriaKey: "min_price", label: "Min", defaultValue: 50, suffix: " ₹" },
  { criteriaKey: "max_price", label: "Max", defaultValue: 5000, suffix: " ₹" },
];

const PCT_FROM_HIGH_FIELDS: RangeField[] = [
  { criteriaKey: "pct_from_all_time_high_max", label: "Max % below ATH", defaultValue: 10, suffix: "%" },
  { criteriaKey: "pct_from_52_week_high_max", label: "Max % below 52W", defaultValue: 10, suffix: "%" },
];

const EXTENSION_FIELDS: RangeField[] = [
  { criteriaKey: "max_extension_pct", label: "Max Extension", defaultValue: 10, suffix: "%" },
];

const BREAKOUT_AGE_FIELDS: RangeField[] = [
  { criteriaKey: "max_breakout_age_weeks", label: "Max Age", defaultValue: 8, suffix: " wks" },
];

const LIQUIDITY_FIELDS: RangeField[] = [
  { criteriaKey: "min_avg_weekly_volume", label: "Min Avg Weekly Volume", defaultValue: 50000 },
  { criteriaKey: "min_breakout_volume_ratio", label: "Min Breakout Volume Ratio", defaultValue: 1.5, suffix: "x" },
];

const CONSOLIDATION_FIELDS: RangeField[] = [
  { criteriaKey: "min_consolidation_weeks", label: "Min Weeks", defaultValue: 5, suffix: " wks" },
  { criteriaKey: "max_consolidation_range_pct", label: "Max Range", defaultValue: 25, suffix: "%" },
];

const STOCK_AGE_FIELDS: RangeField[] = [
  { criteriaKey: "min_stock_age_days", label: "Min", defaultValue: 10, suffix: " wks", toStored: (v) => Math.round(v * 7), fromStored: (v) => v / 7 },
  { criteriaKey: "max_stock_age_days", label: "Max", defaultValue: 15, suffix: " yrs", toStored: (v) => Math.round(v * 365), fromStored: (v) => v / 365 },
];

const RESISTANCE_OPTIONS = [
  { value: "yes", label: "Resistance" },
  { value: "no", label: "No Resistance" },
];

const EXCHANGE_OPTIONS = [{ value: "NSE", label: "NSE" }];

const CAP_CATEGORY_OPTIONS = [
  { value: "Large", label: "Large" },
  { value: "Mid", label: "Mid" },
  { value: "Small", label: "Small" },
];

// Course presets, applied on first load: market cap floor/ceiling, breakout-volume liquidity
// threshold, and the IPO-base stock-age window.
const DEFAULT_CRITERIA: ScreenerCriteria = {
  basis: "ATH",
  new_all_time_high_this_week: true,
  min_market_cap: 1000 * CRORE,
  max_market_cap: 50000 * CRORE,
  min_avg_weekly_volume: 50000,
  min_breakout_volume_ratio: 1.5,
  min_stock_age_days: 70,
  max_stock_age_days: 5475,
};

const fmtPrice = (v: number | null | undefined) =>
  v == null ? "" : v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtInt = (v: number | null | undefined) => (v == null ? "" : Math.round(v).toLocaleString("en-IN"));

const fmtCrore = (v: number | null | undefined) =>
  v == null ? "" : (v / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 0 }) + " Cr";

const fmtPct = (v: number | null | undefined) => (v == null ? "" : (v >= 0 ? "+" : "") + v.toFixed(2) + "%");

const fmtRatio = (v: number | null | undefined) => (v == null ? "" : v.toFixed(2) + "x");

const fmtDate = (v: string | null | undefined) => v ?? "";

const fmtBool = (v: boolean | null | undefined) => (v == null ? "" : v ? "Yes" : "No");

const fmtAge = (days: number | null | undefined) => {
  if (days == null) return "";
  if (days < 365) return `${Math.floor(days / 7)}w`;
  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);
  return months > 0 ? `${years}y ${months}mo` : `${years}y`;
};

type Column = {
  key: string;
  label: string;
  numeric: boolean;
  render: (s: Stock) => React.ReactNode;
  value: (s: Stock) => number | string | null;
  colorize?: boolean;
  colorClass?: (s: Stock) => string;
};

// Monday of the current calendar week, as an ISO date string (matches the
// backend's IST-calendar week convention closely enough for display flags).
function currentWeekStartISO(): string {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}
const WEEK_START_ISO = currentWeekStartISO();

const isNewAthThisWeek = (s: Stock) =>
  s.all_time_high_date != null && s.all_time_high_date >= WEEK_START_ISO;

type ScoreCriterion = { label: string; met: boolean | null };

function scoreCriteria(s: Stock): ScoreCriterion[] {
  const pct = (v: number | null) => (v == null ? "no data" : v.toFixed(1) + "%");
  return [
    {
      label: `Tight base — range ${pct(s.consolidation_range_pct)} (want <15%)`,
      met: s.consolidation_range_pct != null ? s.consolidation_range_pct < 15 : null,
    },
    {
      label: `Proper base length — ${s.consolidation_weeks ?? "?"} wks (want ≥5)`,
      met: s.consolidation_weeks != null ? s.consolidation_weeks >= 5 : null,
    },
    {
      label: `Fresh breakout — ${s.breakout_age_weeks ?? "?"} wks old (want ≤4)`,
      met: s.breakout_age_weeks != null ? s.breakout_age_weeks <= 4 : null,
    },
    {
      label: `Strong breakout volume — ${s.breakout_volume_ratio != null ? s.breakout_volume_ratio.toFixed(1) + "x" : "no data"} (want ≥2x)`,
      met: s.breakout_volume_ratio != null ? s.breakout_volume_ratio >= 2.0 : null,
    },
    {
      label: "Volume dry-up before breakout",
      met: s.volume_dry_up,
    },
    {
      label: `Not extended — ${pct(s.extension_pct)} past breakout (want ≤10%)`,
      met: s.extension_pct != null ? s.extension_pct <= 10 : null,
    },
    {
      label: "Above 200D EMA (long-term uptrend)",
      met: s.current_price != null && s.ema_200d != null ? s.current_price > s.ema_200d : null,
    },
    {
      label: "Above 10W EMA (stoploss line intact)",
      met: s.weekly_close != null && s.ema_10w != null ? s.weekly_close >= s.ema_10w : null,
    },
  ];
}

const SCORE_MAX = scoreCriteria({} as Stock).length;

function scoreStock(s: Stock): number {
  return scoreCriteria(s).filter((c) => c.met === true).length;
}

function scoreTooltip(s: Stock): string {
  return scoreCriteria(s)
    .map((c) => (c.met === true ? "✓ " : c.met === false ? "✗ " : "– ") + c.label)
    .join("\n");
}

const COLUMNS: Column[] = [
  {
    key: "symbol",
    label: "Symbol",
    numeric: false,
    render: (s) => (
      <span className="symbol-cell">
        {s.symbol}
        <a
          className="chart-link"
          href={`https://in.tradingview.com/chart/966eATtq/?symbol=NSE%3A${encodeURIComponent(s.symbol)}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          aria-label={`Open ${s.symbol} chart on TradingView`}
          title="Open chart on TradingView"
        >
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path
              d="M2 13.5V8.5M6 13.5V5M10 13.5V9.5M14 13.5V3.5M2 8.5L6 5L10 9.5L14 3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>
      </span>
    ),
    value: (s) => s.symbol,
  },
  {
    key: "flags",
    label: "Flags",
    numeric: false,
    render: (s) => (
      <span className="flags-cell">
        {isNewAthThisWeek(s) && (
          <span
            className="flag-badge flag-ath"
            title={`New all-time high this week (${s.all_time_high_date}). The course's primary buy signal.`}
          >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <path
                d="M2 12.5L6 8.5L9 10.5L14 4.5 M14 4.5H10.5 M14 4.5V8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        )}
        {s.circuit_trap && (
          <span
            className="flag-badge flag-trap"
            title={`Circuit-stock trap: ${s.circuit_trap_weeks ?? "several"} straight weeks of ~5% gains on negligible volume. Course rule: do not buy.`}
          >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <path
                d="M8 2.2L14.6 13.2H1.4L8 2.2Z M8 6.4V9.6 M8 11.4V11.9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        )}
        {s.exit_signal && (
          <span
            className="flag-badge flag-exit"
            title="Exit signal: weekly close is below the 10-week EMA (course stoploss line)."
          >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <path
                d="M6.5 3H3V13H6.5 M10 5.5L12.5 8L10 10.5 M12.5 8H6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        )}
        {s.pyramid_signal && (
          <span
            className="flag-badge flag-pyramid"
            title="Pyramid setup: a 4+ week consolidation box broke out this week. Course rule: add to your position if you hold it."
          >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <path
                d="M8 2.5L14 13.5H2L8 2.5Z M4.7 8.6H11.3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        )}
      </span>
    ),
    value: (s) =>
      (isNewAthThisWeek(s) ? 1 : 0) + (s.circuit_trap ? 1 : 0) + (s.exit_signal ? 1 : 0) + (s.pyramid_signal ? 1 : 0),
  },
  { key: "exchange", label: "Exchange", numeric: false, render: (s) => s.exchange, value: (s) => s.exchange },
  { key: "name", label: "Name", numeric: false, render: (s) => s.name, value: (s) => s.name },
  { key: "current_price", label: "Price", numeric: true, render: (s) => fmtPrice(s.current_price), value: (s) => s.current_price },
  { key: "current_volume", label: "Volume", numeric: true, render: (s) => fmtInt(s.current_volume), value: (s) => s.current_volume },
  { key: "market_cap", label: "Market Cap", numeric: true, render: (s) => fmtCrore(s.market_cap), value: (s) => s.market_cap },
  { key: "all_time_high", label: "All-Time High", numeric: true, render: (s) => fmtPrice(s.all_time_high), value: (s) => s.all_time_high },
  { key: "week_52_high", label: "52-Week High", numeric: true, render: (s) => fmtPrice(s.week_52_high), value: (s) => s.week_52_high },
  { key: "weekly_close", label: "Weekly Close", numeric: true, render: (s) => fmtPrice(s.weekly_close), value: (s) => s.weekly_close },
  { key: "weekly_volume", label: "Weekly Volume", numeric: true, render: (s) => fmtInt(s.weekly_volume), value: (s) => s.weekly_volume },
  { key: "weekly_pct_change", label: "Weekly % Chg", numeric: true, colorize: true, render: (s) => fmtPct(s.weekly_pct_change), value: (s) => s.weekly_pct_change },
  { key: "ema_21d", label: "21D EMA", numeric: true, render: (s) => fmtPrice(s.ema_21d), value: (s) => s.ema_21d },
  { key: "ema_50d", label: "50D EMA", numeric: true, render: (s) => fmtPrice(s.ema_50d), value: (s) => s.ema_50d },
  { key: "ema_200d", label: "200D EMA", numeric: true, render: (s) => fmtPrice(s.ema_200d), value: (s) => s.ema_200d },
  {
    key: "ema_10w",
    label: "10W EMA",
    numeric: true,
    render: (s) => fmtPrice(s.ema_10w),
    value: (s) => s.ema_10w,
    colorClass: (s) =>
      s.weekly_close != null && s.ema_10w != null ? (s.weekly_close >= s.ema_10w ? "" : "negative") : "",
  },
  { key: "breakout_count", label: "Breakout #", numeric: true, render: (s) => fmtInt(s.breakout_count), value: (s) => s.breakout_count },
  { key: "breakout_week", label: "Breakout Week", numeric: true, render: (s) => fmtDate(s.breakout_week), value: (s) => s.breakout_week },
  { key: "breakout_level", label: "Breakout Level", numeric: true, render: (s) => fmtPrice(s.breakout_level), value: (s) => s.breakout_level },
  { key: "consolidation_weeks", label: "Cons. Weeks", numeric: true, render: (s) => fmtInt(s.consolidation_weeks), value: (s) => s.consolidation_weeks },
  { key: "consolidation_range_pct", label: "Cons. Range %", numeric: true, render: (s) => fmtPct(s.consolidation_range_pct), value: (s) => s.consolidation_range_pct },
  { key: "extension_pct", label: "Extension %", numeric: true, colorize: true, render: (s) => fmtPct(s.extension_pct), value: (s) => s.extension_pct },
  { key: "breakout_age_weeks", label: "Breakout Age", numeric: true, render: (s) => fmtInt(s.breakout_age_weeks), value: (s) => s.breakout_age_weeks },
  { key: "avg_weekly_volume", label: "Avg Weekly Vol", numeric: true, render: (s) => fmtInt(s.avg_weekly_volume), value: (s) => s.avg_weekly_volume },
  {
    key: "breakout_volume_ratio",
    label: "Vol Ratio",
    numeric: true,
    render: (s) => fmtRatio(s.breakout_volume_ratio),
    value: (s) => s.breakout_volume_ratio,
    colorClass: (s) => {
      if (s.breakout_volume_ratio == null) return "";
      return s.breakout_volume_ratio >= 2.0 ? "positive" : s.breakout_volume_ratio < 1.5 ? "negative" : "";
    },
  },
  {
    key: "volume_dry_up",
    label: "Vol Dry-Up",
    numeric: false,
    render: (s) => fmtBool(s.volume_dry_up),
    value: (s) => fmtBool(s.volume_dry_up),
    colorClass: (s) => (s.volume_dry_up === true ? "positive" : ""),
  },
  {
    key: "ema_trend",
    label: "Trend",
    numeric: true,
    render: (s) => {
      const dot = (above: boolean | null) => (
        <span style={{ color: above ? "var(--green)" : "var(--text-dim)" }}>●</span>
      );
      const a21 = s.current_price != null && s.ema_21d != null ? s.current_price >= s.ema_21d : null;
      const a50 = s.current_price != null && s.ema_50d != null ? s.current_price >= s.ema_50d : null;
      const a200 = s.current_price != null && s.ema_200d != null ? s.current_price >= s.ema_200d : null;
      return <span style={{ letterSpacing: "3px" }}>{dot(a21)}{dot(a50)}{dot(a200)}</span>;
    },
    value: (s) => {
      let n = 0;
      if (s.current_price != null && s.ema_21d != null && s.current_price >= s.ema_21d) n++;
      if (s.current_price != null && s.ema_50d != null && s.current_price >= s.ema_50d) n++;
      if (s.current_price != null && s.ema_200d != null && s.current_price >= s.ema_200d) n++;
      return n;
    },
  },
  {
    key: "score",
    label: "Score",
    numeric: true,
    render: (s) => (
      <span className="score-cell" title={scoreTooltip(s)}>
        {scoreStock(s)}/{SCORE_MAX}
      </span>
    ),
    value: (s) => scoreStock(s),
    colorClass: (s) => {
      const sc = scoreStock(s);
      return sc >= 6 ? "positive" : sc >= 4 ? "warning" : "";
    },
  },
  { key: "stock_age", label: "Stock Age", numeric: true, render: (s) => fmtAge(s.stock_age_days), value: (s) => s.stock_age_days },
  { key: "cap_category", label: "Cap", numeric: false, render: (s) => s.cap_category, value: (s) => s.cap_category },
  { key: "weeks_of_history", label: "Weeks of Data", numeric: true, render: (s) => fmtInt(s.weeks_of_history), value: (s) => s.weeks_of_history },
  { key: "sector", label: "Sector", numeric: false, render: (s) => s.sector ?? "", value: (s) => s.sector },
  { key: "industry", label: "Industry", numeric: false, render: (s) => s.industry ?? "", value: (s) => s.industry },
  { key: "revenue_growth", label: "Rev Growth", numeric: true, colorize: true, render: (s) => fmtPct(s.revenue_growth), value: (s) => s.revenue_growth },
  { key: "earnings_growth", label: "EPS Growth", numeric: true, colorize: true, render: (s) => fmtPct(s.earnings_growth), value: (s) => s.earnings_growth },
];

// Symbol is pinned: always the leftmost column, never draggable, never hideable.
const PINNED_COLUMN_KEY = "symbol";

const DEFAULT_VISIBLE = [
  "flags", "score", "name", "current_price", "current_volume", "market_cap",
  "weekly_pct_change", "breakout_count", "breakout_age_weeks",
  "extension_pct", "breakout_volume_ratio", "volume_dry_up", "ema_trend", "ema_10w",
  "cap_category", "sector", "industry", "revenue_growth", "earnings_growth",
];

const DEFAULT_COLUMN_ORDER = [
  "name",
  ...GROUP_ORDER.flatMap((g) =>
    COLUMNS.filter((c) => c.key !== PINNED_COLUMN_KEY && c.key !== "name" && COLUMN_GROUPS[c.key] === g).map((c) => c.key)
  ),
];

const COLUMN_ORDER_COOKIE = "iss_column_order";
const COLUMN_VISIBLE_COOKIE = "iss_column_visible";
const WATCHLIST_COOKIE = "iss_watchlist";

function sortRows(rows: Stock[], sort: { key: string; dir: 1 | -1 }): Stock[] {
  const col = COLUMNS.find((c) => c.key === sort.key);
  if (!col) return rows;
  return [...rows].sort((a, b) => {
    const av = col.value(a);
    const bv = col.value(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "string" || typeof bv === "string") {
      return String(av).localeCompare(String(bv)) * sort.dir;
    }
    return (av - bv) * sort.dir;
  });
}

function reorderColumns(prev: string[], fromKey: string, toKey: string): string[] {
  const fromIdx = prev.indexOf(fromKey);
  const toIdx = prev.indexOf(toKey);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prev;
  const next = [...prev];
  next.splice(fromIdx, 1);
  next.splice(toIdx, 0, fromKey);
  return next;
}

const TOUR_DONE_COOKIE = "iss_tour_done";

const TOUR_STEPS: { title: string; body: string }[] = [
  {
    title: "Welcome to Momentum Stock Screener",
    body: "This app screens NSE stocks for momentum breakout setups using price action and volume — stocks making new highs after consolidating, on strong volume. No fundamental noise, just the setups.",
  },
  {
    title: "Check the market first",
    body: "The banner at the top shows the market regime: green \"Buy zone\" means NIFTY 50 is above its 40-week average and new buys are OK; red \"No-buy zone\" means step back and wait. Open Index Check-in for the detailed index picture.",
  },
  {
    title: "Pick your breakout basis",
    body: "All-Time High mode finds stocks breaking out to fresh all-time highs (the strongest signal). 52-Week High mode is looser — stocks at yearly highs, where the \"Resistance\" filter tells you if an old higher high still looms overhead.",
  },
  {
    title: "Filters & presets",
    body: "The filter chips come preloaded with sensible course defaults (min ₹1,000 Cr market cap, 1.5x breakout volume, and more). Click any chip to adjust. The Presets row gives one-click setups: \"Fresh breakout\" for recent moves, \"Tight base\" for coiled consolidations.",
  },
  {
    title: "Read the results",
    body: "Score (0–8) rates setup quality — hover a score to see exactly which criteria pass and fail, and sort by it. Trend dots show price vs 21/50/200-day averages (3 green = full uptrend). Flags: blue arrow = new all-time high this week (the buy signal), red triangle = circuit-stock trap (avoid), amber door = below the 10-week stoploss line, green pyramid = add-on breakout. Hover any column header or flag for an explanation.",
  },
  {
    title: "Build your watchlist",
    body: "Click + next to any symbol to pin it to your watchlist — it stays visible at the top regardless of filters, so you can track your holdings and candidates. The chart icon opens the stock on TradingView.",
  },
  {
    title: "Data freshness",
    body: "Price data refreshes automatically on weekdays; \"Data as of\" in the top bar shows the current state. That's it — happy screening!",
  },
];

const PRESETS: { label: string; criteria: ScreenerCriteria }[] = [
  { label: "Course defaults", criteria: DEFAULT_CRITERIA },
  { label: "Fresh breakout", criteria: { ...DEFAULT_CRITERIA, max_breakout_age_weeks: 4, min_breakout_volume_ratio: 2.0 } },
  { label: "Tight base", criteria: { ...DEFAULT_CRITERIA, min_consolidation_weeks: 6, max_consolidation_range_pct: 15 } },
];

function App() {
  const [criteria, setCriteria] = useState<ScreenerCriteria>(DEFAULT_CRITERIA);
  const [results, setResults] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<RefreshStatus | null>(null);
  const [indexes, setIndexes] = useState<MarketIndex[]>([]);
  const [indexPanelOpen, setIndexPanelOpen] = useState(false);

  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    const stored = getJSONCookie<string[]>(COLUMN_ORDER_COOKIE, DEFAULT_COLUMN_ORDER);
    const missing = DEFAULT_COLUMN_ORDER.filter((k) => !stored.includes(k));
    return missing.length ? [...stored, ...missing] : stored;
  });
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
    const stored = new Set(getJSONCookie<string[]>(COLUMN_VISIBLE_COOKIE, DEFAULT_VISIBLE));
    // Newly-shipped default columns (absent from the saved order cookie, so the user
    // never chose to hide them) start visible.
    const knownKeys = new Set(getJSONCookie<string[]>(COLUMN_ORDER_COOKIE, DEFAULT_COLUMN_ORDER));
    for (const k of DEFAULT_VISIBLE) {
      if (!knownKeys.has(k)) stored.add(k);
    }
    return stored;
  });
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "weekly_pct_change", dir: -1 });
  const [tourStep, setTourStep] = useState<number | null>(() =>
    getJSONCookie<boolean>(TOUR_DONE_COOKIE, false) ? null : 0
  );

  const closeTour = () => {
    setJSONCookie(TOUR_DONE_COOKIE, true);
    setTourStep(null);
  };

  const [watchlist, setWatchlist] = useState<string[]>(() => getJSONCookie(WATCHLIST_COOKIE, []));
  const [watchlistRows, setWatchlistRows] = useState<Stock[]>([]);
  const [watchlistOpen, setWatchlistOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [dragKey, setDragKey] = useState<string | null>(null);
  const columnMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setJSONCookie(COLUMN_ORDER_COOKIE, columnOrder), [columnOrder]);
  useEffect(() => setJSONCookie(COLUMN_VISIBLE_COOKIE, Array.from(visibleColumns)), [visibleColumns]);
  useEffect(() => setJSONCookie(WATCHLIST_COOKIE, watchlist), [watchlist]);

  // Watchlist rows bypass all filters: fetched by explicit symbol list, only the
  // basis follows the main screen so breakout columns stay comparable.
  useEffect(() => {
    if (watchlist.length === 0) {
      setWatchlistRows([]);
      return;
    }
    screenStocks({ basis: criteria.basis, symbols: watchlist })
      .then(setWatchlistRows)
      .catch(() => {});
  }, [watchlist, criteria.basis]);

  const toggleWatch = (symbol: string) => {
    setWatchlist((prev) =>
      prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [...prev, symbol]
    );
  };

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (columnMenuRef.current && !columnMenuRef.current.contains(e.target as Node)) {
        setColumnMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const toggleColumn = (key: string) => {
    if (key === PINNED_COLUMN_KEY) return;
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Poll fast only while a refresh is in flight; idle polling is just a heartbeat.
  useEffect(() => {
    let timer: number | undefined;
    let cancelled = false;
    const poll = () => {
      getStatus()
        .then((st) => {
          if (cancelled) return;
          setStatus(st);
          timer = window.setTimeout(poll, st.refreshing ? 5000 : 30000);
        })
        .catch(() => {
          if (!cancelled) timer = window.setTimeout(poll, 30000);
        });
    };
    poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    getIndexes().then(setIndexes).catch(() => {});
  }, []);

  const wakeRetries = useRef(0);
  const MAX_WAKE_RETRIES = 15; // ~2 min, covers a Render free-tier cold start

  const runScreen = async (c: ScreenerCriteria) => {
    setLoading(true);
    setError(null);
    try {
      setResults(await screenStocks(c));
      wakeRetries.current = 0;
    } catch (err) {
      // A network error with no data yet usually means the free-tier backend is
      // cold-starting -- keep retrying quietly instead of showing a dead page.
      const isNetworkError = err instanceof TypeError;
      if (isNetworkError && wakeRetries.current < MAX_WAKE_RETRIES) {
        wakeRetries.current += 1;
        setError("Backend is waking up (free hosting spins down when idle) — retrying…");
        setTimeout(() => runScreen(c), 8000);
        return; // keep the loading state visible while we wait
      }
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runScreen(criteria);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    runScreen(criteria);
  };

  const applyFilter = (patch: Partial<ScreenerCriteria>) => {
    setCriteria((prev) => {
      const next = { ...prev, ...patch };
      runScreen(next);
      return next;
    });
  };

  const applyPreset = (preset: ScreenerCriteria) => {
    setCriteria(preset);
    runScreen(preset);
  };

  const handleBasisChange = (basis: "ATH" | "52W") => {
    setCriteria((prev) => {
      const next = {
        ...prev,
        basis,
        new_all_time_high_this_week: basis === "ATH" ? true : undefined,
        new_52_week_high_this_week: basis === "52W" ? true : undefined,
      };
      runScreen(next);
      return next;
    });
  };

  const handleSort = (key: string) => {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 1 ? -1 : 1 } : { key, dir: -1 }));
  };

  const pinnedColumn = COLUMNS.find((c) => c.key === PINNED_COLUMN_KEY)!;

  const orderedVisibleColumns = useMemo(
    () =>
      columnOrder
        .filter((k) => k !== PINNED_COLUMN_KEY && visibleColumns.has(k))
        .map((k) => COLUMNS.find((c) => c.key === k)!)
        .filter(Boolean),
    [columnOrder, visibleColumns]
  );

  const sortedResults = useMemo(() => sortRows(results, sort), [results, sort]);
  const sortedWatchlist = useMemo(() => sortRows(watchlistRows, sort), [watchlistRows, sort]);

  // Full universe, fetched lazily on first search and cached per basis, so search
  // can also surface stocks that the current filters exclude.
  const [allStocks, setAllStocks] = useState<{ basis: string; rows: Stock[] } | null>(null);
  useEffect(() => {
    if (!searchQuery.trim()) return;
    const basis = criteria.basis ?? "ATH";
    if (allStocks && allStocks.basis === basis) return;
    screenStocks({ basis })
      .then((rows) => setAllStocks({ basis, rows }))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, criteria.basis]);

  const isAth = criteria.basis !== "52W";

  // Course market-regime rule: stop buying while NIFTY closes below its 40-week EMA
  // (~200 trading days, so the daily 200D EMA stands in for it).
  const nifty = indexes.find((i) => i.code === "NIFTY50");
  const marketRegime: "buy" | "nobuy" | null =
    nifty && nifty.current_price != null && nifty.ema_200d != null
      ? nifty.current_price >= nifty.ema_200d
        ? "buy"
        : "nobuy"
      : null;

  const matchesQuery = (s: Stock, q: string) =>
    s.symbol.toLowerCase().includes(q) || (s.name ?? "").toLowerCase().includes(q);

  const displayedResults = useMemo(() => {
    if (!searchQuery.trim()) return sortedResults;
    const q = searchQuery.trim().toLowerCase();
    return sortedResults.filter((s) => matchesQuery(s, q));
  }, [sortedResults, searchQuery]);

  // Search hits outside the current filter set, shown in their own section.
  const outsideMatches = useMemo(() => {
    if (!searchQuery.trim() || !allStocks) return [];
    const q = searchQuery.trim().toLowerCase();
    const screenedIds = new Set(results.map((s) => s.id));
    return sortRows(
      allStocks.rows.filter((s) => !screenedIds.has(s.id) && matchesQuery(s, q)),
      sort
    );
  }, [searchQuery, allStocks, results, sort]);

  type FilterBlock = { key: string; group: Group; node: React.ReactNode };

  const filterBlocks: FilterBlock[] = [
    {
      key: "market_cap",
      group: FILTER_GROUPS.market_cap,
      node: (
        <RangeFilterButton
          label="Market Cap"
          fields={MARKET_CAP_FIELDS}
          criteria={criteria}
          onApply={applyFilter}
          tooltip={FIELD_INFO.market_cap_filter}
        />
      ),
    },
    ...(isAth
      ? []
      : [
          {
            key: "resistance",
            group: FILTER_GROUPS.resistance,
            node: (
              <SelectFilterButton
                label="Resistance"
                criteriaKey="resistance"
                options={RESISTANCE_OPTIONS}
                criteria={criteria}
                onApply={applyFilter}
                tooltip={FIELD_INFO.resistance}
              />
            ),
          },
        ]),
    {
      key: "liquidity",
      group: FILTER_GROUPS.liquidity,
      node: (
        <RangeFilterButton
          label="Liquidity"
          fields={LIQUIDITY_FIELDS}
          criteria={criteria}
          onApply={applyFilter}
          tooltip={FIELD_INFO.liquidity_filter}
        />
      ),
    },
    {
      key: "consolidation",
      group: FILTER_GROUPS.consolidation,
      node: (
        <RangeFilterButton
          label="Consolidation"
          fields={CONSOLIDATION_FIELDS}
          criteria={criteria}
          onApply={applyFilter}
          tooltip={FIELD_INFO.consolidation_filter}
        />
      ),
    },
    {
      key: "extension",
      group: FILTER_GROUPS.extension,
      node: (
        <RangeFilterButton
          label="Extension"
          fields={EXTENSION_FIELDS}
          criteria={criteria}
          onApply={applyFilter}
          tooltip={FIELD_INFO.extension_filter}
        />
      ),
    },
    {
      key: "breakout_age",
      group: FILTER_GROUPS.breakout_age,
      node: (
        <RangeFilterButton
          label="Breakout Age"
          fields={BREAKOUT_AGE_FIELDS}
          criteria={criteria}
          onApply={applyFilter}
          tooltip={FIELD_INFO.breakout_age_filter}
        />
      ),
    },
    {
      key: "pct_from_high",
      group: FILTER_GROUPS.pct_from_high,
      node: (
        <RangeFilterButton
          label="% From High"
          fields={PCT_FROM_HIGH_FIELDS}
          criteria={criteria}
          onApply={applyFilter}
          tooltip={FIELD_INFO.pct_from_high_filter}
        />
      ),
    },
    {
      key: "stock_age",
      group: FILTER_GROUPS.stock_age,
      node: (
        <RangeFilterButton
          label="Stock Age"
          fields={STOCK_AGE_FIELDS}
          criteria={criteria}
          onApply={applyFilter}
          tooltip={FIELD_INFO.stock_age_filter}
        />
      ),
    },
    {
      key: "volume",
      group: FILTER_GROUPS.volume,
      node: (
        <RangeFilterButton
          label="Volume"
          fields={VOLUME_FIELDS}
          criteria={criteria}
          onApply={applyFilter}
          tooltip={FIELD_INFO.volume_filter}
        />
      ),
    },
    {
      key: "price",
      group: FILTER_GROUPS.price,
      node: (
        <RangeFilterButton
          label="Price"
          fields={PRICE_FIELDS}
          criteria={criteria}
          onApply={applyFilter}
          tooltip={FIELD_INFO.price_filter}
        />
      ),
    },
    {
      key: "exchange",
      group: FILTER_GROUPS.exchange,
      node: (
        <SelectFilterButton
          label="Exchange"
          criteriaKey="exchange"
          options={EXCHANGE_OPTIONS}
          criteria={criteria}
          onApply={applyFilter}
          tooltip={FIELD_INFO.exchange_filter}
        />
      ),
    },
    {
      key: "cap_category",
      group: FILTER_GROUPS.cap_category,
      node: (
        <SelectFilterButton
          label="Cap Category"
          criteriaKey="cap_category"
          options={CAP_CATEGORY_OPTIONS}
          criteria={criteria}
          onApply={applyFilter}
          tooltip={FIELD_INFO.cap_category_filter}
        />
      ),
    },
  ];

  const orderedFilterBlocks = GROUP_ORDER.flatMap((g) => filterBlocks.filter((f) => f.group === g));

  // Header + row markup shared by the watchlist table and the main results table,
  // so sorting, column order, and visibility stay in lockstep between them.
  const headerRow = (
    <tr>
      <th
        key={pinnedColumn.key}
        className={"pinned-column " + (pinnedColumn.numeric ? "" : "col-text ") + (sort.key === pinnedColumn.key ? "sorted" : "")}
        onClick={() => handleSort(pinnedColumn.key)}
        title={FIELD_INFO[pinnedColumn.key]}
      >
        {pinnedColumn.label}{sort.key === pinnedColumn.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
      </th>
      {orderedVisibleColumns.map((c) => (
        <th
          key={c.key}
          className={
            (c.numeric ? "" : "col-text ") +
            (sort.key === c.key ? "sorted " : "") +
            (dragKey === c.key ? "dragging" : "")
          }
          onClick={() => handleSort(c.key)}
          title={FIELD_INFO[c.key]}
          draggable
          onDragStart={(e) => {
            e.stopPropagation();
            setDragKey(c.key);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (dragKey && dragKey !== c.key) {
              setColumnOrder((prev) => reorderColumns(prev, dragKey, c.key));
            }
            setDragKey(null);
          }}
          onDragEnd={() => setDragKey(null)}
        >
          {c.label}{sort.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
        </th>
      ))}
    </tr>
  );

  const renderRow = (s: Stock) => {
    const watched = watchlist.includes(s.symbol);
    return (
      <tr key={s.id}>
        <td className="pinned-column col-text symbol">
          <span className="symbol-cell">
            <button
              type="button"
              className={"watch-button" + (watched ? " watched" : "")}
              title={watched ? "Remove from watchlist" : "Add to watchlist"}
              aria-label={watched ? `Remove ${s.symbol} from watchlist` : `Add ${s.symbol} to watchlist`}
              onClick={() => toggleWatch(s.symbol)}
            >
              {watched ? "×" : "+"}
            </button>
            {pinnedColumn.render(s)}
          </span>
        </td>
        {orderedVisibleColumns.map((c) => {
          const v = c.value(s);
          const colorClass = c.colorClass
            ? c.colorClass(s)
            : c.colorize && typeof v === "number"
            ? v >= 0 ? "positive" : "negative"
            : "";
          return (
            <td key={c.key} className={(c.numeric ? "" : "col-text ") + colorClass}>
              {c.render(s)}
            </td>
          );
        })}
      </tr>
    );
  };

  return (
    <div className="screener">
      <div className="topbar">
        <h1>Momentum Stock Screener</h1>
        <div className="basis-toggle">
          <button className={criteria.basis !== "52W" ? "active" : ""} onClick={() => handleBasisChange("ATH")}>
            All-Time High
          </button>
          <button className={criteria.basis === "52W" ? "active" : ""} onClick={() => handleBasisChange("52W")}>
            52-Week High
          </button>
        </div>
        <button type="button" className="index-panel-toggle" onClick={() => setIndexPanelOpen((v) => !v)}>
          Index Check-in {indexPanelOpen ? "▴" : "▾"}
        </button>
        {marketRegime && (
          <span
            className={"market-regime " + marketRegime}
            title={
              marketRegime === "buy"
                ? "NIFTY 50 is above its 40-week EMA — the course green-lights new buys."
                : "NIFTY 50 closed below its 40-week EMA — course rule: stop buying until it reclaims the line."
            }
          >
            {marketRegime === "buy" ? "● Market: Buy zone" : "● Market: No-buy zone"}
          </span>
        )}
        <button
          type="button"
          className="index-panel-toggle"
          title="Replay the intro tour"
          onClick={() => setTourStep(0)}
        >
          ? Tour
        </button>
        {status && (
          <span className={"data-status" + (status.refreshing ? " refreshing" : "")}>
            Data as of: {status.data_as_of ?? "never"}
            {status.refreshing && " — refreshing..."}
          </span>
        )}
      </div>

      {indexPanelOpen && (
        <div className="index-panel">
          <table className="index-panel-table">
            <thead>
              <tr>
                <th className="col-text">Index</th>
                <th>Price</th>
                <th title="21-day EMA (~3 weeks)">21D (3W)</th>
                <th title="50-day EMA (~7 weeks)">50D (7W)</th>
                <th title="200-day EMA (~28 weeks)">200D (28W)</th>
                <th title="300-day EMA (~42 weeks)">300D (42W)</th>
              </tr>
            </thead>
            <tbody>
              {indexes.map((idx) => {
                const emaClass = (ema: number | null | undefined) =>
                  idx.current_price == null || ema == null ? "" : idx.current_price >= ema ? "positive" : "negative";
                return (
                  <tr key={idx.id}>
                    <td className="col-text">{idx.name}</td>
                    <td>{fmtPrice(idx.current_price)}</td>
                    <td className={emaClass(idx.ema_21d)}>{fmtPrice(idx.ema_21d)}</td>
                    <td className={emaClass(idx.ema_50d)}>{fmtPrice(idx.ema_50d)}</td>
                    <td className={emaClass(idx.ema_200d)}>{fmtPrice(idx.ema_200d)}</td>
                    <td className={emaClass(idx.ema_300d)}>{fmtPrice(idx.ema_300d)}</td>
                  </tr>
                );
              })}
              {indexes.length === 0 && (
                <tr>
                  <td colSpan={6} className="col-text index-panel-empty">Loading index data...</td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="index-panel-note">
            NIFTY Smallcap 100 isn't shown — no reliable historical data source yet for it.
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="filter-bar">
        {orderedFilterBlocks.map((f) => <div key={f.key}>{f.node}</div>)}
        {(() => {
          const key = isAth ? "new_all_time_high_this_week" : "new_52_week_high_this_week";
          const active = isAth ? (criteria.new_all_time_high_this_week ?? false) : (criteria.new_52_week_high_this_week ?? false);
          return (
            <button
              type="button"
              className={"range-filter-button" + (active ? " active" : "")}
              title={FIELD_INFO.new_high_toggle}
              onClick={() => applyFilter({ [key]: !active } as Partial<ScreenerCriteria>)}
            >
              {isAth ? "New ATH this week" : "New 52W high this week"}
            </button>
          );
        })()}
      </form>

      <div className="presets-row">
        <span className="presets-label">Presets:</span>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className="range-filter-button"
            onClick={() => applyPreset(p.criteria)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="screen-row">
        <button type="button" className="screen-button" disabled={loading} onClick={() => runScreen(criteria)}>
          {loading ? "Screening..." : "Screen"}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {!loading && !error && sortedResults.length === 0 && (
        <p className="empty-state">
          No stocks match the current filters.
          {(criteria.new_all_time_high_this_week || criteria.new_52_week_high_this_week) &&
            " \"New high this week\" resets every Monday — early in the week, few or no stocks may qualify yet. Try toggling it off."}
        </p>
      )}

      {watchlist.length > 0 && (
        <div className="watchlist-section">
          <button type="button" className="watchlist-header" onClick={() => setWatchlistOpen((v) => !v)}>
            Watchlist ({sortedWatchlist.length}) {watchlistOpen ? "▴" : "▾"}
          </button>
          {watchlistOpen && (
            <div className="table-wrap watchlist-wrap">
              <table>
                <thead>{headerRow}</thead>
                <tbody>{sortedWatchlist.map(renderRow)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="table-toolbar">
        <span className="result-count">
          {searchQuery.trim()
            ? `${displayedResults.length} in filters + ${allStocks ? outsideMatches.length : "…"} outside`
            : `${displayedResults.length} results`}
        </span>
        <input
          className="search-input"
          type="search"
          placeholder="Search symbol or name…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <div className="column-picker" ref={columnMenuRef}>
          <button type="button" className="column-picker-button" onClick={() => setColumnMenuOpen((v) => !v)}>
            Columns ▾
          </button>
          {columnMenuOpen && (
            <div className="column-picker-menu">
              <div className="column-picker-group">
                <div className="column-picker-group-label">Pinned</div>
                <div className="column-picker-row" title="Symbol is always shown leftmost and can't be hidden.">
                  <label className="column-picker-row-pinned">
                    <input type="checkbox" checked disabled />
                    {pinnedColumn.label}
                  </label>
                </div>
              </div>
              {GROUP_ORDER.map((g) => (
                <div key={g} className="column-picker-group">
                  <div className="column-picker-group-label">{GROUP_LABELS[g]}</div>
                  {columnOrder
                    .filter((k) => COLUMN_GROUPS[k] === g)
                    .map((k) => {
                      const c = COLUMNS.find((col) => col.key === k);
                      if (!c) return null;
                      return (
                        <div key={k} className="column-picker-row" title={FIELD_INFO[k]}>
                          <label>
                            <input type="checkbox" checked={visibleColumns.has(k)} onChange={() => toggleColumn(k)} />
                            {c.label}
                          </label>
                        </div>
                      );
                    })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>{headerRow}</thead>
          <tbody>
            {searchQuery.trim() ? (
              <>
                <tr className="section-row">
                  <td colSpan={orderedVisibleColumns.length + 1}>
                    Matching current filters ({displayedResults.length})
                  </td>
                </tr>
                {displayedResults.map(renderRow)}
                {displayedResults.length === 0 && (
                  <tr className="section-empty-row">
                    <td colSpan={orderedVisibleColumns.length + 1}>No matches in the filtered results.</td>
                  </tr>
                )}
                <tr className="section-row section-row-outside">
                  <td colSpan={orderedVisibleColumns.length + 1}>
                    Other stocks — outside current filters ({allStocks ? outsideMatches.length : "…"})
                  </td>
                </tr>
                {!allStocks && (
                  <tr className="section-empty-row">
                    <td colSpan={orderedVisibleColumns.length + 1}>Loading all stocks…</td>
                  </tr>
                )}
                {allStocks && outsideMatches.length === 0 && (
                  <tr className="section-empty-row">
                    <td colSpan={orderedVisibleColumns.length + 1}>No other matches.</td>
                  </tr>
                )}
                {outsideMatches.map(renderRow)}
              </>
            ) : (
              displayedResults.map(renderRow)
            )}
          </tbody>
        </table>
      </div>

      {tourStep !== null && (
        <div className="tour-overlay" onClick={closeTour}>
          <div className="tour-card" onClick={(e) => e.stopPropagation()}>
            <div className="tour-progress">
              {tourStep + 1} / {TOUR_STEPS.length}
            </div>
            <h2>{TOUR_STEPS[tourStep].title}</h2>
            <p>{TOUR_STEPS[tourStep].body}</p>
            <div className="tour-actions">
              <button type="button" className="tour-skip" onClick={closeTour}>
                Skip
              </button>
              <div className="tour-nav">
                {tourStep > 0 && (
                  <button type="button" className="tour-back" onClick={() => setTourStep(tourStep - 1)}>
                    Back
                  </button>
                )}
                {tourStep < TOUR_STEPS.length - 1 ? (
                  <button type="button" className="tour-next" onClick={() => setTourStep(tourStep + 1)}>
                    Next
                  </button>
                ) : (
                  <button type="button" className="tour-next" onClick={closeTour}>
                    Done
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
