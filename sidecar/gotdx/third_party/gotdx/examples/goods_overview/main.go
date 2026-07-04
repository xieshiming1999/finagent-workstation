package main

import (
	"log"

	"github.com/bensema/gotdx/examples/internal/exampleutil"
	"github.com/bensema/gotdx/types"
)

func main() {
	client := exampleutil.NewMACExClient()
	defer client.Disconnect()

	count, err := client.GoodsCount()
	if err != nil {
		log.Fatalln(err)
	}
	log.Printf("goods_count=%d", count)

	list, err := client.GoodsList(0, 5)
	if err != nil {
		log.Fatalln(err)
	}
	for _, item := range list {
		log.Printf("goods_list market=%d category=%d code=%s name=%s", item.Market, item.Category, item.Code, item.Name)
	}

	varieties, err := client.GoodsVarieties(uint16(types.ExCategoryCFFEXFutures), 0, 5)
	if err != nil {
		log.Fatalln(err)
	}
	for _, item := range varieties {
		log.Printf("goods_varieties category=%d name=%s index=%d switch=%d codes=[%.2f %.2f %.2f %d %d]",
			item.Category, item.Name, item.Index, item.Switch, item.Code1, item.Code2, item.Code3, item.Code4, item.Code5)
	}

	quotes, err := client.GoodsQuotes([]uint8{types.ExCategoryUSStock}, []string{"TSLA"})
	if err != nil {
		log.Fatalln(err)
	}
	for _, item := range quotes {
		log.Printf("goods_quotes market=%d code=%s close=%.2f pre_close=%.2f vol=%d", item.Category, item.Code, item.Close, item.PreClose, item.Vol)
	}

	bars, err := client.GoodsKLine(types.ExCategoryUSStock, "TSLA", types.KLINE_TYPE_DAILY, 0, 3, 1, types.AdjustNone)
	if err != nil {
		log.Fatalln(err)
	}
	for _, item := range bars {
		log.Printf("goods_kline date=%s open=%.2f high=%.2f low=%.2f close=%.2f", item.DateTime, item.Open, item.High, item.Low, item.Close)
	}
}
