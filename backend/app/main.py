import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from sqlalchemy import inspect, text

from app.db.session import Base, engine
from app.routers import stocks, indexes
from app.services.freshness import check_and_refresh, status

app = FastAPI(title="Momentum Stock Screener API")

_cors_origins = os.environ.get("CORS_ORIGINS", "*").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(GZipMiddleware, minimum_size=1000)

app.include_router(stocks.router)
app.include_router(indexes.router)


# dev-mode migration: create_all doesn't add columns to existing tables, so
# backfill any newly-declared columns with ALTER TABLE, per table.
_NEW_COLUMNS: dict[str, dict[str, str]] = {
    "stocks": {
        "ema_10w": "FLOAT",
        "sector": "VARCHAR",
        "industry": "VARCHAR",
        "revenue_growth": "FLOAT",
        "earnings_growth": "FLOAT",
        "circuit_trap": "BOOLEAN",
        "circuit_trap_weeks": "INTEGER",
        "weekly_close": "FLOAT",
        "weekly_volume": "BIGINT",
        "weekly_pct_change": "FLOAT",
        "ema_13w": "FLOAT",
    },
    # Breakout lifecycle (docs/SPEC-breakout-lifecycle.md)
    "breakout_metrics": {
        "status": "VARCHAR",
        "status_reason": "VARCHAR",
        "box_high": "FLOAT",
        "box_floor": "FLOAT",
    },
}

# One-time backfill of the denormalized weekly snapshot from weekly_prices, so the
# columns aren't empty until the next ingestion run.
_WEEKLY_BACKFILL_SQL = """
UPDATE stocks SET
  weekly_close = (
    SELECT close FROM weekly_prices wp
    WHERE wp.stock_id = stocks.id ORDER BY wp.week_start DESC LIMIT 1
  ),
  weekly_volume = (
    SELECT volume FROM weekly_prices wp
    WHERE wp.stock_id = stocks.id ORDER BY wp.week_start DESC LIMIT 1
  ),
  weekly_pct_change = (
    SELECT (a.close - b.close) / b.close * 100
    FROM weekly_prices a, weekly_prices b
    WHERE a.stock_id = stocks.id AND b.stock_id = stocks.id
      AND a.week_start = (SELECT MAX(week_start) FROM weekly_prices w WHERE w.stock_id = stocks.id)
      AND b.week_start = (SELECT MAX(week_start) FROM weekly_prices w2 WHERE w2.stock_id = stocks.id AND w2.week_start < a.week_start)
      AND b.close != 0
  )
"""


def _migrate_new_columns():
    inspector = inspect(engine)
    stocks_existing = {c["name"] for c in inspector.get_columns("stocks")}
    backfill_weekly = "weekly_close" not in stocks_existing
    with engine.begin() as conn:
        for table, columns in _NEW_COLUMNS.items():
            existing = {c["name"] for c in inspector.get_columns(table)}
            for name, sql_type in columns.items():
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {sql_type}"))
        if backfill_weekly:
            conn.execute(text(_WEEKLY_BACKFILL_SQL))


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)  # dev-mode: no migrations yet, just ensure schema exists
    _migrate_new_columns()
    check_and_refresh()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/status")
def get_status():
    return {"refreshing": status.refreshing, "data_as_of": status.data_as_of}
