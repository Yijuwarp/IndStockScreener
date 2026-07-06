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
    weeks_of_history: Optional[int] = None
    listing_date: Optional[dt.date] = None
    stock_age_days: Optional[int] = None
    ema_21d: Optional[float] = None
    ema_50d: Optional[float] = None
    ema_200d: Optional[float] = None
    ema_10w: Optional[float] = None
    has_resistance: Optional[bool] = None
    volume_dry_up: Optional[bool] = None
    sector: Optional[str] = None
    industry: Optional[str] = None
    revenue_growth: Optional[float] = None
    earnings_growth: Optional[float] = None
    circuit_trap: Optional[bool] = None
    circuit_trap_weeks: Optional[int] = None
    exit_signal: Optional[bool] = None
    pyramid_signal: Optional[bool] = None

    class Config:
        from_attributes = True


class IndexOut(BaseModel):
    id: int
    code: str
    name: str
    current_price: Optional[float]
    ema_21d: Optional[float]
    ema_50d: Optional[float]
    ema_200d: Optional[float]
    ema_300d: Optional[float]
    last_updated: Optional[dt.date]

    class Config:
        from_attributes = True


class BasisMetricsOut(BaseModel):
    """Basis-dependent fields (ATH vs 52W), one block per basis in the bundle."""
    breakout_count: Optional[int] = None
    breakout_week: Optional[dt.date] = None
    breakout_level: Optional[float] = None
    consolidation_weeks: Optional[int] = None
    consolidation_range_pct: Optional[float] = None
    extension_pct: Optional[float] = None
    breakout_age_weeks: Optional[int] = None
    breakout_volume_ratio: Optional[float] = None
    volume_dry_up: Optional[bool] = None
    has_resistance: Optional[bool] = None  # 52W basis only
    pyramid_signal: Optional[bool] = None


class BundleStockOut(BaseModel):
    """A stock with both bases' metrics attached -- the client picks per basis."""
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
    avg_weekly_volume: Optional[int] = None
    cap_category: Optional[str] = None
    weeks_of_history: Optional[int] = None
    listing_date: Optional[dt.date] = None
    stock_age_days: Optional[int] = None
    ema_21d: Optional[float] = None
    ema_50d: Optional[float] = None
    ema_200d: Optional[float] = None
    ema_10w: Optional[float] = None
    sector: Optional[str] = None
    industry: Optional[str] = None
    revenue_growth: Optional[float] = None
    earnings_growth: Optional[float] = None
    circuit_trap: Optional[bool] = None
    circuit_trap_weeks: Optional[int] = None
    exit_signal: Optional[bool] = None
    ath: BasisMetricsOut
    w52: BasisMetricsOut


class BundleOut(BaseModel):
    """Everything a frontend session needs, served in a single request."""
    refreshing: bool
    data_as_of: Optional[dt.date]
    indexes: list[IndexOut]
    stocks: list[BundleStockOut]


class ScreenerCriteria(BaseModel):
    symbols: Optional[list[str]] = None  # explicit symbol list (watchlist fetch) -- bypasses screening
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
    exclude_young_stocks: Optional[bool] = None  # off by default, per user preference
    min_history_weeks: int = 10
    resistance: Optional[str] = None  # "yes" or "no" -- only meaningful when basis == "52W"
    min_stock_age_days: Optional[int] = None
    max_stock_age_days: Optional[int] = None
