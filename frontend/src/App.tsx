import { useEffect, useState } from "react";
import type { RefreshStatus, ScreenerCriteria, Stock } from "./types";
import { getStatus, screenStocks } from "./api";
import "./App.css";

type Column = {
  key: string;
  label: string;
  render: (s: Stock) => React.ReactNode;
};

const COLUMNS: Column[] = [
  { key: "symbol", label: "Symbol", render: (s) => s.symbol },
  { key: "exchange", label: "Exchange", render: (s) => s.exchange },
  { key: "name", label: "Name", render: (s) => s.name },
  { key: "current_price", label: "Price", render: (s) => s.current_price },
  { key: "current_volume", label: "Volume", render: (s) => s.current_volume },
  { key: "market_cap", label: "Market Cap", render: (s) => s.market_cap },
  { key: "all_time_high", label: "All-Time High", render: (s) => s.all_time_high },
  { key: "week_52_high", label: "52-Week High", render: (s) => s.week_52_high },
  { key: "weekly_close", label: "Weekly Close", render: (s) => s.weekly_close },
  { key: "weekly_volume", label: "Weekly Volume", render: (s) => s.weekly_volume },
  { key: "weekly_pct_change", label: "Weekly % Change", render: (s) => s.weekly_pct_change?.toFixed(2) },
  { key: "breakout_count", label: "Breakout Count", render: (s) => s.breakout_count },
  { key: "breakout_week", label: "Breakout Week", render: (s) => s.breakout_week },
  { key: "breakout_level", label: "Breakout Level", render: (s) => s.breakout_level },
  { key: "consolidation_weeks", label: "Consolidation Weeks", render: (s) => s.consolidation_weeks },
  { key: "consolidation_range_pct", label: "Consolidation Range %", render: (s) => s.consolidation_range_pct?.toFixed(2) },
  { key: "extension_pct", label: "Extension %", render: (s) => s.extension_pct?.toFixed(2) },
  { key: "breakout_age_weeks", label: "Breakout Age (weeks)", render: (s) => s.breakout_age_weeks },
  { key: "avg_weekly_volume", label: "Avg Weekly Volume", render: (s) => s.avg_weekly_volume },
  { key: "breakout_volume_ratio", label: "Breakout Volume Ratio", render: (s) => s.breakout_volume_ratio?.toFixed(2) },
  { key: "cap_category", label: "Cap Category", render: (s) => s.cap_category },
  { key: "weeks_of_history", label: "Weeks of History", render: (s) => s.weeks_of_history },
];

