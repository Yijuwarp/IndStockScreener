import datetime as dt

import pandas as pd
import yfinance as yf
from sqlalchemy.orm import Session

from app.models.stock import Stock, DailyPrice, WeeklyPrice, BreakoutMetrics
from app.services.breakout import detect_breakouts


def _upsert_weekly_prices(db: Session, stock: Stock, hist: pd.DataFrame) -> None:
    """Aggregate daily history into Monday-anchored weekly bars."""
    df = hist.copy()
    df["week_start"] = df.index.to_series().apply(lambda d: (d - dt.timedelta(days=d.weekday())).date())

    weekly = df.groupby("week_start").agg(
        open=("Open", "first"),
        high=("High", "max"),
        low=("Low", "min"),
        close=("Close", "last"),
        volume=("Volume", "sum"),
    )

    existing = {
        wp.week_start: wp
        for wp in db.query(WeeklyPrice).filter(WeeklyPrice.stock_id == stock.id).all()
    }

    for week_start, row in weekly.iterrows():
        wp = existing.get(week_start)
        if wp is None:
            wp = WeeklyPrice(stock_id=stock.id, week_start=week_start)
            db.add(wp)
        wp.open = float(row["open"])
        wp.high = float(row["high"])
        wp.low = float(row["low"])
        wp.close = float(row["close"])
        wp.volume = int(row["volume"])


def _upsert_breakout_metrics(db: Session, stock: Stock) -> None:
    """Recompute ATH-basis breakout metrics from this stock's weekly bars."""
    weekly_bars = [
        (wp.week_start, wp.high)
        for wp in db.query(WeeklyPrice)
        .filter(WeeklyPrice.stock_id == stock.id)
        .order_by(WeeklyPrice.week_start.asc())
        .all()
        if wp.high is not None
    ]

    events = detect_breakouts(weekly_bars)

    bm = (
        db.query(BreakoutMetrics)
        .filter(BreakoutMetrics.stock_id == stock.id, BreakoutMetrics.basis == "ATH")
        .first()
    )
    if bm is None:
        bm = BreakoutMetrics(stock_id=stock.id, basis="ATH")
        db.add(bm)

    bm.breakout_count = len(events)
    if events:
        latest = events[-1]
        bm.breakout_week = latest.week_start
        bm.breakout_level = latest.level
    else:
        bm.breakout_week = None
        bm.breakout_level = None


def upsert_stock_history(db: Session, stock: Stock) -> None:
    """Fetch full history for a stock from yfinance and refresh cached snapshot fields."""
    ticker = yf.Ticker(stock.yf_ticker)
    hist = ticker.history(period="max", auto_adjust=True)
    if hist.empty:
        return

    existing_dates = {
        d for (d,) in db.query(DailyPrice.date).filter(DailyPrice.stock_id == stock.id).all()
    }

    for idx, row in hist.iterrows():
        date = idx.date()
        if date in existing_dates:
            continue
        db.add(
            DailyPrice(
                stock_id=stock.id,
                date=date,
                open=row.get("Open"),
                high=row.get("High"),
                low=row.get("Low"),
                close=row.get("Close"),
                volume=row.get("Volume"),
            )
        )

    _upsert_weekly_prices(db, stock, hist)
    db.flush()
    _upsert_breakout_metrics(db, stock)

    db.flush()

    all_time_high_row = hist["High"].idxmax()
    week_52 = hist[hist.index >= hist.index.max() - dt.timedelta(days=365)]
    week_52_high_row = week_52["High"].idxmax()

    info = ticker.fast_info
    stock.current_price = float(hist["Close"].iloc[-1])
    stock.current_volume = int(hist["Volume"].iloc[-1])
    stock.market_cap = getattr(info, "market_cap", None)
    stock.all_time_high = float(hist.loc[all_time_high_row, "High"])
    stock.all_time_high_date = all_time_high_row.date()
    stock.week_52_high = float(week_52.loc[week_52_high_row, "High"])
    stock.week_52_high_date = week_52_high_row.date()
    stock.last_updated = dt.date.today()

    db.commit()
