"""Backtest API routes."""
from __future__ import annotations
import time
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
import pandas as pd

router = APIRouter(prefix="/backtest", tags=["backtest"])


def _load_data(data_cfg: dict) -> dict[str, pd.DataFrame]:
    """Load kline data: local SQLite first, then AkShare/yfinance fallback."""
    import akshare as ak
    import yfinance as yf
    from local_cache import get_local_cache

    codes = data_cfg.get("codes", [])
    source = data_cfg.get("source", "auto")
    start = data_cfg.get("start")
    end = data_cfg.get("end")
    cache = get_local_cache(data_cfg.get("db_path"))
    result = {}

    for code in codes:
        try:
            df = None

            # Try local cache first (unless source explicitly set)
            if source in ("auto", "local"):
                local_df = cache.query_kline(code, start=start, end=end)
                if local_df is not None and len(local_df) > 50:
                    local_df = local_df.rename(columns={
                        "change_pct": "change_pct", "turnover_rate": "turnover_rate"
                    })
                    for col in ["open", "high", "low", "close", "volume"]:
                        if col in local_df.columns:
                            local_df[col] = pd.to_numeric(local_df[col], errors="coerce")
                    df = local_df

            # Fallback to remote
            if df is None or len(df) < 10:
                if source == "yfinance" or any(c.isalpha() for c in code):
                    ticker = yf.Ticker(code)
                    kwargs = {}
                    if start:
                        kwargs["start"] = start
                    if end:
                        kwargs["end"] = end
                    if not start and not end:
                        kwargs["period"] = "5y"
                    df = ticker.history(**kwargs)
                    df = df.reset_index()
                    df.columns = [c.lower() for c in df.columns]
                    if "date" in df.columns:
                        df["date"] = df["date"].astype(str).str[:10]
                else:
                    df = ak.stock_zh_a_hist(symbol=code, period="daily", adjust="qfq")
                    rename = {"日期": "date", "开盘": "open", "最高": "high", "最低": "low",
                              "收盘": "close", "成交量": "volume", "成交额": "amount"}
                    df = df.rename(columns=rename)
                    for col in ["open", "high", "low", "close", "volume"]:
                        if col in df.columns:
                            df[col] = pd.to_numeric(df[col], errors="coerce")
                    df["date"] = df["date"].astype(str)
                    if start:
                        df = df[df["date"] >= start]
                    if end:
                        df = df[df["date"] <= end]

            if df is not None and len(df) > 0:
                result[code] = df.reset_index(drop=True)
        except Exception:
            pass

    return result


def _run_backtest_sync(config: dict) -> dict:
    """Run backtest synchronously (called in executor)."""
    from .engine import Cerebro
    from .strategy import create_strategy, STRATEGY_REGISTRY
    from .analyzers import create_analyzers

    t0 = time.time()
    mode = config.get("mode", "single")

    if mode == "factor":
        from .factor_backtest import FactorBacktest
        fb = FactorBacktest(config.get("factor_config", config.get("data", {})))
        result = fb.run()
        result["elapsed_seconds"] = round(time.time() - t0, 2)
        return result

    data_cfg = config.get("data", {})
    data = _load_data(data_cfg)
    if not data:
        return {"status": "error", "error": "Failed to load data for any code"}

    strategy_cfg = config.get("strategy", {})
    strategy_name = strategy_cfg.get("name", "rsi")
    strategy_params = strategy_cfg.get("params", {})

    try:
        strategy = create_strategy(strategy_name, strategy_params)
    except ValueError as e:
        return {"status": "error", "error": str(e)}

    analyzer_names = config.get("analyzers")
    analyzers = create_analyzers(analyzer_names)

    cerebro = Cerebro(config)
    for code, df in data.items():
        cerebro.add_data(code, df)

    benchmark_cfg = config.get("benchmark")
    if benchmark_cfg:
        bench_code = benchmark_cfg.get("code", "000300")
        try:
            import akshare as ak
            bench_df = ak.stock_zh_index_daily_em(symbol=bench_code)
            rename = {"日期": "date", "开盘": "open", "最高": "high", "最低": "low", "收盘": "close", "成交量": "volume"}
            bench_df = bench_df.rename(columns=rename)
            for col in ["open", "high", "low", "close", "volume"]:
                if col in bench_df.columns:
                    bench_df[col] = pd.to_numeric(bench_df[col], errors="coerce")
            bench_df["date"] = bench_df["date"].astype(str)
            start = data_cfg.get("start")
            if start:
                bench_df = bench_df[bench_df["date"] >= start]
            cerebro.set_benchmark(bench_df.reset_index(drop=True), bench_code)
        except Exception:
            pass

    cerebro.set_strategy(strategy)
    cerebro.set_analyzers(analyzers)

    result = cerebro.run()
    result["elapsed_seconds"] = round(time.time() - t0, 2)
    result["strategy"] = strategy_name
    result["codes"] = list(data.keys())
    return result


