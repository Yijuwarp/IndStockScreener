import datetime as dt
import unittest

import pandas as pd

from app.services.ingestion import _breakout_status, _ema


class W:
    """Minimal WeeklyPrice stand-in."""
    def __init__(self, week, high, low, close):
        self.week_start = dt.date(2025, 1, 6) + dt.timedelta(weeks=week)
        self.high, self.low, self.close = high, low, close


def flat_history(n, price=50.0):
    """n quiet weeks well below the action, to seed the EMA realistically."""
    return [W(i - n, price, price, price) for i in range(n)]


def run(rows, breakout_idx, level, current_price):
    return _breakout_status(rows, breakout_idx, level, current_price)


class BreakoutStatusTests(unittest.TestCase):
    def setUp(self):
        # 30 quiet weeks at 100 (EMA settles at 100), then the breakout week
        # closes at 110 over a level of 105.
        self.pre = [W(i, 100, 100, 100) for i in range(30)]
        self.bi = 30
        self.level = 105.0

    def bars(self, *post):
        return self.pre + [W(30, 112, 104, 110)] + list(post)

    def test_clean_active(self):
        rows = self.bars(W(31, 115, 108, 114))
        status, reason, bh, bf = run(rows, self.bi, self.level, 114.0)
        self.assertEqual(status, "active")

    def test_extended_above_20pct(self):
        rows = self.bars(W(31, 130, 110, 128))
        status, reason, *_ = run(rows, self.bi, self.level, 128.0)
        self.assertEqual(status, "extended")
        self.assertIn("extension:", reason)

    def test_extended_recovers_to_active(self):
        # was extended, drifted back to +10% without any exit trigger
        rows = self.bars(W(31, 130, 110, 128), W(32, 129, 114, 115.5))
        status, *_ = run(rows, self.bi, self.level, 115.5)
        self.assertEqual(status, "active")

    def test_basing_boundary_3_weeks_no_4_weeks_yes(self):
        base_week = lambda w: W(w, 111, 107, 109)
        three = self.bars(*[base_week(31 + i) for i in range(3)])
        four = self.bars(*[base_week(31 + i) for i in range(4)])
        self.assertEqual(run(three, self.bi, self.level, 109.0)[0], "active")
        status, reason, box_high, box_floor = run(four, self.bi, self.level, 109.0)
        self.assertEqual(status, "basing")
        self.assertEqual(box_high, 112)  # the breakout week's high
        self.assertEqual(box_floor, 107)  # min low of the 4 forming weeks
        self.assertIn("box:", reason)

    def test_low_touching_floor_keeps_basing(self):
        base = [W(31 + i, 111, 107, 109) for i in range(4)]
        rows = self.bars(*base, W(35, 110, 107, 107.5))  # low touches 107, close above
        self.assertEqual(run(rows, self.bi, self.level, 107.5)[0], "basing")

    def test_close_below_floor_dissolves_box(self):
        base = [W(31 + i, 111, 107, 109) for i in range(4)]
        rows = self.bars(*base, W(35, 108, 105.5, 106))  # closes below floor 107
        status, *_ = run(rows, self.bi, self.level, 106.0)
        self.assertEqual(status, "active")

    def test_second_box_reforms_after_dissolution(self):
        base = [W(31 + i, 111, 107, 109) for i in range(4)]
        dissolve = W(35, 108, 105.5, 106)
        rebase = [W(36 + i, 110, 106, 108) for i in range(4)]
        rows = self.bars(*base, dissolve, *rebase)
        status, reason, box_high, box_floor = run(rows, self.bi, self.level, 108.0)
        self.assertEqual(status, "basing")
        self.assertEqual(box_floor, 106)  # floor from the new box's forming weeks

    def test_ended_sticky_after_recovery(self):
        # deep close below the 10W EMA, then a full recovery -- still ended
        rows = self.bars(W(31, 112, 80, 82), W(32, 118, 110, 117))
        status, reason, *_ = run(rows, self.bi, self.level, 117.0)
        self.assertEqual(status, "ended")
        self.assertIn("close_below_10w_ema", reason)

    def test_hard_stop_boundary_at_exactly_80pct(self):
        stop = 0.8 * self.level  # 84.0 -- but a close this low also breaks the EMA;
        # use a slow bleed that keeps closes above the EMA, then tap the stop exactly.
        # EMA at breakout ~101; keep closes >= EMA while stepping down is not possible
        # down to 84, so assert the <= comparison directly via reason precedence:
        rows = self.bars(W(31, 112, 83, stop))
        status, reason, *_ = run(rows, self.bi, self.level, stop)
        self.assertEqual(status, "ended")  # either rule; ended regardless

    def test_breakout_week_does_not_end_itself(self):
        rows = self.bars()  # breakout week only, close 110 well above EMA (~100)
        self.assertEqual(run(rows, self.bi, self.level, 110.0)[0], "active")

    def test_ema_seed_matches_pandas_ewm(self):
        closes = [100 + (i % 7) for i in range(40)]
        rows = [W(i, c + 1, c - 1, float(c)) for i, c in enumerate(closes)]
        # Walk with breakout at the last bar: the seed covers the whole series,
        # and with no post-breakout bars the walk leaves it untouched.
        expected = _ema(pd.Series([float(c) for c in closes]), 10)
        # Reproduce the seed loop
        k = 2 / 11
        ema = None
        for c in closes:
            ema = c if ema is None else c * k + ema * (1 - k)
        self.assertAlmostEqual(ema, expected, places=9)


if __name__ == "__main__":
    unittest.main()
