"""Refresh historical prices + snapshot fields for every stock in the DB.

Run with: python -m scripts.run_ingestion [--full]

Default runs are incremental (short fetch window per stock, with automatic full
refetch for stocks whose prices were back-adjusted by a split/bonus). --full
forces a full-history refetch of everything -- run it weekly as a safety net.
"""
import sys

from app.db.session import SessionLocal, engine, Base
from app.models.stock import Stock, WeeklyPrice, BreakoutMetrics, MarketIndex, IndexPrice
from app.services.ingestion import batch_upsert_stock_history, recompute_cap_categories
from app.services.index_ingestion import refresh_all_indexes
from scripts.seed_stocks import seed_nse


def main():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if db.query(Stock).count() == 0:
            print("Database is empty. Seeding stock universe from NSE...")
            seed_count = seed_nse(db)
            print(f"Seeded {seed_count} stocks.")

        if "--full" in sys.argv:
            # last_updated=None routes every stock through the full-history path.
            db.query(Stock).update({Stock.last_updated: None})
            db.commit()
        stocks = db.query(Stock).all()
        for i, (stock, error) in enumerate(batch_upsert_stock_history(db, stocks), 1):
            if error is None:
                print(f"[{i}/{len(stocks)}] updated {stock.yf_ticker}")
            else:
                print(f"[{i}/{len(stocks)}] FAILED {stock.yf_ticker}: {error}")
        recompute_cap_categories(db)
        refresh_all_indexes(db)
    finally:
        db.close()


if __name__ == "__main__":
    main()
