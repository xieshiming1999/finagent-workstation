package proto

import (
	"bytes"
	"encoding/binary"
	"fmt"
)

// MACSymbolQuotes 表示 0x122B MAC 批量股票报价协议。
type MACSymbolQuotes struct {
	reqHeader  *ReqHeader
	respHeader *RespHeader
	request    *MACSymbolQuotesRequest
	reply      *MACSymbolQuotesReply
}

// MACSymbolQuoteStock 表示单个 MAC 批量报价查询目标。
type MACSymbolQuoteStock struct {
	Market uint16
	Code   [22]byte
}

// MACSymbolQuotesRequest 表示 MAC 批量股票报价请求。
type MACSymbolQuotesRequest struct {
	FieldBitmap [20]byte
	Stocks      []MACSymbolQuoteStock
}

// MACSymbolQuoteItem 表示单只股票的动态字段报价结果。
type MACSymbolQuoteItem struct {
	Name   string
	Market uint16
	Symbol string
	Values map[string]any
}

// MACSymbolQuotesReply 表示 MAC 批量股票报价响应。
type MACSymbolQuotesReply struct {
	FieldBitmap  [20]byte
	ActiveFields []MACDynamicFieldDef
	Count        uint16
	Total        uint32
	Stocks       []MACSymbolQuoteItem
}

// NewMACSymbolQuotes 创建 MAC 批量股票报价协议对象。
func NewMACSymbolQuotes(req *MACSymbolQuotesRequest) *MACSymbolQuotes {
	obj := &MACSymbolQuotes{
		reqHeader:  new(ReqHeader),
		respHeader: new(RespHeader),
		request:    new(MACSymbolQuotesRequest),
		reply:      new(MACSymbolQuotesReply),
	}
	obj.reqHeader.Zip = 0x0c
	obj.reqHeader.SeqID = seqID()
	obj.reqHeader.PacketType = 0x01
	obj.reqHeader.Method = KMSG_MACSYMBOLQUOTES
	obj.request.FieldBitmap = defaultMACBoardMembersQuotesFieldBitmap()
	if req != nil {
		obj.applyRequest(req)
	}
	return obj
}

func (obj *MACSymbolQuotes) applyRequest(req *MACSymbolQuotesRequest) {
	if req.FieldBitmap == ([20]byte{}) {
		req.FieldBitmap = defaultMACBoardMembersQuotesFieldBitmap()
	}
	obj.request = req
}

func (obj *MACSymbolQuotes) BuildRequest() ([]byte, error) {
	payload := new(bytes.Buffer)
	if _, err := payload.Write(obj.request.FieldBitmap[:]); err != nil {
		return nil, err
	}
	if err := binary.Write(payload, binary.LittleEndian, uint16(len(obj.request.Stocks))); err != nil {
		return nil, err
	}
	for _, stock := range obj.request.Stocks {
		if err := binary.Write(payload, binary.LittleEndian, stock.Market); err != nil {
			return nil, err
		}
		if err := binary.Write(payload, binary.LittleEndian, stock.Code); err != nil {
			return nil, err
		}
	}
	return buildExRequest(KMSG_MACSYMBOLQUOTES, payload.Bytes())
}

func (obj *MACSymbolQuotes) ParseResponse(header *RespHeader, data []byte) error {
	obj.respHeader = header
	if len(data) < 26 {
		return fmt.Errorf("invalid mac symbol quotes response length: %d", len(data))
	}

	copy(obj.reply.FieldBitmap[:], data[:20])
	obj.reply.Total = binary.LittleEndian.Uint32(data[20:24])
	obj.reply.Count = binary.LittleEndian.Uint16(data[24:26])
	obj.reply.ActiveFields = activeMACDynamicFields(obj.reply.FieldBitmap)

	rowLength := 68 + len(obj.reply.ActiveFields)*4
	pos := 26
	for i := uint16(0); i < obj.reply.Count; i++ {
		if pos+rowLength > len(data) {
			return fmt.Errorf("invalid mac symbol quote item %d", i)
		}
		row := data[pos : pos+rowLength]
		item := MACSymbolQuoteItem{
			Market: binary.LittleEndian.Uint16(row[:2]),
			Symbol: Utf8ToGbk(row[2:24]),
			Name:   Utf8ToGbk(row[24:68]),
			Values: make(map[string]any, len(obj.reply.ActiveFields)),
		}
		fieldPos := 68
		for _, field := range obj.reply.ActiveFields {
			raw := row[fieldPos : fieldPos+4]
			value := decodeMACDynamicValue(field.Format, raw)
			item.Values[field.Name] = value
			for _, alias := range field.Aliases {
				item.Values[alias] = value
			}
			fieldPos += 4
		}
		obj.reply.Stocks = append(obj.reply.Stocks, item)
		pos += rowLength
	}

	return nil
}

// Response 返回 MAC 批量股票报价响应。
func (obj *MACSymbolQuotes) Response() *MACSymbolQuotesReply {
	return obj.reply
}
