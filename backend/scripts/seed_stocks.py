"""Seed the stocks table with the NSE equity universe.

NSE: pulls the official equity list CSV from the NSE archives.

Run with: python -m scripts.seed_stocks
"""
import csv
import io

import httpx
from sqlalchemy.orm import Session

from app.db.session import SessionLocal, engine, Base
from app.models.stock import Stock

NSE_EQUITY_LIST_URL = "https://archives.nseindia.com/content/equities/EQUITY_L.csv"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
}


RENAMED_SYMBOLS = {
    "GUJGASLTD": "GUJENERGY",
}


def seed_nse(db: Session) -> int:
    resp = httpx.get(NSE_EQUITY_LIST_URL, headers=HEADERS, timeout=30, follow_redirects=True)
    resp.raise_for_status()
    reader = csv.DictReader(io.StringIO(resp.text))

    # Clean up legacy Rights Entitlement (-RE) stock records
    db.query(Stock).filter(
        (Stock.symbol.like("%-RE")) | (Stock.name.like("%Rights Entitlement%"))
    ).delete(synchronize_session=False)

    # Migrate known renamed tickers
    for old_sym, new_sym in RENAMED_SYMBOLS.items():
        old_stock = db.query(Stock).filter(Stock.symbol == old_sym).first()
        new_stock = db.query(Stock).filter(Stock.symbol == new_sym).first()
        if old_stock and new_stock:
            db.delete(old_stock)
        elif old_stock and not new_stock:
            old_stock.symbol = new_sym
            old_stock.yf_ticker = f"{new_sym}.NS"

    count = 0
    for row in reader:
        symbol = row["SYMBOL"].strip()
        name = row["NAME OF COMPANY"].strip()
        isin = row.get("ISIN NUMBER", "").strip()

        # Filter out Rights Entitlements (-RE) which are temporary trading instruments with no 'max' history
        if symbol.endswith("-RE") or "-RE" in symbol or "Rights Entitlement" in name:
            continue

        existing = None
        if isin:
            existing = db.query(Stock).filter(Stock.isin == isin, Stock.exchange == "NSE").first()
        if not existing:
            existing = db.query(Stock).filter(Stock.symbol == symbol, Stock.exchange == "NSE").first()

        if existing:
            if existing.symbol != symbol:
                existing.symbol = symbol
                existing.yf_ticker = f"{symbol}.NS"
                existing.name = name
            continue

        db.add(
            Stock(
                symbol=symbol,
                exchange="NSE",
                yf_ticker=f"{symbol}.NS",
                name=name,
                isin=isin or None,
            )
        )
        count += 1

    db.commit()
    return count


def main():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        nse_count = seed_nse(db)
        print(f"Seeded {nse_count} new NSE stocks")
    finally:
        db.close()


if __name__ == "__main__":
    main()
