package proto

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"math"
)

// MACBoardMembersQuotesDynamic 表示按位图动态解析的 MAC 板块成分报价协议。
type MACBoardMembersQuotesDynamic struct {
	reqHeader  *ReqHeader
	respHeader *RespHeader
	request    *MACBoardMembersQuotesDynamicRequest
	reply      *MACBoardMembersQuotesDynamicReply
}

// MACBoardMembersQuotesDynamicRequest 表示动态字段成分报价请求。
type MACBoardMembersQuotesDynamicRequest struct {
	BoardCode   uint32
	Reserved1   [9]byte
	SortType    uint16
	Start       uint32
	PageSize    uint8
	Zero        uint8
	SortOrder   uint8
	Filter      uint8
	FieldBitmap [20]byte
}

// MACDynamicFieldDef 描述一个由位图激活的动态字段。
type MACDynamicFieldDef struct {
	Bit         uint8
	Name        string
	Format      string
	Description string
	Aliases     []string
}

// MACBoardMemberQuoteDynamicItem 表示单只成分股的动态字段结果。
type MACBoardMemberQuoteDynamicItem struct {
	Name   string
	Market uint16
	Symbol string
	Values map[string]any
}

// MACBoardMembersQuotesDynamicReply 表示动态字段成分报价响应。
type MACBoardMembersQuotesDynamicReply struct {
	FieldBitmap  [20]byte
	ActiveFields []MACDynamicFieldDef
	Count        uint16
	Total        uint32
	Stocks       []MACBoardMemberQuoteDynamicItem
}

