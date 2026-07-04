package main

import (
	"fmt"
	"log"

	"github.com/bensema/gotdx/examples/internal/exampleutil"
	"github.com/bensema/gotdx/types"
)

func main() {
	client := exampleutil.NewMACClient()
	defer client.Disconnect()
	BoardType := types.BoardTypeAll
	count, _err := client.MACBoardCount(BoardType)
	if _err != nil {
		log.Fatalln(_err)
	}

	items, err := client.MACBoardList(BoardType, uint32(count))
	if err != nil {
		log.Fatalln(err)
	}

	for _, item := range items {
		log.Printf("mac_board code=%s name=%s price=%.2f rise_speed=%.2f symbol=%s/%s",
			item.Code, item.Name, item.Price, item.RiseSpeed, item.SymbolCode, item.SymbolName)
	}
	fmt.Println(count)

}
