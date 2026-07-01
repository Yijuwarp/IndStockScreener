import type { ScreenerCriteria, Stock, RefreshStatus, MarketIndex } from "./types";

const API_BASE = "http://localhost:8000";

export async function screenStocks(criteria: ScreenerCriteria): Promise<Stock[]> {
  const res = await fetch(`${API_BASE}/stocks/screen`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(criteria),
  });
  if (!res.ok) throw new Error(`Screen request failed: ${res.status}`);
  return res.json();
}

export async function getStatus(): Promise<RefreshStatus> {
  const res = await fetch(`${API_BASE}/status`);
  if (!res.ok) throw new Error(`Status request failed: ${res.status}`);
  return res.json();
}

export async function getIndexes(): Promise<MarketIndex[]> {
  const res = await fetch(`${API_BASE}/indexes`);
  if (!res.ok) throw new Error(`Indexes request failed: ${res.status}`);
  return res.json();
}
