# IndStockScreener

Momentum stock screener for NSE stocks, following a weekly-timeframe breakout methodology:
weekly-close breakouts past all-time/52-week highs after a qualifying pullback, scored 0–8
with volume, trend, and consolidation signals.

Live app: https://ind-stock-screener.vercel.app

## Stack
- Backend: FastAPI + SQLAlchemy + PostgreSQL (data pipeline + fallback API)
- Data source: yfinance (split/bonus-adjusted) + official NSE equity list
- Frontend: React + TypeScript (Vite), all screening client-side

## Architecture

The app is a daily batch pipeline plus a static read path — the backend is not involved in
serving users:

```
GitHub Actions (weekdays 6:15 pm IST + Saturday full refresh)
  └─ ingests yfinance daily bars → weekly bars + metrics → Render Postgres
  └─ exports frontend/public/bundle.json and commits it
       └─ Vercel redeploys → CDN serves the data (~630 KB gzipped)
            └─ browser caches it in IndexedDB, screens everything in memory
```

**Read path (production):** the frontend loads `/bundle.json` from Vercel's CDN — the whole
universe with both bases' (ATH / 52W) metrics, indexes, and freshness in one file. The browser
caches it in IndexedDB keyed by `data_as_of`: refreshes and repeat visits hydrate instantly with
no loading screen, then revalidate in the background and swap in silently when newer data exists.
First-ever visits show a staged boot screen with fetch progress. After the one load, every
filter/preset/search/watchlist interaction runs in memory (`frontend/src/screen.ts` mirrors the
backend's `screen_stocks` semantics) — zero further requests.

**Write path:** `.github/workflows/refresh-data.yml` runs ingestion on GitHub runners (Yahoo
rate-limits datacenter IPs, so ingestion cannot run on Render — set `DISABLE_SELF_REFRESH=1`
there), then runs `scripts/export_bundle.py` and commits the result, which triggers the Vercel
deploy. Manual refresh: `gh workflow run refresh-data.yml` (add `-f full=true` for full history).

**Fallback API:** `GET /stocks/bundle` on the Render backend serves the same payload for local
dev (so the app reflects the local DB) and as a production fallback if the static file is
missing. `POST /stocks/screen` remains for API compatibility.

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

## Local development

### Database
SQLite is the default for local dev (`backend/.env` → `DATABASE_URL=sqlite:///./test.db`).
For multi-user hosting use PostgreSQL (`postgresql+psycopg://...`) — SQLite allows only one
writer and the refresh job is a long-running writer.

### Backend
```
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m scripts.seed_stocks      # seeds NSE stock universe
python -m scripts.run_ingestion    # fetches historical prices + snapshot fields
uvicorn app.main:app
```

### Frontend
```
cd frontend
npm install
npm run dev
```

Visit http://localhost:5173 (dev fetches the bundle from the local backend on port 8000, not the
committed `bundle.json`, so it reflects your local DB). Tests: `python -m unittest discover tests`
in `backend/`.

## Operations notes
- `frontend/public/bundle.json` is machine-published by the refresh workflow (bot commits named
  "Publish data bundle (date)") — don't edit it by hand; local exports come from
  `python -m scripts.export_bundle <path>`.
- Bulk-pushing a locally-ingested dataset to the hosted DB: `python -m scripts.migrate_to_pg
  "<render external DB url>"`.
- Deploys: Vercel (frontend, root `frontend/`) and Render (backend + Postgres, `render.yaml`
  blueprint) both deploy on push to master.

## Next steps
- Add more screener criteria (P/E, sector, RSI, moving averages, etc.).
- Trim the bundle payload (round floats, drop unrendered fields): ~630 KB → ~400 KB gzipped.
- Pagination for very large result sets.
