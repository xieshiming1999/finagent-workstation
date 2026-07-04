package main

import (
	"log"

	"github.com/bensema/gotdx/examples/internal/exampleutil"
	"github.com/bensema/gotdx/types"
)

func main() {
	client := exampleutil.NewExClient()
	defer client.Disconnect()

	items, err := client.ExKLine2(types.ExCategoryUSStock, "TSLA", types.KLINE_TYPE_DAILY, 0, 10, 1)
	if err != nil {
		log.Fatalln(err)
	}

	for _, item := range items {
		log.Printf("ex_kline2 date=%s open=%.2f high=%.2f low=%.2f close=%.2f vol=%d",
			item.DateTime, item.Open, item.High, item.Low, item.Close, item.Vol)
	}
}
