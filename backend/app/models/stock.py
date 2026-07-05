from sqlalchemy import Column, Integer, String, Float, Date, Boolean, BigInteger, UniqueConstraint, ForeignKey, Index
from sqlalchemy.orm import relationship

from app.db.session import Base


class Stock(Base):
    __tablename__ = "stocks"

    id = Column(Integer, primary_key=True)
    symbol = Column(String, nullable=False)
    exchange = Column(String, nullable=False)  # "NSE" (BSE not yet supported)
    yf_ticker = Column(String, nullable=False, unique=True)  # e.g. RELIANCE.NS / 500325.BO
    name = Column(String, nullable=False)
    isin = Column(String, nullable=True)

    # Cached snapshot fields, refreshed by the ingestion job for fast screening.
    current_price = Column(Float, nullable=True)
    current_volume = Column(BigInteger, nullable=True)
    market_cap = Column(Float, nullable=True)
    all_time_high = Column(Float, nullable=True)
    all_time_high_date = Column(Date, nullable=True)
    week_52_high = Column(Float, nullable=True)
    week_52_high_date = Column(Date, nullable=True)
    last_updated = Column(Date, nullable=True)
    avg_weekly_volume = Column(BigInteger, nullable=True)  # trailing 12-week average, liquidity floor
    cap_category = Column(String, nullable=True)  # "Large", "Mid", or "Small" -- rank-based (SEBI convention)
    weeks_of_history = Column(Integer, nullable=True)  # count of weekly bars, for the min-history filter
    listing_date = Column(Date, nullable=True)  # proxy: earliest weekly bar's week_start (no true NSE listing-date source)
    ema_21d = Column(Float, nullable=True)
    ema_50d = Column(Float, nullable=True)
    ema_200d = Column(Float, nullable=True)
    ema_10w = Column(Float, nullable=True)  # 10-week EMA of weekly closes (course stoploss line)

    # Latest-week snapshot, denormalized from weekly_prices at ingestion time so the
    # screen endpoint never has to touch that (large) table.
    weekly_close = Column(Float, nullable=True)
    weekly_volume = Column(BigInteger, nullable=True)
    weekly_pct_change = Column(Float, nullable=True)

    # Fundamentals snapshot (informational columns only, not screening criteria --
    # the course methodology is price/volume only).
    sector = Column(String, nullable=True)
    industry = Column(String, nullable=True)
    revenue_growth = Column(Float, nullable=True)  # yoy quarterly revenue growth, percent
    earnings_growth = Column(Float, nullable=True)  # yoy quarterly earnings growth, percent

    # Circuit-stock trap: consecutive ~5% up-weeks on negligible volume (course warning sign).
    circuit_trap = Column(Boolean, nullable=True)
    circuit_trap_weeks = Column(Integer, nullable=True)  # length of the consecutive ~5% run

    __table_args__ = (
        UniqueConstraint("symbol", "exchange", name="uq_symbol_exchange"),
    )


class WeeklyPrice(Base):
    """Weekly bars (Monday-anchored, IST calendar week) -- the only stored price
    history. Aggregated in memory from fetched daily bars at ingestion time; daily
    bars themselves are never persisted (weekly-granularity decision, 2026-07-05)."""
    __tablename__ = "weekly_prices"

    id = Column(Integer, primary_key=True)
    stock_id = Column(Integer, ForeignKey("stocks.id"), nullable=False)
    week_start = Column(Date, nullable=False)  # Monday of the ISO week
    open = Column(Float, nullable=True)
    high = Column(Float, nullable=True)
    low = Column(Float, nullable=True)
    close = Column(Float, nullable=True)
    volume = Column(BigInteger, nullable=True)

    stock = relationship("Stock")

    __table_args__ = (
        UniqueConstraint("stock_id", "week_start", name="uq_stock_week"),
        Index("ix_weekly_prices_stock_week", "stock_id", "week_start"),
    )


class BreakoutMetrics(Base):
    """Precomputed momentum/breakout metrics, one row per (stock, basis).

    basis is "ATH" or "52W" -- which high series breakout events are measured against.
    """
    __tablename__ = "breakout_metrics"

    id = Column(Integer, primary_key=True)
    stock_id = Column(Integer, ForeignKey("stocks.id"), nullable=False)
    basis = Column(String, nullable=False)  # "ATH" or "52W"

    breakout_week = Column(Date, nullable=True)  # week this breakout's level was first exceeded
    breakout_level = Column(Float, nullable=True)  # the prior high that was broken
    breakout_count = Column(Integer, nullable=True)  # how many such breakouts this stock has had
    consolidation_weeks = Column(Integer, nullable=True)  # weeks spent basing before this breakout
    consolidation_range_pct = Column(Float, nullable=True)  # (max high - min low) / breakout_level over that base
    extension_pct = Column(Float, nullable=True)  # current_price vs breakout_level, how far price has run since
    breakout_age_weeks = Column(Integer, nullable=True)  # weeks since breakout_week
    breakout_volume_ratio = Column(Float, nullable=True)  # breakout week volume / trailing 12-wk avg before it
    volume_dry_up = Column(Boolean, nullable=True)  # avg(vol, last 3wk before breakout) < 70% of avg(vol, trailing 10wk)

    stock = relationship("Stock")

    __table_args__ = (
        UniqueConstraint("stock_id", "basis", name="uq_stock_basis"),
    )


class MarketIndex(Base):
    """A tracked market index for the Index Check-in panel (informational only, not wired into screening)."""
    __tablename__ = "market_indexes"

    id = Column(Integer, primary_key=True)
    code = Column(String, nullable=False, unique=True)  # "NIFTY50", "NIFTYMIDCAP100"
    name = Column(String, nullable=False)
    yf_ticker = Column(String, nullable=False, unique=True)  # "^NSEI", "^CRSMID"

    current_price = Column(Float, nullable=True)
    ema_21d = Column(Float, nullable=True)
    ema_50d = Column(Float, nullable=True)
    ema_200d = Column(Float, nullable=True)
    ema_300d = Column(Float, nullable=True)
    last_updated = Column(Date, nullable=True)


class IndexPrice(Base):
    """Daily close history per tracked index, used to compute its EMAs."""
    __tablename__ = "index_prices"

    id = Column(Integer, primary_key=True)
    index_id = Column(Integer, ForeignKey("market_indexes.id"), nullable=False)
    date = Column(Date, nullable=False)
    close = Column(Float, nullable=True)

    index = relationship("MarketIndex")

    __table_args__ = (
        UniqueConstraint("index_id", "date", name="uq_index_date"),
        Index("ix_index_prices_index_date", "index_id", "date"),
    )
