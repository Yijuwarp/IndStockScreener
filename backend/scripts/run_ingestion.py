"""Refresh historical prices + snapshot fields for every stock in the DB.

Run with: python -m scripts.run_ingestion
"""
from app.db.session import SessionLocal
from app.models.stock import Stock
from app.services.ingestion import upsert_stock_history


def main():
    db = SessionLocal()
    try:
        stocks = db.query(Stock).all()
        for i, stock in enumerate(stocks, 1):
            try:
                upsert_stock_history(db, stock)
                print(f"[{i}/{len(stocks)}] updated {stock.yf_ticker}")
            except Exception as exc:
                print(f"[{i}/{len(stocks)}] FAILED {stock.yf_ticker}: {exc}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
