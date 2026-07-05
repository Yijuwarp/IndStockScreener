import datetime as dt
import random
import unittest

import pandas as pd

from app.services.ingestion import _aggregate_weekly, _ema, _ema_advance


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


if __name__ == "__main__":
    unittest.main()
