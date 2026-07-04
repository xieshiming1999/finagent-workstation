package main

import (
	"log"

	"github.com/bensema/gotdx/examples/internal/exampleutil"
	"github.com/bensema/gotdx/types"
)

func main() {
	client := exampleutil.NewMainClient()
	defer client.Disconnect()

	items, err := client.StockKLineOffset(types.KLINE_TYPE_DAILY, types.MarketSZ.Uint8(), "000001", 0, 10, 1, types.AdjustNone)
	if err != nil {
		log.Fatalln(err)
	}

	for _, item := range items {
		log.Printf("kline_offset date=%s open=%.2f high=%.2f low=%.2f close=%.2f vol=%.2f turnover=%.2f%%",
			item.DateTime, item.Open, item.High, item.Low, item.Close, item.Vol, item.Turnover)
	}
}
