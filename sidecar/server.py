"""
FinAgent Python Sidecar — akshare data service
Runs as a local HTTP server, called by Electron main process.
"""
from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse
import akshare as ak
import uvicorn
import sys
import time
import threading
import inspect
import re
import pandas as pd
from datetime import datetime, timedelta

# Patch requests to add Referer only for EastMoney domains
import requests as _req
_original_session_send = _req.Session.send
def _patched_session_send(self, request, **kwargs):
    if request.url and 'eastmoney.com' in request.url:
        request.headers.setdefault('Referer', 'https://quote.eastmoney.com/')
        request.headers.setdefault('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
    elif request.url and ('User-Agent' not in request.headers or 'python' in request.headers.get('User-Agent', '').lower()):
        request.headers['User-Agent'] = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    return _original_session_send(self, request, **kwargs)
_req.Session.send = _patched_session_send

app = FastAPI(title="FinData Sidecar", version="1.1")
EASTMONEY_CLIST_URL = "https://push2delay.eastmoney.com/api/qt/clist/get"

# Configure local cache from environment
import os
_db_path = os.environ.get("FINDATA_DB_PATH")
if _db_path:
    from local_cache import get_local_cache
    get_local_cache(_db_path)


@app.get("/local_cache/status")
def local_cache_status():
    """Check what local data is available for backtest/screener."""
    from local_cache import get_local_cache
    cache = get_local_cache()
    if not cache.available:
        return {"available": False, "db_path": cache.db_path, "message": "Local SQLite not found. Set FINDATA_DB_PATH or download data via Data Manager."}
    conn = cache._connect()
    if not conn:
        return {"available": False, "db_path": cache.db_path, "message": "Cannot connect to local database."}
    try:
        tables = {}
        for table in ["kline_daily", "fundamental", "stock_list", "fund_list", "fund_nav",
                       "money_flow", "sector_ranking", "northbound", "limit_pool", "fund_holding", "fund_manager"]:
            try:
                row = conn.execute(f"SELECT COUNT(*) as cnt FROM {table}").fetchone()
                tables[table] = row["cnt"] if row else 0
            except Exception:
                tables[table] = 0
        kline_codes = 0
        try:
            row = conn.execute("SELECT COUNT(DISTINCT code) as cnt FROM kline_daily").fetchone()
            kline_codes = row["cnt"] if row else 0
        except Exception:
            pass
        return {
            "available": True,
            "db_path": cache.db_path,
            "tables": tables,
            "kline_stocks": kline_codes,
            "message": f"Local data: {tables.get('stock_list', 0)} stocks listed, {kline_codes} with kline, {tables.get('fundamental', 0)} fundamental records",
        }
    finally:
        conn.close()

from backtest.routes import router as backtest_router
from screener.routes import router as screener_router
app.include_router(backtest_router)
app.include_router(screener_router)

AKSHARE_PROVIDER_BY_FUNC = {
    "stock_zt_pool_em": "eastmoney",
    "stock_zt_pool_dtgc_em": "eastmoney",
    "stock_zt_pool_strong_em": "eastmoney",
    "stock_zt_pool_zbgc_em": "eastmoney",
    "stock_board_industry_name_em": "eastmoney",
    "stock_board_concept_name_em": "eastmoney",
    "stock_board_industry_cons_em": "eastmoney",
    "stock_hsgt_hold_stock_em": "eastmoney",
    "stock_hsgt_hist_em": "eastmoney",
    "stock_hot_rank_em": "eastmoney",
    "stock_individual_fund_flow": "eastmoney",
    "stock_individual_fund_flow_rank": "eastmoney",
    "stock_changes_em": "eastmoney",
    "stock_zh_index_spot_em": "eastmoney",
    "stock_zh_index_daily_em": "eastmoney",
    "stock_zh_a_spot_em": "eastmoney",
    "stock_zh_a_hist": "eastmoney",
    "stock_hk_spot_em": "eastmoney",
    "stock_us_spot_em": "eastmoney",
    "stock_individual_info_em": "eastmoney",
    "fund_open_fund_rank_em": "eastmoney",
    "fund_open_fund_info_em": "eastmoney",
    "fund_portfolio_hold_em": "eastmoney",
    "fund_manager_em": "eastmoney",
    "fund_etf_spot_em": "eastmoney",
    "fund_etf_hist_em": "eastmoney",
}

EXPLICIT_DATE_FUNCS = {
    "stock_zt_pool_em",
    "stock_zt_pool_dtgc_em",
    "stock_zt_pool_strong_em",
    "stock_zt_pool_zbgc_em",
}

RECENT_DATE_WINDOW_FUNCS = {
    "stock_zt_pool_dtgc_em",
    "stock_zt_pool_zbgc_em",
}

HSGT_HOLD_INDICATORS = {
    "今日排行": "1",
    "3日排行": "3",
    "5日排行": "5",
    "10日排行": "10",
    "月排行": "M",
    "季排行": "Q",
    "年排行": "Y",
}

HSGT_HOLD_MARKETS = {
    "北向": None,
    "沪股通": "001",
    "深股通": "003",
}


def compact_date(value: str) -> str:
    return str(value).replace("-", "").strip()


def normalize_recent_trading_date(func_name: str, params: dict):
    if func_name not in EXPLICIT_DATE_FUNCS:
        return None

    latest = datetime.now().date()
    raw_date = params.get("date")
    if not raw_date:
        return JSONResponse({
            "error": f"INVALID_AKSHARE_DATE: akshare.{func_name} requires explicit date=YYYYMMDD. Do not rely on AkShare's stale hard-coded default date.",
            "function": func_name,
            "provider": AKSHARE_PROVIDER_BY_FUNC.get(func_name, "akshare"),
            "latest_supported_date": latest.strftime("%Y%m%d"),
        }, 400)

    requested = compact_date(raw_date)
    if not (len(requested) == 8 and requested.isdigit()):
        return JSONResponse({
            "error": f"INVALID_AKSHARE_DATE: akshare.{func_name} expects explicit date=YYYYMMDD.",
            "function": func_name,
            "provider": AKSHARE_PROVIDER_BY_FUNC.get(func_name, "akshare"),
            "requested_date": str(raw_date),
            "latest_supported_date": latest.strftime("%Y%m%d"),
        }, 400)

    requested_date = datetime.strptime(requested, "%Y%m%d").date()
    if requested_date > latest:
        return JSONResponse({
            "error": f"INVALID_AKSHARE_DATE: akshare.{func_name} date cannot be in the future.",
            "function": func_name,
            "provider": AKSHARE_PROVIDER_BY_FUNC.get(func_name, "akshare"),
            "requested_date": requested,
            "latest_supported_date": latest.strftime("%Y%m%d"),
        }, 400)

    oldest = latest - timedelta(days=30)
    if func_name in RECENT_DATE_WINDOW_FUNCS and requested_date < oldest:
        return JSONResponse({
            "error": f"INVALID_AKSHARE_DATE: akshare.{func_name} supports only AkShare's recent date window. Use a recent date or query persisted limit_pool history instead.",
            "function": func_name,
            "provider": AKSHARE_PROVIDER_BY_FUNC.get(func_name, "akshare"),
            "requested_date": requested,
            "latest_supported_date": latest.strftime("%Y%m%d"),
            "oldest_supported_date_approx": oldest.strftime("%Y%m%d"),
        }, 400)

    params["date"] = requested
    return None


def normalize_akshare_params(func_name: str, params: dict):
    if func_name == "stock_zh_index_daily_em":
        if "period" in params:
            return JSONResponse({
                "error": "INVALID_AKSHARE_PARAM: akshare.stock_zh_index_daily_em does not support period. Use symbol/start_date/end_date only.",
                "function": func_name,
                "unsupported_param": "period",
            }, 400)
        symbol = params.get("symbol")
        if symbol:
            params["symbol"] = normalize_akshare_index_symbol(str(symbol))

    if func_name == "fund_open_fund_info_em":
        if "fund" in params and "symbol" not in params:
            return JSONResponse({
                "error": "INVALID_AKSHARE_PARAM: akshare.fund_open_fund_info_em expects symbol=<fund_code>, not fund=<fund_code>.",
                "function": func_name,
                "unsupported_param": "fund",
                "expected_param": "symbol",
            }, 400)

    if func_name == "stock_zh_a_gdhs":
        symbol = str(params.get("symbol", "最新"))
        if symbol != "最新" and not (len(symbol) == 8 and symbol.isdigit()):
            return JSONResponse({
                "error": "INVALID_AKSHARE_PARAM: akshare.stock_zh_a_gdhs expects symbol=最新 or a quarter-end date like 20260331. For one stock, use stock_zh_a_gdhs_detail_em?symbol=<code>.",
                "function": func_name,
                "requested_symbol": symbol,
                "expected_param": "symbol=最新 or symbol=YYYYMMDD",
            }, 400)

    return None


def normalize_akshare_index_symbol(symbol: str) -> str:
    value = symbol.strip()
    if value.lower().startswith(("sh", "sz", "csi", "bj")):
        return value
    if value.startswith("399"):
        return f"sz{value}"
    if value == "000001":
        return f"sh{value}"
    return f"csi{value}"


def eastmoney_stock_secid(code: str) -> str:
    clean = str(code).replace(".SH", "").replace(".SZ", "").replace(".BJ", "").replace("SH", "").replace("SZ", "").replace("BJ", "")
    market = "1" if clean.startswith("6") else "0"
    return f"{market}.{clean}"


def eastmoney_index_secid(symbol: str) -> str | None:
    value = normalize_akshare_index_symbol(symbol)
    if value.startswith("sz"):
        return f"0.{value.replace('sz', '')}"
    if value.startswith("bj"):
        return f"0.{value.replace('bj', '')}"
    if value.startswith("sh"):
        return f"1.{value.replace('sh', '')}"
    if value.startswith("csi"):
        return f"2.{value.replace('csi', '')}"
    return None


def public_index_code(symbol: str) -> str:
    value = normalize_akshare_index_symbol(symbol).lower()
    for prefix in ("sh", "sz", "csi", "bj"):
        if value.startswith(prefix):
            return value.removeprefix(prefix)
    return value


def tdx_index_request(code: str) -> tuple[str, str]:
    clean = str(code).strip()
    if clean in ("999999", "000001"):
        return "999999", "1"
    if clean.startswith("399"):
        return clean, "0"
    if clean.startswith("000"):
        return clean, "1"
    if clean.startswith("899"):
        return clean, "2"
    return clean, "1" if clean.startswith("6") else "0"


def direct_eastmoney_quote(code: str):
    res = _req.get("https://push2delay.eastmoney.com/api/qt/stock/get", params={
        "ut": "fa5fd1943c7b386f172d6893dbbd1d0c",
        "fltt": "2",
        "invt": "2",
        "fields": "f43,f44,f45,f46,f47,f48,f51,f55,f58,f60,f116,f168,f169,f170",
        "secid": eastmoney_stock_secid(code),
    }, timeout=15)
    res.raise_for_status()
    data = (res.json() or {}).get("data")
    if not data:
        return JSONResponse({"error": f"EastMoney quote empty for {code}", "provider": "eastmoney"}, 502)
    price = float(data.get("f43") or 0)
    prev_close = float(data.get("f60") or 0)
    return {
        "code": str(code),
        "name": data.get("f58") or "",
        "price": price,
        "changePct": float(data.get("f170") or 0),
        "change": price - prev_close if prev_close else float(data.get("f169") or 0),
        "volume": float(data.get("f47") or 0),
        "amount": float(data.get("f48") or 0),
        "open": float(data.get("f46") or 0),
        "high": float(data.get("f44") or 0),
        "low": float(data.get("f45") or 0),
        "prevClose": prev_close,
        "pe": float(data.get("f55")) if data.get("f55") not in (None, "", "-") else None,
        "pb": float(data.get("f51")) if data.get("f51") not in (None, "", "-") else None,
        "turnoverRate": float(data.get("f168")) if data.get("f168") not in (None, "", "-") else None,
        "marketCap": float(data.get("f116")) if data.get("f116") not in (None, "", "-") else None,
        "provider": "eastmoney",
    }


def sina_stock_symbol(code: str) -> str:
    clean = str(code).strip().replace(".SH", "").replace(".SZ", "").replace(".BJ", "").replace("SH", "").replace("SZ", "").replace("BJ", "")
    return f"sh{clean}" if clean.startswith("6") else f"sz{clean}"


def direct_sina_quote(code: str):
    clean = str(code).strip().replace(".SH", "").replace(".SZ", "").replace(".BJ", "").replace("SH", "").replace("SZ", "").replace("BJ", "")
    symbol = sina_stock_symbol(clean)
    resp = _req.get(
        "https://hq.sinajs.cn/list=" + symbol,
        timeout=10,
        headers={
            "Referer": "https://finance.sina.com.cn/",
            "User-Agent": "Mozilla/5.0",
        },
    )
    resp.raise_for_status()
    text = resp.content.decode("gbk", errors="replace")
    m = re.search(r'hq_str_' + re.escape(symbol) + r'="([^"]*)"', text)
    if not m:
        return JSONResponse({"error": f"Sina quote empty for {code}", "provider": "sina"}, 502)
    parts = m.group(1).split(",")
    if len(parts) < 32:
        return JSONResponse({"error": f"Sina quote malformed for {code}", "provider": "sina"}, 502)
    name = parts[0] or clean
    open_price = float(parts[1] or 0)
    prev_close = float(parts[2] or 0)
    price = float(parts[3] or 0)
    high = float(parts[4] or 0)
    low = float(parts[5] or 0)
    volume = float(parts[8] or 0)
    amount = float(parts[9] or 0)
    if price <= 0 or high < low or (high > 0 and price > high) or (low > 0 and price < low):
        return JSONResponse({"error": f"Sina quote implausible for {code}", "provider": "sina"}, 502)
    change = price - prev_close if prev_close else 0
    return {
        "code": clean,
        "name": name,
        "price": price,
        "changePct": (change / prev_close * 100) if prev_close else 0,
        "change": change,
        "volume": volume,
        "amount": amount,
        "open": open_price,
        "high": high,
        "low": low,
        "prevClose": prev_close,
        "pe": None,
        "pb": None,
        "turnoverRate": None,
        "marketCap": None,
        "provider": "sina",
    }


def stock_limit_pool_from_clist(params: dict, limit_type: str):
    requested = compact_date(str(params.get("date", ""))) if params.get("date") else datetime.now().strftime("%Y%m%d")
    res = _req.get(EASTMONEY_CLIST_URL, params={
        "pn": "1",
        "pz": str(params.get("limit", params.get("pz", "5000"))),
        "po": "1",
        "np": "1",
        "ut": "bd1d9ddb04089700cf9c27f6f7426281",
        "fltt": "2",
        "invt": "2",
        "fid": "f3",
        "fs": "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048",
        "fields": "f2,f3,f6,f8,f12,f14",
    }, timeout=30)
    res.raise_for_status()
    rows = ((res.json() or {}).get("data") or {}).get("diff") or []
    records = []
    for row in rows:
        pct = _eastmoney_number(row.get("f3"))
        if pct is None:
            continue
        if limit_type == "up" and pct < 9.8:
            continue
        if limit_type == "down" and pct > -9.8:
            continue
        records.append({
            "代码": str(row.get("f12") or ""),
            "名称": str(row.get("f14") or ""),
            "最新价": _eastmoney_number(row.get("f2")),
            "涨跌幅": pct,
            "成交额": _eastmoney_number(row.get("f6")),
            "换手率": _eastmoney_number(row.get("f8")),
            "首次封板时间": "",
            "最后封板时间": "",
            "炸板次数": 0,
            "连板数": 1,
            "所属行业": "",
        })
    return {
        "data": records,
        "count": len(records),
        "columns": list(records[0].keys()) if records else [],
        "provider": "eastmoney",
        "note": f"Quote-derived {limit_type} limit pool from push2delay clist for {requested}; exact push2ex topic pool is unstable in this network.",
    }


def tdx_index_daily_records(symbol: str, start_date: str, end_date: str):
    code = public_index_code(symbol)
    transport_code, market = tdx_index_request(code)
    res = _req.get("http://127.0.0.1:19801/index_bars", params={
        "code": transport_code,
        "market": market,
        "category": "9",
        "count": "800",
    }, timeout=10)
    res.raise_for_status()
    payload = res.json() or {}
    if isinstance(payload, dict) and payload.get("error"):
        raise RuntimeError(str(payload.get("error")))
    rows = []
    for bar in records_from_tdx_payload(payload):
        date = str(bar.get("DateTime") or bar.get("dateTime") or bar.get("date") or "")[:10]
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
            continue
        compact = compact_date(date)
        if start_date and compact < start_date:
            continue
        if end_date and compact > end_date:
            continue
        record = {
            "date": date,
            "open": _eastmoney_number(bar.get("Open") or bar.get("open")),
            "close": _eastmoney_number(bar.get("Close") or bar.get("close") or bar.get("Price") or bar.get("price")),
            "high": _eastmoney_number(bar.get("High") or bar.get("high")),
            "low": _eastmoney_number(bar.get("Low") or bar.get("low")),
            "volume": _eastmoney_number(bar.get("Vol") or bar.get("Volume") or bar.get("vol") or bar.get("volume")) or 0,
            "amount": _eastmoney_number(bar.get("Amount") or bar.get("amount")) or 0,
        }
        if not all(record[key] and record[key] > 0 for key in ("open", "close", "high", "low")):
            continue
        if record["high"] < record["low"] or record["high"] < record["open"] or record["high"] < record["close"]:
            continue
        if record["low"] > record["open"] or record["low"] > record["close"]:
            continue
        rows.append(record)
    if not rows:
        raise RuntimeError(f"TDX index_bars returned no validated rows for {code}")
    return rows


def tdx_stock_daily_records(code: str, start_date: str, end_date: str):
    clean = compact_eastmoney_stock_code(code)
    market = "1" if clean.startswith("6") else "0"
    res = _req.get("http://127.0.0.1:19801/kline", params={
        "code": clean,
        "market": market,
        "category": "9",
        "count": "500",
    }, timeout=10)
    res.raise_for_status()
    payload = res.json() or {}
    if isinstance(payload, dict) and payload.get("error"):
        raise RuntimeError(str(payload.get("error")))
    records = []
    for bar in records_from_tdx_payload(payload):
        date = str(bar.get("DateTime") or bar.get("dateTime") or bar.get("date") or "")[:10]
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
            continue
        compact = compact_date(date)
        if start_date and compact < start_date:
            continue
        if end_date and compact > end_date:
            continue
        record = {
            "日期": date,
            "开盘": _eastmoney_number(bar.get("Open") or bar.get("open")),
            "收盘": _eastmoney_number(bar.get("Close") or bar.get("close") or bar.get("Price") or bar.get("price")),
            "最高": _eastmoney_number(bar.get("High") or bar.get("high")),
            "最低": _eastmoney_number(bar.get("Low") or bar.get("low")),
            "成交量": _eastmoney_number(bar.get("Vol") or bar.get("Volume") or bar.get("vol") or bar.get("volume")) or 0,
            "成交额": _eastmoney_number(bar.get("Amount") or bar.get("amount")) or 0,
        }
        if not all(record[key] and record[key] > 0 for key in ("开盘", "收盘", "最高", "最低")):
            continue
        if record["最高"] < record["最低"] or record["最高"] < record["开盘"] or record["最高"] < record["收盘"]:
            continue
        if record["最低"] > record["开盘"] or record["最低"] > record["收盘"]:
            continue
        records.append(record)
    if not records:
        raise RuntimeError(f"TDX kline returned no validated rows for {clean}")
    return records


def stock_daily_dataframe(code: str, period: str = "daily", adjust: str = "qfq", limit: int = 120, priority: str = "interactive"):
    """Return A-share daily bars with a TDX-first fallback chain.

    AkShare's default stock_zh_a_hist path asks EastMoney push2his for a very
    broad date range, which is unstable in the current network. Keep the route
    useful by reusing the bounded gotdx daily K-line path first.
    """
    normalized_period = {"daily": "daily", "weekly": "weekly", "monthly": "monthly"}.get(period, "daily")
    normalized_adjust = {"qfq": "qfq", "hfq": "hfq", "none": ""}.get(adjust, "qfq")
    if normalized_period == "daily":
        try:
            records = tdx_stock_daily_records(code, "", "")
            if records:
                df = pd.DataFrame(records)
                df["涨跌幅"] = 0.0
                df["换手率"] = 0.0
                return df.tail(limit)
        except Exception:
            pass
    df = rate_limited_call(
        ak.stock_zh_a_hist,
        symbol=code,
        period=normalized_period,
        adjust=normalized_adjust,
        priority=priority,
    )
    return df.tail(limit)


def records_from_tdx_payload(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("List", "data"):
            if isinstance(payload.get(key), list):
                return payload.get(key)
        reply = payload.get("reply")
        if isinstance(reply, dict):
            for key in ("List", "data"):
                if isinstance(reply.get(key), list):
                    return reply.get(key)
    return []


def stock_zh_a_hist_direct(params: dict):
    symbol = compact_eastmoney_stock_code(str(params.get("symbol", "")))
    if not symbol:
        return JSONResponse({
            "error": "INVALID_AKSHARE_PARAM: stock_zh_a_hist requires symbol.",
            "function": "stock_zh_a_hist",
            "provider": "tdx",
        }, 400)
    period = str(params.get("period", "daily"))
    if period not in ("daily", ""):
        return JSONResponse({
            "error": "INVALID_AKSHARE_PARAM: stock_zh_a_hist gotdx fallback only supports period=daily.",
            "function": "stock_zh_a_hist",
            "provider": "tdx",
            "requested_period": period,
        }, 400)
    start_date = compact_date(str(params.get("start_date", "19900101")))
    end_date = compact_date(str(params.get("end_date", "20500101")))
    try:
        records = tdx_stock_daily_records(symbol, start_date, end_date)
        return {
            "data": records,
            "count": len(records),
            "columns": ["日期", "开盘", "收盘", "最高", "最低", "成交量", "成交额"],
            "provider": "tdx",
            "fallbackFrom": "eastmoney",
            "note": "A-share daily K-line uses local gotdx first because push2his stock kline is unstable in this network; gotdx bars are unadjusted.",
        }
    except Exception:
        pass
    return None


def stock_zh_index_daily_em_direct(params: dict):
    symbol = normalize_akshare_index_symbol(str(params.get("symbol", "csi931151")))
    secid = eastmoney_index_secid(symbol)
    if not secid:
        return JSONResponse({
            "error": "INVALID_AKSHARE_PARAM: stock_zh_index_daily_em symbol must be prefixed with sh/sz/csi/bj or be a known plain index code.",
            "function": "stock_zh_index_daily_em",
            "requested_symbol": params.get("symbol"),
        }, 400)
    start_date = compact_date(str(params.get("start_date", "19900101")))
    end_date = compact_date(str(params.get("end_date", "20500101")))
    try:
        records = tdx_index_daily_records(symbol, start_date, end_date)
        return {
            "data": records,
            "count": len(records),
            "columns": ["date", "open", "close", "high", "low", "volume", "amount"],
            "provider": "tdx",
            "fallbackFrom": "eastmoney",
            "note": "Index daily K-line uses local gotdx index_bars first because push2his index kline is unstable in this network.",
        }
    except Exception as e:
        return JSONResponse({
            "error": f"TDX index_bars unavailable for {public_index_code(symbol)}: {e}. Refusing push2his fallback because it is unstable in this network.",
            "function": "stock_zh_index_daily_em",
            "provider": "tdx",
            "symbol": symbol,
            "secid": secid,
        }, 503)


def records_from_dataframe(value):
    if isinstance(value, pd.DataFrame):
        records = []
        for _, row in value.iterrows():
            records.append({str(col): json_safe(val) for col, val in row.items()})
        return records
    if isinstance(value, list):
        return value
    return []


def fund_etf_hist_em_direct(params: dict):
    symbol = str(params.get("symbol", "")).strip()
    if not symbol:
        return JSONResponse({
            "error": "INVALID_AKSHARE_PARAM: fund_etf_hist_em requires symbol.",
            "function": "fund_etf_hist_em",
            "provider": "eastmoney",
        }, 400)
    start_date = compact_date(str(params.get("start_date", ""))) if params.get("start_date") else ""
    end_date = compact_date(str(params.get("end_date", ""))) if params.get("end_date") else ""

    df = rate_limited_call(
        ak.fund_open_fund_info_em,
        symbol=symbol,
        indicator="单位净值走势",
        priority=str(params.get("_priority", "background")),
    )
    records = []
    for row in records_from_dataframe(df):
        raw_date = str(row.get("净值日期") or row.get("日期") or "")[:10]
        compact = compact_date(raw_date)
        if not compact:
            continue
        if start_date and compact < start_date:
            continue
        if end_date and compact > end_date:
            continue
        nav = _eastmoney_number(row.get("单位净值"))
        daily_return = _eastmoney_number(row.get("日增长率"))
        if nav is None:
            continue
        records.append({
            "日期": raw_date,
            "开盘": nav,
            "收盘": nav,
            "最高": nav,
            "最低": nav,
            "成交量": None,
            "成交额": None,
            "涨跌幅": daily_return,
            "单位净值": nav,
            "日增长率": daily_return,
        })
    return {
        "data": records,
        "count": len(records),
        "columns": list(records[0].keys()) if records else [],
        "provider": "eastmoney",
        "note": "ETF history fallback uses fund_open_fund_info_em NAV history because push2his ETF kline is unstable in this network.",
    }


def stock_zh_index_spot_em_direct(params: dict):
    symbol = str(params.get("symbol", "")).strip()
    if not symbol or symbol == "沪深重要指数":
        sina_rows = fetch_sina_index_quotes(["000001", "399001", "399006"])
        if sina_rows:
            records = []
            for i, row in enumerate(sina_rows, start=1):
                records.append({
                    "序号": i,
                    "代码": row.get("code"),
                    "名称": row.get("name"),
                    "最新价": row.get("price"),
                    "涨跌幅": row.get("changePct"),
                    "涨跌额": row.get("change"),
                    "成交量": row.get("volume"),
                    "成交额": row.get("amount"),
                })
            return {
                "data": records,
                "count": len(records),
                "columns": list(records[0].keys()) if records else [],
                "provider": "sina",
                "note": "Sina index quote route used because EastMoney push2 index spot is unstable in this network.",
            }
    fs = "b:MK0010"
    if symbol == "沪深重要指数":
        fs = "b:MK0010"
    res = _req.get(EASTMONEY_CLIST_URL, params={
        "pn": "1",
        "pz": str(params.get("limit", params.get("pz", "100"))),
        "po": "1",
        "np": "1",
        "ut": "bd1d9ddb04089700cf9c27f6f7426281",
        "fltt": "2",
        "invt": "2",
        "fid": "f12",
        "fs": fs,
        "fields": "f2,f3,f4,f5,f6,f7,f8,f9,f12,f13,f14,f15,f16,f17,f18,f20,f21,f23,f24,f25",
    }, timeout=30)
    res.raise_for_status()
    rows = ((res.json() or {}).get("data") or {}).get("diff") or []
    records = []
    for i, row in enumerate(rows, start=1):
        code = str(row.get("f12") or "")
        if not code:
            continue
        records.append({
            "序号": i,
            "代码": code,
            "名称": str(row.get("f14") or ""),
            "最新价": _eastmoney_number(row.get("f2")),
            "涨跌幅": _eastmoney_number(row.get("f3")),
            "涨跌额": _eastmoney_number(row.get("f4")),
            "成交量": _eastmoney_number(row.get("f5")),
            "成交额": _eastmoney_number(row.get("f6")),
            "振幅": _eastmoney_number(row.get("f7")),
            "换手率": _eastmoney_number(row.get("f8")),
            "市盈率": _eastmoney_number(row.get("f9")),
            "最高": _eastmoney_number(row.get("f15")),
            "最低": _eastmoney_number(row.get("f16")),
            "今开": _eastmoney_number(row.get("f17")),
            "昨收": _eastmoney_number(row.get("f18")),
            "总市值": _eastmoney_number(row.get("f20")),
            "流通市值": _eastmoney_number(row.get("f21")),
            "市净率": _eastmoney_number(row.get("f23")),
        })
    return {
        "data": records,
        "count": len(records),
        "columns": list(records[0].keys()) if records else [],
        "provider": "eastmoney",
        "note": "Direct EastMoney clist route used to avoid AkShare digit-prefixed push2 hosts.",
    }


def compact_eastmoney_stock_code(value: str) -> str:
    code = str(value or "").strip()
    if "." in code:
        return code.split(".")[-1]
    upper = code.upper()
    if upper.startswith(("SH", "SZ", "BJ")):
        return upper[2:]
    return code


def stock_hot_rank_em_direct(params: dict):
    page_size = str(params.get("pageSize", params.get("limit", params.get("pz", "100"))))
    res = _req.post("https://emappdata.eastmoney.com/stockrank/getAllCurrentList", json={
        "appId": "appId01",
        "globalId": "786e4c21-70dc-435a-93bb-38",
        "marketType": "",
        "pageNo": int(params.get("pageNo", params.get("pn", "1"))),
        "pageSize": int(page_size),
    }, timeout=30, headers={
        "Content-Type": "application/json",
        "Referer": "https://quote.eastmoney.com/",
        "User-Agent": "Mozilla/5.0",
    })
    res.raise_for_status()
    payload = res.json() or {}
    rows = payload.get("data") or []
    records = []
    for i, row in enumerate(rows, start=1):
        code = compact_eastmoney_stock_code(row.get("sc") or row.get("代码") or row.get("股票代码") or "")
        if not code:
            continue
        records.append({
            "代码": code,
            "名称": str(row.get("sn") or row.get("名称") or row.get("股票简称") or ""),
            "排名": _eastmoney_number(row.get("rk")) or i,
            "排名变化": _eastmoney_number(row.get("rc")),
            "历史排名变化": _eastmoney_number(row.get("hisRc")),
            "人气值": _eastmoney_number(row.get("hv")),
        })
    return {
        "data": records,
        "count": len(records),
        "columns": list(records[0].keys()) if records else [],
        "provider": "eastmoney",
        "note": "Direct EastMoney app rank route used; quote/name enrichment is left to local stock-name cache or quote fetchers because push2 ulist is unstable in this network.",
    }


def flow_rank_period_config(indicator: str):
    value = str(indicator or "今日")
    if value == "10日":
        return {
            "prefix": "10日",
            "fid": "f174",
            "fields": "f12,f14,f2,f160,f174,f175,f176,f177,f178,f179,f180,f181,f182,f183,f260,f261,f124",
            "main": "f174",
            "main_pct": "f175",
            "super": "f176",
            "super_pct": "f177",
            "large": "f178",
            "large_pct": "f179",
            "medium": "f180",
            "medium_pct": "f181",
        }
    if value == "5日":
        return {
            "prefix": "5日",
            "fid": "f164",
            "fields": "f12,f14,f2,f109,f164,f165,f166,f167,f168,f169,f170,f171,f172,f173,f257,f258,f124",
            "main": "f164",
            "main_pct": "f165",
            "super": "f166",
            "super_pct": "f167",
            "large": "f168",
            "large_pct": "f169",
            "medium": "f170",
            "medium_pct": "f171",
        }
    if value == "3日":
        return {
            "prefix": "3日",
            "fid": "f267",
            "fields": "f12,f14,f2,f127,f267,f268,f269,f270,f271,f272,f273,f274,f275,f276,f257,f258,f124",
            "main": "f267",
            "main_pct": "f268",
            "super": "f269",
            "super_pct": "f270",
            "large": "f271",
            "large_pct": "f272",
            "medium": "f273",
            "medium_pct": "f274",
        }
    return {
        "prefix": "今日",
        "fid": "f62",
        "fields": "f12,f14,f2,f3,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87,f204,f205,f124",
        "main": "f62",
        "main_pct": "f184",
        "super": "f66",
        "super_pct": "f69",
        "large": "f72",
        "large_pct": "f75",
        "medium": "f78",
        "medium_pct": "f81",
    }


def eastmoney_timestamp_date(value) -> str:
    try:
        n = int(float(value))
        if n > 0:
            return datetime.fromtimestamp(n).strftime("%Y-%m-%d")
    except Exception:
        pass
    return datetime.now().strftime("%Y-%m-%d")


def stock_individual_fund_flow_direct(params: dict):
    code = compact_eastmoney_stock_code(params.get("stock") or params.get("symbol") or params.get("code") or "")
    if not code:
        return JSONResponse({
            "error": "INVALID_AKSHARE_PARAM: stock_individual_fund_flow requires stock/code.",
            "function": "stock_individual_fund_flow",
            "provider": "eastmoney",
        }, 400)
    res = _req.get("https://push2delay.eastmoney.com/api/qt/ulist.np/get", params={
        "secids": eastmoney_stock_secid(code),
        "fields": "f12,f14,f2,f3,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87,f124",
        "fltt": "2",
        "invt": "2",
        "ut": "b2884a393a59ad64002292a3e90d46a5",
    }, timeout=15, headers={
        "Referer": "https://quote.eastmoney.com/",
        "User-Agent": "Mozilla/5.0",
    })
    res.raise_for_status()
    rows = ((res.json() or {}).get("data") or {}).get("diff") or []
    if not rows:
        return JSONResponse({
            "error": f"EastMoney ulist money-flow fallback returned no rows for {code}",
            "function": "stock_individual_fund_flow",
            "provider": "eastmoney",
        }, 502)
    row = rows[0]
    actual_code = compact_eastmoney_stock_code(row.get("f12") or "")
    if actual_code and actual_code != code:
        return JSONResponse({
            "error": f"EastMoney ulist money-flow fallback returned {actual_code}, expected {code}",
            "function": "stock_individual_fund_flow",
            "provider": "eastmoney",
        }, 502)
    record = {
        "日期": eastmoney_timestamp_date(row.get("f124")),
        "主力净流入-净额": _eastmoney_number(row.get("f62")),
        "主力净流入-净占比": _eastmoney_number(row.get("f184")),
        "超大单净流入-净额": _eastmoney_number(row.get("f66")),
        "超大单净流入-净占比": _eastmoney_number(row.get("f69")),
        "大单净流入-净额": _eastmoney_number(row.get("f72")),
        "大单净流入-净占比": _eastmoney_number(row.get("f75")),
        "中单净流入-净额": _eastmoney_number(row.get("f78")),
        "中单净流入-净占比": _eastmoney_number(row.get("f81")),
        "小单净流入-净额": _eastmoney_number(row.get("f84")),
        "小单净流入-净占比": _eastmoney_number(row.get("f87")),
        "收盘价": _eastmoney_number(row.get("f2")),
        "涨跌幅": _eastmoney_number(row.get("f3")),
    }
    return {
        "data": [record],
        "count": 1,
        "columns": list(record.keys()),
        "provider": "eastmoney",
        "note": "Single-stock money-flow fallback uses push2delay ulist snapshot because push2his fflow is unstable in this network.",
    }


def stock_individual_fund_flow_rank_direct(params: dict):
    cfg = flow_rank_period_config(str(params.get("indicator", "今日")))
    res = _req.get(EASTMONEY_CLIST_URL, params={
        "fid": cfg["fid"],
        "po": "1",
        "pz": str(params.get("limit", params.get("pz", "100"))),
        "pn": str(params.get("pn", "1")),
        "np": "1",
        "fltt": "2",
        "invt": "2",
        "ut": "b2884a393a59ad64002292a3e90d46a5",
        "fs": "m:0+t:6+f:!2,m:0+t:13+f:!2,m:0+t:80+f:!2,m:1+t:2+f:!2,m:1+t:23+f:!2,m:0+t:7+f:!2,m:1+t:3+f:!2",
        "fields": cfg["fields"],
    }, timeout=30)
    res.raise_for_status()
    rows = ((res.json() or {}).get("data") or {}).get("diff") or []
    prefix = cfg["prefix"]
    records = []
    for row in rows:
        code = compact_eastmoney_stock_code(row.get("f12") or "")
        if not code:
            continue
        records.append({
            "代码": code,
            "名称": str(row.get("f14") or ""),
            "最新价": _eastmoney_number(row.get("f2")),
            "涨跌幅": _eastmoney_number(row.get("f3")),
            f"{prefix}主力净流入-净额": _eastmoney_number(row.get(cfg["main"])),
            f"{prefix}主力净流入-净占比": _eastmoney_number(row.get(cfg["main_pct"])),
            f"{prefix}超大单净流入-净额": _eastmoney_number(row.get(cfg["super"])),
            f"{prefix}超大单净流入-净占比": _eastmoney_number(row.get(cfg["super_pct"])),
            f"{prefix}大单净流入-净额": _eastmoney_number(row.get(cfg["large"])),
            f"{prefix}大单净流入-净占比": _eastmoney_number(row.get(cfg["large_pct"])),
            f"{prefix}中单净流入-净额": _eastmoney_number(row.get(cfg["medium"])),
            f"{prefix}中单净流入-净占比": _eastmoney_number(row.get(cfg["medium_pct"])),
        })
    return {
        "data": records,
        "count": len(records),
        "columns": list(records[0].keys()) if records else [],
        "provider": "eastmoney",
        "note": "Direct EastMoney clist route via push2delay used because push2 and digit-prefixed push2 hosts are unstable in this network.",
    }


def stock_hsgt_hold_stock_em_direct(params: dict):
    market = params.get("market", "沪股通")
    indicator = params.get("indicator", "5日排行")
    if indicator not in HSGT_HOLD_INDICATORS:
        return JSONResponse({
            "error": "INVALID_AKSHARE_PARAM: stock_hsgt_hold_stock_em indicator is invalid.",
            "function": "stock_hsgt_hold_stock_em",
            "requested_indicator": indicator,
            "allowed_indicators": list(HSGT_HOLD_INDICATORS.keys()),
        }, 400)
    if market not in HSGT_HOLD_MARKETS:
        return JSONResponse({
            "error": "INVALID_AKSHARE_PARAM: stock_hsgt_hold_stock_em market is invalid.",
            "function": "stock_hsgt_hold_stock_em",
            "requested_market": market,
            "allowed_markets": list(HSGT_HOLD_MARKETS.keys()),
        }, 400)

    filters = [f'(INTERVAL_TYPE="{HSGT_HOLD_INDICATORS[indicator]}")']
    mutual_type = HSGT_HOLD_MARKETS[market]
    if mutual_type:
        filters.append(f'(MUTUAL_TYPE="{mutual_type}")')
    query = {
        "sortColumns": "TRADE_DATE,ADD_MARKET_CAP",
        "sortTypes": "-1,-1",
        "pageSize": "5000",
        "pageNumber": "1",
        "reportName": "RPT_MUTUAL_STOCK_NORTHSTA",
        "columns": "ALL",
        "source": "WEB",
        "client": "WEB",
        "filter": "".join(filters),
    }
    res = _req.get("https://datacenter-web.eastmoney.com/api/data/v1/get", params=query, timeout=30)
    res.raise_for_status()
    data_json = res.json()
    records = ((data_json.get("result") or {}).get("data") or [])
    columns = list(records[0].keys()) if records else []
    return {
        "data": records,
        "count": len(records),
        "columns": columns,
        "provider": "eastmoney",
        "note": "Direct EastMoney datacenter route used because AkShare's wrapper scrapes the page date before calling this API.",
    }


def _eastmoney_number(value):
    if value in (None, "", "-"):
        return None
    try:
        return float(value)
    except Exception:
        return None


def eastmoney_spot_em_direct(params: dict, market: str):
    fs_map = {
        "a": "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048",
        "hk": "m:128+t:3,m:128+t:4,m:128+t:1,m:128+t:2",
        "us": "m:105,m:106,m:107",
    }
    function_map = {
        "a": "stock_zh_a_spot_em",
        "hk": "stock_hk_spot_em",
        "us": "stock_us_spot_em",
    }
    fs = fs_map[market]
    res = _req.get(EASTMONEY_CLIST_URL, params={
        "pn": str(params.get("pn", "1")),
        "pz": str(params.get("limit", params.get("pz", "100"))),
        "po": "1",
        "np": "1",
        "ut": "bd1d9ddb04089700cf9c27f6f7426281",
        "fltt": "2",
        "invt": "2",
        "fid": str(params.get("fid", "f12")),
        "fs": fs,
        "fields": "f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f15,f16,f17,f18,f20,f21,f22,f23,f24,f25,f26,f33,f62,f128,f136,f115,f152",
    }, timeout=30)
    res.raise_for_status()
    rows = ((res.json() or {}).get("data") or {}).get("diff") or []
    records = []
    for i, row in enumerate(rows, start=1):
        code = str(row.get("f12") or "")
        if not code:
            continue
        records.append({
            "序号": i,
            "代码": code,
            "名称": str(row.get("f14") or ""),
            "最新价": _eastmoney_number(row.get("f2")),
            "涨跌幅": _eastmoney_number(row.get("f3")),
            "涨跌额": _eastmoney_number(row.get("f4")),
            "成交量": _eastmoney_number(row.get("f5")),
            "成交额": _eastmoney_number(row.get("f6")),
            "振幅": _eastmoney_number(row.get("f7")),
            "换手率": _eastmoney_number(row.get("f8")),
            "市盈率-动态": _eastmoney_number(row.get("f9")),
            "量比": _eastmoney_number(row.get("f10")),
            "最高": _eastmoney_number(row.get("f15")),
            "最低": _eastmoney_number(row.get("f16")),
            "今开": _eastmoney_number(row.get("f17")),
            "昨收": _eastmoney_number(row.get("f18")),
            "总市值": _eastmoney_number(row.get("f20")),
            "流通市值": _eastmoney_number(row.get("f21")),
            "涨速": _eastmoney_number(row.get("f22")),
            "市净率": _eastmoney_number(row.get("f23")),
            "60日涨跌幅": _eastmoney_number(row.get("f24")),
            "年初至今涨跌幅": _eastmoney_number(row.get("f25")),
        })
    return {
        "data": records,
        "count": len(records),
        "columns": list(records[0].keys()) if records else [],
        "provider": "eastmoney",
        "function": function_map[market],
        "note": "Direct EastMoney clist route via push2delay used to avoid AkShare digit-prefixed push2 hosts.",
    }


def stock_chip_distribution_direct(params: dict):
    code = compact_eastmoney_stock_code(str(params.get("code", params.get("symbol", ""))))
    if not code:
        return JSONResponse({
            "error": "INVALID_AKSHARE_PARAM: chip requires code.",
            "function": "chip",
            "provider": "eastmoney",
        }, 400)
    secu_code = f"{code}.{'SH' if code.startswith('6') else 'SZ'}"
    res = _req.get("https://datacenter-web.eastmoney.com/api/data/v1/get", params={
        "reportName": "RPT_F10_CHIP_DISTRIBUTION",
        "columns": "ALL",
        "filter": f'(SECUCODE="{secu_code}")',
        "sortColumns": "TRADE_DATE",
        "sortTypes": "-1",
        "pageNumber": "1",
        "pageSize": str(params.get("limit", params.get("pageSize", "30"))),
        "source": "WEB",
        "client": "WEB",
    }, timeout=30)
    res.raise_for_status()
    rows = ((res.json() or {}).get("result") or {}).get("data") or []
    return {
        "data": rows,
        "count": len(rows),
        "columns": list(rows[0].keys()) if rows else [],
        "provider": "eastmoney",
        "function": "chip",
        "note": "Direct EastMoney datacenter chip route used because AkShare stock_cyq_em depends on unstable push2his kline.",
    }


def _resolve_eastmoney_industry_board_code(symbol: str):
    value = str(symbol or "").strip()
    if not value:
        return None
    if re.match(pattern=r"^BK\d+", string=value, flags=re.IGNORECASE):
        return value.upper()

    res = _req.get(EASTMONEY_CLIST_URL, params={
        "pn": "1",
        "pz": "100",
        "po": "1",
        "np": "1",
        "ut": "bd1d9ddb04089700cf9c27f6f7426281",
        "fltt": "2",
        "invt": "2",
        "fid": "f3",
        "fs": "m:90 t:2 f:!50",
        "fields": "f12,f14",
    }, timeout=30)
    res.raise_for_status()
    rows = ((res.json() or {}).get("data") or {}).get("diff") or []
    exact = next((row for row in rows if str(row.get("f14") or "") == value), None)
    fuzzy = next((row for row in rows if value in str(row.get("f14") or "") or str(row.get("f14") or "") in value), None)
    match = exact or fuzzy
    return str(match.get("f12") or "") if match else None


def _resolve_eastmoney_concept_board_code(symbol: str):
    value = str(symbol or "").strip()
    if not value:
        return None
    if re.match(pattern=r"^BK\d+", string=value, flags=re.IGNORECASE):
        return value.upper()

    res = _req.get(EASTMONEY_CLIST_URL, params={
        "pn": "1",
        "pz": "100",
        "po": "1",
        "np": "1",
        "ut": "bd1d9ddb04089700cf9c27f6f7426281",
        "fltt": "2",
        "invt": "2",
        "fid": "f3",
        "fs": "m:90 t:3 f:!50",
        "fields": "f12,f14",
    }, timeout=30)
    res.raise_for_status()
    rows = ((res.json() or {}).get("data") or {}).get("diff") or []
    exact = next((row for row in rows if str(row.get("f14") or "") == value), None)
    fuzzy = next((row for row in rows if value in str(row.get("f14") or "") or str(row.get("f14") or "") in value), None)
    match = exact or fuzzy
    return str(match.get("f12") or "") if match else None


def stock_board_rank_em_direct(params: dict, board_type: str):
    if board_type == "concept":
        fs = "m:90 t:3 f:!50"
        function = "stock_board_concept_name_em"
    else:
        fs = "m:90 t:2 f:!50"
        function = "stock_board_industry_name_em"
    res = _req.get(EASTMONEY_CLIST_URL, params={
        "pn": "1",
        "pz": str(params.get("limit", params.get("pz", "100"))),
        "po": "1",
        "np": "1",
        "ut": "bd1d9ddb04089700cf9c27f6f7426281",
        "fltt": "2",
        "invt": "2",
        "fid": "f3",
        "fs": fs,
        "fields": "f2,f3,f4,f8,f12,f14,f20,f21,f104,f105,f128,f136,f140,f141",
    }, timeout=30)
    res.raise_for_status()
    rows = ((res.json() or {}).get("data") or {}).get("diff") or []
    records = []
    for i, row in enumerate(rows, start=1):
        code = str(row.get("f12") or "")
        if not code:
            continue
        records.append({
            "序号": i,
            "板块代码": code,
            "板块名称": str(row.get("f14") or ""),
            "最新价": _eastmoney_number(row.get("f2")),
            "涨跌幅": _eastmoney_number(row.get("f3")),
            "涨跌额": _eastmoney_number(row.get("f4")),
            "换手率": _eastmoney_number(row.get("f8")),
            "总市值": _eastmoney_number(row.get("f20")),
            "上涨家数": _eastmoney_number(row.get("f104")),
            "下跌家数": _eastmoney_number(row.get("f105")),
            "领涨股票": str(row.get("f128") or ""),
            "领涨股票-涨跌幅": _eastmoney_number(row.get("f136")),
            "领涨股票代码": str(row.get("f140") or ""),
            "领涨股票名称": str(row.get("f141") or ""),
        })
    return {
        "data": records,
        "count": len(records),
        "columns": list(records[0].keys()) if records else [],
        "provider": "eastmoney",
        "function": function,
        "note": "Direct EastMoney clist route used to avoid AkShare digit-prefixed push2 hosts.",
    }


def stock_board_industry_cons_em_direct(params: dict):
    symbol = str(params.get("symbol", "小金属")).strip()
    board_code = _resolve_eastmoney_industry_board_code(symbol)
    if not board_code:
        return JSONResponse({
            "error": "INVALID_AKSHARE_PARAM: stock_board_industry_cons_em could not resolve the industry board name to a BK code. Query stock_board_industry_name_em first, then call with symbol=<BKcode> or use the direct EastMoney board-code route.",
            "function": "stock_board_industry_cons_em",
            "provider": "eastmoney",
            "requested_symbol": symbol,
        }, 404)

    res = _req.get(EASTMONEY_CLIST_URL, params={
        "pn": "1",
        "pz": str(params.get("limit", params.get("pz", "200"))),
        "po": "1",
        "np": "1",
        "ut": "bd1d9ddb04089700cf9c27f6f7426281",
        "fltt": "2",
        "invt": "2",
        "fid": "f3",
        "fs": f"b:{board_code} f:!50",
        "fields": "f2,f3,f4,f5,f6,f7,f8,f9,f12,f14,f15,f16,f17,f18,f20,f23",
    }, timeout=30)
    res.raise_for_status()
    rows = ((res.json() or {}).get("data") or {}).get("diff") or []
    records = []
    for i, row in enumerate(rows, start=1):
        code = str(row.get("f12") or "")
        if not code:
            continue
        records.append({
            "序号": i,
            "代码": code,
            "名称": str(row.get("f14") or ""),
            "最新价": _eastmoney_number(row.get("f2")),
            "涨跌幅": _eastmoney_number(row.get("f3")),
            "涨跌额": _eastmoney_number(row.get("f4")),
            "成交量": _eastmoney_number(row.get("f5")),
            "成交额": _eastmoney_number(row.get("f6")),
            "振幅": _eastmoney_number(row.get("f7")),
            "换手率": _eastmoney_number(row.get("f8")),
            "市盈率-动态": _eastmoney_number(row.get("f9")),
            "最高": _eastmoney_number(row.get("f15")),
            "最低": _eastmoney_number(row.get("f16")),
            "今开": _eastmoney_number(row.get("f17")),
            "昨收": _eastmoney_number(row.get("f18")),
            "市净率": _eastmoney_number(row.get("f23")),
            "总市值": _eastmoney_number(row.get("f20")),
        })
    return {
        "data": records,
        "count": len(records),
        "columns": list(records[0].keys()) if records else [],
        "provider": "eastmoney",
        "board_code": board_code,
        "note": "Direct EastMoney board-code route used to avoid AkShare's name-resolution parser edge cases.",
    }


def stock_board_concept_cons_em_direct(params: dict):
    symbol = str(params.get("symbol", "机器人概念")).strip()
    board_code = _resolve_eastmoney_concept_board_code(symbol)
    if not board_code:
        return JSONResponse({
            "error": "INVALID_AKSHARE_PARAM: stock_board_concept_cons_em could not resolve the concept board name to a BK code. Query stock_board_concept_name_em first, then call with symbol=<BKcode> or use the direct EastMoney board-code route.",
            "function": "stock_board_concept_cons_em",
            "provider": "eastmoney",
            "requested_symbol": symbol,
        }, 404)

    res = _req.get(EASTMONEY_CLIST_URL, params={
        "pn": "1",
        "pz": str(params.get("limit", params.get("pz", "200"))),
        "po": "1",
        "np": "1",
        "ut": "bd1d9ddb04089700cf9c27f6f7426281",
        "fltt": "2",
        "invt": "2",
        "fid": "f3",
        "fs": f"b:{board_code} f:!50",
        "fields": "f2,f3,f4,f5,f6,f7,f8,f9,f12,f14,f15,f16,f17,f18,f20,f23",
    }, timeout=30)
    res.raise_for_status()
    rows = ((res.json() or {}).get("data") or {}).get("diff") or []
    records = []
    for i, row in enumerate(rows, start=1):
        code = str(row.get("f12") or "")
        if not code:
            continue
        records.append({
            "序号": i,
            "代码": code,
            "名称": str(row.get("f14") or ""),
            "最新价": _eastmoney_number(row.get("f2")),
            "涨跌幅": _eastmoney_number(row.get("f3")),
            "涨跌额": _eastmoney_number(row.get("f4")),
            "成交量": _eastmoney_number(row.get("f5")),
            "成交额": _eastmoney_number(row.get("f6")),
            "振幅": _eastmoney_number(row.get("f7")),
            "换手率": _eastmoney_number(row.get("f8")),
            "市盈率-动态": _eastmoney_number(row.get("f9")),
            "最高": _eastmoney_number(row.get("f15")),
            "最低": _eastmoney_number(row.get("f16")),
            "今开": _eastmoney_number(row.get("f17")),
            "昨收": _eastmoney_number(row.get("f18")),
            "市净率": _eastmoney_number(row.get("f23")),
            "总市值": _eastmoney_number(row.get("f20")),
        })
    return {
        "data": records,
        "count": len(records),
        "columns": list(records[0].keys()) if records else [],
        "provider": "eastmoney",
        "board_code": board_code,
        "note": "Direct EastMoney concept board-code route used to avoid AkShare digit-prefixed push2 hosts.",
    }


def stock_lhb_detail_daily_sina_direct(params: dict):
    date = compact_date(str(params.get("date", "")))
    dash_date = f"{date[:4]}-{date[4:6]}-{date[6:8]}" if len(date) == 8 else datetime.now().strftime("%Y-%m-%d")
    query = {
        "reportName": "RPT_DAILYBILLBOARD_DETAILSNEW",
        "columns": "ALL",
        "filter": f"(TRADE_DATE>='{dash_date}')",
        "sortColumns": "ACCUM_AMOUNT",
        "sortTypes": "-1",
        "pageNumber": "1",
        "pageSize": str(params.get("limit", params.get("pageSize", "50"))),
        "source": "WEB",
        "client": "WEB",
    }
    res = _req.get("https://datacenter-web.eastmoney.com/api/data/v1/get", params=query, timeout=30)
    res.raise_for_status()
    rows = ((res.json() or {}).get("result") or {}).get("data") or []
    return {
        "data": rows,
        "count": len(rows),
        "columns": list(rows[0].keys()) if rows else [],
        "provider": "eastmoney",
        "function": "stock_lhb_detail_daily_sina",
        "note": "Direct EastMoney datacenter route used because AkShare's Sina LHB wrapper schema is unstable.",
    }

# --- Dual-Channel Rate Limiter ---
# Two channels: interactive (agent calls, low latency) vs background (data manager batch, high throughput protection)
# Both share the same upstream servers, so a 429 on one channel affects both.


class RateLimiter:
    def __init__(self, name: str, min_interval: float = 2.0, max_interval: float = 30.0):
        self.name = name
        self.min_interval = min_interval
        self.max_interval = max_interval
        self.current_interval = min_interval
        self.last_call_time = 0.0
        self.lock = threading.Lock()
        self.consecutive_errors = 0
        self.total_calls = 0
        self.total_errors = 0

    def wait(self):
        with self.lock:
            elapsed = time.time() - self.last_call_time
            if elapsed < self.current_interval:
                time.sleep(self.current_interval - elapsed)
            self.last_call_time = time.time()
            self.total_calls += 1

    def on_success(self):
        with self.lock:
            self.consecutive_errors = 0
            if self.current_interval > self.min_interval:
                self.current_interval = max(self.min_interval, self.current_interval * 0.9)

    def on_error(self, is_rate_limit: bool = False):
        with self.lock:
            self.consecutive_errors += 1
            self.total_errors += 1
            if is_rate_limit:
                self.current_interval = min(self.max_interval, self.current_interval * 2)
            elif self.consecutive_errors >= 3:
                self.current_interval = min(self.max_interval, self.current_interval * 1.5)

    @property
    def status(self):
        return {
            "name": self.name,
            "current_interval": round(self.current_interval, 2),
            "min_interval": self.min_interval,
            "max_interval": self.max_interval,
            "consecutive_errors": self.consecutive_errors,
            "total_calls": self.total_calls,
            "total_errors": self.total_errors,
            "last_call": round(time.time() - self.last_call_time, 1) if self.last_call_time > 0 else None,
        }


# Interactive: agent direct queries — low latency, light protection
interactive_limiter = RateLimiter("interactive", min_interval=0.5, max_interval=15.0)

# Background: data manager batch fetches — heavy protection, can wait
background_limiter = RateLimiter("background", min_interval=3.0, max_interval=60.0)


def get_limiter(priority: str) -> RateLimiter:
    if priority == "interactive":
        return interactive_limiter
    return background_limiter


def rate_limited_call(func, *args, priority: str = "interactive", **kwargs):
    """Call an akshare function with channel-appropriate rate limiting."""
    limiter = get_limiter(priority)
    limiter.wait()
    try:
        result = func(*args, **kwargs)
        limiter.on_success()
        # A success on either channel means upstream is healthy — help the other recover too
        other = background_limiter if priority == "interactive" else interactive_limiter
        if other.consecutive_errors > 0:
            other.on_success()
        return result
    except Exception as e:
        msg = str(e).lower()
        is_rate = "429" in msg or "too many" in msg or "rate limit" in msg or "频繁" in msg
        limiter.on_error(is_rate_limit=is_rate)
        # Rate limit affects both channels (same upstream IP)
        if is_rate:
            other = background_limiter if priority == "interactive" else interactive_limiter
            other.on_error(is_rate_limit=True)
        raise


def get_priority(request: Request) -> str:
    """Extract priority from query params. Default: interactive for direct calls."""
    return request.query_params.get("_priority", "interactive")


@app.get("/health")
def health():
    return {"status": "ok", "version": "1.1"}


@app.get("/rate_limit/status")
def rate_limit_status():
    return {
        "akshare": {
            "interactive": interactive_limiter.status,
            "background": background_limiter.status,
        },
        "yfinance": {
            "interactive": yf_interactive_limiter.status,
            "background": yf_background_limiter.status,
        },
    }


@app.get("/quote")
def quote(code: str = Query(...), request: Request = None):
    """实时行情 — single-symbol quote; EastMoney first, Sina fallback when push2 is blocked."""
    try:
        p = get_priority(request) if request else "interactive"
        get_limiter(p).wait()
        try:
            return direct_eastmoney_quote(code)
        except Exception as eastmoney_error:
            sina = direct_sina_quote(code)
            if isinstance(sina, JSONResponse):
                return JSONResponse({
                    "error": f"EastMoney quote failed: {eastmoney_error}; Sina fallback failed",
                    "provider": "eastmoney+sina",
                }, 502)
            sina["fallbackFrom"] = "eastmoney"
            sina["fallbackReason"] = str(eastmoney_error)
            return sina
    except Exception as e:
        return JSONResponse({"error": str(e)}, 500)


@app.get("/kline")
def kline(code: str = Query(...), period: str = "daily", adjust: str = "qfq", limit: int = 120, request: Request = None):
    """K线历史"""
    try:
        p = get_priority(request) if request else "interactive"
        df = stock_daily_dataframe(code, period=period, adjust=adjust, limit=limit, priority=p)
        return {"data": [
            {
                "date": str(row["日期"]),
                "open": float(row["开盘"]),
                "close": float(row["收盘"]),
                "high": float(row["最高"]),
                "low": float(row["最低"]),
                "volume": float(row["成交量"]),
                "amount": float(row["成交额"]),
                "changePct": float(row.get("涨跌幅", 0)),
                "turnoverRate": float(row.get("换手率", 0)),
            }
            for _, row in df.iterrows()
        ]}
    except Exception as e:
        return JSONResponse({"error": str(e)}, 500)


@app.get("/fund/nav")
def fund_nav(code: str = Query(...), request: Request = None):
    """基金净值"""
    try:
        p = get_priority(request) if request else "interactive"
        df = rate_limited_call(ak.fund_open_fund_info_em, symbol=code, indicator="单位净值走势", priority=p)
        df = df.tail(60)
        return {"data": [
            {"date": str(row["净值日期"]), "nav": float(row["单位净值"]), "accNav": float(row["累计净值"])}
            for _, row in df.iterrows()
        ]}
    except Exception as e:
        return JSONResponse({"error": str(e)}, 500)


@app.get("/index/list")
def index_list(request: Request = None):
    """主要指数列表"""
    try:
        sina_rows = fetch_sina_index_quotes(["000001", "399001", "399006"])
        if sina_rows:
            return {"data": sina_rows, "source": "sina"}
        p = get_priority(request) if request else "interactive"
        df = rate_limited_call(ak.stock_zh_index_spot_em, priority=p)
        return {"data": [
            {"code": r["代码"], "name": r["名称"], "price": float(r.get("最新价", 0)),
             "changePct": float(r.get("涨跌幅", 0))}
            for _, r in df.head(20).iterrows()
        ]}
    except Exception as e:
        return JSONResponse({"error": str(e)}, 500)


@app.get("/index/quotes")
def index_quotes(code: str = Query(""), request: Request = None):
    """指数实时行情。code 支持逗号分隔，例如 000001,399001,399006。"""
    try:
        requested = [normalize_index_code(c) for c in code.split(",") if c.strip()]
        if not requested:
            requested = ["000001", "399001", "399006"]
        sina_rows = fetch_sina_index_quotes(requested)
        if len(sina_rows) == len(requested):
            return {"data": sina_rows, "source": "sina"}

        p = get_priority(request) if request else "interactive"
        df = rate_limited_call(ak.stock_zh_index_spot_em, priority=p)

        def norm(v):
            return normalize_index_code(v)

        rows = []
        iterable = df.iterrows()
        if requested:
            wanted = {norm(c): i for i, c in enumerate(requested)}
            matched = []
            for _, r in iterable:
                n = norm(r.get("代码", ""))
                if n in wanted:
                    matched.append((wanted[n], r))
            iterable = [(_, r) for _, r in sorted(matched, key=lambda item: item[0])]

        for _, r in iterable:
            rows.append({
                "code": norm(r.get("代码", "")),
                "name": r.get("名称", ""),
                "price": float(r.get("最新价", 0)),
                "changePct": float(r.get("涨跌幅", 0)),
                "change": float(r.get("涨跌额", 0)) if "涨跌额" in r else 0,
                "volume": float(r.get("成交量", 0)) if "成交量" in r else 0,
                "amount": float(r.get("成交额", 0)) if "成交额" in r else 0,
                "open": float(r.get("今开", 0)) if "今开" in r else 0,
                "high": float(r.get("最高", 0)) if "最高" in r else 0,
                "low": float(r.get("最低", 0)) if "最低" in r else 0,
                "prevClose": float(r.get("昨收", 0)) if "昨收" in r else 0,
            })
            if not requested and len(rows) >= 20:
                break

        return {"data": rows, "source": "akshare"}
    except Exception as e:
        return JSONResponse({"error": str(e)}, 500)


def normalize_index_code(value):
    s = str(value or "").strip().lower()
    if "." in s:
        s = s.split(".")[0]
    if s.startswith(("sh", "sz", "bj")):
        s = s[2:]
    return s


def sina_index_symbol(code):
    return f"sz{code}" if str(code).startswith("399") else f"sh{code}"


def fetch_sina_index_quotes(codes):
    clean_codes = [normalize_index_code(c) for c in codes if normalize_index_code(c)]
    if not clean_codes:
        return []
    symbols = ",".join([f"s_{sina_index_symbol(c)}" for c in clean_codes])
    try:
        resp = _req.get(
            "https://hq.sinajs.cn/list=" + symbols,
            timeout=10,
            headers={
                "Referer": "https://finance.sina.com.cn/",
                "User-Agent": "Mozilla/5.0",
            },
        )
        resp.raise_for_status()
        text = resp.content.decode("gbk", errors="replace")
        rows = []
        for code in clean_codes:
            symbol = sina_index_symbol(code)
            m = re.search(r'hq_str_s_' + re.escape(symbol) + r'="([^"]*)"', text)
            if not m:
                continue
            parts = m.group(1).split(",")
            if len(parts) < 4:
                continue
            price = float(parts[1] or 0)
            change_pct = float(parts[3] or 0)
            if not is_plausible_index_quote(code, price, change_pct):
                continue
            rows.append({
                "code": code,
                "name": parts[0] or code,
                "price": price,
                "change": float(parts[2] or 0),
                "changePct": change_pct,
                "volume": float(parts[4] or 0) if len(parts) > 4 else 0,
                "amount": float(parts[5] or 0) if len(parts) > 5 else 0,
                "source": "sina:index_quote",
            })
        return rows
    except Exception:
        return []


def is_plausible_index_quote(code, price, change_pct):
    if price <= 0 or abs(change_pct) > 20:
        return False
    ranges = {
        "000001": (1000, 10000),
        "399001": (5000, 30000),
        "399006": (1000, 10000),
    }
    low_high = ranges.get(str(code))
    if not low_high:
        return True
    low, high = low_high
    return low <= price <= high


@app.get("/news")
def news(
    keyword: str = Query(""),
    enrich: bool = Query(False),
    max_enrich: int = Query(8),
    request: Request = None,
):
    """财经新闻"""
    try:
        p = get_priority(request) if request else "interactive"
        source_func = "stock_news_em" if keyword else "stock_info_global_em"
        df = rate_limited_call(ak.stock_news_em, symbol=keyword, priority=p) if keyword else rate_limited_call(ak.stock_info_global_em, priority=p)
        rows = []
        enrich_count = 0
        for _, r in df.head(50).iterrows():
            item = normalize_news_row(r, keyword=keyword, source_func=source_func)
            if enrich and enrich_count < max(0, min(max_enrich, 12)) and needs_news_preview(item):
                preview = fetch_article_preview(item.get("url", ""))
                if preview:
                    item["summary"] = item.get("summary") or preview.get("summary", "")
                    item["content"] = item.get("content") or preview.get("content", "")
                    item["previewFetched"] = True
                    item["relatedSymbols"] = extract_related_symbols(" ".join([
                        item.get("title", ""),
                        item.get("summary", ""),
                        item.get("content", ""),
                    ]))
                enrich_count += 1
                time.sleep(0.25)
            item["headlineOnly"] = is_headline_only_news(item)
            if item.get("title"):
                rows.append(item)
            if len(rows) >= 20:
                break
        return {"data": rows, "source": "akshare", "sourceFunc": source_func, "enriched": enrich, "enrichedCount": enrich_count}
    except Exception as e:
        return JSONResponse({"error": str(e)}, 500)


def normalize_news_row(row, keyword: str = "", source_func: str = ""):
    """Normalize AkShare news rows without discarding useful article context."""
    title = first_non_empty(row, ["新闻标题", "标题", "title", "Title"])
    summary = first_non_empty(row, ["新闻摘要", "摘要", "简介", "summary", "description"])
    content = first_non_empty(row, ["新闻内容", "内容", "正文", "content", "text"])
    url = first_non_empty(row, ["新闻链接", "链接", "url", "URL", "原文链接"])
    source = first_non_empty(row, ["新闻来源", "来源", "source", "publisher"])
    published = first_non_empty(row, ["发布时间", "时间", "发布日期", "date", "datetime", "pubDate"])
    related = extract_related_symbols(" ".join([title, summary, content]))
    return {
        "title": title,
        "time": published,
        "source": source,
        "url": url,
        "link": url,
        "summary": summary,
        "content": content,
        "keyword": keyword,
        "sourceFunc": source_func,
        "relatedSymbols": related,
    }


def needs_news_preview(item):
    if not item.get("url") or item.get("content"):
        return False
    title = normalize_news_text(item.get("title", ""))
    summary = normalize_news_text(item.get("summary", ""))
    return not summary or len(summary) < 30 or summary.rstrip("。.!") == title.rstrip("。.!")


def is_headline_only_news(item):
    title = normalize_news_text(item.get("title", ""))
    summary = normalize_news_text(item.get("summary", ""))
    content = normalize_news_text(item.get("content", ""))
    if content and content != title:
        return False
    if not summary:
        return True
    return len(summary) < 30 or summary.rstrip("。.!") == title.rstrip("。.!")


def fetch_article_preview(url: str):
    """Best-effort, serial article preview fetch for title-only news rows."""
    if not url or not url.startswith(("http://", "https://")):
        return None
    try:
        resp = _req.get(url, timeout=2.5, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Referer": "https://www.eastmoney.com/",
        })
        if resp.status_code >= 400:
            return None
        resp.encoding = resp.apparent_encoding or resp.encoding
        html = resp.text or ""
        summary = extract_meta_description(html)
        content = extract_article_text(html)
        if not summary and content:
            summary = content[:180]
        return {"summary": summary, "content": content[:1200]}
    except Exception:
        return None


def extract_meta_description(html: str):
    for pattern in [
        r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']description["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:description["\']',
    ]:
        m = re.search(pattern, html, flags=re.IGNORECASE)
        if m:
            text = clean_html_text(m.group(1))
            if text:
                return text[:500]
    return ""


def extract_article_text(html: str):
    snippets = []
    for m in re.finditer(r"<p[^>]*>(.*?)</p>", html, flags=re.IGNORECASE | re.DOTALL):
        text = clean_html_text(m.group(1))
        if len(text) >= 20 and not re.search(r"(免责声明|责任编辑|function|var |copyright)", text, re.IGNORECASE):
            snippets.append(text)
        if len(" ".join(snippets)) >= 1200:
            break
    if snippets:
        return "\n".join(snippets)[:1600]
    return ""


def clean_html_text(value: str):
    text = re.sub(r"<[^>]+>", " ", value or "")
    text = (text
            .replace("&nbsp;", " ")
            .replace("&amp;", "&")
            .replace("&quot;", '"')
            .replace("&#39;", "'")
            .replace("&lt;", "<")
            .replace("&gt;", ">"))
    return re.sub(r"\s+", " ", text).strip()


def normalize_news_text(value: str):
    return re.sub(r"\s+", "", str(value or "")).strip()


def first_non_empty(row, keys):
    for key in keys:
        try:
            value = row.get(key, "")
        except Exception:
            value = ""
        if value is None:
            continue
        try:
            if pd.isna(value):
                continue
        except Exception:
            pass
        text = str(value).strip()
        if text and text.lower() != "nan":
            return text
    return ""


def extract_related_symbols(text: str):
    if not text:
        return []
    seen = []
    for code in re.findall(r"(?<!\d)(?:[036]\d{5}|[48]\d{5}|5\d{5}|1\d{5})(?!\d)", text):
        if code not in seen:
            seen.append(code)
        if len(seen) >= 8:
            break
    return seen


@app.get("/margin")
def margin(code: str = Query(""), date: str = Query(""), request: Request = None):
    """融资融券"""
    try:
        p = get_priority(request) if request else "interactive"
        trade_date = compact_date(date) if date else compact_date(datetime.now().strftime("%Y%m%d"))
        df = rate_limited_call(ak.stock_margin_detail_szse, date=trade_date, priority=p)
        if code and "证券代码" in df.columns:
            df = df[df["证券代码"].astype(str).str.endswith(str(code))]
        df = df.tail(30)
        return {"data": records_from_dataframe(df), "date": trade_date}
    except Exception as e:
        return JSONResponse({"error": str(e)}, 500)


@app.get("/holders")
def holders(code: str = Query(...), request: Request = None):
    """十大股东"""
    try:
        p = get_priority(request) if request else "interactive"
        df = rate_limited_call(ak.stock_main_stock_holder, stock=code, priority=p)
        return {"data": records_from_dataframe(df.head(10))}
    except Exception as e:
        return JSONResponse({"error": str(e)}, 500)


# --- Alpha Factors ---

@app.get("/alpha/factors")
def alpha_factors(code: str = Query(...), period: str = "daily", limit: int = 120, request: Request = None):
    """Compute alpha factors (simplified Alpha158 subset)"""
    try:
        import numpy as np
        p = get_priority(request) if request else "interactive"
        df = stock_daily_dataframe(code, period=period, adjust="qfq", limit=limit, priority=p)
        if len(df) < 30:
            return JSONResponse({"error": "Not enough data"}, 400)

        close = df["收盘"].values.astype(float)
        high = df["最高"].values.astype(float)
        low = df["最低"].values.astype(float)
        volume = df["成交量"].values.astype(float)
        returns = np.diff(close) / close[:-1]

        factors = {}
        factors["momentum_5d"] = float((close[-1] / close[-6] - 1) * 100) if len(close) > 5 else None
        factors["momentum_20d"] = float((close[-1] / close[-21] - 1) * 100) if len(close) > 20 else None
        factors["volatility_20d"] = float(np.std(returns[-20:]) * np.sqrt(252) * 100) if len(returns) > 20 else None
        factors["volume_ratio_5d"] = float(volume[-1] / np.mean(volume[-5:])) if len(volume) > 5 else None
        factors["price_position_60d"] = float((close[-1] - np.min(close[-60:])) / (np.max(close[-60:]) - np.min(close[-60:])) * 100) if len(close) > 60 else None
        factors["high_low_range_20d"] = float((np.max(high[-20:]) - np.min(low[-20:])) / close[-1] * 100) if len(close) > 20 else None
        factors["ma5_deviation"] = float((close[-1] / np.mean(close[-5:]) - 1) * 100) if len(close) > 5 else None
        factors["ma20_deviation"] = float((close[-1] / np.mean(close[-20:]) - 1) * 100) if len(close) > 20 else None
        factors["turnover_20d_avg"] = float(np.mean(volume[-20:])) if len(volume) > 20 else None
        factors["skewness_20d"] = float(float(np.mean(((returns[-20:] - np.mean(returns[-20:])) / np.std(returns[-20:]))**3))) if len(returns) > 20 else None

        return {"code": code, "factors": factors}
    except Exception as e:
        return JSONResponse({"error": str(e)}, 500)


@app.get("/chip")
def chip_distribution(code: str = Query(...), request: Request = None):
    """筹码分布 (成本分析)"""
    try:
        return stock_chip_distribution_direct({"code": code})
    except Exception as e:
        return JSONResponse({"error": str(e)}, 500)


# --- Generic AkShare Proxy ---
# Call ANY akshare function via HTTP: GET /akshare/{function_name}?param1=val1&param2=val2
# Pass _priority=background for batch operations (default: interactive)

@app.get("/akshare/{func_name}")
def akshare_proxy(func_name: str, request: Request):
    """
    Generic AkShare proxy. Call any akshare function by name.
    Pass _priority=background for data manager batch calls (slower, won't block interactive).
    Example: GET /akshare/stock_zh_a_spot_em
    Example: GET /akshare/stock_zh_a_hist?symbol=600519&period=daily&adjust=qfq&_priority=background
    """
    func = getattr(ak, func_name, None)
    if func is None:
        return JSONResponse({"error": f"akshare function '{func_name}' not found"}, 404)
    if not callable(func):
        return JSONResponse({"error": f"akshare.{func_name} is not callable"}, 400)

    # Extract control parameters before building AkShare params
    priority = request.query_params.get("_priority", "interactive")
    requested_provider = request.query_params.get("_provider")
    actual_provider = AKSHARE_PROVIDER_BY_FUNC.get(func_name, "akshare")
    if requested_provider and requested_provider != actual_provider:
        return JSONResponse({
            "error": f"akshare.{func_name} is provider '{actual_provider}', not requested provider '{requested_provider}'",
            "function": func_name,
            "provider": actual_provider,
            "requested_provider": requested_provider,
        }, 400)

    # Build kwargs from query parameters (exclude internal _priority param)
    params = {k: v for k, v in request.query_params.items() if not k.startswith("_")}
    date_error = normalize_recent_trading_date(func_name, params)
    if date_error is not None:
        return date_error
    param_error = normalize_akshare_params(func_name, params)
    if param_error is not None:
        return param_error

    if func_name == "stock_zh_a_hist":
        direct = stock_zh_a_hist_direct(params)
        if direct is not None:
            return direct
    if func_name == "stock_zh_a_spot_em":
        try:
            return eastmoney_spot_em_direct(params, "a")
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            return JSONResponse({"error": str(e), "function": func_name, "traceback": tb.split('\n')[-3:]}, 500)
    if func_name == "stock_hk_spot_em":
        try:
            return eastmoney_spot_em_direct(params, "hk")
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            return JSONResponse({"error": str(e), "function": func_name, "traceback": tb.split('\n')[-3:]}, 500)
    if func_name == "stock_us_spot_em":
        try:
            return eastmoney_spot_em_direct(params, "us")
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            return JSONResponse({"error": str(e), "function": func_name, "traceback": tb.split('\n')[-3:]}, 500)
    if func_name == "stock_zt_pool_em":
        try:
            return stock_limit_pool_from_clist(params, "up")
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            return JSONResponse({"error": str(e), "function": func_name, "traceback": tb.split('\n')[-3:]}, 500)
    if func_name == "stock_zt_pool_dtgc_em":
        try:
            return stock_limit_pool_from_clist(params, "down")
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            return JSONResponse({"error": str(e), "function": func_name, "traceback": tb.split('\n')[-3:]}, 500)
    if func_name == "stock_hsgt_hold_stock_em":
        try:
            return stock_hsgt_hold_stock_em_direct(params)
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            return JSONResponse({"error": str(e), "function": func_name, "traceback": tb.split('\n')[-3:]}, 500)
    if func_name == "stock_hot_rank_em":
        try:
            return stock_hot_rank_em_direct(params)
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            return JSONResponse({"error": str(e), "function": func_name, "traceback": tb.split('\n')[-3:]}, 500)
    if func_name == "stock_individual_fund_flow_rank":
        try:
            return stock_individual_fund_flow_rank_direct(params)
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            return JSONResponse({"error": str(e), "function": func_name, "traceback": tb.split('\n')[-3:]}, 500)
    if func_name == "stock_individual_fund_flow":
        try:
            return stock_individual_fund_flow_direct(params)
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            return JSONResponse({"error": str(e), "function": func_name, "traceback": tb.split('\n')[-3:]}, 500)
    if func_name == "stock_board_industry_name_em":
        try:
            return stock_board_rank_em_direct(params, "industry")
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            return JSONResponse({"error": str(e), "function": func_name, "traceback": tb.split('\n')[-3:]}, 500)
    if func_name == "stock_board_concept_name_em":
        try:
            return stock_board_rank_em_direct(params, "concept")
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            return JSONResponse({"error": str(e), "function": func_name, "traceback": tb.split('\n')[-3:]}, 500)
    if func_name == "stock_board_industry_cons_em":
        try:
            return stock_board_industry_cons_em_direct(params)
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            return JSONResponse({"error": str(e), "function": func_name, "traceback": tb.split('\n')[-3:]}, 500)
    if func_name == "stock_board_concept_cons_em":
        try:
            return stock_board_concept_cons_em_direct(params)
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            return JSONResponse({"error": str(e), "function": func_name, "traceback": tb.split('\n')[-3:]}, 500)
    if func_name == "stock_lhb_detail_daily_sina":
        try:
            return stock_lhb_detail_daily_sina_direct(params)
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            return JSONResponse({"error": str(e), "function": func_name, "traceback": tb.split('\n')[-3:]}, 500)
    if func_name == "stock_zh_index_daily_em":
        try:
            return stock_zh_index_daily_em_direct(params)
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            return JSONResponse({"error": str(e), "function": func_name, "traceback": tb.split('\n')[-3:]}, 500)
    if func_name == "fund_etf_hist_em":
        try:
            return fund_etf_hist_em_direct(params)
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            return JSONResponse({"error": str(e), "function": func_name, "traceback": tb.split('\n')[-3:]}, 500)
    if func_name == "stock_zh_index_spot_em":
        try:
            return stock_zh_index_spot_em_direct(params)
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            return JSONResponse({"error": str(e), "function": func_name, "traceback": tb.split('\n')[-3:]}, 500)

    sig = inspect.signature(func)
    for key, val in params.items():
        if key in sig.parameters:
            ann = sig.parameters[key].annotation
            if ann == int or ann == inspect.Parameter.empty:
                try:
                    params[key] = int(val)
                except ValueError:
                    pass
            elif ann == float:
                try:
                    params[key] = float(val)
                except ValueError:
                    pass

    try:
        result = rate_limited_call(func, priority=priority, **params)
        if isinstance(result, pd.DataFrame):
            if len(result) > 5000:
                result = result.tail(5000)
            records = []
            for _, row in result.iterrows():
                record = {}
                for col in result.columns:
                    val = row[col]
                    if pd.isna(val):
                        record[col] = None
                    elif isinstance(val, (pd.Timestamp,)):
                        record[col] = str(val)
                    else:
                        try:
                            record[col] = val.item() if hasattr(val, 'item') else val
                        except:
                            record[col] = str(val)
                records.append(record)
            return {"data": records, "count": len(records), "columns": list(result.columns), "provider": actual_provider}
        elif isinstance(result, (list, dict)):
            return {"data": result, "provider": actual_provider}
        else:
            return {"data": str(result), "provider": actual_provider}
    except TypeError as e:
        params_info = {k: str(v.annotation) for k, v in sig.parameters.items()}
        return JSONResponse({"error": str(e), "expected_params": params_info}, 400)
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        log_msg = f"[AkShare] {func_name} failed: {e}"
        print(log_msg)
        return JSONResponse({"error": str(e), "function": func_name, "traceback": tb.split('\n')[-3:]}, 500)
def akshare_list():
    """List all available akshare functions (search by keyword)"""
    return {"message": "Use GET /akshare/{function_name} to call any akshare function. Pass _priority=background for batch ops. Example: /akshare/stock_zh_a_spot_em"}


@app.get("/akshare_search")
def akshare_search(q: str = Query("")):
    """Search akshare functions by keyword"""
    all_funcs = [name for name in dir(ak) if not name.startswith('_') and callable(getattr(ak, name, None))]
    if q:
        matches = [f for f in all_funcs if q.lower() in f.lower()]
    else:
        matches = all_funcs[:50]
    return {"functions": matches, "total": len(all_funcs), "showing": len(matches)}


# --- yfinance Rate Limiters ---
# Yahoo Finance has stricter rate limits than EastMoney

yf_interactive_limiter = RateLimiter("yf_interactive", min_interval=1.0, max_interval=20.0)
yf_background_limiter = RateLimiter("yf_background", min_interval=5.0, max_interval=60.0)


def yf_rate_limited_call(func, *args, priority: str = "interactive", **kwargs):
    """Call a yfinance function with channel-appropriate rate limiting."""
    limiter = yf_interactive_limiter if priority == "interactive" else yf_background_limiter
    limiter.wait()
    try:
        result = func(*args, **kwargs)
        limiter.on_success()
        other = yf_background_limiter if priority == "interactive" else yf_interactive_limiter
        if other.consecutive_errors > 0:
            other.on_success()
        return result
    except Exception as e:
        msg = str(e).lower()
        is_rate = "429" in msg or "too many" in msg or "rate limit" in msg
        limiter.on_error(is_rate_limit=is_rate)
        if is_rate:
            other = yf_background_limiter if priority == "interactive" else yf_interactive_limiter
            other.on_error(is_rate_limit=True)
        raise


def df_to_records(df):
    """Convert DataFrame to JSON-safe records."""
    records = []
    for idx, row in df.iterrows():
        record = {"_index": str(idx)}
        for col in df.columns:
            val = row[col]
            if pd.isna(val):
                record[col] = None
            elif isinstance(val, (pd.Timestamp,)):
                record[col] = str(val)
            else:
                try:
                    record[col] = val.item() if hasattr(val, 'item') else val
                except:
                    record[col] = str(val)
        records.append(record)
    return records


def json_safe(value):
    """Convert common pandas/numpy/yfinance values into JSON-safe values."""
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except Exception:
        pass
    if isinstance(value, (pd.Timestamp,)):
        return str(value)
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(v) for v in value]
    try:
        return value.item() if hasattr(value, "item") else value
    except Exception:
        return str(value)


