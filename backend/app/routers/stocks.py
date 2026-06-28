import datetime as dt

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.stock import Stock, WeeklyPrice, BreakoutMetrics
from app.schemas import StockOut, ScreenerCriteria

router = APIRouter(prefix="/stocks", tags=["stocks"])


def start_of_week(d: dt.date) -> dt.date:
    """Monday of the calendar week containing d (IST calendar week)."""
    return d - dt.timedelta(days=d.weekday())


def attach_weekly_fields(db: Session, stocks: list[Stock]) -> list[Stock]:
    """Attach weekly_close / weekly_volume / weekly_pct_change from the two most
    recent WeeklyPrice rows per stock."""
    stock_ids = [s.id for s in stocks]
    if not stock_ids:
        return stocks

    rows = (
        db.query(WeeklyPrice)
        .filter(WeeklyPrice.stock_id.in_(stock_ids))
        .order_by(WeeklyPrice.stock_id, WeeklyPrice.week_start.desc())
        .all()
    )

    latest_two: dict[int, list[WeeklyPrice]] = {}
    for row in rows:
        bucket = latest_two.setdefault(row.stock_id, [])
        if len(bucket) < 2:
            bucket.append(row)

    for stock in stocks:
        bucket = latest_two.get(stock.id, [])
        stock.weekly_close = None
        stock.weekly_volume = None
        stock.weekly_pct_change = None
        if len(bucket) >= 1:
            stock.weekly_close = bucket[0].close
            stock.weekly_volume = bucket[0].volume
        if len(bucket) >= 2 and bucket[1].close:
            stock.weekly_pct_change = (bucket[0].close - bucket[1].close) / bucket[1].close * 100

    return stocks


def attach_breakout_fields(db: Session, stocks: list[Stock], basis: str = "ATH") -> list[Stock]:
    """Attach breakout_count / breakout_week / breakout_level from BreakoutMetrics."""
    stock_ids = [s.id for s in stocks]
    if not stock_ids:
        return stocks

    rows = (
        db.query(BreakoutMetrics)
        .filter(BreakoutMetrics.stock_id.in_(stock_ids), BreakoutMetrics.basis == basis)
        .all()
    )
    by_stock = {r.stock_id: r for r in rows}

    for stock in stocks:
        bm = by_stock.get(stock.id)
        stock.breakout_count = bm.breakout_count if bm else None
        stock.breakout_week = bm.breakout_week if bm else None
        stock.breakout_level = bm.breakout_level if bm else None
        stock.consolidation_weeks = bm.consolidation_weeks if bm else None
        stock.consolidation_range_pct = bm.consolidation_range_pct if bm else None
        stock.extension_pct = bm.extension_pct if bm else None
        stock.breakout_age_weeks = bm.breakout_age_weeks if bm else None

    return stocks


@router.get("", response_model=list[StockOut])
def list_stocks(db: Session = Depends(get_db)):
    stocks = attach_weekly_fields(db, db.query(Stock).all())
    return attach_breakout_fields(db, stocks)


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

    results = attach_weekly_fields(db, results)
    results = attach_breakout_fields(db, results)

    if criteria.min_consolidation_weeks is not None:
        results = [
            s for s in results
            if s.consolidation_weeks is not None and s.consolidation_weeks >= criteria.min_consolidation_weeks
        ]
    if criteria.max_consolidation_range_pct is not None:
        results = [
            s for s in results
            if s.consolidation_range_pct is not None and s.consolidation_range_pct <= criteria.max_consolidation_range_pct
        ]
    if criteria.max_extension_pct is not None:
        results = [
            s for s in results
            if s.extension_pct is not None and s.extension_pct <= criteria.max_extension_pct
        ]
    if criteria.max_breakout_age_weeks is not None:
        results = [
            s for s in results
            if s.breakout_age_weeks is not None and s.breakout_age_weeks <= criteria.max_breakout_age_weeks
        ]

    return results
