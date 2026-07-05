package main

import (
	"log"

	"github.com/bensema/gotdx/examples/internal/exampleutil"
	"github.com/bensema/gotdx/types"
)

func main() {
	client := exampleutil.NewMainClient()
	defer client.Disconnect()

	items, err := client.StockTransaction(types.MarketSZ.Uint8(), "000001", 0, 20)
	if err != nil {
		log.Fatalln(err)
	}

	for _, item := range items {
		log.Printf("time=%s price=%.2f vol=%d num=%d action=%d",
			item.Time, item.Price, item.Vol, item.Num, item.BuyOrSell)
	}
}
