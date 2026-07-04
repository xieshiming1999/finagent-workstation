package main

import (
	"log"

	"github.com/bensema/gotdx/examples/internal/exampleutil"
	"github.com/bensema/gotdx/types"
)

func main() {
	client := exampleutil.NewMainClient()
	defer client.Disconnect()

	for _, market := range []struct {
		name   string
		market uint8
	}{
		{name: "SZ", market: types.MarketSZ.Uint8()},
		{name: "SH", market: types.MarketSH.Uint8()},
		{name: "BJ", market: types.MarketBJ.Uint8()},
	} {
		count, err := client.StockCount(market.market)
		if err != nil {
			log.Fatalf("%s count failed: %v", market.name, err)
		}
		log.Printf("market=%s count=%d", market.name, count)
	}
}
