package gotdx

import (
	"testing"

	"github.com/bensema/gotdx/proto"
)

type goodsAPI interface {
	GoodsCount() (uint32, error)
	GoodsCategoryList() ([]proto.ExCategoryItem, error)
	GoodsList(start uint32, count uint16) ([]proto.ExListItem, error)
	GoodsVarieties(market uint16, start uint32, count uint32) ([]proto.ExMapping2562Item, error)
	GoodsQuote(market uint8, code string) (*proto.ExQuoteItem, error)
	GoodsQuotes(markets []uint8, codes []string) ([]proto.ExQuoteItem, error)
	GoodsQuotesList(market uint8, start uint16, count uint16, sortType uint16, reverse bool) ([]proto.ExQuoteItem, error)
	GoodsKLine(market uint8, code string, period uint16, start uint32, count uint32, times uint16, adjust uint16) ([]proto.MACSymbolBar, error)
	GoodsTickChart(market uint8, code string, queryDate uint32) ([]proto.MACQuoteChartItem, error)
	GoodsChartSampling(market uint8, code string) ([]float64, error)
	GoodsHistoryTransaction(market uint8, code string, queryDate uint32, count uint32) ([]proto.MACTransactionItem, error)
}

func TestClientImplementsGoodsAPI(t *testing.T) {
	var _ goodsAPI = (*Client)(nil)
}

func TestGoodsVarietiesCountLimit(t *testing.T) {
	client := New()
	if _, err := client.GoodsVarieties(47, 0, MaxGoodsVarietiesCount+1); err == nil {
		t.Fatal("expected count limit error")
	}
}
