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

	reply, err := client.MACBoardMembersQuotesDynamic(
		"880761",
		10,
		types.SortChangePct,
		uint8(types.SortOrderDesc),
		gotdx.MACFieldBitmap(gotdx.MACPresetCommon),
	)
	if err != nil {
		log.Fatalln(err)
	}

	log.Printf("mac_member_quote_dynamic total=%d count=%d fields=%d bitmap=%x",
		reply.Total, reply.Count, len(reply.ActiveFields), reply.FieldBitmap)

	for _, item := range reply.Stocks[:min(5, len(reply.Stocks))] {
		log.Printf("symbol=%s name=%s close=%v pre_close=%v turnover=%v pe_ttm=%v",
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
