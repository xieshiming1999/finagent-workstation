package main

import (
	"log"

	"github.com/bensema/gotdx/examples/internal/exampleutil"
	"github.com/bensema/gotdx/types"
)

func main() {
	client := exampleutil.NewMACClient()
	defer client.Disconnect()

	items, err := client.MACTransactions(types.MarketSZ.Uint8(), "000001", 0, 20)
	if err != nil {
		log.Fatalln(err)
	}

	for _, item := range items {
		log.Printf("mac_transactions time=%s price=%.2f vol=%d trade_count=%d action=%d",
			item.Time, item.Price, item.Vol, item.TradeCount, item.BuyOrSell)
	}
}
