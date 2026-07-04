package main

import (
	"log"

	"github.com/bensema/gotdx/examples/internal/exampleutil"
	"github.com/bensema/gotdx/types"
)

func main() {
	client := exampleutil.NewMACClient()
	defer client.Disconnect()

	items, err := client.MACSymbolBelongBoard("000001", types.MarketSZ.Uint8())
	if err != nil {
		log.Fatalln(err)
	}

	for _, item := range items {
		log.Printf("mac_belong_board type=%s code=%s name=%s price=%.2f pre_close=%.2f",
			item.BoardType, item.BoardCode, item.BoardName, item.Price, item.PreClose)
	}
}
