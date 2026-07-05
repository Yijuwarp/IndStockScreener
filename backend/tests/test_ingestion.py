import datetime as dt
import random
import unittest

import pandas as pd
import sqlalchemy as sa
from sqlalchemy.orm import sessionmaker

from app.db.session import Base
from app.models.stock import Stock, WeeklyPrice
from app.services.ingestion import _aggregate_weekly, _detect_back_adjustment, _ema, _ema_advance


class EmaAdvanceTests(unittest.TestCase):
    def test_recursion_matches_full_recompute(self):
        rng = random.Random(7)
        closes = pd.Series([100 * (1 + rng.uniform(-0.03, 0.03)) ** i for i in range(300)])
        for span in (21, 50, 200):
            for split in (1, 5, 299):
                prev = _ema(closes.iloc[:split], span)
                advanced = _ema_advance(prev, closes.iloc[split:], span)
                self.assertAlmostEqual(advanced, _ema(closes, span), places=6)

    def test_no_new_closes_keeps_previous_value(self):
        self.assertEqual(_ema_advance(123.45, pd.Series(dtype=float), 21), 123.45)


class AggregateWeeklyTests(unittest.TestCase):
    def test_monday_anchored_ohlcv(self):
        # Wed 2025-01-08 .. Tue 2025-01-14 spans two calendar weeks
        days = [dt.date(2025, 1, 8) + dt.timedelta(days=i) for i in range(7) if i not in (3, 4)]
        df = pd.DataFrame({
            "date": days,
            "open": [10, 11, 12, 13, 14],
            "high": [15, 20, 18, 17, 16],
            "low": [9, 8, 7, 6, 5],
            "close": [11, 12, 13, 14, 15],
            "volume": [100, 200, 300, 400, 500],
        })
        weekly = _aggregate_weekly(df)
        self.assertEqual(list(weekly.index), [dt.date(2025, 1, 6), dt.date(2025, 1, 13)])
        # week of Jan 6 holds Wed 8th / Thu 9th / Fri 10th
        wk1 = weekly.loc[dt.date(2025, 1, 6)]
        self.assertEqual((wk1["open"], wk1["high"], wk1["low"], wk1["close"], wk1["volume"]),
                         (10, 20, 7, 13, 600))


class DetectBackAdjustmentTests(unittest.TestCase):
    LAST_WEEK = dt.date(2026, 6, 29)

    def setUp(self):
        engine = sa.create_engine("sqlite://")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.stock = Stock(symbol="TEST", exchange="NSE", yf_ticker="TEST.NS", name="Test")
        self.db.add(self.stock)
        self.db.flush()
        # three stored weeks; closes at the pre-split scale
        for offset, close in ((-14, 100.0), (-7, 110.0), (0, 120.0)):
            self.db.add(WeeklyPrice(
                stock_id=self.stock.id,
                week_start=self.LAST_WEEK + dt.timedelta(days=offset),
                close=close, high=close, low=close,
            ))
        self.db.flush()

    def fetched(self, last_close):
        # fetch window starts mid-week two weeks back (partial first week),
        # matches stored closes except for the last stored week
        return pd.DataFrame(
            {"close": [110.0, last_close]},
            index=[self.LAST_WEEK - dt.timedelta(days=7), self.LAST_WEEK],
        )

    def test_adjustment_on_complete_last_week_is_detected(self):
        self.stock.last_updated = self.LAST_WEEK + dt.timedelta(days=7)  # stored in a later week
        self.assertTrue(
            _detect_back_adjustment(self.db, self.stock, self.fetched(60.0), self.LAST_WEEK)
        )

    def test_partial_last_week_bar_is_not_compared(self):
        self.stock.last_updated = self.LAST_WEEK + dt.timedelta(days=2)  # stored mid-week
        self.assertFalse(
            _detect_back_adjustment(self.db, self.stock, self.fetched(60.0), self.LAST_WEEK)
        )

    def test_matching_closes_do_not_trigger(self):
        self.stock.last_updated = self.LAST_WEEK + dt.timedelta(days=7)
        self.assertFalse(
            _detect_back_adjustment(self.db, self.stock, self.fetched(120.0), self.LAST_WEEK)
        )


if __name__ == "__main__":
    unittest.main()
