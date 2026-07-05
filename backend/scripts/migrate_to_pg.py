"""One-shot copy of locally-ingested data into a remote Postgres database.

Yahoo rate-limits cloud-provider IPs, so ingestion can't run on Render. Instead,
run the normal refresh locally against SQLite, then push the results with:

    python -m scripts.migrate_to_pg "<external postgres url from Render>"

Weekly bars are the only stored price history (weekly-granularity decision,
2026-07-05); daily bars are never persisted, so this copies stocks, weekly_prices,
breakout_metrics, and the index tables. A leftover daily_prices table on the
target is dropped. Target tables are truncated first so ids stay consistent.
"""
import sqlite3
import sys

import psycopg

SQLITE_PATH = "test.db"

# (table, columns) in dependency order; truncated in reverse before copying.
TABLES: list[tuple[str, list[str]]] = [
    (
        "stocks",
        [
            "id", "symbol", "exchange", "yf_ticker", "name", "isin",
            "current_price", "current_volume", "market_cap",
            "all_time_high", "all_time_high_date", "week_52_high", "week_52_high_date",
            "last_updated", "avg_weekly_volume", "cap_category", "weeks_of_history",
            "listing_date", "ema_21d", "ema_50d", "ema_200d", "ema_10w",
            "weekly_close", "weekly_volume", "weekly_pct_change",
            "sector", "industry", "revenue_growth", "earnings_growth",
            "circuit_trap", "circuit_trap_weeks",
        ],
    ),
    (
        "breakout_metrics",
        [
            "id", "stock_id", "basis", "breakout_week", "breakout_level",
            "breakout_count", "consolidation_weeks", "consolidation_range_pct",
            "extension_pct", "breakout_age_weeks", "breakout_volume_ratio", "volume_dry_up",
        ],
    ),
    (
        "weekly_prices",
        ["id", "stock_id", "week_start", "open", "high", "low", "close", "volume"],
    ),
    (
        "market_indexes",
        [
            "id", "code", "name", "yf_ticker", "current_price",
            "ema_21d", "ema_50d", "ema_200d", "ema_300d", "last_updated",
        ],
    ),
    (
        "index_prices",
        ["id", "index_id", "date", "close"],
    ),
]

BOOL_COLUMNS = {"volume_dry_up", "circuit_trap"}


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: python -m scripts.migrate_to_pg <postgres-url>")
    pg_url = sys.argv[1]
    if pg_url.startswith("postgres://"):
        pg_url = pg_url.replace("postgres://", "postgresql://", 1)

    src = sqlite3.connect(SQLITE_PATH)
    with psycopg.connect(pg_url) as dst:
        with dst.cursor() as cur:
            # Weekly-only storage: reclaim the space if the target still has dailies.
            cur.execute("DROP TABLE IF EXISTS daily_prices")

            for table, _ in reversed(TABLES):
                cur.execute(f"TRUNCATE {table} CASCADE")

            for table, columns in TABLES:
                bool_idx = [i for i, c in enumerate(columns) if c in BOOL_COLUMNS]
                rows = src.execute(f"SELECT {', '.join(columns)} FROM {table}")
                count = 0
                with cur.copy(
                    f"COPY {table} ({', '.join(columns)}) FROM STDIN"
                ) as copy:
                    for row in rows:
                        if bool_idx:
                            row = list(row)
                            for i in bool_idx:
                                if row[i] is not None:
                                    row[i] = bool(row[i])
                        copy.write_row(row)
                        count += 1
                print(f"{table}: {count} rows")

                # COPY bypasses the id sequences; bump them past the copied ids.
                cur.execute(
                    f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
                    f"COALESCE((SELECT MAX(id) FROM {table}), 1))"
                )
        dst.commit()
    print("done")


if __name__ == "__main__":
    main()
