import datetime as dt


def start_of_week(d: dt.date) -> dt.date:
    """Monday of the calendar week containing d (IST calendar week)."""
    return d - dt.timedelta(days=d.weekday())
