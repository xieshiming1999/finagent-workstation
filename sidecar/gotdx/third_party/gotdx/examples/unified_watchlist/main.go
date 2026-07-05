package main

import (
	"log"

	"github.com/bensema/gotdx/examples/internal/exampleutil"
	"github.com/bensema/gotdx/types"
)

func main() {
	client := exampleutil.NewUnifiedClient()
	defer client.Disconnect()

	stockItems, err := client.StockQuotesDetail(
		[]uint8{types.MarketSZ.Uint8(), types.MarketSH.Uint8(), types.MarketSZ.Uint8()},
		[]string{"000001", "600000", "300750"},
	)
	if err != nil {
		log.Fatalln(err)
	}
	for _, item := range stockItems {
		log.Printf("stock code=%s time=%s price=%.2f open=%.2f high=%.2f low=%.2f vol=%d turnover=%.2f%%",
			item.Code, item.ServerTime, item.Price, item.Open, item.High, item.Low, item.Vol, item.Turnover)
	}

	bars, err := client.StockKLine(types.KLINE_TYPE_DAILY, types.MarketSZ.Uint8(), "000001", 0, 5, 1, types.AdjustNone)
	if err != nil {
		log.Fatalln(err)
	}
	for _, item := range bars {
		log.Printf("stock_kline time=%s close=%.2f vol=%.0f turnover=%.2f%%", item.DateTime, item.Close, item.Vol, item.Turnover)
	}

	exItems, err := client.ExQuotes(
		[]uint8{types.ExCategoryUSStock, types.ExCategoryHKStock},
		[]string{"TSLA", "09988"},
	)
	if err != nil {
		log.Fatalln(err)
	}
	for _, item := range exItems {
		log.Printf("ex code=%s date=%s close=%.2f high=%.2f low=%.2f vol=%d",
			item.Code, item.Date, item.Close, item.High, item.Low, item.Vol)
	}

	samples, err := client.ExChartSampling(types.ExCategoryUSStock, "TSLA")
	if err != nil {
		log.Fatalln(err)
	}
	for i, price := range samples[:min(10, len(samples))] {
		log.Printf("ex_sample index=%d price=%.2f", i, price)
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
