package main

import (
	"log"

	"github.com/bensema/gotdx/examples/internal/exampleutil"
	"github.com/bensema/gotdx/types"
)

func main() {
	client := exampleutil.NewMACClient()
	defer client.Disconnect()

	reply, err := client.MACTickCharts(types.MarketSZ.Uint8(), "000001", 0, 3)
	if err != nil {
		log.Fatalln(err)
	}

	log.Printf("mac_tick_charts code=%s name=%s time=%s close=%.2f days=%d",
		reply.Code, reply.Name, reply.DateTime, reply.Close, len(reply.Charts))

	for _, day := range reply.Charts {
		log.Printf("day=%s pre_close=%.2f ticks=%d", day.Date, day.PreClose, len(day.Ticks))
		for _, item := range day.Ticks[:min(3, len(day.Ticks))] {
			log.Printf("tick time=%s price=%.2f avg=%.2f vol=%d",
				item.Time, item.Price, item.Avg, item.Vol)
		}
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
