import datetime as dt
from typing import Optional

from pydantic import BaseModel


class StockOut(BaseModel):
    id: int
    symbol: str
    exchange: str
    name: str
    current_price: Optional[float]
    current_volume: Optional[int]
    market_cap: Optional[float]
    all_time_high: Optional[float]
    all_time_high_date: Optional[dt.date]
    week_52_high: Optional[float]
    week_52_high_date: Optional[dt.date]
    last_updated: Optional[dt.date]
    weekly_close: Optional[float] = None
    weekly_volume: Optional[int] = None
    weekly_pct_change: Optional[float] = None
    breakout_count: Optional[int] = None
    breakout_week: Optional[dt.date] = None
    breakout_level: Optional[float] = None
    consolidation_weeks: Optional[int] = None
    consolidation_range_pct: Optional[float] = None
    extension_pct: Optional[float] = None
    breakout_age_weeks: Optional[int] = None
    avg_weekly_volume: Optional[int] = None
    breakout_volume_ratio: Optional[float] = None
    cap_category: Optional[str] = None

    class Config:
        from_attributes = True


class ScreenerCriteria(BaseModel):
    exchange: Optional[str] = None  # "NSE" (BSE not yet supported)
    min_market_cap: Optional[float] = None
    max_market_cap: Optional[float] = None
    min_volume: Optional[int] = None
    max_volume: Optional[int] = None
    min_price: Optional[float] = None
    max_price: Optional[float] = None
    pct_from_all_time_high_max: Optional[float] = None  # e.g. 5 = within 5% of ATH
    pct_from_52_week_high_max: Optional[float] = None
    new_all_time_high_this_week: Optional[bool] = None
    new_52_week_high_this_week: Optional[bool] = None
    basis: str = "ATH"  # "ATH" or "52W" -- which BreakoutMetrics row to attach
    min_consolidation_weeks: Optional[int] = None
    max_consolidation_range_pct: Optional[float] = None
    max_extension_pct: Optional[float] = None
    max_breakout_age_weeks: Optional[int] = None
    min_avg_weekly_volume: Optional[int] = None
    min_breakout_volume_ratio: Optional[float] = None
    cap_category: Optional[str] = None  # "Large", "Mid", or "Small"
