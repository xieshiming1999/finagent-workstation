package main

import (
	"log"

	"github.com/bensema/gotdx/examples/internal/exampleutil"
)

func main() {
	client := exampleutil.NewMACClient()
	defer client.Disconnect()

	meta, err := client.MACFileList("StockInfo.dat", 0)
	if err != nil {
		log.Fatalln(err)
	}
	log.Printf("mac_file_list offset=%d size=%d flag=%d hash=%s", meta.Offset, meta.Size, meta.Flag, meta.Hash)

	content, err := client.MACDownloadFullFile("StockInfo.dat", 1, meta.Size)
	if err != nil {
		log.Fatalln(err)
	}
	log.Printf("mac_file_download bytes=%d", len(content))
}
