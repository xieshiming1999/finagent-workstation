package proto

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"time"
)

type Hello1 struct {
	reqHeader  *ReqHeader
	respHeader *RespHeader
	request    *Hello1Request
	reply      *Hello1Reply

	contentHex string
}

type Hello1Request struct {
}

type Hello1Reply struct {
	Info       string
	DateTime   string
	ServerName string
	Website    string
	Category   string
}

func NewHello1() *Hello1 {
	obj := new(Hello1)
	obj.reqHeader = new(ReqHeader)
	obj.respHeader = new(RespHeader)
	obj.request = new(Hello1Request)
	obj.reply = new(Hello1Reply)

	obj.reqHeader.Zip = 0x0c
	obj.reqHeader.SeqID = seqID()
	obj.reqHeader.PacketType = 0x01
	obj.reqHeader.Method = KMSG_CMD1
	obj.contentHex = "01"
	return obj
}

func (obj *Hello1) BuildRequest() ([]byte, error) {
	b, err := hex.DecodeString(obj.contentHex)

	obj.reqHeader.PkgLen1 = 2 + uint16(len(b))
	obj.reqHeader.PkgLen2 = 2 + uint16(len(b))

	buf := new(bytes.Buffer)
	err = binary.Write(buf, binary.LittleEndian, obj.reqHeader)

	buf.Write(b)
	return buf.Bytes(), err
}

/*
00e60708051 50 f0 00 d3 a02b2020c03840384038403840384033a02b2020c0384038403840384038403 00 5a8a3401 f94a0100 5a8a3401 fd4a0100ff00e 700000101013f

	分  时    秒                                                                      日期
*/
func (obj *Hello1) ParseResponse(header *RespHeader, data []byte) error {
	obj.respHeader = header
	if len(data) < 189 {
		return fmt.Errorf("invalid hello1 response length: %d", len(data))
	}

	year := binary.LittleEndian.Uint16(data[1:3])
	day := int(data[3])
	month := int(data[4])
	minute := int(data[5])
	hour := int(data[6])
	second := int(data[8])

	obj.reply.DateTime = time.Date(
		int(year),
		time.Month(month),
		day,
		hour,
		minute,
		second,
		0,
		time.Local,
	).Format("2006-01-02 15:04:05")
	obj.reply.ServerName = Utf8ToGbk(data[67:89])
	obj.reply.Website = Utf8ToGbk(data[89:153])
	obj.reply.Category = Utf8ToGbk(data[159:189])
	obj.reply.Info = Utf8ToGbk(data[67:])
	return nil
}

func (obj *Hello1) Response() *Hello1Reply {
	return obj.reply
}
