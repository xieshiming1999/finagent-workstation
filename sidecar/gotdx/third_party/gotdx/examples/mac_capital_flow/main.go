package main

import (
	"log"

	"github.com/bensema/gotdx/examples/internal/exampleutil"
	"github.com/bensema/gotdx/types"
)

func main() {
	client := exampleutil.NewMACClient()
	defer client.Disconnect()

	reply, err := client.MACCapitalFlow(types.MarketSZ.Uint8(), "000001")
	if err != nil {
		log.Fatalln(err)
	}

	log.Printf("mac_capital_flow query=%s ext=%s today_main_net_in=%.2f today_retail_net_in=%.2f five_day_main_net_in=%.2f",
		reply.QueryInfo, reply.Ext, reply.TodayMainNetIn, reply.TodayRetailNetIn, reply.FiveDayMainNetIn)
}
