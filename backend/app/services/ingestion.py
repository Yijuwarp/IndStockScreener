"""Price ingestion with weekly-only storage.

The app screens on a weekly timeframe, so weekly bars are the only stored price
history. Daily bars fetched from yfinance live in memory just long enough to:
  - aggregate into Monday-anchored weekly bars (upserted into weekly_prices),
  - update the daily-derived snapshot scalars on stocks (current price/volume,
    daily EMAs; incremental runs continue EMAs via the ewm recursion).
Long-lookback fields (all-time high, 52-week high, listing date) are derived from
the stored weekly bars at week precision. This keeps the database ~5x smaller
than storing dailies (see docs: weekly-granularity decision, 2026-07-05).
"""
import datetime as dt

import pandas as pd
import yfinance as yf
from sqlalchemy import func as sa_func
from sqlalchemy.orm import Session

from app.models.stock import Stock, WeeklyPrice, BreakoutMetrics
from app.services.breakout import detect_breakouts

AVG_VOLUME_WEEKS = 12
LARGE_CAP_RANK = 100  # SEBI convention: top 100 by market cap
MID_CAP_RANK = 250  # next 150 (rank 101-250)
DRY_UP_RECENT_WEEKS = 3
DRY_UP_BASELINE_WEEKS = 10
DRY_UP_THRESHOLD = 0.7  # recent 3wk avg volume must be below 70% of trailing 10wk avg

# Circuit-stock trap ("non-stop 5% circuits with volumes in hundreds or thousands"):
# consecutive weeks each gaining ~5% (a daily 5% circuit compounds to ~4-6%/wk when
# only a day or two hits the circuit) on negligible volume.
CIRCUIT_GAIN_MIN_PCT = 4.0
CIRCUIT_GAIN_MAX_PCT = 6.0
CIRCUIT_MIN_RUN_WEEKS = 4
CIRCUIT_MAX_AVG_WEEKLY_VOLUME = 50_000


def _ema(series: pd.Series, span: int) -> float | None:
    if series.empty:
        return None
    return float(series.ewm(span=span, adjust=False).mean().iloc[-1])


def _ema_advance(prev: float | None, closes: pd.Series, span: int) -> float | None:
    """Continue an EMA from its stored value using only the new closes -- the
    ewm(adjust=False) recursion, so incremental runs don't need old daily bars.
    Falls back to computing from scratch when there is no stored value."""
    if closes.empty:
        return prev
    if prev is None:
        return _ema(closes, span)
    k = 2 / (span + 1)
    value = prev
    for close in closes:
        value = close * k + value * (1 - k)
    return float(value)


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


def _hist_to_daily_df(hist: pd.DataFrame) -> pd.DataFrame:
    """A fetched yfinance history window as a date/open/high/low/close/volume frame.
    Daily bars are never stored -- they live only in memory for the duration of one
    stock's refresh (see the module docstring on weekly-only storage)."""
    return pd.DataFrame(
        {
            "date": [d.date() for d in hist.index],
            "open": hist["Open"].values,
            "high": hist["High"].values,
            "low": hist["Low"].values,
            "close": hist["Close"].values,
            "volume": hist["Volume"].values,
        }
    )


def _aggregate_weekly(daily_df: pd.DataFrame) -> pd.DataFrame:
    """Aggregate daily bars into Monday-anchored weekly bars, indexed by week_start."""
    df = daily_df.copy()
    df["week_start"] = df["date"].apply(lambda d: d - dt.timedelta(days=d.weekday()))
    return df.groupby("week_start").agg(
        open=("open", "first"),
        high=("high", "max"),
        low=("low", "min"),
        close=("close", "last"),
        volume=("volume", "sum"),
    )


def _upsert_weekly(
    db: Session, stock: Stock, weekly: pd.DataFrame, since_week: dt.date | None = None
) -> None:
    """Write aggregated weekly bars to the DB. When since_week is given, only weeks
    from that Monday onward are touched (incremental refresh)."""
    if since_week is not None:
        weekly = weekly[weekly.index >= since_week]
    if weekly.empty:
        return

    query = db.query(WeeklyPrice).filter(WeeklyPrice.stock_id == stock.id)
    if since_week is not None:
        query = query.filter(WeeklyPrice.week_start >= since_week)
    existing = {wp.week_start: wp for wp in query.all()}

    for week_start, row in weekly.iterrows():
        wp = existing.get(week_start)
        if wp is None:
            wp = WeeklyPrice(stock_id=stock.id, week_start=week_start)
            db.add(wp)
        wp.open = None if pd.isna(row["open"]) else float(row["open"])
        wp.high = None if pd.isna(row["high"]) else float(row["high"])
        wp.low = None if pd.isna(row["low"]) else float(row["low"])
        wp.close = None if pd.isna(row["close"]) else float(row["close"])
        wp.volume = None if pd.isna(row["volume"]) else int(row["volume"])


