package main

import (
	"log"

	"github.com/bensema/gotdx/examples/internal/exampleutil"
	"github.com/bensema/gotdx/types"
)

func main() {
	client := exampleutil.NewMACClient()
	defer client.Disconnect()

	reply, err := client.MACSymbolInfo(types.MarketSZ.Uint8(), "000001")
	if err != nil {
		log.Fatalln(err)
	}

	log.Printf("mac_symbol_info code=%s name=%s time=%s close=%.2f pre_close=%.2f activity=%d turnover=%.2f vr=%.2f",
		reply.Code, reply.Name, reply.DateTime, reply.Close, reply.PreClose, reply.Activity, reply.Turnover, reply.VR)
}