def mapping_like_to_dict(value):
    """Best-effort conversion for yfinance lazy mapping objects such as fast_info."""
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if hasattr(value, "keys") and hasattr(value, "__getitem__"):
        clean = {}
        for key in list(value.keys()):
            try:
                clean[str(key)] = json_safe(value[key])
            except Exception as e:
                clean[str(key)] = None
                clean[f"{key}_error"] = str(e)
        return clean
    return None


def yfinance_method_kwargs(action, extra):
    """Coerce yfinance query params for methods with typed arguments."""
    if action == "history":
        kwargs = {}
        if "period" in extra: kwargs["period"] = extra["period"]
        if "interval" in extra: kwargs["interval"] = extra["interval"]
        if "start" in extra: kwargs["start"] = extra["start"]
        if "end" in extra: kwargs["end"] = extra["end"]
        if "prepost" in extra: kwargs["prepost"] = extra["prepost"].lower() in ("true", "1")
        if "auto_adjust" in extra: kwargs["auto_adjust"] = extra["auto_adjust"].lower() in ("true", "1")
        if "actions" in extra: kwargs["actions"] = extra["actions"].lower() in ("true", "1")
        return kwargs
    if action == "option_chain":
        return {"date": extra["date"]} if extra.get("date") else {}
    if action in ("get_earnings_dates",):
        kwargs = {}
        if "limit" in extra: kwargs["limit"] = int(extra["limit"])
        if "offset" in extra: kwargs["offset"] = int(extra["offset"])
        return kwargs
    return extra


