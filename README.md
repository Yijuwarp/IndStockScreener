# IndStockScreener

Web app to screen NSE stocks against historical criteria: market cap, volume, price, all-time high, and 52-week high.

## Stack
- Backend: FastAPI + SQLAlchemy + PostgreSQL
- Data source: yfinance (split/bonus-adjusted) + official NSE equity list
- Frontend: React + TypeScript (Vite)

## Setup

### Database
Create a PostgreSQL database named `indstockscreener`, then copy `backend/.env.example` to `backend/.env` and adjust `DATABASE_URL` if needed.

### Backend
```
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m scripts.seed_stocks      # seeds NSE stock universe
python -m scripts.run_ingestion    # fetches historical prices + snapshot fields
uvicorn app.main:app --reload
```

### Frontend
```
cd frontend
npm install
npm run dev
```

Visit http://localhost:5173, backend runs on http://localhost:8000.

## Data storage: weekly granularity only (decision, 2026-07-05)

Weekly bars (`weekly_prices`) are the only stored price history. Daily bars fetched from
yfinance are aggregated and discarded in memory during ingestion — there is no
`daily_prices` table.

**Why:** the screening methodology is weekly-timeframe (weekly-close breakouts, 10-week EMA
stoploss), and full daily history for the ~2,400-stock NSE universe is 7.5M rows (~1.5–2 GB
in Postgres) — it doesn't fit Render's 1 GB free tier and nothing at query time ever read it.
Weekly storage is ~5x smaller (~1.6M rows) and every user-facing metric survives.

**How daily-derived fields still work:**
- *Current price/volume, market cap:* taken from the fetch each run, stored as scalars on `stocks`.
- *Daily EMAs (21/50/200) → trend dots:* full runs compute from the fetched history; weekday
  incremental runs continue the stored EMA with the new closes (exact `ewm(adjust=False)`
  recursion). The Saturday `--full` refresh recomputes from scratch, healing any drift.
- *All-time high, 52-week high, listing date / stock age:* derived from stored weekly bars.
  A week's high is the max of its days' highs, so the **values** are identical to daily-derived
  ones; the **dates** are week-precision (the Monday of the week the high printed).
- *Split/bonus detection:* fetched weekly closes are compared against stored ones on complete
  overlapping weeks; divergence triggers a full-history refetch and weekly rebuild.

**Trade-off accepted:** any future daily-granularity feature (daily candles, daily backtests,
long-lookback ATR) would need refetching from yfinance rather than reading the DB.

## Hosting notes
- SQLite (`DATABASE_URL=sqlite:///./test.db`) is fine for local/single-user use. For multi-user
  hosting switch to PostgreSQL (`DATABASE_URL=postgresql+psycopg://...`) — SQLite allows only one
  writer, and the daily refresh job is a long-running writer that will contend with user requests.
- The backend serves each frontend session exactly once: on load the client fetches
  `GET /stocks/bundle` (the whole universe with both bases' metrics + indexes + refresh status,
  ~630 KB gzipped) behind a staged boot screen, and every subsequent filter/preset/search/watchlist
  interaction screens that payload in the browser (`frontend/src/screen.ts` mirrors the backend's
  `screen_stocks` semantics). No further requests, so free-tier cold starts are paid once per session.
- Responses are gzip-compressed and the bundle reads only the denormalized `stocks` and
  `breakout_metrics` tables, so a small VPS (1-2 vCPU) handles dozens of concurrent users.

## Next steps
- Schedule `run_ingestion` to run daily (e.g. via APScheduler or a cron job).
- Add more screener criteria (P/E, sector, RSI, moving averages, etc.).
- Add pagination/sorting to the results table.
