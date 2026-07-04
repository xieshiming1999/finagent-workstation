package main

import (
	"log"

	"github.com/bensema/gotdx/examples/internal/exampleutil"
	"github.com/bensema/gotdx/types"
)

func main() {
	client := exampleutil.NewMACClient()
	defer client.Disconnect()

	items, err := client.MACSymbolBars(types.MarketSZ.Uint8(), "000001", types.KLINE_TYPE_DAILY, 1, 0, 10, types.AdjustNone)
	if err != nil {
		log.Fatalln(err)
	}

	for _, item := range items {
		log.Printf("mac_symbol_bars date=%s open=%.2f high=%.2f low=%.2f close=%.2f vol=%.2f",
			item.DateTime, item.Open, item.High, item.Low, item.Close, item.Vol)
	}
}
