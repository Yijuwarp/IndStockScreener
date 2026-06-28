import { useEffect, useMemo, useRef, useState } from "react";
import type { RefreshStatus, ScreenerCriteria, Stock } from "./types";
import { getStatus, screenStocks } from "./api";
import { RangeFilterButton, type RangeField } from "./RangeFilter";
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

const fmtPrice = (v: number | null | undefined) =>
  v == null ? "" : v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtInt = (v: number | null | undefined) => (v == null ? "" : Math.round(v).toLocaleString("en-IN"));

const fmtCrore = (v: number | null | undefined) =>
  v == null ? "" : (v / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 0 }) + " Cr";

const fmtPct = (v: number | null | undefined) => (v == null ? "" : (v >= 0 ? "+" : "") + v.toFixed(2) + "%");

const fmtRatio = (v: number | null | undefined) => (v == null ? "" : v.toFixed(2) + "x");

const fmtDate = (v: string | null | undefined) => v ?? "";

type Column = {
  key: string;
  label: string;
  numeric: boolean;
  render: (s: Stock) => React.ReactNode;
  value: (s: Stock) => number | string | null;
  colorize?: boolean;
};

const COLUMNS: Column[] = [
  { key: "symbol", label: "Symbol", numeric: false, render: (s) => s.symbol, value: (s) => s.symbol },
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
  { key: "breakout_count", label: "Breakout #", numeric: true, render: (s) => fmtInt(s.breakout_count), value: (s) => s.breakout_count },
  { key: "breakout_week", label: "Breakout Week", numeric: true, render: (s) => fmtDate(s.breakout_week), value: (s) => s.breakout_week },
  { key: "breakout_level", label: "Breakout Level", numeric: true, render: (s) => fmtPrice(s.breakout_level), value: (s) => s.breakout_level },
  { key: "consolidation_weeks", label: "Cons. Weeks", numeric: true, render: (s) => fmtInt(s.consolidation_weeks), value: (s) => s.consolidation_weeks },
  { key: "consolidation_range_pct", label: "Cons. Range %", numeric: true, render: (s) => fmtPct(s.consolidation_range_pct), value: (s) => s.consolidation_range_pct },
  { key: "extension_pct", label: "Extension %", numeric: true, colorize: true, render: (s) => fmtPct(s.extension_pct), value: (s) => s.extension_pct },
  { key: "breakout_age_weeks", label: "Breakout Age", numeric: true, render: (s) => fmtInt(s.breakout_age_weeks), value: (s) => s.breakout_age_weeks },
  { key: "avg_weekly_volume", label: "Avg Weekly Vol", numeric: true, render: (s) => fmtInt(s.avg_weekly_volume), value: (s) => s.avg_weekly_volume },
  { key: "breakout_volume_ratio", label: "Vol Ratio", numeric: true, render: (s) => fmtRatio(s.breakout_volume_ratio), value: (s) => s.breakout_volume_ratio },
  { key: "cap_category", label: "Cap", numeric: false, render: (s) => s.cap_category, value: (s) => s.cap_category },
  { key: "weeks_of_history", label: "Weeks of Data", numeric: true, render: (s) => fmtInt(s.weeks_of_history), value: (s) => s.weeks_of_history },
];

const DEFAULT_VISIBLE = new Set([
  "symbol", "name", "current_price", "current_volume", "market_cap",
  "weekly_pct_change", "breakout_count", "breakout_age_weeks",
  "extension_pct", "breakout_volume_ratio", "cap_category",
]);

