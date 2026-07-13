"""Builds the session bundle: the whole universe with both bases' metrics,
plus indexes and data freshness. Served by GET /stocks/bundle and exported to
a static bundle.json by the data-refresh workflow (scripts/export_bundle), so
production frontends load it from the CDN without touching the backend."""
import datetime as dt

from sqlalchemy import func as sa_func
from sqlalchemy.orm import Session

from app.models.stock import Stock, BreakoutMetrics, MarketIndex
from app.services.freshness import status as refresh_status

PYRAMID_MIN_CONSOLIDATION_WEEKS = 4  # course: Darvas box of at least 4 weeks

_BASIS_METRIC_FIELDS = (
    "breakout_count", "breakout_week", "breakout_level", "consolidation_weeks",
    "consolidation_range_pct", "extension_pct", "breakout_age_weeks",
    "breakout_volume_ratio", "volume_dry_up",
)

_BUNDLE_STOCK_FIELDS = (
    "id", "symbol", "exchange", "name", "current_price", "current_volume",
    "market_cap", "all_time_high", "all_time_high_date", "week_52_high",
    "week_52_high_date", "last_updated", "weekly_close", "weekly_volume",
    "weekly_pct_change", "avg_weekly_volume", "cap_category", "weeks_of_history",
    "listing_date", "ema_21d", "ema_50d", "ema_200d", "ema_10w", "sector",
    "industry", "revenue_growth", "earnings_growth", "circuit_trap",
    "circuit_trap_weeks",
)


def _basis_block(stock: Stock, bm: BreakoutMetrics | None, basis: str) -> dict:
    block = {f: getattr(bm, f) if bm else None for f in _BASIS_METRIC_FIELDS}
    if basis == "52W" and stock.all_time_high is not None and stock.current_price is not None:
        block["has_resistance"] = stock.all_time_high > stock.current_price
    if block["breakout_age_weeks"] is not None and block["consolidation_weeks"] is not None:
        block["pyramid_signal"] = (
            block["breakout_age_weeks"] == 0
            and block["consolidation_weeks"] >= PYRAMID_MIN_CONSOLIDATION_WEEKS
        )
    return block


def build_bundle(db: Session) -> dict:
    stocks = db.query(Stock).all()
    metrics: dict[tuple[int, str], BreakoutMetrics] = {
        (bm.stock_id, bm.basis): bm for bm in db.query(BreakoutMetrics).all()
    }

    today = dt.date.today()
    rows = []
    for s in stocks:
        row = {f: getattr(s, f) for f in _BUNDLE_STOCK_FIELDS}
        row["stock_age_days"] = (today - s.listing_date).days if s.listing_date else None
        if s.weekly_close is not None and s.ema_10w is not None:
            row["exit_signal"] = s.weekly_close < s.ema_10w
        else:
            row["exit_signal"] = None
        row["ath"] = _basis_block(s, metrics.get((s.id, "ATH")), "ATH")
        row["w52"] = _basis_block(s, metrics.get((s.id, "52W")), "52W")
        rows.append(row)

    # Live from the DB (oldest successfully-updated stock), not the process's
    # startup snapshot -- a long-lived process would otherwise serve a stale date
    # after the external refresh job writes new data.
    data_as_of = (
        db.query(sa_func.min(Stock.last_updated)).filter(Stock.last_updated.isnot(None)).scalar()
    )

    return {
        "refreshing": refresh_status.refreshing,
        "data_as_of": data_as_of,
        "indexes": db.query(MarketIndex).all(),
        "stocks": rows,
    }