var macBoardMembersQuotesDynamicFieldMap = map[uint8]MACDynamicFieldDef{
	0x0:  {Bit: 0x0, Name: "pre_close", Format: "float32", Description: "昨收"},
	0x1:  {Bit: 0x1, Name: "open", Format: "float32", Description: "开盘价"},
	0x2:  {Bit: 0x2, Name: "high", Format: "float32", Description: "最高价"},
	0x3:  {Bit: 0x3, Name: "low", Format: "float32", Description: "最低价"},
	0x4:  {Bit: 0x4, Name: "close", Format: "float32", Description: "收盘价"},
	0x5:  {Bit: 0x5, Name: "vol", Format: "uint32", Description: "成交量"},
	0x6:  {Bit: 0x6, Name: "vol_ratio", Format: "float32", Description: "量比"},
	0x7:  {Bit: 0x7, Name: "amount", Format: "float32", Description: "总金额(元)"},
	0x8:  {Bit: 0x8, Name: "inside_volume", Format: "uint32", Description: "内盘"},
	0x9:  {Bit: 0x9, Name: "outside_volume", Format: "uint32", Description: "外盘"},
	0xa:  {Bit: 0xa, Name: "total_shares", Format: "float32", Description: "总股数(单位万)"},
	0xb:  {Bit: 0xb, Name: "float_shares", Format: "float32", Description: "流通股(单位万)", Aliases: []string{"total_shares_hk"}},
	0xc:  {Bit: 0xc, Name: "eps", Format: "float32", Description: "每股收益"},
	0xd:  {Bit: 0xd, Name: "net_assets", Format: "float32", Description: "净资产"},
	0xe:  {Bit: 0xe, Name: "security_type_price", Format: "float32", Description: "证券类型价", Aliases: []string{"action_price"}},
	0xf:  {Bit: 0xf, Name: "total_market_cap_ab", Format: "float32", Description: "AB股总市值"},
	0x10: {Bit: 0x10, Name: "pe_dynamic", Format: "float32", Description: "市盈率(动)"},
	0x11: {Bit: 0x11, Name: "bid_price", Format: "float32", Description: "买一价", Aliases: []string{"bid"}},
	0x12: {Bit: 0x12, Name: "ask_price", Format: "float32", Description: "卖一价", Aliases: []string{"ask"}},
	0x13: {Bit: 0x13, Name: "server_update_date", Format: "uint32", Description: "服务器更新日期 YYYYMMDD"},
	0x14: {Bit: 0x14, Name: "server_update_time", Format: "uint32", Description: "服务器更新时间 HHMMSS"},
	0x15: {Bit: 0x15, Name: "lot_size_info", Format: "uint32", Description: "未确定"},
	0x16: {Bit: 0x16, Name: "board_strength", Format: "float32", Description: "板块强度(涨跌家数差)", Aliases: []string{"unknown_22"}},
	0x17: {Bit: 0x17, Name: "dividend_yield", Format: "float32", Description: "股息(含义待定)"},
	0x18: {Bit: 0x18, Name: "bid_volume", Format: "uint32", Description: "买量"},
	0x19: {Bit: 0x19, Name: "ask_volume", Format: "uint32", Description: "卖量"},
	0x1a: {Bit: 0x1a, Name: "last_volume", Format: "uint32", Description: "现量"},
	0x1b: {Bit: 0x1b, Name: "turnover", Format: "float32", Description: "换手"},
	0x1c: {Bit: 0x1c, Name: "industry", Format: "uint32", Description: "行业分类代码", Aliases: []string{"block5"}},
	0x1d: {Bit: 0x1d, Name: "industry_change_up", Format: "float32", Description: "行业涨跌幅", Aliases: []string{"block_ext_info"}},
	0x1e: {Bit: 0x1e, Name: "some_bitmap", Format: "uint32", Description: "位图"},
	0x1f: {Bit: 0x1f, Name: "decimal_point", Format: "uint32", Description: "数据精度"},
	0x20: {Bit: 0x20, Name: "buy_price_limit", Format: "float32", Description: "涨停价"},
	0x21: {Bit: 0x21, Name: "sell_price_limit", Format: "float32", Description: "跌停价"},
	0x22: {Bit: 0x22, Name: "price_decimal_info", Format: "uint32", Description: "价格精度标志", Aliases: []string{"unknown_34"}},
	0x23: {Bit: 0x23, Name: "lot_size", Format: "uint32", Description: "所属地区板块(A股)/每手股数(港股)"},
	0x24: {Bit: 0x24, Name: "pre_ipov", Format: "float32", Description: "昨IPOV", Aliases: []string{"float_shares"}},
	0x25: {Bit: 0x25, Name: "speed_pct", Format: "float32", Description: "涨速"},
	0x26: {Bit: 0x26, Name: "avg_price", Format: "float32", Description: "均价"},
	0x27: {Bit: 0x27, Name: "ipov", Format: "float32", Description: "IPOV", Aliases: []string{"float_shares2"}},
	0x28: {Bit: 0x28, Name: "pe_ttm_vol_related", Format: "float32", Description: "前参考价(美股适用)"},
	0x29: {Bit: 0x29, Name: "ex_price_placeholder", Format: "float32", Description: "前金额参考", Aliases: []string{"close_placeholder"}},
	0x2a: {Bit: 0x2a, Name: "operating_revenue", Format: "float32", Description: "营业收入(万)", Aliases: []string{"unknown_42"}},
	0x2b: {Bit: 0x2b, Name: "flag_kcb", Format: "uint32", Description: "科创板标志", Aliases: []string{"kcb_flag"}},
	0x2c: {Bit: 0x2c, Name: "flag_bj", Format: "uint32", Description: "北交所标志", Aliases: []string{"bj_flag"}},
	0x2d: {Bit: 0x2d, Name: "circulating_capital_z", Format: "float32", Description: "流通股本Z（单位：万股）", Aliases: []string{"unknown_45"}},
	0x2e: {Bit: 0x2e, Name: "gem_star_info", Format: "float32", Description: "创业板/科创板数据", Aliases: []string{"unknown_46"}},
	0x2f: {Bit: 0x2f, Name: "unknown_47", Format: "float32", Description: "未知字段 47"},
	0x30: {Bit: 0x30, Name: "pe_ttm", Format: "float32", Description: "市盈率TTM"},
	0x31: {Bit: 0x31, Name: "pe_static", Format: "float32", Description: "市盈率静"},
	0x32: {Bit: 0x32, Name: "unknown_50", Format: "uint32", Description: "未知字段 50"},
	0x33: {Bit: 0x33, Name: "unknown_51", Format: "uint32", Description: "未知字段 51"},
	0x34: {Bit: 0x34, Name: "unknown_52", Format: "uint32", Description: "未知字段 52"},
	0x35: {Bit: 0x35, Name: "unknown_53", Format: "float32", Description: "未知字段 53"},
	0x36: {Bit: 0x36, Name: "unknown_54", Format: "float32", Description: "未知字段 54"},
	0x37: {Bit: 0x37, Name: "index_metric", Format: "float32", Description: "指数指标", Aliases: []string{"unknown_55"}},
	0x38: {Bit: 0x38, Name: "main_net_amount", Format: "float32", Description: "今日主力净流入", Aliases: []string{"unknown_close_price"}},
	0x39: {Bit: 0x39, Name: "bid_ask_ratio", Format: "float32", Description: "委比", Aliases: []string{"unknown_57"}},
	0x3a: {Bit: 0x3a, Name: "non_index_flag", Format: "uint32", Description: "非指数标志", Aliases: []string{"unknown_58"}},
	0x3b: {Bit: 0x3b, Name: "change_20d_pct", Format: "float32", Description: "20日涨幅%"},
	0x3c: {Bit: 0x3c, Name: "ytd_pct", Format: "float32", Description: "年初至今%"},
	0x3d: {Bit: 0x3d, Name: "unknown_61", Format: "float32", Description: "未知字段 61"},
	0x3e: {Bit: 0x3e, Name: "stock_class_code", Format: "uint32", Description: "证券子分类码", Aliases: []string{"unknown_62"}},
	0x3f: {Bit: 0x3f, Name: "percent_base", Format: "uint32", Description: "百分比基底", Aliases: []string{"unknown_63"}},
	0x40: {Bit: 0x40, Name: "mtd_pct", Format: "float32", Description: "月初至今%"},
	0x41: {Bit: 0x41, Name: "change_1y_pct", Format: "float32", Description: "一年涨幅%"},
	0x42: {Bit: 0x42, Name: "prev_change_pct", Format: "float32", Description: "昨涨幅%"},
	0x43: {Bit: 0x43, Name: "change_3d_pct", Format: "float32", Description: "3日涨幅%"},
	0x44: {Bit: 0x44, Name: "change_60d_pct", Format: "float32", Description: "60日涨幅%"},
	0x45: {Bit: 0x45, Name: "change_5d_pct", Format: "float32", Description: "5日涨幅%"},
	0x46: {Bit: 0x46, Name: "change_10d_pct", Format: "float32", Description: "10日涨幅%"},
	0x47: {Bit: 0x47, Name: "prev2_change_pct", Format: "float32", Description: "前日涨幅%", Aliases: []string{"unknown_71"}},
	0x48: {Bit: 0x48, Name: "bid2_price", Format: "float32", Description: "买二价", Aliases: []string{"low_copy"}},
	0x49: {Bit: 0x49, Name: "ask2_price", Format: "float32", Description: "卖二价", Aliases: []string{"low_copy2"}},
	0x4a: {Bit: 0x4a, Name: "ah_code", Format: "uint32", Description: "对应A/H股code,不足位数前面补0"},
	0x4b: {Bit: 0x4b, Name: "unknown_code", Format: "uint32", Description: "少部分有数据,6位数字"},
	0x4c: {Bit: 0x4c, Name: "unknown_76", Format: "float32", Description: "未知字段 76"},
	0x4d: {Bit: 0x4d, Name: "unknown_77", Format: "float32", Description: "未知字段 77"},
	0x4e: {Bit: 0x4e, Name: "unknown_78", Format: "float32", Description: "未知字段 78"},
	0x4f: {Bit: 0x4f, Name: "unknown_79", Format: "float32", Description: "未知字段 79"},
	0x50: {Bit: 0x50, Name: "unknown_80", Format: "float32", Description: "未知字段 80"},
	0x51: {Bit: 0x51, Name: "unknown_81", Format: "float32", Description: "未知字段 81"},
	0x52: {Bit: 0x52, Name: "unknown_82", Format: "float32", Description: "未知字段 82"},
	0x53: {Bit: 0x53, Name: "unknown_83", Format: "float32", Description: "未知字段 83"},
	0x54: {Bit: 0x54, Name: "unknown_84", Format: "float32", Description: "未知字段 84"},
	0x55: {Bit: 0x55, Name: "unknown_85", Format: "float32", Description: "未知字段 85"},
	0x56: {Bit: 0x56, Name: "unknown_86", Format: "float32", Description: "未知字段 86"},
	0x57: {Bit: 0x57, Name: "open_amount", Format: "float32", Description: "开盘金额(元)"},
	0x58: {Bit: 0x58, Name: "annual_limit_up_days", Format: "int32", Description: "年涨停天数"},
	0x59: {Bit: 0x59, Name: "activity", Format: "uint32", Description: "活跃度"},
	0x5b: {Bit: 0x5b, Name: "dividend_yield_pct", Format: "float32", Description: "股息率(%)"},
	0x5c: {Bit: 0x5c, Name: "consecutive_up_days", Format: "int32", Description: "连涨天"},
	0x5d: {Bit: 0x5d, Name: "limit_up_count", Format: "uint32", Description: "涨停数(板块) / 买二量(个股)", Aliases: []string{"bid2_volume"}},
	0x5e: {Bit: 0x5e, Name: "limit_down_count", Format: "uint32", Description: "跌停数(板块) / 卖二量(个股)", Aliases: []string{"ask2_volume"}},
	0x5f: {Bit: 0x5f, Name: "industry_sub", Format: "uint32", Description: "行业二级分类"},
	0x66: {Bit: 0x66, Name: "auction_buy_limit", Format: "float32", Description: "连续竞价买入上限"},
	0x67: {Bit: 0x67, Name: "auction_sell_limit", Format: "float32", Description: "连续竞价卖出下限"},
	0x68: {Bit: 0x68, Name: "vol_speed_pct", Format: "float32", Description: "量涨速%"},
	0x69: {Bit: 0x69, Name: "short_turnover_pct", Format: "float32", Description: "短换手%"},
	0x6a: {Bit: 0x6a, Name: "amount_2m", Format: "float32", Description: "2分钟金额(元)"},
	0x6b: {Bit: 0x6b, Name: "main_net_amount_copy", Format: "float32", Description: "今日主力净流入(副本)"},
	0x6d: {Bit: 0x6d, Name: "retail_net_amount", Format: "float32", Description: "散户单增比"},
	0x6e: {Bit: 0x6e, Name: "main_net_5m_amount", Format: "float32", Description: "5分钟主力净额"},
	0x6f: {Bit: 0x6f, Name: "main_net_3d_amount", Format: "float32", Description: "近三日主力净额"},
	0x70: {Bit: 0x70, Name: "main_net_5d_amount", Format: "float32", Description: "近五日主力净额"},
	0x71: {Bit: 0x71, Name: "main_net_10d_amount", Format: "float32", Description: "近十日主买金额(待确定)"},
	0x72: {Bit: 0x72, Name: "main_buy_net_amount", Format: "float32", Description: "今日主买净额"},
	0x73: {Bit: 0x73, Name: "ddx", Format: "float32", Description: "DDX"},
	0x74: {Bit: 0x74, Name: "ddy", Format: "float32", Description: "DDY"},
	0x75: {Bit: 0x75, Name: "ddz", Format: "float32", Description: "DDZ"},
	0x76: {Bit: 0x76, Name: "ddf", Format: "float32", Description: "DDF"},
	0x77: {Bit: 0x77, Name: "stock_flag_a", Format: "float32", Description: "个股标志位A"},
	0x78: {Bit: 0x78, Name: "stock_flag_b", Format: "float32", Description: "个股标志位B(副本)"},
	0x7a: {Bit: 0x7a, Name: "auction_vol_ratio", Format: "float32", Description: "竞价昨比"},
	0x7d: {Bit: 0x7d, Name: "recent_indicator", Format: "float32", Description: "近日指标提示"},
	0x80: {Bit: 0x80, Name: "bid3_price", Format: "float32", Description: "买三价"},
	0x81: {Bit: 0x81, Name: "bid4_price", Format: "float32", Description: "买四价"},
	0x82: {Bit: 0x82, Name: "bid5_price", Format: "float32", Description: "买五价"},
	0x83: {Bit: 0x83, Name: "ask3_price", Format: "float32", Description: "卖三价"},
	0x84: {Bit: 0x84, Name: "ask4_price", Format: "float32", Description: "卖四价"},
	0x85: {Bit: 0x85, Name: "ask5_price", Format: "float32", Description: "卖五价", Aliases: []string{"avg_price_copy"}},
	0x86: {Bit: 0x86, Name: "bid3_volume", Format: "uint32", Description: "买三量"},
	0x87: {Bit: 0x87, Name: "bid4_volume", Format: "uint32", Description: "买四量"},
	0x88: {Bit: 0x88, Name: "up_count", Format: "uint32", Description: "上涨家数(板块) / 买五量(个股)", Aliases: []string{"bid5_volume"}},
	0x89: {Bit: 0x89, Name: "ask3_volume", Format: "uint32", Description: "卖三量"},
	0x8a: {Bit: 0x8a, Name: "ask4_volume", Format: "uint32", Description: "卖四量"},
	0x8b: {Bit: 0x8b, Name: "down_count", Format: "uint32", Description: "下跌家数(板块) / 卖五量(个股)", Aliases: []string{"ask5_volume"}},
	0x8c: {Bit: 0x8c, Name: "bid_ask_diff", Format: "int32", Description: "委差"},
	0x8e: {Bit: 0x8e, Name: "constant_neg_one", Format: "int32", Description: "填充位(A股非-1)"},
	0x8f: {Bit: 0x8f, Name: "stock_rating", Format: "float32", Description: "个股评级代码"},
}

