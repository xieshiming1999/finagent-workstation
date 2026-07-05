"""Screener API routes."""
from __future__ import annotations
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/screener", tags=["screener"])


@router.post("/stock")
async def screen_stock(request: Request):
    """
    Screen stocks with gates (pass/fail) and optional scoring.

    Body:
    {
      "universe": {"market": null, "exclude_st": true, "min_market_cap": 5e9},
      "gates": [{"factor": "pe_ttm", "op": "between", "value": [5, 30]}],
      "scoring": {"weights": {"roe": 0.3, "pe_ttm": 0.2}, "normalize": "rank"},
      "sort_by": "composite_score",
      "limit": 30,
      "include_fair_value": false
    }
    """
    try:
        config = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, 400)

    from .stock_screener import StockScreener
    screener = StockScreener()

    import asyncio
    from concurrent.futures import ThreadPoolExecutor
    executor = ThreadPoolExecutor(max_workers=1)
    loop = asyncio.get_event_loop()

    try:
        result = await loop.run_in_executor(executor, screener.screen, config)
        return result
    except Exception as e:
        return JSONResponse({"error": str(e)}, 500)


@router.post("/fund")
async def screen_fund(request: Request):
    """
    Screen funds. Modes: 4433, custom, manager.

    Body:
    {
      "mode": "4433",
      "fund_type": "股票型",
      "min_aum": 1e8,
      "limit": 30
    }
    """
    try:
        config = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, 400)

    from .fund_screener import FundScreener
    screener = FundScreener()

    import asyncio
    from concurrent.futures import ThreadPoolExecutor
    executor = ThreadPoolExecutor(max_workers=1)
    loop = asyncio.get_event_loop()

    try:
        result = await loop.run_in_executor(executor, screener.screen, config)
        return result
    except Exception as e:
        return JSONResponse({"error": str(e)}, 500)


@router.post("/fair_value")
async def fair_value(request: Request):
    """Compute fair value for a stock."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, 400)

    code = body.get("code", "")
    if not code:
        return JSONResponse({"error": "code required"}, 400)

    from .stock_screener import StockScreener
    screener = StockScreener()
    return screener.fair_value(code)


@router.get("/factors")
def list_factors():
    """List all available screening factors."""
    from .factors import get_all_stock_factors, get_all_fund_factors
    return {
        "stock_factors": get_all_stock_factors(),
        "fund_factors": get_all_fund_factors(),
    }


@router.get("/help")
def screener_help():
    return {
        "endpoints": {
            "POST /screener/stock": "Stock screening with gates + scoring",
            "POST /screener/fund": "Fund screening (4433 / custom / manager)",
            "POST /screener/fair_value": "Fair value estimation for a stock",
            "GET /screener/factors": "List all available factors",
        },
        "stock_example": {
            "universe": {"exclude_st": True, "min_market_cap": 5e9},
            "gates": [
                {"factor": "pe_ttm", "op": "between", "value": [5, 30]},
                {"factor": "pb", "op": "<", "value": 5},
            ],
            "scoring": {
                "weights": {"pe_ttm": 0.2, "pb": 0.2, "turnover_rate": 0.1, "change_pct": 0.1, "market_cap": 0.4},
                "normalize": "rank",
            },
            "limit": 20,
        },
        "fund_example": {
            "mode": "4433",
            "fund_type": "股票型",
            "limit": 20,
        },
        "manager_example": {
            "mode": "manager",
            "min_experience": 5,
            "min_aum": 50,
            "limit": 20,
        },
    }