def _detect_circuit_trap(weekly_rows: list[WeeklyPrice]) -> tuple[bool, int]:
    """Count the consecutive most-recent weeks that each gained ~5%; trap if the run
    is long enough and traded on negligible volume. Returns (is_trap, run_length)."""
    run = 0
    volumes: list[int] = []
    for i in range(len(weekly_rows) - 1, 0, -1):
        cur, prev = weekly_rows[i], weekly_rows[i - 1]
        if not cur.close or not prev.close:
            break
        gain_pct = (cur.close - prev.close) / prev.close * 100
        if CIRCUIT_GAIN_MIN_PCT <= gain_pct <= CIRCUIT_GAIN_MAX_PCT:
            run += 1
            volumes.append(cur.volume or 0)
        else:
            break
    is_trap = (
        run >= CIRCUIT_MIN_RUN_WEEKS
        and bool(volumes)
        and sum(volumes) / len(volumes) < CIRCUIT_MAX_AVG_WEEKLY_VOLUME
    )
    return is_trap, run


def _update_avg_weekly_volume(stock: Stock, weekly_rows: list[WeeklyPrice]) -> None:
    """Trailing 12-week average volume, a liquidity floor independent of basis/breakout."""
    recent = [wp.volume for wp in weekly_rows[-AVG_VOLUME_WEEKS:] if wp.volume is not None]
    stock.avg_weekly_volume = int(sum(recent) / len(recent)) if recent else None


def _upsert_breakout_metrics(db: Session, stock: Stock, basis: str, weekly_rows: list[WeeklyPrice]) -> None:
    """Recompute breakout metrics for the given basis ("ATH" or "52W") from this stock's weekly bars."""
    by_week = {wp.week_start: wp for wp in weekly_rows}
    by_index = {wp.week_start: i for i, wp in enumerate(weekly_rows)}

    bars = [
        (wp.week_start, wp.high, wp.low, wp.close)
        for wp in weekly_rows
        if wp.high is not None and wp.low is not None and wp.close is not None
    ]
    events = detect_breakouts(bars, basis=basis)

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
            if latest.peak_week < w < latest.week_start
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


BATCH_CHUNK_SIZE = 30  # modest: each chunk's full-history download must fit in a 512MB instance


def fetch_history_batch(
    tickers: list[str], chunk_size: int = BATCH_CHUNK_SIZE, period: str = "max"
) -> dict[str, pd.DataFrame]:
    """Batch-fetch history for many tickers via yf.download(), chunked to stay
    within Yahoo's per-request limits. Returns only tickers with non-empty history."""
    results: dict[str, pd.DataFrame] = {}
    for i in range(0, len(tickers), chunk_size):
        chunk = tickers[i:i + chunk_size]
        data = yf.download(
            chunk, period=period, auto_adjust=True, group_by="ticker", threads=True, progress=False
        )
        for ticker in chunk:
            if ticker not in data.columns.get_level_values(0):
                continue
            hist = data[ticker]
            hist = hist.dropna(subset=["Close"], how="all")
            if not hist.empty:
                results[ticker] = hist
    return results


# Incremental refresh: window fetched for stocks that already have history, and the
# relative price divergence on overlapping weeks that signals a split/bonus
# back-adjustment (=> that stock needs a full-history refetch).
INCREMENTAL_PERIOD = "1mo"
ADJUSTMENT_TOLERANCE = 0.01
OVERLAP_CHECK_WEEKS = 3


def _detect_back_adjustment(
    db: Session, stock: Stock, fetched_weekly: pd.DataFrame, last_week: dt.date
) -> bool:
    """True when fetched weekly closes disagree with stored ones on weeks we already
    have -- Yahoo back-adjusts the whole series after a split/bonus, so any
    divergence means every stored bar is stale.

    Only complete overlapping weeks are compared: the earliest fetched week may be
    partially covered by the window, and the latest stored week may still be in
    progress, so both are excluded."""
    if fetched_weekly.empty:
        return False
    first_week = fetched_weekly.index.min()
    candidates = [w for w in fetched_weekly.index if first_week < w < last_week]
    if not candidates:
        return False
    candidates = sorted(candidates)[-OVERLAP_CHECK_WEEKS:]
    stored = dict(
        db.query(WeeklyPrice.week_start, WeeklyPrice.close)
        .filter(WeeklyPrice.stock_id == stock.id, WeeklyPrice.week_start.in_(candidates))
        .all()
    )
    for week in candidates:
        fetched_close = fetched_weekly.loc[week, "close"]
        stored_close = stored.get(week)
        if fetched_close is None or pd.isna(fetched_close) or not stored_close:
            continue
        if abs(fetched_close - stored_close) / stored_close > ADJUSTMENT_TOLERANCE:
            return True
    return False


