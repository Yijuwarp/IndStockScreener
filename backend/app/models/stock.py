from sqlalchemy import Column, Integer, String, Float, Date, BigInteger, UniqueConstraint, ForeignKey, Index
from sqlalchemy.orm import relationship

from app.db.session import Base


class Stock(Base):
    __tablename__ = "stocks"

    id = Column(Integer, primary_key=True)
    symbol = Column(String, nullable=False)
    exchange = Column(String, nullable=False)  # "NSE" or "BSE"
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
