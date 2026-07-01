"""Ingestion for the Index Check-in panel -- informational only, not wired into stock screening.

Only NIFTY 50 and NIFTY Midcap 100 are tracked: NIFTY Smallcap 100 has no yfinance
ticker that returns historical OHLC (^CNXSC resolves but only returns a single
snapshot row), so it's deferred until a non-yfinance data source is available.
"""
import datetime as dt

import yfinance as yf
from sqlalchemy.orm import Session

from app.models.stock import MarketIndex, IndexPrice
from app.services.ingestion import _ema

TRACKED_INDEXES = [
    {"code": "NIFTY50", "name": "NIFTY 50", "yf_ticker": "^NSEI"},
    {"code": "NIFTYMIDCAP100", "name": "NIFTY Midcap 100", "yf_ticker": "^CRSMID"},
]


def seed_indexes(db: Session) -> None:
    for idx in TRACKED_INDEXES:
        existing = db.query(MarketIndex).filter(MarketIndex.code == idx["code"]).first()
        if existing is None:
            db.add(MarketIndex(**idx))
    db.commit()


def upsert_index_history(db: Session, index: MarketIndex) -> None:
    ticker = yf.Ticker(index.yf_ticker)
    hist = ticker.history(period="max", auto_adjust=True)
    if hist.empty:
        return

    existing_dates = {
        d for (d,) in db.query(IndexPrice.date).filter(IndexPrice.index_id == index.id).all()
    }
    for idx_date, row in hist.iterrows():
        date = idx_date.date()
        if date in existing_dates:
            continue
        db.add(IndexPrice(index_id=index.id, date=date, close=float(row["Close"])))
    db.flush()

    close = hist["Close"]
    index.current_price = float(close.iloc[-1])
    index.ema_21d = _ema(close, 21)
    index.ema_50d = _ema(close, 50)
    index.ema_200d = _ema(close, 200)
    index.ema_300d = _ema(close, 300)
    index.last_updated = dt.date.today()
    db.commit()


def refresh_all_indexes(db: Session) -> None:
    seed_indexes(db)
    for index in db.query(MarketIndex).all():
        try:
            upsert_index_history(db, index)
        except Exception:
            continue
