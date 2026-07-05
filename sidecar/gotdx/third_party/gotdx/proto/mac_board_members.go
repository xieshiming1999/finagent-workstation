package proto

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"math"
)

type MACBoardMembers struct {
	reqHeader  *ReqHeader
	respHeader *RespHeader
	request    *MACBoardMembersRequest
	reply      *MACBoardMembersReply
}

type MACBoardMembersRequest struct {
	BoardCode uint32
	Reserved1 [9]byte
	SortType  uint16
	Start     uint32
	PageSize  uint8
	Zero      uint8
	SortOrder uint16
	Extra     [20]byte
}

type MACBoardMembersReply struct {
	Name   string
	Count  uint16
	Total  uint32
	Stocks []MACBoardMemberItem
}

type MACBoardMemberItem struct {
	Name   string
	Market uint16
	Symbol string
}

func NewMACBoardMembers(req *MACBoardMembersRequest) *MACBoardMembers {
	obj := &MACBoardMembers{
		reqHeader:  new(ReqHeader),
		respHeader: new(RespHeader),
		request:    new(MACBoardMembersRequest),
		reply:      new(MACBoardMembersReply),
	}
	obj.reqHeader.Zip = 0x0c
	obj.reqHeader.SeqID = seqID()
	obj.reqHeader.PacketType = 0x01
	obj.reqHeader.Method = KMSG_MACBOARDMEMBERS
	obj.request.SortType = 14
	obj.request.PageSize = 80
	obj.request.SortOrder = 1
	if req != nil {
		obj.applyRequest(req)
	}
	return obj
}

func (obj *MACBoardMembers) applyRequest(req *MACBoardMembersRequest) {
	if req.PageSize == 0 {
		req.PageSize = 80
	}
	if req.SortType == 0 {
		req.SortType = 14
	}
	if req.SortOrder == 0 {
		req.SortOrder = 1
	}
	obj.request = req
}

func (obj *MACBoardMembers) BuildRequest() ([]byte, error) {
	payload := new(bytes.Buffer)
	if err := binary.Write(payload, binary.LittleEndian, obj.request); err != nil {
		return nil, err
	}
	return buildExRequest(KMSG_MACBOARDMEMBERS, payload.Bytes())
}

func (obj *MACBoardMembers) ParseResponse(header *RespHeader, data []byte) error {
	obj.respHeader = header
	if len(data) < 26 {
		return fmt.Errorf("invalid mac board members response length: %d", len(data))
	}

	obj.reply.Name = Utf8ToGbk(data[16:20])
	obj.reply.Total = binary.LittleEndian.Uint32(data[20:24])
	obj.reply.Count = binary.LittleEndian.Uint16(data[24:26])

	pos := 26
	for i := uint16(0); i < obj.reply.Count; i++ {
		if pos+68 > len(data) {
			return fmt.Errorf("invalid mac board member item %d", i)
		}
		item := MACBoardMemberItem{
			Market: binary.LittleEndian.Uint16(data[pos : pos+2]),
			Symbol: Utf8ToGbk(data[pos+2 : pos+8]),
			Name:   Utf8ToGbk(data[pos+24 : pos+40]),
		}
		obj.reply.Stocks = append(obj.reply.Stocks, item)
		pos += 68
	}

	return nil
}

func (obj *MACBoardMembers) Response() *MACBoardMembersReply {
	return obj.reply
}

type MACBoardMembersQuotes struct {
	reqHeader  *ReqHeader
	respHeader *RespHeader
	request    *MACBoardMembersQuotesRequest
	reply      *MACBoardMembersQuotesReply
}

type MACBoardMembersQuotesRequest struct {
	BoardCode uint32
	Reserved1 [9]byte
	SortType  uint16
	Start     uint32
	PageSize  uint8
	Zero      uint8
	SortOrder uint8
	Extra     [21]byte
}

type MACBoardMembersQuotesReply struct {
	Name   string
	Count  uint16
	Total  uint32
	Stocks []MACBoardMemberQuoteItem
}