@router.post("/run")
async def run_backtest(request: Request):
    """Run a backtest. Modes: single, portfolio, factor."""
    try:
        config = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON body"}, 400)

    import asyncio
    from concurrent.futures import ThreadPoolExecutor
    executor = ThreadPoolExecutor(max_workers=2)
    loop = asyncio.get_event_loop()

    try:
        result = await loop.run_in_executor(executor, _run_backtest_sync, config)
        return result
    except Exception as e:
        return JSONResponse({"error": str(e)}, 500)


@router.get("/strategies")
def list_strategies():
    """List available built-in strategies with their default parameters."""
    from .strategy import STRATEGY_INFO
    return {"strategies": STRATEGY_INFO}


@router.get("/help")
def backtest_help():
    return {
        "usage": "POST /backtest/run with JSON config",
        "modes": ["single", "portfolio", "factor"],
        "portfolio_note": "For portfolio mode, funds are split equally among all codes. Each stock gets initial_cash / len(codes).",
        "config_example": {
            "mode": "single",
            "data": {"codes": ["600519"], "start": "2022-01-01"},
            "strategy": {"name": "rsi", "params": {"period": 14, "oversold": 30, "overbought": 70}},
            "broker": {
                "initial_cash": 1000000,
                "commission": {"fixed": 5, "pct": 0.0003, "stamp_tax_pct": 0.001},
                "slippage": {"pct": 0.0005},
            },
            "position_sizing": {"type": "percent_of_cash", "value": 0.95},
            "allow_short": False,
            "benchmark": {"code": "000300"},
            "analyzers": ["total_return", "sharpe", "max_drawdown", "win_rate", "trade_count"],
        },
        "factor_example": {
            "mode": "factor",
            "factor_config": {
                "expression": "close / sma(close, 20) - 1",
                "codes": ["600519", "000858", "601318"],
                "start": "2022-01-01",
                "quantiles": 5,
                "rebalance_days": 20,
            },
        },
    }


@router.post("/screen_then_backtest")
async def screen_then_backtest(request: Request):
    """
    Pipeline: screen stocks first, then backtest the top N.
    Body: {screen_config: {...}, backtest_config: {...}, top_n: 10}
    """
    try:
        config = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, 400)

    import asyncio
    from concurrent.futures import ThreadPoolExecutor
    executor = ThreadPoolExecutor(max_workers=2)
    loop = asyncio.get_event_loop()

    try:
        result = await loop.run_in_executor(executor, _screen_then_backtest_sync, config)
        return result
    except Exception as e:
        return JSONResponse({"error": str(e)}, 500)


def _screen_then_backtest_sync(config: dict) -> dict:
    """Screen → pick top N → backtest each."""
    import time
    t0 = time.time()

    from screener.stock_screener import StockScreener
    screen_cfg = config.get("screen_config", {})
    backtest_cfg = config.get("backtest_config", {})
    top_n = config.get("top_n", 10)

    screener = StockScreener()
    screen_cfg["limit"] = top_n
    screen_result = screener.screen(screen_cfg)

    if screen_result.get("status") == "error":
        return screen_result

    stocks = screen_result.get("stocks", [])
    codes = [s["code"] for s in stocks if s.get("code")]
    if not codes:
        return {"status": "error", "error": "No stocks passed screening"}

    backtest_cfg.setdefault("data", {})["codes"] = codes
    backtest_cfg.setdefault("mode", "portfolio" if len(codes) > 1 else "single")

    bt_result = _run_backtest_sync(backtest_cfg)
    bt_result["screened_stocks"] = [{"code": s["code"], "name": s["name"], "score": s.get("composite_score")} for s in stocks]
    bt_result["screen_summary"] = {
        "total_universe": screen_result.get("total_universe"),
        "passed_gates": screen_result.get("passed_gates"),
        "selected": len(codes),
    }
    bt_result["elapsed_seconds"] = round(time.time() - t0, 2)
    return bt_result
