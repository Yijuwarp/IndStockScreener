import datetime as dt

import pandas as pd
import yfinance as yf
from sqlalchemy.orm import Session

from app.models.stock import Stock, DailyPrice, WeeklyPrice, BreakoutMetrics
from app.services.breakout import detect_breakouts

AVG_VOLUME_WEEKS = 12
LARGE_CAP_RANK = 100  # SEBI convention: top 100 by market cap
MID_CAP_RANK = 250  # next 150 (rank 101-250)
DRY_UP_RECENT_WEEKS = 3
DRY_UP_BASELINE_WEEKS = 10
DRY_UP_THRESHOLD = 0.7  # recent 3wk avg volume must be below 70% of trailing 10wk avg


def _ema(series: pd.Series, span: int) -> float | None:
    if series.empty:
        return None
    return float(series.ewm(span=span, adjust=False).mean().iloc[-1])


def recompute_cap_categories(db: Session) -> None:
    """Rank-based Large/Mid/Small classification across the whole universe."""
    stocks = (
        db.query(Stock)
        .filter(Stock.market_cap.isnot(None))
        .order_by(Stock.market_cap.desc())
        .all()
    )
    for rank, stock in enumerate(stocks, start=1):
        if rank <= LARGE_CAP_RANK:
            stock.cap_category = "Large"
        elif rank <= MID_CAP_RANK:
            stock.cap_category = "Mid"
        else:
            stock.cap_category = "Small"
    db.commit()


def _upsert_weekly_prices(db: Session, stock: Stock, hist: pd.DataFrame) -> None:
    """Aggregate daily history into Monday-anchored weekly bars."""
    df = hist.copy()
    df["week_start"] = df.index.to_series().apply(lambda d: (d - dt.timedelta(days=d.weekday())).date())

    weekly = df.groupby("week_start").agg(
        open=("Open", "first"),
        high=("High", "max"),
        low=("Low", "min"),
        close=("Close", "last"),
        volume=("Volume", "sum"),
    )

    existing = {
        wp.week_start: wp
        for wp in db.query(WeeklyPrice).filter(WeeklyPrice.stock_id == stock.id).all()
    }

    for week_start, row in weekly.iterrows():
        wp = existing.get(week_start)
        if wp is None:
            wp = WeeklyPrice(stock_id=stock.id, week_start=week_start)
            db.add(wp)
        wp.open = float(row["open"])
        wp.high = float(row["high"])
        wp.low = float(row["low"])
        wp.close = float(row["close"])
        wp.volume = int(row["volume"])


def _update_avg_weekly_volume(stock: Stock, weekly_rows: list[WeeklyPrice]) -> None:
    """Trailing 12-week average volume, a liquidity floor independent of basis/breakout."""
    recent = [wp.volume for wp in weekly_rows[-AVG_VOLUME_WEEKS:] if wp.volume is not None]
    stock.avg_weekly_volume = int(sum(recent) / len(recent)) if recent else None


ROLLING_52W_WEEKS = 52


def _rolling_52w_high(weekly_rows: list[WeeklyPrice]) -> list[tuple[dt.date, float]]:
    """Trailing 52-week high series, used as the "basis" series for 52W breakouts."""
    series = []
    for i, wp in enumerate(weekly_rows):
        if wp.high is None:
            continue
        window = weekly_rows[max(0, i - ROLLING_52W_WEEKS + 1):i + 1]
        highs = [w.high for w in window if w.high is not None]
        if highs:
            series.append((wp.week_start, max(highs)))
    return series


def _upsert_breakout_metrics(db: Session, stock: Stock, basis: str, weekly_rows: list[WeeklyPrice]) -> None:
    """Recompute breakout metrics for the given basis ("ATH" or "52W") from this stock's weekly bars."""
    by_week = {wp.week_start: wp for wp in weekly_rows}
    by_index = {wp.week_start: i for i, wp in enumerate(weekly_rows)}

    if basis == "ATH":
        high_series = [(wp.week_start, wp.high) for wp in weekly_rows if wp.high is not None]
    else:
        high_series = _rolling_52w_high(weekly_rows)

    events = detect_breakouts(high_series)

    bm = (
        db.query(BreakoutMetrics)
        .filter(BreakoutMetrics.stock_id == stock.id, BreakoutMetrics.basis == basis)
        .first()
    )
    if bm is None:
        bm = BreakoutMetrics(stock_id=stock.id, basis=basis)
        db.add(bm)

    bm.breakout_count = len(events)
    if events:
        latest = events[-1]
        bm.breakout_week = latest.week_start
        bm.breakout_level = latest.level

        base_weeks = [
            w for w in by_week
            if latest.peak_week <= w <= latest.week_start
        ]
        bm.consolidation_weeks = len(base_weeks)
        highs = [by_week[w].high for w in base_weeks if by_week[w].high is not None]
        lows = [by_week[w].low for w in base_weeks if by_week[w].low is not None]
        if highs and lows and latest.level:
            bm.consolidation_range_pct = (max(highs) - min(lows)) / latest.level * 100
        else:
            bm.consolidation_range_pct = None

        if stock.current_price is not None and latest.level:
            bm.extension_pct = (stock.current_price - latest.level) / latest.level * 100
        else:
            bm.extension_pct = None

        today = dt.date.today()
        current_week_start = today - dt.timedelta(days=today.weekday())
        bm.breakout_age_weeks = (current_week_start - latest.week_start).days // 7

        breakout_idx = by_index[latest.week_start]
        prior_window = weekly_rows[max(0, breakout_idx - AVG_VOLUME_WEEKS):breakout_idx]
        prior_volumes = [wp.volume for wp in prior_window if wp.volume is not None]
        breakout_volume = by_week[latest.week_start].volume
        if prior_volumes and breakout_volume is not None:
            avg_prior_volume = sum(prior_volumes) / len(prior_volumes)
            bm.breakout_volume_ratio = breakout_volume / avg_prior_volume if avg_prior_volume else None
        else:
            bm.breakout_volume_ratio = None

        baseline_window = weekly_rows[max(0, breakout_idx - DRY_UP_BASELINE_WEEKS):breakout_idx]
        recent_window = weekly_rows[max(0, breakout_idx - DRY_UP_RECENT_WEEKS):breakout_idx]
        baseline_volumes = [wp.volume for wp in baseline_window if wp.volume is not None]
        recent_volumes = [wp.volume for wp in recent_window if wp.volume is not None]
        if baseline_volumes and recent_volumes:
            avg_baseline = sum(baseline_volumes) / len(baseline_volumes)
            avg_recent = sum(recent_volumes) / len(recent_volumes)
            bm.volume_dry_up = avg_baseline > 0 and avg_recent < DRY_UP_THRESHOLD * avg_baseline
        else:
            bm.volume_dry_up = None
    else:
        bm.breakout_week = None
        bm.breakout_level = None
        bm.consolidation_weeks = None
        bm.consolidation_range_pct = None
        bm.extension_pct = None
        bm.breakout_age_weeks = None
        bm.breakout_volume_ratio = None
        bm.volume_dry_up = None


