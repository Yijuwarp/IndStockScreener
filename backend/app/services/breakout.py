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
        if (level - trough) / level * 100 >= pullback_pct:
            events.append(BreakoutEvent(week_start, level, weekly_bars[peak_index][0]))
    return events