function App() {
  const [criteria, setCriteria] = useState<ScreenerCriteria>({ basis: "ATH", new_all_time_high_this_week: true });
  const [results, setResults] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<RefreshStatus | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(COLUMNS.map((c) => c.key)));

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

  const handleBasisChange = (basis: "ATH" | "52W") => {
    setCriteria((prev) => ({
      ...prev,
      basis,
      new_all_time_high_this_week: basis === "ATH" ? true : undefined,
      new_52_week_high_this_week: basis === "52W" ? true : undefined,
    }));
  };

  return (
    <div className="screener">
      <h1>IndStockScreener</h1>
      {status && (
        <p className="data-status">
          Data as of: {status.data_as_of ?? "never"}
          {status.refreshing && " — refreshing..."}
        </p>
      )}
      <form onSubmit={handleSubmit} className="criteria-form">
        <label>
          Basis
          <select value={criteria.basis ?? "ATH"} onChange={(e) => handleBasisChange(e.target.value as "ATH" | "52W")}>
            <option value="ATH">All-Time High</option>
            <option value="52W">52-Week High</option>
          </select>
        </label>
        {criteria.basis !== "52W" && (
          <label>
            <input
              type="checkbox"
              checked={criteria.new_all_time_high_this_week ?? false}
              onChange={(e) => handleToggle("new_all_time_high_this_week", e.target.checked)}
            />
            New All-Time High this week
          </label>
        )}
        {criteria.basis === "52W" && (
          <label>
            <input
              type="checkbox"
              checked={criteria.new_52_week_high_this_week ?? false}
              onChange={(e) => handleToggle("new_52_week_high_this_week", e.target.checked)}
            />
            New 52-Week High this week
          </label>
        )}
        <label>
          Exchange
          <select onChange={(e) => handleChange("exchange", e.target.value)}>
            <option value="">Any</option>
            <option value="NSE">NSE</option>
          </select>
        </label>
        <label>
          Cap Category
          <select onChange={(e) => handleChange("cap_category", e.target.value)}>
            <option value="">Any</option>
            <option value="Large">Large</option>
            <option value="Mid">Mid</option>
            <option value="Small">Small</option>
          </select>
        </label>
        <label>
          Min Market Cap
          <input type="number" onChange={(e) => handleChange("min_market_cap", e.target.value)} />
        </label>
        <label>
          Max Market Cap
          <input type="number" onChange={(e) => handleChange("max_market_cap", e.target.value)} />
        </label>
        <label>
          Min Volume
          <input type="number" onChange={(e) => handleChange("min_volume", e.target.value)} />
        </label>
        <label>
          Min Price
          <input type="number" onChange={(e) => handleChange("min_price", e.target.value)} />
        </label>
        <label>
          Max Price
          <input type="number" onChange={(e) => handleChange("max_price", e.target.value)} />
        </label>
        <label>
          Max % below All-Time High
          <input type="number" onChange={(e) => handleChange("pct_from_all_time_high_max", e.target.value)} />
        </label>
        <label>
          Max % below 52-Week High
          <input type="number" onChange={(e) => handleChange("pct_from_52_week_high_max", e.target.value)} />
        </label>
        <label>
          Max Extension %
          <input type="number" onChange={(e) => handleChange("max_extension_pct", e.target.value)} />
        </label>
        <label>
          Max Breakout Age (weeks)
          <input type="number" onChange={(e) => handleChange("max_breakout_age_weeks", e.target.value)} />
        </label>
        <label>
          Min Avg Weekly Volume
          <input type="number" onChange={(e) => handleChange("min_avg_weekly_volume", e.target.value)} />
        </label>
        <label>
          Min Breakout Volume Ratio
          <input type="number" onChange={(e) => handleChange("min_breakout_volume_ratio", e.target.value)} />
        </label>
        <label>
          <input
            type="checkbox"
            checked={criteria.exclude_young_stocks ?? false}
            onChange={(e) => handleToggle("exclude_young_stocks", e.target.checked)}
          />
          Ignore stocks with &lt;10 weeks of history
        </label>
        <button type="submit" disabled={loading}>
          {loading ? "Screening..." : "Screen Stocks"}
        </button>
      </form>

      <fieldset className="consolidation-filters">
        <legend>Consolidation Indicators</legend>
        <label>
          Min Consolidation Weeks
          <input type="number" onChange={(e) => handleChange("min_consolidation_weeks", e.target.value)} />
        </label>
        <label>
          Max Consolidation Range %
          <input type="number" onChange={(e) => handleChange("max_consolidation_range_pct", e.target.value)} />
        </label>
        <button type="button" disabled={loading} onClick={() => runScreen(criteria)}>
          {loading ? "Screening..." : "Apply"}
        </button>
      </fieldset>

      {error && <p className="error">{error}</p>}

      <fieldset className="column-toggles">
        <legend>Columns</legend>
        {COLUMNS.map((c) => (
          <label key={c.key}>
            <input
              type="checkbox"
              checked={visibleColumns.has(c.key)}
              onChange={() => toggleColumn(c.key)}
            />
            {c.label}
          </label>
        ))}
      </fieldset>

      <table>
        <thead>
          <tr>
            {COLUMNS.filter((c) => visibleColumns.has(c.key)).map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.map((s) => (
            <tr key={s.id}>
              {COLUMNS.filter((c) => visibleColumns.has(c.key)).map((c) => (
                <td key={c.key}>{c.render(s)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default App;