def upsert_stock_history(db: Session, stock: Stock, hist: pd.DataFrame | None = None) -> None:
    """Refresh a stock from a fetched price history window.

    Weekly bars are the only stored price history: the fetched daily bars live in
    memory just long enough to update the weekly table and the daily-derived
    snapshot scalars (current price/volume, ATH, 52W high, daily EMAs), then are
    discarded. `hist` may be a short incremental window (INCREMENTAL_PERIOD) or
    full history. If fetched weekly closes disagree with stored ones on complete
    overlapping weeks (split/bonus back-adjustment), or the fetch doesn't reach
    back to the last stored week (data gap), the stock's stored history is wiped
    and refetched in full.
    """
    if hist is None:
        single = fetch_history_batch([stock.yf_ticker], chunk_size=1)
        hist = single.get(stock.yf_ticker)
    if hist is None or hist.empty:
        return

    # Re-attach: batch callers expunge the session between stocks to cap memory,
    # which detaches the Stock instances they're iterating.
    stock = db.merge(stock)

    daily_df = _hist_to_daily_df(hist)
    fetched_weekly = _aggregate_weekly(daily_df)

    last_week = (
        db.query(sa_func.max(WeeklyPrice.week_start)).filter(WeeklyPrice.stock_id == stock.id).scalar()
    )

    full_rebuild = last_week is None
    if not full_rebuild:
        # A gap means weeks between the stored history and this window are missing
        # from both; a back-adjustment means every stored bar is stale.
        gap = fetched_weekly.index.min() > last_week
        if gap or _detect_back_adjustment(db, stock, fetched_weekly, last_week):
            full = fetch_history_batch([stock.yf_ticker], chunk_size=1, period="max")
            full_hist = full.get(stock.yf_ticker)
            if full_hist is None or full_hist.empty:
                return  # can't rebuild safely now; leave stored data for the next run
            hist = full_hist
            daily_df = _hist_to_daily_df(hist)
            fetched_weekly = _aggregate_weekly(daily_df)
            db.query(WeeklyPrice).filter(WeeklyPrice.stock_id == stock.id).delete()
            db.flush()
            full_rebuild = True

    # Incremental runs re-write the last stored week (it may have been in progress
    # at the previous run) plus anything newer; full rebuilds write everything.
    _upsert_weekly(db, stock, fetched_weekly, since_week=None if full_rebuild else last_week)
    db.flush()

    ticker = yf.Ticker(stock.yf_ticker)
    # .get_info() carries market cap plus the informational fundamentals in the same
    # single HTTP call .fast_info would have cost; fall back to fast_info if it fails.
    try:
        info = ticker.get_info() or {}
    except Exception:
        info = {}

    closes = daily_df["close"].dropna()

    stock.current_price = float(closes.iloc[-1]) if not closes.empty else None
    last_vol = daily_df["volume"].iloc[-1]
    stock.current_volume = int(last_vol) if pd.notna(last_vol) else None
    stock.market_cap = info.get("marketCap")
    if stock.market_cap is None:
        stock.market_cap = getattr(ticker.fast_info, "market_cap", None)
    stock.sector = info.get("sector")
    stock.industry = info.get("industry")
    revenue_growth = info.get("revenueGrowth")
    earnings_growth = info.get("earningsQuarterlyGrowth")
    stock.revenue_growth = revenue_growth * 100 if revenue_growth is not None else None
    stock.earnings_growth = earnings_growth * 100 if earnings_growth is not None else None

    # Daily EMAs: full rebuilds compute from the fetched history; incremental runs
    # continue the stored EMA with the closes that arrived since the last run
    # (exact ewm recursion). The Saturday --full refresh recomputes from scratch,
    # healing any drift from missed days.
    if full_rebuild:
        stock.ema_21d = _ema(closes, 21)
        stock.ema_50d = _ema(closes, 50)
        stock.ema_200d = _ema(closes, 200)
    else:
        prev_run = stock.last_updated or dt.date.min
        new_closes = daily_df[daily_df["date"] > prev_run]["close"].dropna()
        stock.ema_21d = _ema_advance(stock.ema_21d, new_closes, 21)
        stock.ema_50d = _ema_advance(stock.ema_50d, new_closes, 50)
        stock.ema_200d = _ema_advance(stock.ema_200d, new_closes, 200)

    stock.last_updated = dt.date.today()

    weekly_rows = (
        db.query(WeeklyPrice)
        .filter(WeeklyPrice.stock_id == stock.id)
        .order_by(WeeklyPrice.week_start.asc())
        .all()
    )
    stock.weeks_of_history = len(weekly_rows)

    # ATH / 52W high / listing date come from the stored weekly bars (full history
    # lives there); dates are week-precision -- the Monday of the week the high
    # printed. A week's high is the max of its days' highs, so the values match
    # what daily bars would give.
    week_highs = [(wp.week_start, wp.high) for wp in weekly_rows if wp.high is not None]
    if week_highs:
        ath_week, ath_high = max(week_highs, key=lambda pair: pair[1])
        stock.all_time_high = float(ath_high)
        stock.all_time_high_date = ath_week
        cutoff = week_highs[-1][0] - dt.timedelta(days=365)
        recent = [(w, h) for w, h in week_highs if w >= cutoff]
        w52_week, w52_high = max(recent, key=lambda pair: pair[1])
        stock.week_52_high = float(w52_high)
        stock.week_52_high_date = w52_week
    if weekly_rows:
        stock.listing_date = weekly_rows[0].week_start

    # Denormalized latest-week snapshot (keeps the screen endpoint off weekly_prices).
    stock.weekly_close = weekly_rows[-1].close if weekly_rows else None
    stock.weekly_volume = weekly_rows[-1].volume if weekly_rows else None
    prev_week = weekly_rows[-2] if len(weekly_rows) >= 2 else None
    if weekly_rows and prev_week is not None and prev_week.close:
        stock.weekly_pct_change = (weekly_rows[-1].close - prev_week.close) / prev_week.close * 100
    else:
        stock.weekly_pct_change = None

    weekly_closes = pd.Series([wp.close for wp in weekly_rows if wp.close is not None])
    stock.ema_10w = _ema(weekly_closes, 10)
    stock.circuit_trap, stock.circuit_trap_weeks = _detect_circuit_trap(weekly_rows)
    _update_avg_weekly_volume(stock, weekly_rows)
    _upsert_breakout_metrics(db, stock, "ATH", weekly_rows)
    _upsert_breakout_metrics(db, stock, "52W", weekly_rows)

    db.commit()