# --- yfinance Generic Proxy ---

import yfinance as yf

@app.get("/yfinance/{action}")
def yfinance_proxy(action: str, request: Request):
    """
    Generic yfinance proxy. Call any Ticker method by name.
    Requires `symbol` param. Pass _priority=background for batch operations.

    Examples:
      GET /yfinance/history?symbol=AAPL&period=1y&interval=1d
      GET /yfinance/info?symbol=AAPL
      GET /yfinance/financials?symbol=AAPL
      GET /yfinance/balance_sheet?symbol=AAPL
      GET /yfinance/cash_flow?symbol=AAPL
      GET /yfinance/recommendations?symbol=AAPL
      GET /yfinance/news?symbol=AAPL
      GET /yfinance/options?symbol=AAPL
      GET /yfinance/option_chain?symbol=AAPL&date=2026-06-20
      GET /yfinance/dividends?symbol=AAPL
      GET /yfinance/splits?symbol=AAPL
      GET /yfinance/earnings_dates?symbol=AAPL
      GET /yfinance/earnings_history?symbol=AAPL
      GET /yfinance/institutional_holders?symbol=AAPL
      GET /yfinance/insider_transactions?symbol=AAPL
      GET /yfinance/fast_info?symbol=AAPL
      GET /yfinance/valuation?symbol=AAPL
    """
    symbol = request.query_params.get("symbol", "")
    if not symbol:
        return JSONResponse({"error": "symbol required. Example: /yfinance/history?symbol=AAPL"}, 400)

    priority = request.query_params.get("_priority", "interactive")
    # Extra params (exclude symbol and _priority)
    extra = {k: v for k, v in request.query_params.items() if k not in ("symbol", "_priority")}

    ticker = yf.Ticker(symbol)
    attr = getattr(ticker, action, None)
    if attr is None:
        return JSONResponse({"error": f"Unknown yfinance action: {action}. Use /yfinance_search to list available actions."}, 404)

    try:
        if callable(attr):
            # Methods like history(), get_info(), option_chain()
            kwargs = yfinance_method_kwargs(action, extra)
            result = yf_rate_limited_call(lambda: attr(**kwargs) if kwargs else attr(), priority=priority)
        else:
            # Properties like info, fast_info, financials, news, options
            result = yf_rate_limited_call(lambda: attr, priority=priority)

        # Serialize result
        if isinstance(result, pd.DataFrame):
            if len(result) > 5000:
                result = result.tail(5000)
            records = df_to_records(result)
            return {"data": records, "count": len(records), "columns": list(result.columns), "symbol": symbol}
        elif isinstance(result, pd.Series):
            data = {}
            for k, v in result.items():
                data[str(k)] = json_safe(v)
            return {"data": data, "symbol": symbol}
        elif isinstance(result, dict) or (hasattr(result, "keys") and hasattr(result, "__getitem__")):
            # info returns dicts; fast_info returns a lazy mapping-like object.
            clean = mapping_like_to_dict(result) or {}
            return {"data": clean, "symbol": symbol}
        elif hasattr(result, 'calls') and hasattr(result, 'puts'):
            # option_chain returns namedtuple with calls/puts DataFrames
            return {
                "calls": df_to_records(result.calls) if isinstance(result.calls, pd.DataFrame) else [],
                "puts": df_to_records(result.puts) if isinstance(result.puts, pd.DataFrame) else [],
                "symbol": symbol,
            }
        elif isinstance(result, (list, tuple)):
            return {"data": list(result), "symbol": symbol}
        else:
            return {"data": str(result), "symbol": symbol}
    except Exception as e:
        return JSONResponse({"error": str(e), "symbol": symbol}, 500)


