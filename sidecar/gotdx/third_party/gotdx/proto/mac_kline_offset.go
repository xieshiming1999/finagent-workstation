package proto

import (
	"bytes"
	"encoding/binary"
	"fmt"
)

// MACKLineOffset 表示 0x124A MAC K线偏移信息协议。
type MACKLineOffset struct {
	reqHeader  *ReqHeader
	respHeader *RespHeader
	request    *MACKLineOffsetRequest
	reply      *MACKLineOffsetReply
}

// MACKLineOffsetRequest 表示 MAC K线偏移信息请求。
type MACKLineOffsetRequest struct {
	Offset   uint32
	Count    uint32
	Reserved [5]byte
}

// MACKLineOffsetReply 表示 MAC K线偏移信息响应。
type MACKLineOffsetReply struct {
	Total    uint32
	Returned uint32
}

// NewMACKLineOffset 创建 MAC K线偏移信息协议对象。
func NewMACKLineOffset(req *MACKLineOffsetRequest) *MACKLineOffset {
	obj := &MACKLineOffset{
		reqHeader:  new(ReqHeader),
		respHeader: new(RespHeader),
		request:    &MACKLineOffsetRequest{Count: 128000},
		reply:      new(MACKLineOffsetReply),
	}
	obj.reqHeader.Zip = 0x0c
	obj.reqHeader.SeqID = seqID()
	obj.reqHeader.PacketType = 0x01
	obj.reqHeader.Method = KMSG_MACKLINEOFFSET
	if req != nil {
		obj.applyRequest(req)
	}
	return obj
}

func (obj *MACKLineOffset) applyRequest(req *MACKLineOffsetRequest) {
	if req.Count == 0 {
		req.Count = 128000
	}
	obj.request = req
}

func (obj *MACKLineOffset) BuildRequest() ([]byte, error) {
	payload := new(bytes.Buffer)
	if err := binary.Write(payload, binary.LittleEndian, obj.request); err != nil {
		return nil, err
	}
	return buildExRequest(KMSG_MACKLINEOFFSET, payload.Bytes())
}

func (obj *MACKLineOffset) ParseResponse(header *RespHeader, data []byte) error {
	obj.respHeader = header
	if len(data) < 8 {
		return fmt.Errorf("invalid mac kline offset response length: %d", len(data))
	}
	obj.reply.Total = binary.BigEndian.Uint32(data[:4])
	obj.reply.Returned = binary.LittleEndian.Uint32(data[4:8])
	return nil
}

// Response 返回解析后的 MAC K线偏移信息响应。
func (obj *MACKLineOffset) Response() *MACKLineOffsetReply {
	return obj.reply
}
