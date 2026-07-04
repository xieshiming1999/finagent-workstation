package main

import (
	"log"

	"github.com/bensema/gotdx/examples/internal/exampleutil"
)

func main() {
	client := exampleutil.NewMACClient()
	defer client.Disconnect()

	reply, err := client.MACServerInfo()
	if err != nil {
		log.Fatalln(err)
	}

	log.Printf("mac_server_info today=%s last_trading_day=%s sessions1=%v sessions2=%v flag=%d params=%d/%d",
		reply.Today, reply.LastTradingDay, reply.Sessions1, reply.Sessions2, reply.Flag, reply.MarketParam1, reply.MarketParam2)
}
