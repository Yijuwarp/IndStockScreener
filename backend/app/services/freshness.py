"""Tracks whether cached stock data is stale and refreshes it in the background.

Staleness is checked against the most recent weekday (Mon-Fri), not an
NSE holiday calendar -- a holiday just costs one redundant, harmless
refresh that finds no new data.
"""
import datetime as dt
import threading

from app.db.session import SessionLocal
from app.models.stock import Stock
from app.services.ingestion import batch_upsert_stock_history, recompute_cap_categories
from app.services.index_ingestion import refresh_all_indexes


class RefreshStatus:
    def __init__(self):
        self.refreshing = False
        self.data_as_of: dt.date | None = None
        self.lock = threading.Lock()


status = RefreshStatus()


def most_recent_weekday(today: dt.date) -> dt.date:
    d = today
    while d.weekday() >= 5:  # Saturday=5, Sunday=6
        d -= dt.timedelta(days=1)
    return d


def _oldest_last_updated(db) -> dt.date | None:
    row = (
        db.query(Stock.last_updated)
        .filter(Stock.last_updated.isnot(None))
        .order_by(Stock.last_updated.asc())
        .first()
    )
    return row[0] if row else None


def _run_refresh():
    db = SessionLocal()
    try:
        stocks = db.query(Stock).all()
        for _stock, _error in batch_upsert_stock_history(db, stocks):
            pass
        recompute_cap_categories(db)
        refresh_all_indexes(db)
    finally:
        db.close()

    db = SessionLocal()
    try:
        with status.lock:
            status.data_as_of = _oldest_last_updated(db)
            status.refreshing = False
    finally:
        db.close()


def check_and_refresh() -> None:
    """Call on startup. Seeds the stock universe if the table is empty (fresh cloud
    deploy with no shell access), updates status.data_as_of, and kicks off a
    background refresh if data is older than the most recent weekday."""
    db = SessionLocal()
    try:
        if db.query(Stock.id).first() is None:
            from scripts.seed_stocks import seed_nse

            try:
                seed_nse(db)
            except Exception:
                pass  # no network / NSE archive down -- retry next startup
        oldest = _oldest_last_updated(db)
    finally:
        db.close()

    with status.lock:
        status.data_as_of = oldest

    cutoff = most_recent_weekday(dt.date.today())
    stale = oldest is None or oldest < cutoff

    if not stale:
        return

    with status.lock:
        if status.refreshing:
            return
        status.refreshing = True

    threading.Thread(target=_run_refresh, daemon=True).start()
