package proto

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
)

// MACCapitalFlow 表示 0x1218 head=2 MAC 资金流向协议。
type MACCapitalFlow struct {
	reqHeader  *ReqHeader
	respHeader *RespHeader
	request    *MACCapitalFlowRequest
	reply      *MACCapitalFlowReply
}

// MACCapitalFlowRequest 表示 MAC 资金流向请求。
type MACCapitalFlowRequest struct {
	Market   uint16
	Symbol   [8]byte
	Reserved [16]byte
	Query    [21]byte
}

// MACCapitalFlowReply 表示 MAC 资金流向响应。
type MACCapitalFlowReply struct {
	Market           uint16
	QueryInfo        string
	Ext              string
	Today            []float64
	FiveDays         []float64
	TodayMainIn      float64
	TodayMainOut     float64
	TodayRetailIn    float64
	TodayRetailOut   float64
	TodayMainNetIn   float64
	TodayRetailNetIn float64
	FiveDayMainBuy   float64
	FiveDayMainSell  float64
	FiveDaySuperNet  float64
	FiveDayLargeNet  float64
	FiveDayMediumNet float64
	FiveDaySmallNet  float64
	FiveDayMainNetIn float64
}

// NewMACCapitalFlow 创建 MAC 资金流向协议对象。
func NewMACCapitalFlow(req *MACCapitalFlowRequest) *MACCapitalFlow {
	obj := &MACCapitalFlow{
		reqHeader:  new(ReqHeader),
		respHeader: new(RespHeader),
		request:    new(MACCapitalFlowRequest),
		reply:      new(MACCapitalFlowReply),
	}
	obj.reqHeader.Zip = 0x0c
	obj.reqHeader.SeqID = seqID()
	obj.reqHeader.PacketType = 0x01
	obj.reqHeader.Method = KMSG_MACCAPITALFLOW
	obj.request.Query = makeMACCode21("Stock_ZJLX")
	if req != nil {
		obj.applyRequest(req)
	}
	return obj
}

func (obj *MACCapitalFlow) applyRequest(req *MACCapitalFlowRequest) {
	if req.Query == ([21]byte{}) {
		req.Query = makeMACCode21("Stock_ZJLX")
	}
	obj.request = req
}

func (obj *MACCapitalFlow) BuildRequest() ([]byte, error) {
	payload := new(bytes.Buffer)
	if err := binary.Write(payload, binary.LittleEndian, obj.request); err != nil {
		return nil, err
	}
	return buildGenericRequest(0x02, 0, 0x01, KMSG_MACCAPITALFLOW, payload.Bytes())
}

func (obj *MACCapitalFlow) ParseResponse(header *RespHeader, data []byte) error {
	obj.respHeader = header
	if len(data) < 27 {
		return fmt.Errorf("invalid mac capital flow response length: %d", len(data))
	}

	obj.reply.Market = binary.LittleEndian.Uint16(data[:2])
	obj.reply.QueryInfo = Utf8ToGbk(data[2:14])
	obj.reply.Ext = Utf8ToGbk(data[19:27])

	var rows [][]interface{}
	if err := json.Unmarshal(data[27:], &rows); err != nil {
		return err
	}
	if len(rows) > 0 {
		obj.reply.Today = convertAnySliceToFloat64(rows[0])
	}
	if len(rows) > 1 {
		obj.reply.FiveDays = convertAnySliceToFloat64(rows[1])
	}
	if len(obj.reply.Today) >= 4 {
		obj.reply.TodayMainIn = obj.reply.Today[0]
		obj.reply.TodayMainOut = obj.reply.Today[1]
		obj.reply.TodayRetailIn = obj.reply.Today[2]
		obj.reply.TodayRetailOut = obj.reply.Today[3]
		obj.reply.TodayMainNetIn = obj.reply.TodayMainIn - obj.reply.TodayMainOut
		obj.reply.TodayRetailNetIn = obj.reply.TodayRetailIn - obj.reply.TodayRetailOut
	}
	if len(obj.reply.FiveDays) >= 6 {
		obj.reply.FiveDayMainBuy = obj.reply.FiveDays[0]
		obj.reply.FiveDayMainSell = obj.reply.FiveDays[1]
		obj.reply.FiveDaySuperNet = obj.reply.FiveDays[2]
		obj.reply.FiveDayLargeNet = obj.reply.FiveDays[3]
		obj.reply.FiveDayMediumNet = obj.reply.FiveDays[4]
		obj.reply.FiveDaySmallNet = obj.reply.FiveDays[5]
		obj.reply.FiveDayMainNetIn = obj.reply.FiveDayMainBuy - obj.reply.FiveDayMainSell
	}
	return nil
}

// Response 返回解析后的 MAC 资金流向响应。
func (obj *MACCapitalFlow) Response() *MACCapitalFlowReply {
	return obj.reply
}

func convertAnySliceToFloat64(values []interface{}) []float64 {
	out := make([]float64, 0, len(values))
	for _, value := range values {
		out = append(out, anyToFloat64(value))
	}
	return out
}