type MACBoardMemberQuoteItem struct {
	Name               string
	Market             uint16
	Symbol             string
	PreClose           float64
	Open               float64
	High               float64
	Low                float64
	Close              float64
	Unknown6           float64
	Vol                uint32
	VolumeRatio        float64
	Amount             float64
	TotalShares        float64
	FloatShares        float64
	EPS                float64
	ROE                float64
	NetAssets          float64
	ActionPrice        float64
	Unknown13          float64
	UnknownActionPrice float64
	MarketCap          float64
	TotalMarketCapAB   float64
	PEDynamic          float64
	Zero16             float64
	LotSizeInfo        uint32
	Unknown23          float64
	Zero17             float64
	DividendYield      float64
	RiseSpeed          float64
	CurrentVol         uint16
	LastVolume         uint32
	Turnover           float64
	TurnoverRate       float64
	Unknown21          float64
	SomeBitmap         uint32
	Unknown22          float64
	DecimalPoint       uint32
	LimitUp            float64
	BuyPriceLimit      float64
	LimitDown          float64
	SellPriceLimit     float64
	Zero25             float64
	Unknown34          uint32
	Unknown26          float64
	LotSize            uint32
	LotSizeBoardSymbol string
	Unknown27          float64
	PreIPOV            float64
	RiseSpeed2         float64
	SpeedPct           float64
	Zero29             float64
	FlagKCB            uint32
	KCBFlag            uint32
	PEStatic           float64
	PETTM              float64
	Unknown31          float64
	UnknownClosePrice  float64
}

func NewMACBoardMembersQuotes(req *MACBoardMembersQuotesRequest) *MACBoardMembersQuotes {
	obj := &MACBoardMembersQuotes{
		reqHeader:  new(ReqHeader),
		respHeader: new(RespHeader),
		request:    new(MACBoardMembersQuotesRequest),
		reply:      new(MACBoardMembersQuotesReply),
	}
	obj.reqHeader.Zip = 0x0c
	obj.reqHeader.SeqID = seqID()
	obj.reqHeader.PacketType = 0x01
	obj.reqHeader.Method = KMSG_MACBOARDMEMBERS
	obj.request.SortType = 14
	obj.request.PageSize = 80
	obj.request.SortOrder = 1
	obj.request.Extra = [21]byte{
		0x00, 0xff, 0xfc, 0xe1, 0xcc, 0x3f, 0x08, 0x03, 0x01, 0x00,
		0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
		0x00,
	}
	if req != nil {
		obj.applyRequest(req)
	}
	return obj
}

func (obj *MACBoardMembersQuotes) applyRequest(req *MACBoardMembersQuotesRequest) {
	if req.PageSize == 0 {
		req.PageSize = 80
	}
	if req.SortType == 0 {
		req.SortType = 14
	}
	if req.SortOrder == 0 {
		req.SortOrder = 1
	}
	if req.Extra == ([21]byte{}) {
		req.Extra = obj.request.Extra
	}
	obj.request = req
}

func (obj *MACBoardMembersQuotes) BuildRequest() ([]byte, error) {
	payload := new(bytes.Buffer)
	if err := binary.Write(payload, binary.LittleEndian, obj.request.BoardCode); err != nil {
		return nil, err
	}
	if _, err := payload.Write(obj.request.Reserved1[:]); err != nil {
		return nil, err
	}
	if err := binary.Write(payload, binary.LittleEndian, obj.request.SortType); err != nil {
		return nil, err
	}
	if err := binary.Write(payload, binary.LittleEndian, obj.request.Start); err != nil {
		return nil, err
	}
	if err := binary.Write(payload, binary.LittleEndian, obj.request.PageSize); err != nil {
		return nil, err
	}
	if err := binary.Write(payload, binary.LittleEndian, obj.request.Zero); err != nil {
		return nil, err
	}
	if err := binary.Write(payload, binary.LittleEndian, obj.request.SortOrder); err != nil {
		return nil, err
	}
	if _, err := payload.Write(obj.request.Extra[:]); err != nil {
		return nil, err
	}
	return buildExRequest(KMSG_MACBOARDMEMBERS, payload.Bytes())
}

