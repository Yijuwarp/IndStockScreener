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

## Hosting notes
- SQLite (`DATABASE_URL=sqlite:///./test.db`) is fine for local/single-user use. For multi-user
  hosting switch to PostgreSQL (`DATABASE_URL=postgresql+psycopg://...`) — SQLite allows only one
  writer, and the daily refresh job is a long-running writer that will contend with user requests.
- Responses are gzip-compressed and the screen endpoint reads only the denormalized `stocks`
  table, so a small VPS (1-2 vCPU) handles dozens of concurrent users.

## Next steps
- Schedule `run_ingestion` to run daily (e.g. via APScheduler or a cron job).
- Add more screener criteria (P/E, sector, RSI, moving averages, etc.).
- Add pagination/sorting to the results table.