@app.get("/yfinance")
def yfinance_help():
    """yfinance proxy help"""
    return {
        "message": "Use GET /yfinance/{action}?symbol=AAPL to call yfinance. Use /yfinance_search to list actions.",
        "examples": [
            "/yfinance/history?symbol=AAPL&period=1y",
            "/yfinance/info?symbol=AAPL",
            "/yfinance/financials?symbol=AAPL",
            "/yfinance/news?symbol=AAPL",
            "/yfinance/recommendations?symbol=AAPL",
        ],
    }


@app.get("/yfinance_search")
def yfinance_search(q: str = Query("")):
    """Search yfinance Ticker methods/properties"""
    t = yf.Ticker("AAPL")
    all_attrs = [m for m in dir(t) if not m.startswith('_') and m not in ('session', 'ticker', 'ws', 'live')]
    if q:
        matches = [a for a in all_attrs if q.lower() in a.lower()]
    else:
        matches = all_attrs
    return {"actions": matches, "total": len(all_attrs), "showing": len(matches)}


# --- Technical Analysis (pandas_ta) ---

@app.get("/ta/{indicator}")
def ta_indicator(indicator: str, request: Request):
    """
    Compute a technical indicator on stock data.
    Fetches kline data via AkShare, then computes the indicator using pandas_ta.

    Params:
      symbol (required) — stock code (A-share) or yfinance symbol
      period? — data period: 1y, 6mo, etc. (for yfinance) or start_date (for akshare)
      length? — indicator period length (default varies by indicator)
      Any extra params are passed to the pandas_ta indicator function.

    Examples:
      GET /ta/rsi?symbol=600519&length=14
      GET /ta/macd?symbol=600519
      GET /ta/bbands?symbol=AAPL&length=20
      GET /ta/sma?symbol=600519&length=20
      GET /ta/ema?symbol=600519&length=12
      GET /ta/atr?symbol=600519&length=14
      GET /ta/stoch?symbol=600519
      GET /ta/adx?symbol=600519
    """
    try:
        import pandas_ta as ta_lib
    except ImportError:
        return JSONResponse({"error": "pandas_ta not installed. Run: uv add pandas-ta"}, 500)

    symbol = request.query_params.get("symbol", "")
    if not symbol:
        return JSONResponse({"error": "symbol required. Example: /ta/rsi?symbol=600519"}, 400)

    # Check indicator exists
    ind_func = getattr(ta_lib, indicator, None)
    if ind_func is None or not callable(ind_func):
        categories = {}
        for cat in ta_lib.Category:
            categories[cat] = list(ta_lib.Category[cat])
        return JSONResponse({
            "error": f"Unknown indicator: {indicator}",
            "available_categories": categories,
            "hint": "Use /ta_search?q=rsi to find indicators",
        }, 404)

    extra = {k: v for k, v in request.query_params.items() if k not in ("symbol", "_priority")}
    priority = request.query_params.get("_priority", "interactive")

    # Fetch data
    try:
        is_global = any(c.isalpha() for c in symbol) and not symbol.isdigit()
        if is_global:
            period = extra.pop("period", "1y")
            df = yf_rate_limited_call(lambda: yf.Ticker(symbol).history(period=period), priority=priority)
            df.columns = [c.lower() for c in df.columns]
        else:
            df = stock_daily_dataframe(symbol, period="daily", adjust="qfq", limit=500, priority=priority)
            df = df.rename(columns={"开盘": "open", "最高": "high", "最低": "low", "收盘": "close", "成交量": "volume", "成交额": "amount"})
            for col in ["open", "high", "low", "close", "volume"]:
                if col in df.columns:
                    df[col] = pd.to_numeric(df[col], errors="coerce")
    except Exception as e:
        return JSONResponse({"error": f"Failed to fetch data for {symbol}: {e}"}, 500)

    if df is None or len(df) < 10:
        return JSONResponse({"error": f"Not enough data for {symbol} ({len(df) if df is not None else 0} bars)"}, 400)

    # Convert extra params to numeric where possible
    kwargs = {}
    for k, v in extra.items():
        try:
            kwargs[k] = int(v)
        except ValueError:
            try:
                kwargs[k] = float(v)
            except ValueError:
                kwargs[k] = v

    # Compute indicator
    try:
        result = df.ta.__getattribute__(indicator)(**kwargs)
        if result is None:
            return JSONResponse({"error": f"Indicator {indicator} returned None. Check params."}, 400)

        if isinstance(result, pd.DataFrame):
            records = df_to_records(result.tail(100))
            return {"indicator": indicator, "symbol": symbol, "params": kwargs, "data": records, "count": len(records), "columns": list(result.columns)}
        elif isinstance(result, pd.Series):
            values = result.tail(100).tolist()
            clean = [None if pd.isna(v) else round(float(v), 4) for v in values]
            return {"indicator": indicator, "symbol": symbol, "params": kwargs, "data": clean, "count": len(clean), "name": result.name}
        else:
            return {"indicator": indicator, "symbol": symbol, "data": str(result)}
    except Exception as e:
        # Provide helpful error with expected params
        import inspect
        try:
            sig = inspect.signature(ind_func)
            params_info = {k: str(v.annotation) if v.annotation != inspect.Parameter.empty else "any"
                          for k, v in sig.parameters.items() if k not in ("open_", "high", "low", "close", "volume", "self")}
        except:
            params_info = {}
        return JSONResponse({
            "error": str(e),
            "indicator": indicator,
            "expected_params": params_info,
            "hint": f"Check parameter names. Example: /ta/{indicator}?symbol=600519&length=14",
        }, 400)