function App() {
  const [criteria, setCriteria] = useState<ScreenerCriteria>({ basis: "ATH", new_all_time_high_this_week: true });
  const [results, setResults] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<RefreshStatus | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(DEFAULT_VISIBLE);
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "weekly_pct_change", dir: -1 });
  const columnMenuRef = useRef<HTMLDivElement>(null);

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

  const STRING_FIELDS: (keyof ScreenerCriteria)[] = ["exchange", "cap_category"];

  const handleChange = (key: keyof ScreenerCriteria, value: string) => {
    setCriteria((prev) => ({
      ...prev,
      [key]: value === "" ? undefined : STRING_FIELDS.includes(key) ? value : Number(value),
    }));
  };

  const handleToggle = (key: keyof ScreenerCriteria, checked: boolean) => {
    setCriteria((prev) => ({ ...prev, [key]: checked }));
  };

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

  const visibleColumnList = COLUMNS.filter((c) => visibleColumns.has(c.key));

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
        {criteria.basis !== "52W" ? (
          <label className="new-high-toggle">
            <input
              type="checkbox"
              checked={criteria.new_all_time_high_this_week ?? false}
              onChange={(e) => handleToggle("new_all_time_high_this_week", e.target.checked)}
            />
            New ATH this week
          </label>
        ) : (
          <label className="new-high-toggle">
            <input
              type="checkbox"
              checked={criteria.new_52_week_high_this_week ?? false}
              onChange={(e) => handleToggle("new_52_week_high_this_week", e.target.checked)}
            />
            New 52W high this week
          </label>
        )}
        {status && (
          <span className={"data-status" + (status.refreshing ? " refreshing" : "")}>
            Data as of: {status.data_as_of ?? "never"}
            {status.refreshing && " — refreshing..."}
          </span>
        )}
      </div>

      <form onSubmit={handleSubmit} className="filter-bar">
        <div className="filter-field">
          <label>Exchange</label>
          <select onChange={(e) => handleChange("exchange", e.target.value)}>
            <option value="">Any</option>
            <option value="NSE">NSE</option>
          </select>
        </div>
        <div className="filter-field">
          <label>Cap Category</label>
          <select onChange={(e) => handleChange("cap_category", e.target.value)}>
            <option value="">Any</option>
            <option value="Large">Large</option>
            <option value="Mid">Mid</option>
            <option value="Small">Small</option>
          </select>
        </div>

        <RangeFilterButton label="Market Cap" fields={MARKET_CAP_FIELDS} criteria={criteria} onApply={applyFilter} />
        <RangeFilterButton label="Volume" fields={VOLUME_FIELDS} criteria={criteria} onApply={applyFilter} />
        <RangeFilterButton label="Price" fields={PRICE_FIELDS} criteria={criteria} onApply={applyFilter} />
        <RangeFilterButton label="% From High" fields={PCT_FROM_HIGH_FIELDS} criteria={criteria} onApply={applyFilter} />
        <RangeFilterButton label="Extension" fields={EXTENSION_FIELDS} criteria={criteria} onApply={applyFilter} />
        <RangeFilterButton label="Breakout Age" fields={BREAKOUT_AGE_FIELDS} criteria={criteria} onApply={applyFilter} />
        <RangeFilterButton label="Liquidity" fields={LIQUIDITY_FIELDS} criteria={criteria} onApply={applyFilter} />
        <RangeFilterButton label="Consolidation" fields={CONSOLIDATION_FIELDS} criteria={criteria} onApply={applyFilter} />

        <label className="new-high-toggle">
          <input
            type="checkbox"
            checked={criteria.exclude_young_stocks ?? false}
            onChange={(e) => handleToggle("exclude_young_stocks", e.target.checked)}
          />
          Hide &lt;10wk stocks
        </label>

        <button type="submit" className="screen-button" disabled={loading}>
          {loading ? "Screening..." : "Screen"}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {!loading && !error && sortedResults.length === 0 && (
        <p className="empty-state">
          No stocks match the current filters.
          {(criteria.new_all_time_high_this_week || criteria.new_52_week_high_this_week) &&
            " \"New high this week\" resets every Monday — early in the week, few or no stocks may qualify yet. Try toggling it off."}
        </p>
      )}

      <div className="table-toolbar">
        <span className="result-count">{sortedResults.length} results</span>
        <div className="column-picker" ref={columnMenuRef}>
          <button type="button" className="column-picker-button" onClick={() => setColumnMenuOpen((v) => !v)}>
            Columns ▾
          </button>
          {columnMenuOpen && (
            <div className="column-picker-menu">
              {COLUMNS.map((c) => (
                <label key={c.key}>
                  <input type="checkbox" checked={visibleColumns.has(c.key)} onChange={() => toggleColumn(c.key)} />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {visibleColumnList.map((c) => (
                <th
                  key={c.key}
                  className={(c.numeric ? "" : "col-text ") + (sort.key === c.key ? "sorted" : "")}
                  onClick={() => handleSort(c.key)}
                >
                  {c.label}{sort.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedResults.map((s) => (
              <tr key={s.id}>
                {visibleColumnList.map((c) => {
                  const v = c.value(s);
                  const colorClass = c.colorize && typeof v === "number" ? (v >= 0 ? "positive" : "negative") : "";
                  return (
                    <td key={c.key} className={(c.numeric ? "" : "col-text ") + (c.key === "symbol" ? "symbol " : "") + colorClass}>
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
