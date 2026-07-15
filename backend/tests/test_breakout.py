import datetime as dt
import random
import unittest

from app.services.breakout import BOX_WEEKS, BreakoutEvent, detect_breakouts, PULLBACK_PCT


def detect_breakouts_naive(weekly_bars, basis="ATH", pullback_pct=PULLBACK_PCT):
    """Straightforward O(n^2) reference: for each week, rescan the lookback
    window for the peak and the base trough. Semantics oracle for the O(n)
    deque implementation in detect_breakouts."""
    if len(weekly_bars) < 2:
        return []
    events = []
    for i in range(1, len(weekly_bars)):
        week_start, _high, _low, close = weekly_bars[i]
        start = 0 if basis == "ATH" else max(0, i - 52)
        prior = weekly_bars[start:i]
        level = max(bar[1] for bar in prior)
        peak_offset = max(j for j, bar in enumerate(prior) if bar[1] == level)
        peak_index = start + peak_offset
        base = weekly_bars[peak_index + 1:i]
        if not base or close <= level:
            continue
        trough = min(bar[2] for bar in base)
        pulled_back = (level - trough) / level * 100 >= pullback_pct
        if pulled_back or len(base) >= BOX_WEEKS:
            events.append(BreakoutEvent(week_start, level, weekly_bars[peak_index][0]))
    return events


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

    def test_box_rebreakout_without_pullback_fires(self):
        # peak at 100, then 4 completed weeks basing shallowly (only ~5% deep --
        # no 15% pullback), then a weekly close above the peak: the course's
        # Darvas-box base makes this a new event.
        rows = [bar(0, 100, 95, 98)]
        rows += [bar(w, 98, 95, 96) for w in range(1, 5)]
        rows.append(bar(5, 103, 97, 102))
        events = detect_breakouts(rows, basis="ATH")
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].level, 100)

    def test_three_week_pause_is_not_a_box(self):
        rows = [bar(0, 100, 95, 98)]
        rows += [bar(w, 98, 95, 96) for w in range(1, 4)]  # only 3 base weeks
        rows.append(bar(4, 103, 97, 102))
        self.assertEqual(detect_breakouts(rows, basis="ATH"), [])

    def test_overlapping_pullback_and_box_fire_one_event(self):
        # deep pullback AND >=4 base weeks -- still exactly one event on the break
        rows = [bar(0, 100, 95, 98)]
        rows += [bar(w, 90, 78, 85) for w in range(1, 6)]
        rows.append(bar(6, 104, 96, 101))
        self.assertEqual(len(detect_breakouts(rows, basis="ATH")), 1)

    def test_matches_naive_reference_on_random_walks(self):
        rng = random.Random(42)
        for basis in ("ATH", "52W"):
            for _ in range(50):
                price, bars = 100.0, []
                for week in range(rng.randint(2, 200)):
                    price = max(1.0, price * rng.uniform(0.8, 1.25))
                    high = price * rng.uniform(1.0, 1.1)
                    low = price * rng.uniform(0.85, 1.0)
                    close = rng.uniform(low, high)
                    # duplicate highs sometimes, to exercise peak tie-breaking
                    if bars and rng.random() < 0.1:
                        high = bars[-1][1]
                    bars.append(bar(week, high, low, close))
                self.assertEqual(
                    detect_breakouts(bars, basis=basis),
                    detect_breakouts_naive(bars, basis=basis),
                )


if __name__ == "__main__":
    unittest.main()
