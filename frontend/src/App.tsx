import { useState } from "react";
import type { ScreenerCriteria, Stock } from "./types";
import { screenStocks } from "./api";
import "./App.css";

function App() {
  const [criteria, setCriteria] = useState<ScreenerCriteria>({});
  const [results, setResults] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (key: keyof ScreenerCriteria, value: string) => {
    setCriteria((prev) => ({
      ...prev,
      [key]: value === "" ? undefined : key === "exchange" ? value : Number(value),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      setResults(await screenStocks(criteria));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="screener">
      <h1>IndStockScreener</h1>
      <form onSubmit={handleSubmit} className="criteria-form">
        <label>
          Exchange
          <select onChange={(e) => handleChange("exchange", e.target.value)}>
            <option value="">Any</option>
            <option value="NSE">NSE</option>
            <option value="BSE">BSE</option>
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
        <button type="submit" disabled={loading}>
          {loading ? "Screening..." : "Screen Stocks"}
        </button>
      </form>

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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default App;