def batch_upsert_stock_history(db: Session, stocks: list[Stock], chunk_size: int = BATCH_CHUNK_SIZE):
    """Refresh history for many stocks at once, batching the yfinance fetch.

    Fetches and processes one chunk at a time (rather than downloading the whole
    universe's history up front) so peak memory stays flat regardless of universe
    size -- the full-universe prefetch OOM'd Render's 512MB free tier.

    Stocks that already have history get a short incremental window
    (INCREMENTAL_PERIOD); never-ingested stocks get full history. Split/bonus
    back-adjustments are detected per stock and trigger a full refetch for just
    that stock (see upsert_stock_history).

    Yields (stock, error) for each input stock as it's processed, so callers can
    report progress the same way they did with a per-ticker loop. error is None
    on success.
    """
    full_fetch = [s for s in stocks if s.last_updated is None]
    incremental = [s for s in stocks if s.last_updated is not None]
    groups = [(full_fetch, "max"), (incremental, INCREMENTAL_PERIOD)]

    for group, period in groups:
        for i in range(0, len(group), chunk_size):
            chunk = group[i:i + chunk_size]
            history_by_ticker = fetch_history_batch(
                [s.yf_ticker for s in chunk], chunk_size=chunk_size, period=period
            )
            for stock in chunk:
                try:
                    upsert_stock_history(db, stock, hist=history_by_ticker.get(stock.yf_ticker))
                    yield stock, None
                except Exception as exc:
                    # Roll back the failed transaction so one bad stock doesn't
                    # poison the session for every stock after it.
                    db.rollback()
                    yield stock, exc
                finally:
                    # Drop flushed ORM objects (hundreds of WeeklyPrice rows per stock)
                    # from the identity map so the session doesn't grow unboundedly.
                    db.expunge_all()
            del history_by_ticker
