package proto

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"strings"
)

// MACMarketMonitor 表示 0x1237 MAC 市场监控协议。
type MACMarketMonitor struct {
	reqHeader  *ReqHeader
	respHeader *RespHeader
	request    *MACMarketMonitorRequest
	reply      *MACMarketMonitorReply
}

// MACMarketMonitorRequest 表示 MAC 市场监控请求。
type MACMarketMonitorRequest struct {
	Market    uint16
	Start     uint16
	Reserved1 uint16
	Count     uint16
	Reserved2 uint16
	Mode      uint16
	Limits    [5]uint16
}

// MACMarketMonitorReply 表示 MAC 市场监控响应。
type MACMarketMonitorReply struct {
	Count uint16
	List  []MACMarketMonitorItem
}

// MACMarketMonitorItem 表示单条 MAC 市场监控数据。
type MACMarketMonitorItem struct {
	Index       uint16
	Market      uint16
	Code        string
	Name        string
	Time        string
	Desc        string
	Value       string
	UnusualType uint8
	V1          uint8
	V2          float64
	V3          float64
	V4          float64
}

func defaultMACMarketMonitorLimits() [5]uint16 {
	return [5]uint16{200, 30, 40, 50, 200}
}

// NewMACMarketMonitor 创建 MAC 市场监控协议对象。
func NewMACMarketMonitor(req *MACMarketMonitorRequest) *MACMarketMonitor {
	obj := &MACMarketMonitor{
		reqHeader:  new(ReqHeader),
		respHeader: new(RespHeader),
		request:    new(MACMarketMonitorRequest),
		reply:      new(MACMarketMonitorReply),
	}
	obj.reqHeader.Zip = 0x0c
	obj.reqHeader.SeqID = seqID()
	obj.reqHeader.PacketType = 0x01
	obj.reqHeader.Method = KMSG_MACMARKETMONITOR
	obj.request.Count = 600
	obj.request.Mode = 1
	obj.request.Limits = defaultMACMarketMonitorLimits()
	if req != nil {
		obj.applyRequest(req)
	}
	return obj
}

func (obj *MACMarketMonitor) applyRequest(req *MACMarketMonitorRequest) {
	if req.Count == 0 {
		req.Count = 600
	}
	if req.Mode == 0 {
		req.Mode = 1
	}
	if req.Limits == ([5]uint16{}) {
		req.Limits = defaultMACMarketMonitorLimits()
	}
	obj.request = req
}

func (obj *MACMarketMonitor) BuildRequest() ([]byte, error) {
	payload := new(bytes.Buffer)
	if err := binary.Write(payload, binary.LittleEndian, obj.request); err != nil {
		return nil, err
	}
	return buildExRequest(KMSG_MACMARKETMONITOR, payload.Bytes())
}

func (obj *MACMarketMonitor) ParseResponse(header *RespHeader, data []byte) error {
	obj.respHeader = header
	if len(data) < 2 {
		return fmt.Errorf("invalid mac market monitor response length: %d", len(data))
	}
	if err := binary.Read(bytes.NewReader(data[:2]), binary.LittleEndian, &obj.reply.Count); err != nil {
		return err
	}

	for i := uint16(0); i < obj.reply.Count; i++ {
		base := int(i)*32 + 2
		if base+32 > len(data) {
			return io.ErrUnexpectedEOF
		}
		payload := data[base+15 : base+28]
		v1 := payload[0]
		v2 := float64(math.Float32frombits(binary.LittleEndian.Uint32(payload[1:5])))
		v3 := float64(math.Float32frombits(binary.LittleEndian.Uint32(payload[5:9])))
		v4 := float64(math.Float32frombits(binary.LittleEndian.Uint32(payload[9:13])))
		desc, value := unpackUnusualByType(data[base+9], payload)

		item := MACMarketMonitorItem{
			Index:       binary.LittleEndian.Uint16(data[base+11 : base+13]),
			Market:      binary.LittleEndian.Uint16(data[base : base+2]),
			Code:        Utf8ToGbk(data[base+2 : base+8]),
			Time:        fmt.Sprintf("%02d:%02d:%02d", int(data[base+29]), int(binary.LittleEndian.Uint16(data[base+30:base+32]))/100, int(binary.LittleEndian.Uint16(data[base+30:base+32]))%100),
			Desc:        desc,
			Value:       value,
			UnusualType: data[base+9],
			V1:          v1,
			V2:          v2,
			V3:          v3,
			V4:          v4,
		}
		obj.reply.List = append(obj.reply.List, item)
	}

	binaryLength := 2 + int(obj.reply.Count)*32
	if binaryLength >= len(data) {
		return nil
	}

	names := strings.Trim(Utf8ToGbk(data[binaryLength:]), ",")
	if names == "" {
		return nil
	}
	parts := strings.Split(names, ",")
	for i := range obj.reply.List {
		if i < len(parts) {
			obj.reply.List[i].Name = parts[i]
		}
	}
	return nil
}

// Response 返回解析后的 MAC 市场监控响应。
func (obj *MACMarketMonitor) Response() *MACMarketMonitorReply {
	return obj.reply
}
