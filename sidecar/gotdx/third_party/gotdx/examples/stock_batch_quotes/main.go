package main

import (
	"log"

	"github.com/bensema/gotdx/examples/internal/exampleutil"
	"github.com/bensema/gotdx/types"
)

func main() {
	client := exampleutil.NewMainClient()
	defer client.Disconnect()

	items, err := client.StockQuotes(
		[]uint8{types.MarketSZ.Uint8(), types.MarketSH.Uint8(), types.MarketSZ.Uint8()},
		[]string{"000001", "600000", "300750"},
	)
	if err != nil {
		log.Fatalln(err)
	}

	for _, item := range items {
		log.Printf("market=%d code=%s price=%.2f change=%.2f vol=%d rise_speed=%.2f turnover=%.2f%%",
			item.Market, item.Code, item.Price, item.Price-item.PreClose, item.Vol, item.RiseSpeed, item.Turnover)
	}
}
