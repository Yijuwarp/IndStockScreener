import datetime as dt
import unittest

from app.services.breakout import detect_breakouts


def bar(week, high, low, close):
    return (dt.date(2025, 1, 6) + dt.timedelta(weeks=week), high, low, close)


class BreakoutDetectionTests(unittest.TestCase):
    def test_ath_requires_pullback_and_weekly_close_confirmation(self):
        events = detect_breakouts(
            [bar(0, 100, 95, 98), bar(1, 96, 79, 85), bar(2, 102, 94, 101)],
            basis="ATH",
        )
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].level, 100)

    def test_intrawweek_wick_is_not_a_breakout(self):
        rows = [bar(0, 100, 95, 98), bar(1, 96, 79, 85), bar(2, 103, 94, 99)]
        self.assertEqual(detect_breakouts(rows, basis="ATH"), [])

    def test_52w_breakout_uses_real_price_bars(self):
        rows = [bar(0, 100, 95, 98), bar(1, 95, 75, 80), bar(2, 101, 90, 100.5)]
        self.assertEqual(len(detect_breakouts(rows, basis="52W")), 1)


if __name__ == "__main__":
    unittest.main()
