"""Seed the stocks table with the NSE and BSE equity universe.

NSE: pulls the official equity list CSV from the NSE archives.
BSE: pulls the official scrip master CSV from the BSE website.

Run with: python -m scripts.seed_stocks
"""
import csv
import io

import httpx
from sqlalchemy.orm import Session

from app.db.session import SessionLocal, engine, Base
from app.models.stock import Stock

NSE_EQUITY_LIST_URL = "https://archives.nseindia.com/content/equities/EQUITY_L.csv"
BSE_SCRIP_MASTER_URL = "https://api.bseindia.com/BseIndiaAPI/api/ListofScripCSVData/w?Group=&Scripcode=&industry=&segment=Equity&status=Active"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
}


def seed_nse(db: Session) -> int:
    resp = httpx.get(NSE_EQUITY_LIST_URL, headers=HEADERS, timeout=30, follow_redirects=True)
    resp.raise_for_status()
    reader = csv.DictReader(io.StringIO(resp.text))

    count = 0
    for row in reader:
        symbol = row["SYMBOL"].strip()
        name = row["NAME OF COMPANY"].strip()
        isin = row.get("ISIN NUMBER", "").strip()

        existing = db.query(Stock).filter(Stock.symbol == symbol, Stock.exchange == "NSE").first()
        if existing:
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


def seed_bse(db: Session) -> int:
    resp = httpx.get(BSE_SCRIP_MASTER_URL, headers=HEADERS, timeout=30, follow_redirects=True)
    resp.raise_for_status()
    reader = csv.DictReader(io.StringIO(resp.text))

    count = 0
    for row in reader:
        code = row.get("SC_CODE", "").strip()
        symbol = row.get("SC_NAME", "").strip()
        name = row.get("SC_NAME", "").strip()
        if not code:
            continue

        existing = db.query(Stock).filter(Stock.symbol == symbol, Stock.exchange == "BSE").first()
        if existing:
            continue

        db.add(
            Stock(
                symbol=symbol,
                exchange="BSE",
                yf_ticker=f"{code}.BO",
                name=name,
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
        bse_count = seed_bse(db)
        print(f"Seeded {bse_count} new BSE stocks")
    finally:
        db.close()


if __name__ == "__main__":
    main()