func defaultMACBoardMembersQuotesFieldBitmap() [20]byte {
	return [20]byte{
		0xff, 0xfc, 0xe1, 0xcc, 0x3f, 0x08, 0x03, 0x01, 0x00, 0x00,
		0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	}
}

// NewMACBoardMembersQuotesDynamic 创建动态字段成分报价协议对象。
func NewMACBoardMembersQuotesDynamic(req *MACBoardMembersQuotesDynamicRequest) *MACBoardMembersQuotesDynamic {
	obj := &MACBoardMembersQuotesDynamic{
		reqHeader:  new(ReqHeader),
		respHeader: new(RespHeader),
		request:    new(MACBoardMembersQuotesDynamicRequest),
		reply:      new(MACBoardMembersQuotesDynamicReply),
	}
	obj.reqHeader.Zip = 0x0c
	obj.reqHeader.SeqID = seqID()
	obj.reqHeader.PacketType = 0x01
	obj.reqHeader.Method = KMSG_MACBOARDMEMBERS
	obj.request.SortType = 14
	obj.request.PageSize = 80
	obj.request.SortOrder = 1
	obj.request.FieldBitmap = defaultMACBoardMembersQuotesFieldBitmap()
	if req != nil {
		obj.applyRequest(req)
	}
	return obj
}

