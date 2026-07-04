package main

import (
	"log"

	"github.com/bensema/gotdx/examples/internal/exampleutil"
	"github.com/bensema/gotdx/types"
)

func main() {
	client := exampleutil.NewMainClient()
	defer client.Disconnect()

	items, err := client.StockQuotesDetail(
		[]uint8{types.MarketSZ.Uint8(), types.MarketSH.Uint8()},
		[]string{"000001", "600000"},
	)
	if err != nil {
		log.Fatalln(err)
	}

	for _, item := range items {
		log.Printf("%s %s price=%.2f open=%.2f high=%.2f low=%.2f vol=%d turnover=%.2f%%",
			item.Code, item.ServerTime, item.Price, item.Open, item.High, item.Low, item.Vol, item.Turnover)
	}
}
