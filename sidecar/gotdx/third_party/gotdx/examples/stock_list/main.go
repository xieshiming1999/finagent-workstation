package main

import (
	"log"

	"github.com/bensema/gotdx/examples/internal/exampleutil"
	"github.com/bensema/gotdx/types"
)

func main() {
	client := exampleutil.NewMainClient()
	defer client.Disconnect()

	items, err := client.StockList(types.MarketSZ.Uint8(), 0, 20)
	if err != nil {
		log.Fatalln(err)
	}

	for _, item := range items {
		log.Printf("code=%s name=%s pre_close=%.2f vol_unit=%d", item.Code, item.Name, item.PreClose, item.VolUnit)
	}
}
