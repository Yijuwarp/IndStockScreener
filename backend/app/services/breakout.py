"""Detects distinct all-time-high breakout events from weekly bars.

A breakout is not every new high printed during a continuing uptrend -- a stock
making fresh highs every week for months is one continuous move. A breakout only
counts as a new, distinct event if price pulled back by at least PULLBACK_PCT
from the prior peak (and based there) before exceeding that peak again.
"""
import datetime as dt
from dataclasses import dataclass

PULLBACK_PCT = 15.0  # default, configurable later


@dataclass
class BreakoutEvent:
    week_start: dt.date
    level: float  # the prior peak that was broken


def detect_breakouts(weekly_bars: list[tuple[dt.date, float]], pullback_pct: float = PULLBACK_PCT) -> list[BreakoutEvent]:
    """weekly_bars: list of (week_start, high), ascending by week_start.

    Returns every confirmed breakout event in chronological order.
    """
    if not weekly_bars:
        return []

    events: list[BreakoutEvent] = []

    running_high = weekly_bars[0][1]
    trough_since_running_high = running_high
    pending_level: float | None = None  # peak level a future breakout must exceed
    pullback_confirmed = False

    for week_start, high in weekly_bars[1:]:
        if high > running_high:
            running_high = high
            trough_since_running_high = high
            if pullback_confirmed and pending_level is not None:
                events.append(BreakoutEvent(week_start=week_start, level=pending_level))
                pending_level = None
                pullback_confirmed = False
        else:
            if high < trough_since_running_high:
                trough_since_running_high = high
            drawdown = (running_high - trough_since_running_high) / running_high * 100
            if drawdown >= pullback_pct and pending_level is None:
                pending_level = running_high
                pullback_confirmed = True

    return events
