from sqlalchemy import Column, Integer, String, Float, Date, BigInteger, UniqueConstraint, ForeignKey, Index
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

    prices = relationship("DailyPrice", back_populates="stock", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("symbol", "exchange", name="uq_symbol_exchange"),
    )


class DailyPrice(Base):
    __tablename__ = "daily_prices"

    id = Column(Integer, primary_key=True)
    stock_id = Column(Integer, ForeignKey("stocks.id"), nullable=False)
    date = Column(Date, nullable=False)
    open = Column(Float, nullable=True)
    high = Column(Float, nullable=True)
    low = Column(Float, nullable=True)
    close = Column(Float, nullable=True)
    volume = Column(BigInteger, nullable=True)

    stock = relationship("Stock", back_populates="prices")

    __table_args__ = (
        UniqueConstraint("stock_id", "date", name="uq_stock_date"),
        Index("ix_daily_prices_stock_date", "stock_id", "date"),
    )


class WeeklyPrice(Base):
    """Precomputed weekly bars (Monday-anchored, IST calendar week), derived from daily_prices."""
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

    stock = relationship("Stock")

    __table_args__ = (
        UniqueConstraint("stock_id", "basis", name="uq_stock_basis"),
    )