func (obj *MACBoardMembersQuotesDynamic) applyRequest(req *MACBoardMembersQuotesDynamicRequest) {
	if req.PageSize == 0 {
		req.PageSize = 80
	}
	if req.SortType == 0 {
		req.SortType = 14
	}
	if req.SortOrder == 0 {
		req.SortOrder = 1
	}
	if req.FieldBitmap == ([20]byte{}) {
		req.FieldBitmap = defaultMACBoardMembersQuotesFieldBitmap()
	}
	obj.request = req
}

func (obj *MACBoardMembersQuotesDynamic) BuildRequest() ([]byte, error) {
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
	if err := binary.Write(payload, binary.LittleEndian, obj.request.Filter); err != nil {
		return nil, err
	}
	if _, err := payload.Write(obj.request.FieldBitmap[:]); err != nil {
		return nil, err
	}
	return buildExRequest(KMSG_MACBOARDMEMBERS, payload.Bytes())
}

func (obj *MACBoardMembersQuotesDynamic) ParseResponse(header *RespHeader, data []byte) error {
	obj.respHeader = header
	if len(data) < 26 {
		return fmt.Errorf("invalid mac board members dynamic response length: %d", len(data))
	}

	copy(obj.reply.FieldBitmap[:], data[:20])
	obj.reply.Total = binary.LittleEndian.Uint32(data[20:24])
	obj.reply.Count = binary.LittleEndian.Uint16(data[24:26])
	obj.reply.ActiveFields = activeMACDynamicFields(obj.reply.FieldBitmap)

	rowLength := 68 + len(obj.reply.ActiveFields)*4
	pos := 26
	for i := uint16(0); i < obj.reply.Count; i++ {
		if pos+rowLength > len(data) {
			return fmt.Errorf("invalid mac dynamic quote item %d", i)
		}
		row := data[pos : pos+rowLength]
		item := MACBoardMemberQuoteDynamicItem{
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

// Response 返回动态字段成分报价响应。
func (obj *MACBoardMembersQuotesDynamic) Response() *MACBoardMembersQuotesDynamicReply {
	return obj.reply
}

func decodeMACDynamicValue(format string, raw []byte) any {
	switch format {
	case "uint32":
		return binary.LittleEndian.Uint32(raw)
	case "int32":
		return int32(binary.LittleEndian.Uint32(raw))
	default:
		return float64(math.Float32frombits(binary.LittleEndian.Uint32(raw)))
	}
}

func activeMACDynamicFields(bitmap [20]byte) []MACDynamicFieldDef {
	fields := make([]MACDynamicFieldDef, 0)
	for bit := 0; bit < len(bitmap)*8; bit++ {
		if bitmap[bit/8]&(1<<uint(bit%8)) == 0 {
			continue
		}
		fieldDef, ok := macBoardMembersQuotesDynamicFieldMap[uint8(bit)]
		if !ok {
			fieldDef = MACDynamicFieldDef{
				Bit:         uint8(bit),
				Name:        fmt.Sprintf("unknown_field_%d", bit),
				Format:      "uint32",
				Description: "未映射字段",
			}
		}
		fields = append(fields, fieldDef)
	}
	return fields
}
