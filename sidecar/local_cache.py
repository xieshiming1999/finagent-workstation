"""Local data cache — reads from Electron's market.db SQLite for local-first data access."""
from __future__ import annotations
import sqlite3
import os
from pathlib import Path
import pandas as pd


class LocalCache:
    """Read-only access to Electron's local SQLite market data."""

    def __init__(self, db_path: str | None = None):
        if db_path:
            self._db_path = db_path
        else:
            home = Path.home()
            candidates = [
                home / ".finagent-workstation" / "data" / "market.db",
                home / "finagent_workstation" / "data" / "market.db",
                home / "Documents" / "finagent_workstation" / "data" / "market.db",
            ]
            self._db_path = None
            for p in candidates:
                if p.exists():
                    self._db_path = str(p)
                    break

    @property
    def available(self) -> bool:
        return self._db_path is not None and os.path.exists(self._db_path)

    @property
    def db_path(self) -> str | None:
        return self._db_path

    def _connect(self) -> sqlite3.Connection | None:
        if not self.available:
            return None
        try:
            conn = sqlite3.connect(f"file:{self._db_path}?mode=ro", uri=True)
            conn.row_factory = sqlite3.Row
            return conn
        except Exception:
            return None

    def query_kline(self, code: str, start: str | None = None, end: str | None = None,
                    adjust: str = "qfq", limit: int = 5000) -> pd.DataFrame | None:
        conn = self._connect()
        if not conn:
            return None
        try:
            sql = "SELECT * FROM kline_daily WHERE code = ? AND adjust = ?"
            params: list = [code, adjust]
            if start:
                sql += " AND date >= ?"
                params.append(start)
            if end:
                sql += " AND date <= ?"
                params.append(end)
            sql += " ORDER BY date LIMIT ?"
            params.append(limit)
            df = pd.read_sql_query(sql, conn, params=params)
            return df if len(df) > 0 else None
        except Exception:
            return None
        finally:
            conn.close()

    def query_fundamental(self, code: str, limit: int = 4) -> pd.DataFrame | None:
        conn = self._connect()
        if not conn:
            return None
        try:
            df = pd.read_sql_query(
                "SELECT * FROM fundamental WHERE code = ? ORDER BY report_date DESC LIMIT ?",
                conn, params=[code, limit])
            return df if len(df) > 0 else None
        except Exception:
            return None
        finally:
            conn.close()

    def query_stock_list(self) -> pd.DataFrame | None:
        conn = self._connect()
        if not conn:
            return None
        try:
            cols = [row["name"] for row in conn.execute("PRAGMA table_info(stock_list)").fetchall()]
            where = " WHERE delist_date IS NULL" if "delist_date" in cols else ""
            df = pd.read_sql_query(
                f"SELECT * FROM stock_list{where}", conn)
            return df if len(df) > 0 else None
        except Exception:
            return None
        finally:
            conn.close()

    def query_fund_list(self, fund_type: str | None = None) -> pd.DataFrame | None:
        conn = self._connect()
        if not conn:
            return None
        try:
            sql = "SELECT * FROM fund_list"
            params = []
            if fund_type:
                sql += " WHERE fund_type = ?"
                params.append(fund_type)
            df = pd.read_sql_query(sql, conn, params=params)
            return df if len(df) > 0 else None
        except Exception:
            return None
        finally:
            conn.close()

    def query_fund_screening_universe(self, fund_type: str | None = None) -> pd.DataFrame | None:
        conn = self._connect()
        if not conn:
            return None
        try:
            sql = """
                WITH ranked_perf AS (
                    SELECT
                        p.*,
                        ROW_NUMBER() OVER (
                            PARTITION BY p.code
                            ORDER BY
                                CASE
                                    WHEN p.nav IS NOT NULL
                                      OR p.return_ytd IS NOT NULL
                                      OR p.return_1w IS NOT NULL
                                      OR p.return_1m IS NOT NULL
                                      OR p.return_3m IS NOT NULL
                                      OR p.return_6m IS NOT NULL
                                      OR p.return_1y IS NOT NULL
                                      OR p.return_2y IS NOT NULL
                                      OR p.return_3y IS NOT NULL
                                      OR p.return_since_inception IS NOT NULL
                                    THEN 0 ELSE 1
                                END,
                                p.metric_date DESC,
                                p.fetched_at DESC
                        ) AS rn
                    FROM fund_performance_metrics p
                ),
                latest_perf AS (
                    SELECT * FROM ranked_perf WHERE rn = 1
                )
                SELECT
                    l.code,
                    l.name,
                    l.fund_type,
                    l.company,
                    l.manager,
                    l.total_size AS aum,
                    COALESCE(p.nav, l.nav) AS nav,
                    COALESCE(p.metric_date, l.nav_date) AS nav_date,
                    COALESCE(p.return_ytd, l.return_ytd) AS return_ytd,
                    p.return_1w,
                    p.return_1m,
                    p.return_3m,
                    p.return_6m,
                    COALESCE(p.return_1y, l.return_1y) AS return_1y,
                    p.return_2y,
                    COALESCE(p.return_3y, l.return_3y) AS return_3y,
                    p.return_since_inception,
                    p.provider,
                    p.fetched_at
                FROM fund_list l
                LEFT JOIN latest_perf p ON p.code = l.code
            """
            params = []
            if fund_type:
                patterns = fund_type_patterns(fund_type)
                if patterns:
                    sql += " WHERE (" + " OR ".join(["l.fund_type LIKE ?" for _ in patterns]) + ")"
                    params.extend(patterns)
                else:
                    sql += " WHERE l.fund_type = ?"
                    params.append(fund_type)
            df = pd.read_sql_query(sql, conn, params=params)
            return df if len(df) > 0 else None
        except Exception:
            return None
        finally:
            conn.close()

    def has_kline(self, code: str, start: str | None = None) -> bool:
        conn = self._connect()
        if not conn:
            return False
        try:
            sql = "SELECT COUNT(*) as cnt FROM kline_daily WHERE code = ?"
            params: list = [code]
            if start:
                sql += " AND date >= ?"
                params.append(start)
            row = conn.execute(sql, params).fetchone()
            return row["cnt"] > 50 if row else False
        except Exception:
            return False
        finally:
            conn.close()

    def coverage(self, code: str) -> dict | None:
        conn = self._connect()
        if not conn:
            return None
        try:
            rows = conn.execute(
                "SELECT data_type, MIN(date) as earliest, MAX(date) as latest, COUNT(*) as cnt "
                "FROM kline_daily WHERE code = ? GROUP BY adjust",
                [code]).fetchall()
            if not rows:
                return None
            return {
                "code": code,
                "kline": [{"adjust": r["data_type"] if "data_type" in r.keys() else "qfq",
                           "earliest": r["earliest"], "latest": r["latest"], "count": r["cnt"]} for r in rows],
            }
        except Exception:
            return None
        finally:
            conn.close()


_cache = LocalCache()


def get_local_cache(db_path: str | None = None) -> LocalCache:
    global _cache
    if db_path:
        _cache = LocalCache(db_path)
    return _cache


def fund_type_patterns(fund_type: str | None) -> list[str]:
    if not fund_type:
        return []
    key = str(fund_type).strip().lower()
    aliases = {
        "mixed": ["混合型%", "QDII-混合%"],
        "hybrid": ["混合型%", "QDII-混合%"],
        "stock": ["股票型%", "指数型-股票%", "QDII-普通股票%"],
        "equity": ["股票型%", "指数型-股票%", "QDII-普通股票%"],
        "bond": ["债券型%"],
        "money": ["货币型%"],
        "money_market": ["货币型%"],
        "index": ["指数型%"],
        "fof": ["FOF-%"],
        "qdii": ["QDII-%"],
        "reits": ["Reits%"],
        "reit": ["Reits%"],
    }
    return aliases.get(key, [])
