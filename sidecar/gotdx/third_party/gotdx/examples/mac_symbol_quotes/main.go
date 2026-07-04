package main

import (
	"log"

	"github.com/bensema/gotdx"
	"github.com/bensema/gotdx/examples/internal/exampleutil"
	"github.com/bensema/gotdx/types"
)

func main() {
	client := exampleutil.NewMACClient()
	defer client.Disconnect()

	reply, err := client.MACSymbolQuotes(
		[]uint8{types.MarketSZ.Uint8(), types.MarketSH.Uint8()},
		[]string{"000001", "600000"},
		gotdx.DefaultMACSymbolQuotesFieldBitmap(),
	)
	if err != nil {
		log.Fatalln(err)
	}

	log.Printf("mac_symbol_quotes total=%d count=%d fields=%d bitmap=%x",
		reply.Total, reply.Count, len(reply.ActiveFields), reply.FieldBitmap)

	for _, item := range reply.Stocks[:min(5, len(reply.Stocks))] {
		log.Printf("market=%d symbol=%s name=%s close=%v pre_close=%v turnover=%v pe_ttm=%v",
			item.Market,
			item.Symbol,
			item.Name,
			item.Values["close"],
			item.Values["pre_close"],
			item.Values["turnover"],
			item.Values["pe_ttm"],
		)
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
