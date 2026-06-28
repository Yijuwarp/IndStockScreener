import datetime as dt

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.stock import Stock
from app.schemas import StockOut, ScreenerCriteria

router = APIRouter(prefix="/stocks", tags=["stocks"])


def start_of_week(d: dt.date) -> dt.date:
    """Monday of the calendar week containing d (IST calendar week)."""
    return d - dt.timedelta(days=d.weekday())


@router.get("", response_model=list[StockOut])
def list_stocks(db: Session = Depends(get_db)):
    return db.query(Stock).all()


@router.post("/screen", response_model=list[StockOut])
def screen_stocks(criteria: ScreenerCriteria, db: Session = Depends(get_db)):
    query = db.query(Stock)

    if criteria.exchange:
        query = query.filter(Stock.exchange == criteria.exchange)
    if criteria.min_market_cap is not None:
        query = query.filter(Stock.market_cap >= criteria.min_market_cap)
    if criteria.max_market_cap is not None:
        query = query.filter(Stock.market_cap <= criteria.max_market_cap)
    if criteria.min_volume is not None:
        query = query.filter(Stock.current_volume >= criteria.min_volume)
    if criteria.max_volume is not None:
        query = query.filter(Stock.current_volume <= criteria.max_volume)
    if criteria.min_price is not None:
        query = query.filter(Stock.current_price >= criteria.min_price)
    if criteria.max_price is not None:
        query = query.filter(Stock.current_price <= criteria.max_price)
    if criteria.new_all_time_high_this_week:
        query = query.filter(Stock.all_time_high_date >= start_of_week(dt.date.today()))

    results = query.all()

    if criteria.pct_from_all_time_high_max is not None:
        results = [
            s for s in results
            if s.all_time_high and s.current_price
            and (s.all_time_high - s.current_price) / s.all_time_high * 100 <= criteria.pct_from_all_time_high_max
        ]
    if criteria.pct_from_52_week_high_max is not None:
        results = [
            s for s in results
            if s.week_52_high and s.current_price
            and (s.week_52_high - s.current_price) / s.week_52_high * 100 <= criteria.pct_from_52_week_high_max
        ]

    return results
