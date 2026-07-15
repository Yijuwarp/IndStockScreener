import datetime as dt

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.stock import Stock, BreakoutMetrics
from app.schemas import BundleOut, StockOut, ScreenerCriteria
from app.services.bundle import build_bundle
from app.utils import start_of_week

router = APIRouter(prefix="/stocks", tags=["stocks"])


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
        stock.breakout_volume_ratio = bm.breakout_volume_ratio if bm else None
        stock.volume_dry_up = bm.volume_dry_up if bm else None
        stock.status = bm.status if bm else None
        stock.status_reason = bm.status_reason if bm else None
        stock.box_high = bm.box_high if bm else None
        stock.box_floor = bm.box_floor if bm else None

    return stocks


PYRAMID_MIN_CONSOLIDATION_WEEKS = 4  # course: Darvas box of at least 4 weeks


def attach_derived_fields(stocks: list[Stock], basis: str = "ATH") -> list[Stock]:
    """Attach computed-on-the-fly fields that don't need their own table: stock age,
    resistance (52W basis only -- see PRD-ui-momentum-v2), and the course's exit /
    pyramid signals. Must run after attach_weekly_fields and attach_breakout_fields."""
    today = dt.date.today()
    for stock in stocks:
        stock.stock_age_days = (today - stock.listing_date).days if stock.listing_date else None
        if basis == "52W" and stock.all_time_high is not None and stock.current_price is not None:
            stock.has_resistance = stock.all_time_high > stock.current_price
        else:
            stock.has_resistance = None

        # Course sell rule: weekly close below the 10-week EMA.
        if stock.weekly_close is not None and stock.ema_10w is not None:
            stock.exit_signal = stock.weekly_close < stock.ema_10w
        else:
            stock.exit_signal = None

        # Course pyramiding rule: a >=4-week box broken this week.
        if stock.breakout_age_weeks is not None and stock.consolidation_weeks is not None:
            stock.pyramid_signal = (
                stock.breakout_age_weeks == 0
                and stock.consolidation_weeks >= PYRAMID_MIN_CONSOLIDATION_WEEKS
            )
        else:
            stock.pyramid_signal = None
    return stocks


@router.get("", response_model=list[StockOut])
def list_stocks(db: Session = Depends(get_db)):
    stocks = attach_breakout_fields(db, db.query(Stock).all())
    return attach_derived_fields(stocks)


@router.get("/bundle", response_model=BundleOut)
def get_bundle(db: Session = Depends(get_db)):
    """The whole universe with both bases' metrics, plus indexes and refresh
    status -- everything a frontend session needs, so screening (and every
    later filter change) runs client-side and each session costs one request.
    Production frontends normally load the statically-published copy instead
    (see app/services/bundle.py); this endpoint is the fallback."""
    return build_bundle(db)


@router.post("/screen", response_model=list[StockOut])
def screen_stocks(criteria: ScreenerCriteria, db: Session = Depends(get_db)):
    query = db.query(Stock)

    if criteria.symbols:
        query = query.filter(Stock.symbol.in_(criteria.symbols))
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
    if criteria.new_52_week_high_this_week:
        query = query.filter(Stock.week_52_high_date >= start_of_week(dt.date.today()))
    if criteria.min_avg_weekly_volume is not None:
        query = query.filter(Stock.avg_weekly_volume >= criteria.min_avg_weekly_volume)
    if criteria.cap_category:
        query = query.filter(Stock.cap_category == criteria.cap_category)
    if criteria.exclude_young_stocks:
        query = query.filter(Stock.weeks_of_history >= criteria.min_history_weeks)

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

    results = attach_breakout_fields(db, results, basis=criteria.basis)
    results = attach_derived_fields(results, basis=criteria.basis)

    if criteria.resistance is not None and criteria.basis == "52W":
        want = criteria.resistance == "yes"
        results = [s for s in results if s.has_resistance is not None and s.has_resistance == want]
    if criteria.min_stock_age_days is not None:
        results = [s for s in results if s.stock_age_days is not None and s.stock_age_days >= criteria.min_stock_age_days]
    if criteria.max_stock_age_days is not None:
        results = [s for s in results if s.stock_age_days is not None and s.stock_age_days <= criteria.max_stock_age_days]

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
    if criteria.min_breakout_volume_ratio is not None:
        results = [
            s for s in results
            if s.breakout_volume_ratio is not None and s.breakout_volume_ratio >= criteria.min_breakout_volume_ratio
        ]

    return results
