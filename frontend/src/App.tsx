import { useEffect, useState } from "react";
import type { RefreshStatus, ScreenerCriteria, Stock } from "./types";
import { getStatus, screenStocks } from "./api";
import "./App.css";

function App() {
  const [criteria, setCriteria] = useState<ScreenerCriteria>({ basis: "ATH", new_all_time_high_this_week: true });
  const [results, setResults] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<RefreshStatus | null>(null);

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

      <table>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Exchange</th>
            <th>Name</th>
            <th>Price</th>
            <th>Volume</th>
            <th>Market Cap</th>
            <th>All-Time High</th>
            <th>52-Week High</th>
            <th>Weekly Close</th>
            <th>Weekly Volume</th>
            <th>Weekly % Change</th>
            <th>Breakout Count</th>
            <th>Breakout Week</th>
            <th>Breakout Level</th>
            <th>Consolidation Weeks</th>
            <th>Consolidation Range %</th>
            <th>Extension %</th>
            <th>Breakout Age (weeks)</th>
            <th>Avg Weekly Volume</th>
            <th>Breakout Volume Ratio</th>
            <th>Cap Category</th>
          </tr>
        </thead>
        <tbody>
          {results.map((s) => (
            <tr key={s.id}>
              <td>{s.symbol}</td>
              <td>{s.exchange}</td>
              <td>{s.name}</td>
              <td>{s.current_price}</td>
              <td>{s.current_volume}</td>
              <td>{s.market_cap}</td>
              <td>{s.all_time_high}</td>
              <td>{s.week_52_high}</td>
              <td>{s.weekly_close}</td>
              <td>{s.weekly_volume}</td>
              <td>{s.weekly_pct_change?.toFixed(2)}</td>
              <td>{s.breakout_count}</td>
              <td>{s.breakout_week}</td>
              <td>{s.breakout_level}</td>
              <td>{s.consolidation_weeks}</td>
              <td>{s.consolidation_range_pct?.toFixed(2)}</td>
              <td>{s.extension_pct?.toFixed(2)}</td>
              <td>{s.breakout_age_weeks}</td>
              <td>{s.avg_weekly_volume}</td>
              <td>{s.breakout_volume_ratio?.toFixed(2)}</td>
              <td>{s.cap_category}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default App;
