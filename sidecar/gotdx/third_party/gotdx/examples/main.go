package main

import (
	"log"

	"github.com/bensema/gotdx/examples/internal/exampleutil"
	"github.com/bensema/gotdx/types"
)

func main() {
	client := exampleutil.NewUnifiedClient()
	defer client.Disconnect()

	reply, err := client.StockQuotesDetail([]uint8{types.MarketSZ.Uint8(), types.MarketSH.Uint8()}, []string{"000001", "600008"})
	if err != nil {
		log.Fatalln(err)
	}

	for _, obj := range reply {
		log.Printf("%+v", obj)
	}

	exQuotes, err := client.ExQuotes([]uint8{types.ExCategoryUSStock}, []string{"TSLA"})
	if err != nil {
		log.Fatalln(err)
	}

	for _, obj := range exQuotes {
		log.Printf("%+v", obj)
	}
}
