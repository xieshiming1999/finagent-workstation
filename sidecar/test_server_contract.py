import ast
from pathlib import Path
import unittest
from unittest.mock import patch

import server
import pandas as pd


SERVER_PATH = Path(__file__).with_name("server.py")


def provider_map() -> dict[str, str]:
    tree = ast.parse(SERVER_PATH.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign):
            if any(isinstance(target, ast.Name) and target.id == "AKSHARE_PROVIDER_BY_FUNC" for target in node.targets):
                value = ast.literal_eval(node.value)
                if isinstance(value, dict):
                    return value
    raise AssertionError("AKSHARE_PROVIDER_BY_FUNC not found")


class SidecarProviderContractTest(unittest.TestCase):
    def test_eastmoney_provider_hint_accepts_runtime_fund_endpoints(self) -> None:
        mapping = provider_map()
        for func in [
            "stock_hk_spot_em",
            "stock_us_spot_em",
            "stock_individual_info_em",
            "fund_open_fund_rank_em",
            "fund_open_fund_info_em",
            "fund_portfolio_hold_em",
            "fund_manager_em",
            "fund_etf_spot_em",
            "fund_etf_hist_em",
        ]:
            self.assertEqual(mapping.get(func), "eastmoney", func)

    def test_quote_falls_back_to_sina_when_eastmoney_push2_fails(self) -> None:
        class Response:
            content = (
                'var hq_str_sh600519="贵州茅台,1250.00,1240.00,1260.00,1270.00,1245.00,'
                '0,0,1000000,1260000000,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,'
                '2026-06-12,15:00:00,00";'
            ).encode("gbk")

            def raise_for_status(self) -> None:
                return None

        with patch.object(server, "direct_eastmoney_quote", side_effect=RuntimeError("push2 blocked")), \
                patch.object(server._req, "get", return_value=Response()):
            row = server.quote("600519")

        self.assertEqual(row["provider"], "sina")
        self.assertEqual(row["fallbackFrom"], "eastmoney")
        self.assertEqual(row["code"], "600519")
        self.assertEqual(row["name"], "贵州茅台")
        self.assertEqual(row["price"], 1260.0)

    def test_direct_quote_uses_push2delay_host(self) -> None:
        class Response:
            def raise_for_status(self) -> None:
                return None

            def json(self):
                return {
                    "data": {
                        "f43": 1291.91,
                        "f44": 1295.0,
                        "f45": 1265.01,
                        "f46": 1271.18,
                        "f47": 50495,
                        "f48": 6477910214.0,
                        "f51": 21.7,
                        "f55": 21.79,
                        "f58": "贵州茅台",
                        "f60": 1279.0,
                        "f116": 1614992921147.9,
                        "f168": 0.4,
                        "f169": 12.91,
                        "f170": 1.01,
                    },
                }

        with patch.object(server._req, "get", return_value=Response()) as get:
            row = server.direct_eastmoney_quote("600519")

        self.assertIn("push2delay.eastmoney.com/api/qt/stock/get", get.call_args.args[0])
        self.assertEqual(row["provider"], "eastmoney")
        self.assertEqual(row["price"], 1291.91)

    def test_fund_etf_hist_falls_back_to_nav_history_rows(self) -> None:
        df = pd.DataFrame([
            {"净值日期": "2026-01-01", "单位净值": 1.0, "日增长率": 0.1},
            {"净值日期": "2026-06-12", "单位净值": 1.23, "日增长率": 1.2},
            {"净值日期": "2026-06-13", "单位净值": 1.24, "日增长率": 0.8},
        ])

        with patch.object(server, "rate_limited_call", return_value=df) as call:
            result = server.fund_etf_hist_em_direct({
                "symbol": "510300",
                "start_date": "20260601",
                "end_date": "20260612",
                "_priority": "background",
            })

        call.assert_called_once()
        self.assertEqual(result["provider"], "eastmoney")
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["data"][0], {
            "日期": "2026-06-12",
            "开盘": 1.23,
            "收盘": 1.23,
            "最高": 1.23,
            "最低": 1.23,
            "成交量": None,
            "成交额": None,
            "涨跌幅": 1.2,
            "单位净值": 1.23,
            "日增长率": 1.2,
        })

    def test_index_daily_uses_gotdx_index_bars_when_available(self) -> None:
        class Response:
            def raise_for_status(self) -> None:
                return None

            def json(self):
                return {
                    "List": [
                        {
                            "DateTime": "2026-01-01 00:00:00",
                            "Open": 4000.0,
                            "Close": 4010.0,
                            "High": 4020.0,
                            "Low": 3990.0,
                            "Vol": 100,
                            "Amount": 200,
                        },
                        {
                            "DateTime": "2026-06-12 00:00:00",
                            "Open": 4200.0,
                            "Close": 4210.0,
                            "High": 4220.0,
                            "Low": 4190.0,
                            "Vol": 300,
                            "Amount": 400,
                        },
                    ],
                }

        with patch.object(server._req, "get", return_value=Response()) as get:
            result = server.stock_zh_index_daily_em_direct({
                "symbol": "csi000300",
                "start_date": "20260601",
                "end_date": "20260612",
            })

        self.assertIn("127.0.0.1:19801/index_bars", get.call_args.args[0])
        self.assertEqual(get.call_args.kwargs["params"]["code"], "000300")
        self.assertEqual(get.call_args.kwargs["params"]["market"], "1")
        self.assertEqual(get.call_args.kwargs["params"]["count"], "800")
        self.assertEqual(result["provider"], "tdx")
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["data"][0]["date"], "2026-06-12")
        self.assertEqual(result["data"][0]["close"], 4210.0)

    def test_index_daily_refuses_push2his_fallback_when_gotdx_unavailable(self) -> None:
        with patch.object(server, "tdx_index_daily_records", side_effect=RuntimeError("gotdx down")):
            result = server.stock_zh_index_daily_em_direct({
                "symbol": "csi000300",
                "start_date": "20260601",
                "end_date": "20260612",
            })

        self.assertEqual(result.status_code, 503)
        body = result.body.decode("utf-8")
        self.assertIn("Refusing push2his fallback", body)
        self.assertIn("gotdx down", body)

    def test_stock_hist_uses_gotdx_kline_when_available(self) -> None:
        class Response:
            def raise_for_status(self) -> None:
                return None

            def json(self):
                return {
                    "List": [
                        {
                            "DateTime": "2026-01-01 00:00:00",
                            "Open": 1200.0,
                            "Close": 1210.0,
                            "High": 1220.0,
                            "Low": 1190.0,
                            "Vol": 100,
                            "Amount": 200,
                        },
                        {
                            "DateTime": "2026-06-12 00:00:00",
                            "Open": 1271.18,
                            "Close": 1291.91,
                            "High": 1295.0,
                            "Low": 1265.01,
                            "Vol": 300,
                            "Amount": 400,
                        },
                    ],
                }

        with patch.object(server._req, "get", return_value=Response()) as get:
            result = server.stock_zh_a_hist_direct({
                "symbol": "600519",
                "period": "daily",
                "start_date": "20260601",
                "end_date": "20260612",
            })

        self.assertIn("127.0.0.1:19801/kline", get.call_args.args[0])
        self.assertEqual(get.call_args.kwargs["params"]["code"], "600519")
        self.assertEqual(get.call_args.kwargs["params"]["market"], "1")
        self.assertEqual(get.call_args.kwargs["params"]["count"], "500")
        self.assertEqual(result["provider"], "tdx")
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["data"][0]["日期"], "2026-06-12")
        self.assertEqual(result["data"][0]["收盘"], 1291.91)

    def test_generic_stock_daily_dataframe_uses_tdx_before_akshare(self) -> None:
        with patch.object(server, "tdx_stock_daily_records", return_value=[
            {
                "日期": "2026-06-12",
                "开盘": 1271.18,
                "收盘": 1291.91,
                "最高": 1295.0,
                "最低": 1265.01,
                "成交量": 300,
                "成交额": 400,
            },
        ]), patch.object(server, "rate_limited_call") as akshare:
            df = server.stock_daily_dataframe("600519", limit=20, priority="background")

        akshare.assert_not_called()
        self.assertEqual(len(df), 1)
        self.assertEqual(float(df.iloc[0]["收盘"]), 1291.91)
        self.assertIn("涨跌幅", df.columns)
        self.assertIn("换手率", df.columns)

    def test_generic_kline_route_uses_shared_daily_dataframe(self) -> None:
        df = pd.DataFrame([{
            "日期": "2026-06-12",
            "开盘": 1271.18,
            "收盘": 1291.91,
            "最高": 1295.0,
            "最低": 1265.01,
            "成交量": 300,
            "成交额": 400,
            "涨跌幅": 1.01,
            "换手率": 0.4,
        }])

        with patch.object(server, "stock_daily_dataframe", return_value=df) as daily:
            result = server.kline("600519", limit=20)

        daily.assert_called_once()
        self.assertEqual(result["data"][0]["close"], 1291.91)
        self.assertEqual(result["data"][0]["changePct"], 1.01)

    def test_spot_wrapper_uses_push2delay_direct_route(self) -> None:
        class Response:
            def raise_for_status(self) -> None:
                return None

            def json(self):
                return {
                    "data": {
                        "diff": [{
                            "f12": "600519",
                            "f14": "贵州茅台",
                            "f2": 1291.91,
                            "f3": 1.01,
                            "f4": 12.91,
                            "f5": 100,
                            "f6": 200,
                        }],
                    },
                }

        with patch.object(server._req, "get", return_value=Response()) as get:
            result = server.eastmoney_spot_em_direct({"pz": "5"}, "a")

        self.assertIn("push2delay.eastmoney.com/api/qt/clist/get", get.call_args.args[0])
        self.assertEqual(get.call_args.kwargs["params"]["fs"], "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048")
        self.assertEqual(result["provider"], "eastmoney")
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["data"][0]["代码"], "600519")

    def test_concept_constituents_use_direct_board_code_route(self) -> None:
        class Response:
            def __init__(self, payload):
                self.payload = payload

            def raise_for_status(self) -> None:
                return None

            def json(self):
                return self.payload

        responses = [
            Response({"data": {"diff": [{"f12": "BK1234", "f14": "机器人概念"}]}}),
            Response({"data": {"diff": [{"f12": "002747", "f14": "埃斯顿", "f2": 36.92, "f3": -1.63}]}}),
        ]

        with patch.object(server._req, "get", side_effect=responses) as get:
            result = server.stock_board_concept_cons_em_direct({"symbol": "机器人概念", "pz": "5"})

        self.assertEqual(get.call_args_list[0].kwargs["params"]["fs"], "m:90 t:3 f:!50")
        self.assertEqual(get.call_args_list[1].kwargs["params"]["fs"], "b:BK1234 f:!50")
        self.assertEqual(result["provider"], "eastmoney")
        self.assertEqual(result["board_code"], "BK1234")
        self.assertEqual(result["data"][0]["代码"], "002747")

    def test_chip_route_uses_eastmoney_datacenter_directly(self) -> None:
        class Response:
            def raise_for_status(self) -> None:
                return None

            def json(self):
                return {
                    "result": {
                        "data": [{
                            "SECUCODE": "600519.SH",
                            "TRADE_DATE": "2026-06-12",
                            "AVG_COST": 1200.0,
                        }],
                    },
                }

        with patch.object(server._req, "get", return_value=Response()) as get:
            result = server.stock_chip_distribution_direct({"code": "600519", "limit": "5"})

        self.assertIn("datacenter-web.eastmoney.com/api/data/v1/get", get.call_args.args[0])
        self.assertEqual(get.call_args.kwargs["params"]["reportName"], "RPT_F10_CHIP_DISTRIBUTION")
        self.assertEqual(get.call_args.kwargs["params"]["filter"], '(SECUCODE="600519.SH")')
        self.assertEqual(result["provider"], "eastmoney")
        self.assertEqual(result["count"], 1)

    def test_stock_individual_fund_flow_uses_push2delay_ulist_snapshot(self) -> None:
        class Response:
            def raise_for_status(self) -> None:
                return None

            def json(self):
                return {
                    "data": {
                        "diff": [{
                            "f12": "600519",
                            "f2": 1291.91,
                            "f3": 1.01,
                            "f62": 500000,
                            "f184": 1.07,
                            "f66": 300000,
                            "f69": 1.38,
                            "f72": 200000,
                            "f75": 0.31,
                            "f78": -50000,
                            "f81": -1.05,
                            "f84": -10000,
                            "f87": -0.02,
                            "f124": 1781251908,
                        }],
                    },
                }

        with patch.object(server._req, "get", return_value=Response()) as get:
            result = server.stock_individual_fund_flow_direct({"stock": "600519"})

        self.assertIn("push2delay.eastmoney.com/api/qt/ulist.np/get", get.call_args.args[0])
        self.assertEqual(result["provider"], "eastmoney")
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["data"][0]["主力净流入-净额"], 500000)
        self.assertEqual(result["data"][0]["收盘价"], 1291.91)

    def test_limit_up_pool_uses_push2delay_quote_list_fallback(self) -> None:
        class Response:
            def raise_for_status(self) -> None:
                return None

            def json(self):
                return {
                    "data": {
                        "diff": [
                            {"f12": "600519", "f14": "贵州茅台", "f2": 1291.91, "f3": 10.01, "f6": 1000000, "f8": 1.2},
                            {"f12": "600036", "f14": "招商银行", "f2": 39.34, "f3": 1.58, "f6": 2000000, "f8": 0.8},
                        ],
                    },
                }

        with patch.object(server._req, "get", return_value=Response()) as get:
            result = server.stock_limit_pool_from_clist({"date": "20260612"}, "up")

        self.assertIn("push2delay.eastmoney.com/api/qt/clist/get", get.call_args.args[0])
        self.assertEqual(result["provider"], "eastmoney")
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["data"][0]["代码"], "600519")
        self.assertEqual(result["data"][0]["涨跌幅"], 10.01)


if __name__ == "__main__":
    unittest.main()
