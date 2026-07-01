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
  { criteriaKey: "min_market_cap", label: "Min", defaultValue: 500, suffix: " Cr", toStored: (v) => v * CRORE, fromStored: (v) => v / CRORE },
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
  min_market_cap: 500 * CRORE,
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
};

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
  { key: "breakout_count", label: "Breakout #", numeric: true, render: (s) => fmtInt(s.breakout_count), value: (s) => s.breakout_count },
  { key: "breakout_week", label: "Breakout Week", numeric: true, render: (s) => fmtDate(s.breakout_week), value: (s) => s.breakout_week },
  { key: "breakout_level", label: "Breakout Level", numeric: true, render: (s) => fmtPrice(s.breakout_level), value: (s) => s.breakout_level },
  { key: "consolidation_weeks", label: "Cons. Weeks", numeric: true, render: (s) => fmtInt(s.consolidation_weeks), value: (s) => s.consolidation_weeks },
  { key: "consolidation_range_pct", label: "Cons. Range %", numeric: true, render: (s) => fmtPct(s.consolidation_range_pct), value: (s) => s.consolidation_range_pct },
  { key: "extension_pct", label: "Extension %", numeric: true, colorize: true, render: (s) => fmtPct(s.extension_pct), value: (s) => s.extension_pct },
  { key: "breakout_age_weeks", label: "Breakout Age", numeric: true, render: (s) => fmtInt(s.breakout_age_weeks), value: (s) => s.breakout_age_weeks },
  { key: "avg_weekly_volume", label: "Avg Weekly Vol", numeric: true, render: (s) => fmtInt(s.avg_weekly_volume), value: (s) => s.avg_weekly_volume },
  { key: "breakout_volume_ratio", label: "Vol Ratio", numeric: true, render: (s) => fmtRatio(s.breakout_volume_ratio), value: (s) => s.breakout_volume_ratio },
  { key: "volume_dry_up", label: "Vol Dry-Up", numeric: false, render: (s) => fmtBool(s.volume_dry_up), value: (s) => fmtBool(s.volume_dry_up) },
  { key: "stock_age", label: "Stock Age", numeric: true, render: (s) => fmtAge(s.stock_age_days), value: (s) => s.stock_age_days },
  { key: "cap_category", label: "Cap", numeric: false, render: (s) => s.cap_category, value: (s) => s.cap_category },
  { key: "weeks_of_history", label: "Weeks of Data", numeric: true, render: (s) => fmtInt(s.weeks_of_history), value: (s) => s.weeks_of_history },
];

// Symbol is pinned: always the leftmost column, never draggable, never hideable.
const PINNED_COLUMN_KEY = "symbol";

const DEFAULT_VISIBLE = [
  "name", "current_price", "current_volume", "market_cap",
  "weekly_pct_change", "breakout_count", "breakout_age_weeks",
  "extension_pct", "breakout_volume_ratio", "volume_dry_up", "cap_category",
];

const DEFAULT_COLUMN_ORDER = [
  "name",
  ...GROUP_ORDER.flatMap((g) =>
    COLUMNS.filter((c) => c.key !== PINNED_COLUMN_KEY && c.key !== "name" && COLUMN_GROUPS[c.key] === g).map((c) => c.key)
  ),
];

const COLUMN_ORDER_COOKIE = "iss_column_order";
const COLUMN_VISIBLE_COOKIE = "iss_column_visible";

function reorderColumns(prev: string[], fromKey: string, toKey: string): string[] {
  const fromIdx = prev.indexOf(fromKey);
  const toIdx = prev.indexOf(toKey);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prev;
  const next = [...prev];
  next.splice(fromIdx, 1);
  next.splice(toIdx, 0, fromKey);
  return next;
}

function App() {
  const [criteria, setCriteria] = useState<ScreenerCriteria>(DEFAULT_CRITERIA);
  const [results, setResults] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<RefreshStatus | null>(null);
  const [indexes, setIndexes] = useState<MarketIndex[]>([]);
  const [indexPanelOpen, setIndexPanelOpen] = useState(false);

  const [columnOrder, setColumnOrder] = useState<string[]>(() =>
    getJSONCookie(COLUMN_ORDER_COOKIE, DEFAULT_COLUMN_ORDER)
  );
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(
    () => new Set(getJSONCookie<string[]>(COLUMN_VISIBLE_COOKIE, DEFAULT_VISIBLE))
  );
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "weekly_pct_change", dir: -1 });
  const [searchQuery, setSearchQuery] = useState("");
  const [dragKey, setDragKey] = useState<string | null>(null);
  const columnMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setJSONCookie(COLUMN_ORDER_COOKIE, columnOrder), [columnOrder]);
  useEffect(() => setJSONCookie(COLUMN_VISIBLE_COOKIE, Array.from(visibleColumns)), [visibleColumns]);

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

  useEffect(() => {
    const poll = () => getStatus().then(setStatus).catch(() => {});
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    getIndexes().then(setIndexes).catch(() => {});
  }, []);

  const runScreen = async (c: ScreenerCriteria) => {
    setLoading(true);
    setError(null);
    try {
      setResults(await screenStocks(c));
    } catch (err) {
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

  const handleBasisChange = (basis: "ATH" | "52W") => {
    setCriteria((prev) => ({
      ...prev,
      basis,
      new_all_time_high_this_week: basis === "ATH" ? true : undefined,
      new_52_week_high_this_week: basis === "52W" ? true : undefined,
    }));
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

  const sortedResults = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sort.key);
    if (!col) return results;
    return [...results].sort((a, b) => {
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
  }, [results, sort]);

  const isAth = criteria.basis !== "52W";

  const displayedResults = useMemo(() => {
    if (!searchQuery.trim()) return sortedResults;
    const q = searchQuery.trim().toLowerCase();
    return sortedResults.filter(
      (s) => s.symbol.toLowerCase().includes(q) || (s.name ?? "").toLowerCase().includes(q)
    );
  }, [sortedResults, searchQuery]);

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

  return (
    <div className="screener">
      <div className="topbar">
        <h1>IndStockScreener</h1>
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

      <div className="table-toolbar">
        <span className="result-count">
          {displayedResults.length}{searchQuery.trim() ? ` of ${sortedResults.length}` : ""} results
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
          <thead>
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
          </thead>
          <tbody>
            {displayedResults.map((s) => (
              <tr key={s.id}>
                <td className="pinned-column col-text symbol">{pinnedColumn.render(s)}</td>
                {orderedVisibleColumns.map((c) => {
                  const v = c.value(s);
                  const colorClass = c.colorize && typeof v === "number" ? (v >= 0 ? "positive" : "negative") : "";
                  return (
                    <td key={c.key} className={(c.numeric ? "" : "col-text ") + colorClass}>
                      {c.render(s)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default App;
