"""Detects distinct all-time-high breakout events from weekly bars.

A breakout is not every new high printed during a continuing uptrend -- a stock
making fresh highs every week for months is one continuous move. A breakout only
counts as a new, distinct event if price pulled back by at least PULLBACK_PCT
from the prior peak (and based there) before exceeding that peak again.
"""
import datetime as dt
from collections import deque
from dataclasses import dataclass

PULLBACK_PCT = 15.0  # default, configurable later


@dataclass
class BreakoutEvent:
    week_start: dt.date
    level: float  # the prior peak that was broken
    peak_week: dt.date  # week the prior peak (level) was set, i.e. start of the base


def detect_breakouts(
    weekly_bars: list[tuple[dt.date, float, float, float]],
    basis: str = "ATH",
    pullback_pct: float = PULLBACK_PCT,
) -> list[BreakoutEvent]:
    """Return weekly-close breakouts after a qualifying low-price pullback."""
    if len(weekly_bars) < 2:
        return []
    events: list[BreakoutEvent] = []
    # Monotonic deques over the lookback window [start, i-1]:
    # highs holds candidate peaks in decreasing order, so its front is the
    # window max with the *latest* index (equal highs evict earlier ones).
    # lows holds candidate troughs (increasing) restricted to bars strictly
    # after the current peak; its front is the base trough, and it is empty
    # exactly when the base is empty.
    highs: deque[int] = deque()
    lows: deque[int] = deque()
    for i in range(1, len(weekly_bars)):
        j = i - 1  # newest bar in the lookback window
        while highs and weekly_bars[highs[-1]][1] <= weekly_bars[j][1]:
            highs.pop()
        if not highs:
            lows.clear()  # bar j is the new peak; the base restarts after it
        else:
            while lows and weekly_bars[lows[-1]][2] >= weekly_bars[j][2]:
                lows.pop()
            lows.append(j)
        highs.append(j)

        if basis != "ATH":
            start = max(0, i - 52)
            while highs[0] < start:
                highs.popleft()
                if not highs:  # cannot happen: bar j is always in the window
                    break
            while lows and lows[0] <= highs[0]:
                lows.popleft()

        peak_index = highs[0]
        level = weekly_bars[peak_index][1]
        week_start, _high, _low, close = weekly_bars[i]
        if not lows or close <= level:
            continue
        trough = weekly_bars[lows[0]][2]
        if (level - trough) / level * 100 >= pullback_pct:
            events.append(BreakoutEvent(week_start, level, weekly_bars[peak_index][0]))
    return events
