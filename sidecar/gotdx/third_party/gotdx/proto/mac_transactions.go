package proto

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"math"
	"time"
)

// MACTransactions 表示 0x122F MAC 分时成交协议。
type MACTransactions struct {
	reqHeader  *ReqHeader
	respHeader *RespHeader
	request    *MACTransactionsRequest
	reply      *MACTransactionsReply
}

// MACTransactionsRequest 表示 MAC 分时成交请求。
type MACTransactionsRequest struct {
	Market    uint16
	Code      [22]byte
	QueryDate uint32
	Start     uint32
	Count     uint16
	Reserved  [10]byte
}

// MACTransactionsReply 表示 MAC 分时成交响应。
type MACTransactionsReply struct {
	Market    uint16
	Code      string
	QueryDate uint32
	Count     uint16
	Start     uint32
	Total     uint32
	List      []MACTransactionItem
}

// MACTransactionItem 表示单条 MAC 分时成交。
type MACTransactionItem struct {
	Time       string
	Price      float64
	Vol        uint32
	TradeCount uint32
	BuyOrSell  uint16
}

// NewMACTransactions 创建 MAC 分时成交协议对象。
func NewMACTransactions(req *MACTransactionsRequest) *MACTransactions {
	obj := &MACTransactions{
		reqHeader:  new(ReqHeader),
		respHeader: new(RespHeader),
		request:    new(MACTransactionsRequest),
		reply:      new(MACTransactionsReply),
	}
	obj.reqHeader.Zip = 0x0c
	obj.reqHeader.SeqID = seqID()
	obj.reqHeader.PacketType = 0x01
	obj.reqHeader.Method = KMSG_MACTRANSACTIONS
	obj.request.Count = 1000
	if req != nil {
		obj.applyRequest(req)
	}
	return obj
}

func (obj *MACTransactions) applyRequest(req *MACTransactionsRequest) {
	if req.Count == 0 {
		req.Count = 1000
	}
	obj.request = req
}

func (obj *MACTransactions) BuildRequest() ([]byte, error) {
	payload := new(bytes.Buffer)
	if err := binary.Write(payload, binary.LittleEndian, obj.request); err != nil {
		return nil, err
	}
	return buildExRequest(KMSG_MACTRANSACTIONS, payload.Bytes())
}

func (obj *MACTransactions) ParseResponse(header *RespHeader, data []byte) error {
	obj.respHeader = header
	if len(data) < 39 {
		return fmt.Errorf("invalid mac transactions response length: %d", len(data))
	}

	obj.reply.Market = binary.LittleEndian.Uint16(data[:2])
	obj.reply.Code = Utf8ToGbk(data[2:24])
	obj.reply.QueryDate = binary.LittleEndian.Uint32(data[24:28])
	obj.reply.Count = binary.LittleEndian.Uint16(data[29:31])
	obj.reply.Start = binary.LittleEndian.Uint32(data[31:35])
	obj.reply.Total = binary.LittleEndian.Uint32(data[35:39])

	pos := 39
	for i := uint16(0); i < obj.reply.Count; i++ {
		if pos+18 > len(data) {
			return fmt.Errorf("invalid mac transactions item %d", i)
		}
		seconds := binary.LittleEndian.Uint32(data[pos : pos+4])
		obj.reply.List = append(obj.reply.List, MACTransactionItem{
			Time:       time.Date(0, 1, 1, int(seconds/3600)%24, int((seconds%3600)/60), int(seconds%60), 0, time.Local).Format("15:04:05"),
			Price:      float64(math.Float32frombits(binary.LittleEndian.Uint32(data[pos+4 : pos+8]))),
			Vol:        binary.LittleEndian.Uint32(data[pos+8 : pos+12]),
			TradeCount: binary.LittleEndian.Uint32(data[pos+12 : pos+16]),
			BuyOrSell:  binary.LittleEndian.Uint16(data[pos+16 : pos+18]),
		})
		pos += 18
	}
	return nil
}

// Response 返回解析后的 MAC 分时成交响应。
func (obj *MACTransactions) Response() *MACTransactionsReply {
	return obj.reply
}
