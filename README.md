# IndStockScreener

Web app to screen NSE & BSE stocks against historical criteria: market cap, volume, price, all-time high, and 52-week high.

## Stack
- Backend: FastAPI + SQLAlchemy + PostgreSQL
- Data source: yfinance + official NSE/BSE equity lists
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
python -m scripts.seed_stocks      # seeds NSE & BSE stock universe
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

## Next steps
- Schedule `run_ingestion` to run daily (e.g. via APScheduler or a cron job).
- Add more screener criteria (P/E, sector, RSI, moving averages, etc.).
- Add pagination/sorting to the results table.
