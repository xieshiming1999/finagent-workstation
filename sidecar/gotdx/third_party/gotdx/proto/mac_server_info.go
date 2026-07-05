package proto

import (
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"strings"
)

// MACServerInfo 表示 0x120F MAC 服务端交易日时段协议。
type MACServerInfo struct {
	reqHeader  *ReqHeader
	respHeader *RespHeader
	request    *MACServerInfoRequest
	reply      *MACServerInfoReply
}

// MACServerInfoRequest 表示 MAC 服务端信息请求。
type MACServerInfoRequest struct {
	Payload [68]byte
}

// MACTradingSession 表示一段交易时段。
type MACTradingSession struct {
	OpenMinutes  uint16
	CloseMinutes uint16
	Open         string
	Close        string
}

// MACServerInfoReply 表示 MAC 服务端信息响应。
type MACServerInfoReply struct {
	Count           uint16
	FlagsHex        string
	Tag             string
	Today           string
	TS1             uint32
	Sessions1       []MACTradingSession
	Sessions2       []MACTradingSession
	Flag            uint8
	LastTradingDay  string
	TS2             uint32
	LastTradingDay2 string
	TS3             uint32
	MarketParam1    uint32
	MarketParam2    uint32
	ExtraHex        string
}

// NewMACServerInfo 创建 MAC 服务端信息协议对象。
func NewMACServerInfo(req *MACServerInfoRequest) *MACServerInfo {
	obj := &MACServerInfo{
		reqHeader:  new(ReqHeader),
		respHeader: new(RespHeader),
		request:    new(MACServerInfoRequest),
		reply:      new(MACServerInfoReply),
	}
	obj.reqHeader.Zip = 0x0c
	obj.reqHeader.SeqID = seqID()
	obj.reqHeader.PacketType = 0x01
	obj.reqHeader.Method = KMSG_MACSERVERINFO
	obj.request.Payload = defaultMACServerInfoPayload()
	if req != nil {
		obj.applyRequest(req)
	}
	return obj
}

func (obj *MACServerInfo) applyRequest(req *MACServerInfoRequest) {
	if req.Payload == ([68]byte{}) {
		req.Payload = defaultMACServerInfoPayload()
	}
	obj.request = req
}

func defaultMACServerInfoPayload() [68]byte {
	var payload [68]byte
	copy(payload[:4], []byte{0x04, 0x00, 0x2d, 0x31})
	copy(payload[12:16], []byte{0x00, 0x27, 0x06, 0x0e})
	return payload
}

func (obj *MACServerInfo) BuildRequest() ([]byte, error) {
	return buildExRequest(KMSG_MACSERVERINFO, obj.request.Payload[:])
}

func (obj *MACServerInfo) ParseResponse(header *RespHeader, data []byte) error {
	obj.respHeader = header
	if len(data) < 87 {
		return fmt.Errorf("invalid mac server info response length: %d", len(data))
	}

	pos := 0
	obj.reply.Count = binary.LittleEndian.Uint16(data[pos : pos+2])
	pos += 2
	obj.reply.FlagsHex = hex.EncodeToString(data[pos : pos+8])
	pos += 8
	obj.reply.Tag = strings.TrimRight(string(data[pos:pos+3]), "\x00")
	pos += 3
	pos += 9

	obj.reply.Today = formatMACServerDate(binary.LittleEndian.Uint32(data[pos : pos+4]))
	pos += 4
	obj.reply.TS1 = binary.LittleEndian.Uint32(data[pos : pos+4])
	pos += 4
	obj.reply.Sessions1 = parseMACTradingSessions(data[pos : pos+16])
	pos += 16
	obj.reply.Sessions2 = parseMACTradingSessions(data[pos : pos+16])
	pos += 16
	obj.reply.Flag = data[pos]
	pos++
	obj.reply.LastTradingDay = formatMACServerDate(binary.LittleEndian.Uint32(data[pos : pos+4]))
	pos += 4
	obj.reply.TS2 = binary.LittleEndian.Uint32(data[pos : pos+4])
	pos += 4
	obj.reply.LastTradingDay2 = formatMACServerDate(binary.LittleEndian.Uint32(data[pos : pos+4]))
	pos += 4
	obj.reply.TS3 = binary.LittleEndian.Uint32(data[pos : pos+4])
	pos += 4
	obj.reply.MarketParam1 = binary.LittleEndian.Uint32(data[pos : pos+4])
	pos += 4
	obj.reply.MarketParam2 = binary.LittleEndian.Uint32(data[pos : pos+4])
	pos += 4
	if pos < len(data) {
		obj.reply.ExtraHex = hex.EncodeToString(data[pos:])
	}
	return nil
}

func parseMACTradingSessions(data []byte) []MACTradingSession {
	sessions := make([]MACTradingSession, 0, 4)
	for i := 0; i+4 <= len(data); i += 4 {
		openMinutes := binary.LittleEndian.Uint16(data[i : i+2])
		closeMinutes := binary.LittleEndian.Uint16(data[i+2 : i+4])
		sessions = append(sessions, MACTradingSession{
			OpenMinutes:  openMinutes,
			CloseMinutes: closeMinutes,
			Open:         formatMACSessionTime(openMinutes),
			Close:        formatMACSessionTime(closeMinutes),
		})
	}
	return sessions
}

func formatMACSessionTime(minutes uint16) string {
	return fmt.Sprintf("%d:%02d", minutes/60, minutes%60)
}

func formatMACServerDate(raw uint32) string {
	return fmt.Sprintf("%04d-%02d-%02d", raw/10000, (raw%10000)/100, raw%100)
}

// Response 返回解析后的 MAC 服务端信息响应。
func (obj *MACServerInfo) Response() *MACServerInfoReply {
	return obj.reply
}