@app.get("/ta")
def ta_help():
    """List available TA indicator categories"""
    try:
        import pandas_ta as ta_lib
        categories = {}
        for cat in ta_lib.Category:
            categories[cat] = list(ta_lib.Category[cat])
        return {"categories": categories, "usage": "GET /ta/{indicator}?symbol=600519&length=14"}
    except ImportError:
        return JSONResponse({"error": "pandas_ta not installed"}, 500)


@app.get("/ta_search")
def ta_search(q: str = Query("")):
    """Search technical analysis indicators"""
    try:
        import pandas_ta as ta_lib
        all_indicators = []
        for cat in ta_lib.Category:
            for ind in ta_lib.Category[cat]:
                all_indicators.append({"name": ind, "category": cat})
        if q:
            matches = [i for i in all_indicators if q.lower() in i["name"].lower() or q.lower() in i["category"].lower()]
        else:
            matches = all_indicators
        return {"indicators": matches, "total": len(all_indicators), "showing": len(matches)}
    except ImportError:
        return JSONResponse({"error": "pandas_ta not installed"}, 500)


# --- Sidecar Help ---

@app.get("/help")
def sidecar_help():
    """Overview of all sidecar capabilities"""
    return {
        "service": "FinData Sidecar v1.1",
        "data_sources": {
            "akshare": {
                "proxy": "/akshare/{function_name}",
                "search": "/akshare_search?q=keyword",
                "description": "A股全覆盖 (1000+ functions): 行情/K线/资金流/板块/基金/指数/宏观",
            },
            "yfinance": {
                "proxy": "/yfinance/{action}?symbol=AAPL",
                "search": "/yfinance_search?q=keyword",
                "description": "美股/港股 (100+ methods): K线/财报/分析师/新闻/期权/内部交易",
            },
            "technical_analysis": {
                "compute": "/ta/{indicator}?symbol=600519&length=14",
                "list": "/ta",
                "search": "/ta_search?q=keyword",
                "description": "技术指标计算 (130+): RSI/MACD/Bollinger/ATR/ADX/Stoch/Ichimoku...",
            },
        },
        "engines": {
            "backtest": {
                "run": "POST /backtest/run",
                "strategies": "GET /backtest/strategies",
                "help": "GET /backtest/help",
                "description": "回测引擎: 单股/组合/因子回测, 7种策略, 11种分析器, 佣金/滑点模型",
            },
            "screener": {
                "stock": "POST /screener/stock",
                "fund": "POST /screener/fund",
                "factors": "GET /screener/factors",
                "help": "GET /screener/help",
                "description": "选股引擎: 30+因子, gate过滤+打分排名, 基金4433规则, 合理估值",
            },
        },
        "convenience_endpoints": [
            "/quote?code=600519", "/kline?code=600519", "/fund/nav?code=110011",
            "/index/list", "/news", "/margin?code=600519", "/holders?code=600519",
            "/alpha/factors?code=600519", "/chip?code=600519",
        ],
        "rate_limiting": "/rate_limit/status",
        "health": "/health",
    }


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 19800
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