BATCH_CHUNK_SIZE = 75


def fetch_history_batch(tickers: list[str], chunk_size: int = BATCH_CHUNK_SIZE) -> dict[str, pd.DataFrame]:
    """Batch-fetch full history for many tickers via yf.download(), chunked to stay
    within Yahoo's per-request limits. Returns only tickers with non-empty history."""
    results: dict[str, pd.DataFrame] = {}
    for i in range(0, len(tickers), chunk_size):
        chunk = tickers[i:i + chunk_size]
        data = yf.download(
            chunk, period="max", auto_adjust=True, group_by="ticker", threads=True, progress=False
        )
        for ticker in chunk:
            if ticker not in data.columns.get_level_values(0):
                continue
            hist = data[ticker]
            hist = hist.dropna(subset=["Close"], how="all")
            if not hist.empty:
                results[ticker] = hist
    return results


def upsert_stock_history(db: Session, stock: Stock, hist: pd.DataFrame | None = None) -> None:
    """Refresh cached snapshot fields for a stock from a fetched price history.

    If `hist` is not provided, fetches it for this single ticker (used for one-off
    refreshes). Batch refreshes should fetch history via `fetch_history_batch` and
    pass it in directly to avoid one yfinance call per ticker.
    """
    if hist is None:
        single = fetch_history_batch([stock.yf_ticker], chunk_size=1)
        hist = single.get(stock.yf_ticker)
    if hist is None or hist.empty:
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

    _upsert_weekly_prices(db, stock, hist)
    db.flush()

    all_time_high_row = hist["High"].idxmax()
    week_52 = hist[hist.index >= hist.index.max() - dt.timedelta(days=365)]
    week_52_high_row = week_52["High"].idxmax()

    info = yf.Ticker(stock.yf_ticker).fast_info
    stock.current_price = float(hist["Close"].iloc[-1])
    stock.current_volume = int(hist["Volume"].iloc[-1])
    stock.market_cap = getattr(info, "market_cap", None)
    stock.all_time_high = float(hist.loc[all_time_high_row, "High"])
    stock.all_time_high_date = all_time_high_row.date()
    stock.week_52_high = float(week_52.loc[week_52_high_row, "High"])
    stock.week_52_high_date = week_52_high_row.date()
    stock.last_updated = dt.date.today()
    stock.listing_date = hist.index.min().date()
    stock.ema_21d = _ema(hist["Close"], 21)
    stock.ema_50d = _ema(hist["Close"], 50)
    stock.ema_200d = _ema(hist["Close"], 200)

    weekly_rows = (
        db.query(WeeklyPrice)
        .filter(WeeklyPrice.stock_id == stock.id)
        .order_by(WeeklyPrice.week_start.asc())
        .all()
    )
    stock.weeks_of_history = len(weekly_rows)
    _update_avg_weekly_volume(stock, weekly_rows)
    _upsert_breakout_metrics(db, stock, "ATH", weekly_rows)
    _upsert_breakout_metrics(db, stock, "52W", weekly_rows)

    db.commit()


def batch_upsert_stock_history(db: Session, stocks: list[Stock], chunk_size: int = BATCH_CHUNK_SIZE):
    """Refresh history for many stocks at once, batching the yfinance fetch.

    Yields (stock, error) for each input stock as it's processed, so callers can
    report progress the same way they did with a per-ticker loop. error is None
    on success.
    """
    history_by_ticker = fetch_history_batch([s.yf_ticker for s in stocks], chunk_size=chunk_size)
    for stock in stocks:
        try:
            upsert_stock_history(db, stock, hist=history_by_ticker.get(stock.yf_ticker))
            yield stock, None
        except Exception as exc:
            yield stock, exc
