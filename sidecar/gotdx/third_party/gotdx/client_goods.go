package gotdx

import (
	"fmt"

	"github.com/bensema/gotdx/proto"
)

const (
	// DefaultGoodsHistoryTransactionCount 是 GoodsHistoryTransaction 的默认历史成交条数。
	DefaultGoodsHistoryTransactionCount uint32 = 2000
	// MaxGoodsVarietiesCount 是 GoodsVarieties 单次请求的最大条数。
	MaxGoodsVarietiesCount uint32 = 1000
)

// GoodsCount 获取扩展市场商品总数。
func (client *Client) GoodsCount() (uint32, error) {
	return client.ExCount()
}

// GoodsCategoryList 获取扩展市场商品分类列表。
func (client *Client) GoodsCategoryList() ([]proto.ExCategoryItem, error) {
	return client.ExCategoryList()
}

// GoodsList 获取扩展市场商品列表。
func (client *Client) GoodsList(start uint32, count uint16) ([]proto.ExListItem, error) {
	return client.ExList(start, count)
}

// GoodsVarieties 获取扩展市场品种列表。
func (client *Client) GoodsVarieties(market uint16, start uint32, count uint32) ([]proto.ExMapping2562Item, error) {
	if count > MaxGoodsVarietiesCount {
		return nil, fmt.Errorf("goods varieties count exceeds %d: %d", MaxGoodsVarietiesCount, count)
	}
	return client.ExMapping2562(market, start, count)
}

// GoodsQuote 获取单个扩展市场商品报价。
func (client *Client) GoodsQuote(market uint8, code string) (*proto.ExQuoteItem, error) {
	return client.ExQuote(market, code)
}

// GoodsQuotes 获取批量扩展市场商品报价。
func (client *Client) GoodsQuotes(markets []uint8, codes []string) ([]proto.ExQuoteItem, error) {
	return client.ExQuotes(markets, codes)
}

// GoodsQuotesList 获取扩展市场商品行情列表。
func (client *Client) GoodsQuotesList(market uint8, start uint16, count uint16, sortType uint16, reverse bool) ([]proto.ExQuoteItem, error) {
	return client.ExQuotesList(market, start, count, sortType, reverse)
}

// GoodsKLine 获取扩展市场商品 MAC K 线。
func (client *Client) GoodsKLine(market uint8, code string, period uint16, start uint32, count uint32, times uint16, adjust uint16) ([]proto.MACSymbolBar, error) {
	return client.MACSymbolBars(market, code, period, times, start, count, adjust)
}

// GoodsTickChart 获取扩展市场商品分时图；queryDate 为 0 时获取实时分时。
func (client *Client) GoodsTickChart(market uint8, code string, queryDate uint32) ([]proto.MACQuoteChartItem, error) {
	reply, err := client.MACQuotesWithDate(market, code, queryDate)
	if err != nil {
		return nil, err
	}
	return reply.ChartData, nil
}

// GoodsChartSampling 获取扩展市场商品分时缩略采样。
func (client *Client) GoodsChartSampling(market uint8, code string) ([]float64, error) {
	return client.ExChartSampling(market, code)
}

// GoodsHistoryTransaction 获取扩展市场商品历史成交；count 为 0 时默认取 2000 条。
func (client *Client) GoodsHistoryTransaction(market uint8, code string, queryDate uint32, count uint32) ([]proto.MACTransactionItem, error) {
	if count == 0 {
		count = DefaultGoodsHistoryTransactionCount
	}
	return client.MACTransactionsWithDate(market, code, 0, count, queryDate)
}
