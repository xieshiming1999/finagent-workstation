package main

import (
	"log"

	"github.com/bensema/gotdx"
	"github.com/bensema/gotdx/examples/internal/exampleutil"
)

func main() {
	client := exampleutil.NewMACClient()
	defer client.Disconnect()

	reply, err := client.MACKLineOffset(0, gotdx.DefaultMACKLineOffsetCount)
	if err != nil {
		log.Fatalln(err)
	}

	log.Printf("mac_kline_offset total=%d returned=%d", reply.Total, reply.Returned)
}
