import datetime as dt

import yfinance as yf
from sqlalchemy.orm import Session

from app.models.stock import Stock, DailyPrice


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
