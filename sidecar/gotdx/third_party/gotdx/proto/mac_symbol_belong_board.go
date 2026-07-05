package proto

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"strconv"
)

type MACSymbolBelongBoard struct {
	reqHeader  *ReqHeader
	respHeader *RespHeader
	request    *MACSymbolBelongBoardRequest
	reply      *MACSymbolBelongBoardReply
}

type MACSymbolBelongBoardRequest struct {
	Market   uint16
	Symbol   [8]byte
	Reserved [16]byte
	Query    [21]byte
}

type MACSymbolBelongBoardReply struct {
	Market uint16
	Query  string
	List   []MACBelongBoardItem
}

type MACBelongBoardItem struct {
	BoardType     string
	MarketCode    int
	StatusCode    int
	BoardCode     string
	BoardName     string
	Price         float64
	PreClose      float64
	SchemaColumns int

	LimitUpCount   float64
	LimitDownCount float64
	MostSimilar    float64

	SpeedPct       float64
	SymbolMarket   int
	Symbol         string
	SymbolName     string
	SymbolClose    float64
	SymbolPreClose float64
	SymbolSpeedPct float64

	Metric1 float64
	Metric2 float64
	Metric3 float64
}

func NewMACSymbolBelongBoard(req *MACSymbolBelongBoardRequest) *MACSymbolBelongBoard {
	obj := &MACSymbolBelongBoard{
		reqHeader:  new(ReqHeader),
		respHeader: new(RespHeader),
		request:    new(MACSymbolBelongBoardRequest),
		reply:      new(MACSymbolBelongBoardReply),
	}
	obj.reqHeader.Zip = 0x0c
	obj.reqHeader.SeqID = seqID()
	obj.reqHeader.PacketType = 0x01
	obj.reqHeader.Method = KMSG_MACSYMBOLBELONGBOARD
	obj.request.Query = makeMACCode21("Stock_GLHQ")
	if req != nil {
		obj.applyRequest(req)
	}
	return obj
}

func (obj *MACSymbolBelongBoard) applyRequest(req *MACSymbolBelongBoardRequest) {
	if req.Query == ([21]byte{}) {
		req.Query = makeMACCode21("Stock_GLHQ")
	}
	obj.request = req
}

func (obj *MACSymbolBelongBoard) BuildRequest() ([]byte, error) {
	payload := new(bytes.Buffer)
	if err := binary.Write(payload, binary.LittleEndian, obj.request); err != nil {
		return nil, err
	}
	return buildExRequest(KMSG_MACSYMBOLBELONGBOARD, payload.Bytes())
}

func (obj *MACSymbolBelongBoard) ParseResponse(header *RespHeader, data []byte) error {
	obj.respHeader = header
	if len(data) < 27 {
		return fmt.Errorf("invalid mac belong board response length: %d", len(data))
	}

	obj.reply.Market = binary.LittleEndian.Uint16(data[:2])
	obj.reply.Query = Utf8ToGbk(data[2:14])

	var rows [][]interface{}
	if err := json.Unmarshal([]byte(Utf8ToGbk(data[27:])), &rows); err != nil {
		return err
	}

	for _, row := range rows {
		if len(row) < 9 {
			continue
		}
		item := MACBelongBoardItem{
			BoardType:     anyToString(row[0]),
			MarketCode:    anyToInt(row[1]),
			BoardCode:     anyToString(row[2]),
			BoardName:     anyToString(row[3]),
			Price:         anyToFloat64(row[4]),
			PreClose:      anyToFloat64(row[5]),
			SchemaColumns: len(row),
		}
		item.StatusCode = item.MarketCode

		switch len(row) {
		case 9:
			item.LimitUpCount = anyToFloat64(row[6])
			item.LimitDownCount = anyToFloat64(row[7])
			item.MostSimilar = anyToFloat64(row[8])
			item.Metric1 = item.LimitUpCount
			item.Metric2 = item.LimitDownCount
			item.Metric3 = item.MostSimilar
		case 13:
			item.SpeedPct = anyToFloat64(row[6])
			item.SymbolMarket = anyToInt(row[7])
			item.Symbol = anyToString(row[8])
			item.SymbolName = anyToString(row[9])
			item.SymbolClose = anyToFloat64(row[10])
			item.SymbolPreClose = anyToFloat64(row[11])
			item.SymbolSpeedPct = anyToFloat64(row[12])
			item.Metric1 = item.SpeedPct
			item.Metric2 = item.SymbolClose
			item.Metric3 = item.SymbolSpeedPct
		default:
			item.Metric1 = anyToFloat64(row[6])
			item.Metric2 = anyToFloat64(row[7])
			item.Metric3 = anyToFloat64(row[8])
		}
		obj.reply.List = append(obj.reply.List, item)
	}

	return nil
}

func (obj *MACSymbolBelongBoard) Response() *MACSymbolBelongBoardReply {
	return obj.reply
}

func anyToString(v interface{}) string {
	switch value := v.(type) {
	case string:
		return value
	case float64:
		return strconv.FormatFloat(value, 'f', -1, 64)
	case json.Number:
		return value.String()
	default:
		return fmt.Sprint(value)
	}
}

func anyToInt(v interface{}) int {
	switch value := v.(type) {
	case float64:
		return int(value)
	case json.Number:
		i, _ := value.Int64()
		return int(i)
	case string:
		i, _ := strconv.Atoi(value)
		return i
	default:
		return 0
	}
}

func anyToFloat64(v interface{}) float64 {
	switch value := v.(type) {
	case float64:
		return value
	case json.Number:
		f, _ := value.Float64()
		return f
	case string:
		f, _ := strconv.ParseFloat(value, 64)
		return f
	default:
		return 0
	}
}