func (obj *MACBoardMembersQuotes) ParseResponse(header *RespHeader, data []byte) error {
	obj.respHeader = header
	if len(data) < 26 {
		return fmt.Errorf("invalid mac board members quotes response length: %d", len(data))
	}

	obj.reply.Name = Utf8ToGbk(data[16:20])
	obj.reply.Total = binary.LittleEndian.Uint32(data[20:24])
	obj.reply.Count = binary.LittleEndian.Uint16(data[24:26])

	pos := 26
	for i := uint16(0); i < obj.reply.Count; i++ {
		if pos+196 > len(data) {
			return fmt.Errorf("invalid mac board member quote item %d", i)
		}
		item := MACBoardMemberQuoteItem{
			Market: binary.LittleEndian.Uint16(data[pos : pos+2]),
			Symbol: Utf8ToGbk(data[pos+2 : pos+8]),
			Name:   Utf8ToGbk(data[pos+24 : pos+48]),
		}

		metrics := data[pos+68 : pos+196]
		floatAt := func(index int) float64 {
			return float64(math.Float32frombits(binary.LittleEndian.Uint32(metrics[index*4 : index*4+4])))
		}
		uintAt := func(index int) uint32 {
			return binary.LittleEndian.Uint32(metrics[index*4 : index*4+4])
		}

		item.PreClose = floatAt(0)
		item.Open = floatAt(1)
		item.High = floatAt(2)
		item.Low = floatAt(3)
		item.Close = floatAt(4)
		item.Vol = uintAt(5)
		item.Unknown6 = float64(item.Vol)
		item.VolumeRatio = floatAt(6)
		item.Amount = floatAt(7)
		item.TotalShares = floatAt(8)
		item.FloatShares = floatAt(9)
		item.EPS = floatAt(10)
		item.NetAssets = floatAt(11)
		item.ROE = item.NetAssets
		item.ActionPrice = floatAt(12)
		item.UnknownActionPrice = item.ActionPrice
		item.Unknown13 = item.ActionPrice
		item.TotalMarketCapAB = floatAt(13)
		item.MarketCap = item.TotalMarketCapAB
		item.PEDynamic = floatAt(14)
		item.LotSizeInfo = uintAt(15)
		item.Zero16 = float64(item.LotSizeInfo)
		item.Unknown23 = floatAt(16)
		item.Zero17 = item.Unknown23
		item.DividendYield = floatAt(17)
		item.SpeedPct = floatAt(27)
		item.RiseSpeed = item.SpeedPct
		item.LastVolume = uintAt(18)
		item.CurrentVol = uint16(item.LastVolume)
		item.Turnover = floatAt(19)
		item.TurnoverRate = item.Turnover
		item.SomeBitmap = uintAt(20)
		item.Unknown21 = float64(item.SomeBitmap)
		item.DecimalPoint = uintAt(21)
		item.Unknown22 = float64(item.DecimalPoint)
		item.BuyPriceLimit = floatAt(22)
		item.LimitUp = item.BuyPriceLimit
		item.SellPriceLimit = floatAt(23)
		item.LimitDown = item.SellPriceLimit
		item.Unknown34 = uintAt(24)
		item.Zero25 = float64(item.Unknown34)
		item.LotSize = uintAt(25)
		item.LotSizeBoardSymbol = macLotSizeBoardSymbol(item.LotSize)
		item.Unknown26 = float64(item.LotSize)
		item.PreIPOV = floatAt(26)
		item.Unknown27 = item.PreIPOV
		item.RiseSpeed2 = item.SpeedPct
		item.KCBFlag = uintAt(28)
		item.FlagKCB = item.KCBFlag
		item.Zero29 = float64(item.KCBFlag)
		item.PETTM = floatAt(29)
		item.PEStatic = floatAt(30)
		item.UnknownClosePrice = floatAt(31)
		item.Unknown31 = item.UnknownClosePrice

		obj.reply.Stocks = append(obj.reply.Stocks, item)
		pos += 196
	}

	return nil
}

func (obj *MACBoardMembersQuotes) Response() *MACBoardMembersQuotesReply {
	return obj.reply
}
