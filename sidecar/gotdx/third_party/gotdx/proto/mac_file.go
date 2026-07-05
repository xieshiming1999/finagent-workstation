package proto

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"strings"
)

// MACFileList 表示 0x1215 MAC 文件列表/元信息协议。
type MACFileList struct {
	reqHeader  *ReqHeader
	respHeader *RespHeader
	request    *MACFileListRequest
	reply      *MACFileListReply
}

// MACFileListRequest 表示 MAC 文件列表请求。
type MACFileListRequest struct {
	Offset   uint32
	Filename [70]byte
	Reserved [30]byte
}

// MACFileListReply 表示 MAC 文件列表响应。
type MACFileListReply struct {
	Offset uint32
	Size   uint32
	Flag   int8
	Hash   string
}

// NewMACFileList 创建 MAC 文件列表协议对象。
func NewMACFileList(req *MACFileListRequest) *MACFileList {
	obj := &MACFileList{
		reqHeader:  new(ReqHeader),
		respHeader: new(RespHeader),
		request:    new(MACFileListRequest),
		reply:      new(MACFileListReply),
	}
	obj.reqHeader.Zip = 0x0c
	obj.reqHeader.SeqID = seqID()
	obj.reqHeader.PacketType = 0x01
	obj.reqHeader.Method = KMSG_MACFILELIST
	if req != nil {
		obj.applyRequest(req)
	}
	return obj
}

func (obj *MACFileList) applyRequest(req *MACFileListRequest) {
	obj.request = req
}

func (obj *MACFileList) BuildRequest() ([]byte, error) {
	payload := new(bytes.Buffer)
	if err := binary.Write(payload, binary.LittleEndian, obj.request); err != nil {
		return nil, err
	}
	return buildExRequest(KMSG_MACFILELIST, payload.Bytes())
}

func (obj *MACFileList) ParseResponse(header *RespHeader, data []byte) error {
	obj.respHeader = header
	if len(data) < 41 {
		return fmt.Errorf("invalid mac file list response length: %d", len(data))
	}
	obj.reply.Offset = binary.LittleEndian.Uint32(data[:4])
	obj.reply.Size = binary.LittleEndian.Uint32(data[4:8])
	obj.reply.Flag = int8(data[8])
	obj.reply.Hash = strings.TrimRight(string(data[9:41]), "\x00")
	return nil
}

// Response 返回解析后的 MAC 文件列表响应。
func (obj *MACFileList) Response() *MACFileListReply {
	return obj.reply
}

// MACFileDownload 表示 0x1217 MAC 文件下载协议。
type MACFileDownload struct {
	reqHeader  *ReqHeader
	respHeader *RespHeader
	request    *MACFileDownloadRequest
	reply      *MACFileDownloadReply
}

// MACFileDownloadRequest 表示 MAC 文件下载请求。
type MACFileDownloadRequest struct {
	Index    uint32
	Offset   uint32
	Size     uint32
	Filename [70]byte
	Reserved [30]byte
}

// MACFileDownloadReply 表示 MAC 文件下载响应。
type MACFileDownloadReply struct {
	Index uint32
	Size  uint32
	Data  []byte
}

// NewMACFileDownload 创建 MAC 文件下载协议对象。
func NewMACFileDownload(req *MACFileDownloadRequest) *MACFileDownload {
	obj := &MACFileDownload{
		reqHeader:  new(ReqHeader),
		respHeader: new(RespHeader),
		request:    new(MACFileDownloadRequest),
		reply:      new(MACFileDownloadReply),
	}
	obj.reqHeader.Zip = 0x0c
	obj.reqHeader.SeqID = seqID()
	obj.reqHeader.PacketType = 0x01
	obj.reqHeader.Method = KMSG_MACFILEDOWNLOAD
	obj.request.Index = 1
	obj.request.Size = 30000
	if req != nil {
		obj.applyRequest(req)
	}
	return obj
}

func (obj *MACFileDownload) applyRequest(req *MACFileDownloadRequest) {
	if req.Index == 0 {
		req.Index = 1
	}
	if req.Size == 0 {
		req.Size = 30000
	}
	obj.request = req
}

func (obj *MACFileDownload) BuildRequest() ([]byte, error) {
	payload := new(bytes.Buffer)
	if err := binary.Write(payload, binary.LittleEndian, obj.request); err != nil {
		return nil, err
	}
	return buildExRequest(KMSG_MACFILEDOWNLOAD, payload.Bytes())
}

func (obj *MACFileDownload) ParseResponse(header *RespHeader, data []byte) error {
	obj.respHeader = header
	if len(data) < 8 {
		return fmt.Errorf("invalid mac file download response length: %d", len(data))
	}
	obj.reply.Index = binary.LittleEndian.Uint32(data[:4])
	obj.reply.Size = binary.LittleEndian.Uint32(data[4:8])
	obj.reply.Data = append([]byte(nil), data[8:]...)
	return nil
}

// Response 返回解析后的 MAC 文件下载响应。
func (obj *MACFileDownload) Response() *MACFileDownloadReply {
	return obj.reply
}
