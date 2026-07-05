package gotdx

// MACFieldSelector 表示可写入 MAC 动态字段位图的字段或预设。
type MACFieldSelector interface {
	applyMACFieldBitmap(*[20]byte)
}

// MACFieldBit 表示 MAC 动态字段位图中的单个字段位。
type MACFieldBit uint8

const (
	MACFieldPreClose            MACFieldBit = 0x0
	MACFieldOpen                MACFieldBit = 0x1
	MACFieldHigh                MACFieldBit = 0x2
	MACFieldLow                 MACFieldBit = 0x3
	MACFieldClose               MACFieldBit = 0x4
	MACFieldVol                 MACFieldBit = 0x5
	MACFieldVolRatio            MACFieldBit = 0x6
	MACFieldAmount              MACFieldBit = 0x7
	MACFieldInsideVolume        MACFieldBit = 0x8
	MACFieldOutsideVolume       MACFieldBit = 0x9
	MACFieldTotalShares         MACFieldBit = 0xa
	MACFieldFloatShares         MACFieldBit = 0xb
	MACFieldEPS                 MACFieldBit = 0xc
	MACFieldNetAssets           MACFieldBit = 0xd
	MACFieldSecurityTypePrice   MACFieldBit = 0xe
	MACFieldTotalMarketCapAb    MACFieldBit = 0xf
	MACFieldPEDynamic           MACFieldBit = 0x10
	MACFieldBidPrice            MACFieldBit = 0x11
	MACFieldAskPrice            MACFieldBit = 0x12
	MACFieldServerUpdateDate    MACFieldBit = 0x13
	MACFieldServerUpdateTime    MACFieldBit = 0x14
	MACFieldLotSizeInfo         MACFieldBit = 0x15
	MACFieldBoardStrength       MACFieldBit = 0x16
	MACFieldDividendYield       MACFieldBit = 0x17
	MACFieldBidVolume           MACFieldBit = 0x18
	MACFieldAskVolume           MACFieldBit = 0x19
	MACFieldLastVolume          MACFieldBit = 0x1a
	MACFieldTurnover            MACFieldBit = 0x1b
	MACFieldIndustry            MACFieldBit = 0x1c
	MACFieldIndustryChangeUp    MACFieldBit = 0x1d
	MACFieldSomeBitmap          MACFieldBit = 0x1e
	MACFieldDecimalPoint        MACFieldBit = 0x1f
	MACFieldBuyPriceLimit       MACFieldBit = 0x20
	MACFieldSellPriceLimit      MACFieldBit = 0x21
	MACFieldPriceDecimalInfo    MACFieldBit = 0x22
	MACFieldLotSize             MACFieldBit = 0x23
	MACFieldPreIPOV             MACFieldBit = 0x24
	MACFieldSpeedPct            MACFieldBit = 0x25
	MACFieldAvgPrice            MACFieldBit = 0x26
	MACFieldIPOV                MACFieldBit = 0x27
	MACFieldPETTMVolRelated     MACFieldBit = 0x28
	MACFieldExPricePlaceholder  MACFieldBit = 0x29
	MACFieldOperatingRevenue    MACFieldBit = 0x2a
	MACFieldFlagKCB             MACFieldBit = 0x2b
	MACFieldFlagBJ              MACFieldBit = 0x2c
	MACFieldCirculatingCapitalZ MACFieldBit = 0x2d
	MACFieldGEMStarInfo         MACFieldBit = 0x2e
	MACFieldPETTM               MACFieldBit = 0x30
	MACFieldPEStatic            MACFieldBit = 0x31
	MACFieldIndexMetric         MACFieldBit = 0x37
	MACFieldMainNetAmount       MACFieldBit = 0x38
	MACFieldBidAskRatio         MACFieldBit = 0x39
	MACFieldNonIndexFlag        MACFieldBit = 0x3a
	MACFieldChange20DPct        MACFieldBit = 0x3b
	MACFieldYTDPct              MACFieldBit = 0x3c
	MACFieldStockClassCode      MACFieldBit = 0x3e
	MACFieldPercentBase         MACFieldBit = 0x3f
	MACFieldMTDPct              MACFieldBit = 0x40
	MACFieldChange1yPct         MACFieldBit = 0x41
	MACFieldPrevChangePct       MACFieldBit = 0x42
	MACFieldChange3DPct         MACFieldBit = 0x43
	MACFieldChange60DPct        MACFieldBit = 0x44
	MACFieldChange5DPct         MACFieldBit = 0x45
	MACFieldChange10DPct        MACFieldBit = 0x46
	MACFieldPrev2ChangePct      MACFieldBit = 0x47
	MACFieldBid2Price           MACFieldBit = 0x48
	MACFieldAsk2Price           MACFieldBit = 0x49
	MACFieldAHCode              MACFieldBit = 0x4a
	MACFieldUnknownCode         MACFieldBit = 0x4b
	MACFieldOpenAmount          MACFieldBit = 0x57
	MACFieldAnnualLimitUpDays   MACFieldBit = 0x58
	MACFieldActivity            MACFieldBit = 0x59
	MACFieldDividendYieldPct    MACFieldBit = 0x5b
	MACFieldConsecutiveUpDays   MACFieldBit = 0x5c
	MACFieldLimitUpCount        MACFieldBit = 0x5d
	MACFieldLimitDownCount      MACFieldBit = 0x5e
	MACFieldIndustrySub         MACFieldBit = 0x5f
	MACFieldAuctionBuyLimit     MACFieldBit = 0x66
	MACFieldAuctionSellLimit    MACFieldBit = 0x67
	MACFieldVolSpeedPct         MACFieldBit = 0x68
	MACFieldShortTurnoverPct    MACFieldBit = 0x69
	MACFieldAmount2m            MACFieldBit = 0x6a
	MACFieldMainNetAmountCopy   MACFieldBit = 0x6b
	MACFieldRetailNetAmount     MACFieldBit = 0x6d
	MACFieldMainNet5mAmount     MACFieldBit = 0x6e
	MACFieldMainNet3DAmount     MACFieldBit = 0x6f
	MACFieldMainNet5DAmount     MACFieldBit = 0x70
	MACFieldMainNet10DAmount    MACFieldBit = 0x71
	MACFieldMainBuyNetAmount    MACFieldBit = 0x72
	MACFieldDDX                 MACFieldBit = 0x73
	MACFieldDDY                 MACFieldBit = 0x74
	MACFieldDDZ                 MACFieldBit = 0x75
	MACFieldDDF                 MACFieldBit = 0x76
	MACFieldStockFlagA          MACFieldBit = 0x77
	MACFieldStockFlagB          MACFieldBit = 0x78
	MACFieldAuctionVolRatio     MACFieldBit = 0x7a
	MACFieldRecentIndicator     MACFieldBit = 0x7d
	MACFieldBid3Price           MACFieldBit = 0x80
	MACFieldBid4Price           MACFieldBit = 0x81
	MACFieldBid5Price           MACFieldBit = 0x82
	MACFieldAsk3Price           MACFieldBit = 0x83
	MACFieldAsk4Price           MACFieldBit = 0x84
	MACFieldAsk5Price           MACFieldBit = 0x85
	MACFieldBid3Volume          MACFieldBit = 0x86
	MACFieldBid4Volume          MACFieldBit = 0x87
	MACFieldUpCount             MACFieldBit = 0x88
	MACFieldAsk3Volume          MACFieldBit = 0x89
	MACFieldAsk4Volume          MACFieldBit = 0x8a
	MACFieldDownCount           MACFieldBit = 0x8b
	MACFieldBidAskDiff          MACFieldBit = 0x8c
	MACFieldConstantNegOne      MACFieldBit = 0x8e
	MACFieldStockRating         MACFieldBit = 0x8f
	MACFieldBid2Volume          MACFieldBit = MACFieldLimitUpCount
	MACFieldAsk2Volume          MACFieldBit = MACFieldLimitDownCount
	MACFieldBid5Volume          MACFieldBit = MACFieldUpCount
	MACFieldAsk5Volume          MACFieldBit = MACFieldDownCount
)

func (bit MACFieldBit) applyMACFieldBitmap(bitmap *[20]byte) {
	if int(bit) >= len(bitmap)*8 {
		return
	}
	bitmap[int(bit)/8] |= 1 << uint(int(bit)%8)
}

// MACPresetField 表示一组常用 MAC 动态字段预设。
type MACPresetField uint8

const (
	MACPresetNone        MACPresetField = 0
	MACPresetOHLC        MACPresetField = 1
	MACPresetBasic       MACPresetField = 2
	MACPresetQuote       MACPresetField = 3
	MACPresetVolume      MACPresetField = 4
	MACPresetFundamental MACPresetField = 5
	MACPresetEnhanced    MACPresetField = 6
	MACPresetAHCode      MACPresetField = 7
	MACPresetBoardStats  MACPresetField = 8
	MACPresetHandicap    MACPresetField = 9
	MACPresetCommon      MACPresetField = 10
	MACPresetDebug       MACPresetField = 11
	MACPresetAll         MACPresetField = 12
)

func (preset MACPresetField) applyMACFieldBitmap(bitmap *[20]byte) {
	switch preset {
	case MACPresetNone:
		return
	case MACPresetOHLC:
		for _, bit := range []MACFieldBit{MACFieldOpen, MACFieldHigh, MACFieldLow, MACFieldClose} {
			bit.applyMACFieldBitmap(bitmap)
		}
	case MACPresetBasic:
		for _, bit := range []MACFieldBit{MACFieldOpen, MACFieldHigh, MACFieldLow, MACFieldClose, MACFieldPreClose, MACFieldVol} {
			bit.applyMACFieldBitmap(bitmap)
		}
	case MACPresetQuote:
		for _, bit := range []MACFieldBit{MACFieldBidPrice, MACFieldAskPrice, MACFieldBidVolume, MACFieldAskVolume, MACFieldLastVolume} {
			bit.applyMACFieldBitmap(bitmap)
		}
	case MACPresetVolume:
		for _, bit := range []MACFieldBit{MACFieldVol, MACFieldAmount, MACFieldTurnover, MACFieldVolRatio} {
			bit.applyMACFieldBitmap(bitmap)
		}
	case MACPresetFundamental:
		for _, bit := range []MACFieldBit{MACFieldTotalShares, MACFieldFloatShares, MACFieldEPS, MACFieldNetAssets} {
			bit.applyMACFieldBitmap(bitmap)
		}
	case MACPresetEnhanced:
		for _, bit := range []MACFieldBit{MACFieldOpen, MACFieldHigh, MACFieldLow, MACFieldClose, MACFieldVol, MACFieldFloatShares, MACFieldActivity} {
			bit.applyMACFieldBitmap(bitmap)
		}
	case MACPresetAHCode:
		for _, bit := range []MACFieldBit{MACFieldOpen, MACFieldHigh, MACFieldLow, MACFieldClose, MACFieldVol, MACFieldAHCode, MACFieldLotSize, MACFieldIndustry} {
			bit.applyMACFieldBitmap(bitmap)
		}
	case MACPresetBoardStats:
		for _, bit := range []MACFieldBit{MACFieldLimitUpCount, MACFieldLimitDownCount, MACFieldUpCount, MACFieldDownCount} {
			bit.applyMACFieldBitmap(bitmap)
		}
	case MACPresetHandicap:
		for _, bit := range []MACFieldBit{MACFieldBidPrice, MACFieldBid2Price, MACFieldBid3Price, MACFieldBid4Price, MACFieldBid5Price, MACFieldAskPrice, MACFieldAsk2Price, MACFieldAsk3Price, MACFieldAsk4Price, MACFieldAsk5Price, MACFieldBidVolume, MACFieldLimitUpCount, MACFieldBid3Volume, MACFieldBid4Volume, MACFieldUpCount, MACFieldAskVolume, MACFieldLimitDownCount, MACFieldAsk3Volume, MACFieldAsk4Volume, MACFieldDownCount} {
			bit.applyMACFieldBitmap(bitmap)
		}
	case MACPresetCommon:
		for _, bit := range []MACFieldBit{MACFieldPreClose, MACFieldOpen, MACFieldHigh, MACFieldLow, MACFieldClose, MACFieldVol, MACFieldVolRatio, MACFieldAmount, MACFieldTotalShares, MACFieldFloatShares, MACFieldEPS, MACFieldNetAssets, MACFieldSecurityTypePrice, MACFieldTotalMarketCapAb, MACFieldPEDynamic, MACFieldLotSizeInfo, MACFieldDividendYield, MACFieldLastVolume, MACFieldTurnover, MACFieldSomeBitmap, MACFieldDecimalPoint, MACFieldBuyPriceLimit, MACFieldSellPriceLimit, MACFieldPriceDecimalInfo, MACFieldLotSize, MACFieldPreIPOV, MACFieldSpeedPct, MACFieldFlagKCB, MACFieldPETTM, MACFieldPEStatic, MACFieldMainNetAmount, MACFieldVolSpeedPct, MACFieldShortTurnoverPct, MACFieldCirculatingCapitalZ} {
			bit.applyMACFieldBitmap(bitmap)
		}
	case MACPresetDebug:
		for i := range bitmap {
			bitmap[i] = 0xff
		}
	case MACPresetAll:
		for _, bit := range []MACFieldBit{MACFieldPreClose, MACFieldOpen, MACFieldHigh, MACFieldLow, MACFieldClose, MACFieldVol, MACFieldVolRatio, MACFieldAmount, MACFieldInsideVolume, MACFieldOutsideVolume, MACFieldTotalShares, MACFieldFloatShares, MACFieldEPS, MACFieldNetAssets, MACFieldSecurityTypePrice, MACFieldTotalMarketCapAb, MACFieldPEDynamic, MACFieldBidPrice, MACFieldAskPrice, MACFieldServerUpdateDate, MACFieldServerUpdateTime, MACFieldLotSizeInfo, MACFieldBoardStrength, MACFieldDividendYield, MACFieldBidVolume, MACFieldAskVolume, MACFieldLastVolume, MACFieldTurnover, MACFieldIndustry, MACFieldIndustryChangeUp, MACFieldSomeBitmap, MACFieldDecimalPoint, MACFieldBuyPriceLimit, MACFieldSellPriceLimit, MACFieldPriceDecimalInfo, MACFieldLotSize, MACFieldPreIPOV, MACFieldSpeedPct, MACFieldAvgPrice, MACFieldIPOV, MACFieldPETTMVolRelated, MACFieldExPricePlaceholder, MACFieldOperatingRevenue, MACFieldFlagKCB, MACFieldFlagBJ, MACFieldCirculatingCapitalZ, MACFieldGEMStarInfo, MACFieldPETTM, MACFieldPEStatic, MACFieldIndexMetric, MACFieldMainNetAmount, MACFieldBidAskRatio, MACFieldNonIndexFlag, MACFieldChange20DPct, MACFieldYTDPct, MACFieldStockClassCode, MACFieldPercentBase, MACFieldMTDPct, MACFieldChange1yPct, MACFieldPrevChangePct, MACFieldChange3DPct, MACFieldChange60DPct, MACFieldChange5DPct, MACFieldChange10DPct, MACFieldPrev2ChangePct, MACFieldBid2Price, MACFieldAsk2Price, MACFieldAHCode, MACFieldUnknownCode, MACFieldOpenAmount, MACFieldAnnualLimitUpDays, MACFieldActivity, MACFieldDividendYieldPct, MACFieldConsecutiveUpDays, MACFieldLimitUpCount, MACFieldLimitDownCount, MACFieldIndustrySub, MACFieldAuctionBuyLimit, MACFieldAuctionSellLimit, MACFieldVolSpeedPct, MACFieldShortTurnoverPct, MACFieldAmount2m, MACFieldMainNetAmountCopy, MACFieldRetailNetAmount, MACFieldMainNet5mAmount, MACFieldMainNet3DAmount, MACFieldMainNet5DAmount, MACFieldMainNet10DAmount, MACFieldMainBuyNetAmount, MACFieldDDX, MACFieldDDY, MACFieldDDZ, MACFieldDDF, MACFieldStockFlagA, MACFieldStockFlagB, MACFieldAuctionVolRatio, MACFieldRecentIndicator, MACFieldBid3Price, MACFieldBid4Price, MACFieldBid5Price, MACFieldAsk3Price, MACFieldAsk4Price, MACFieldAsk5Price, MACFieldBid3Volume, MACFieldBid4Volume, MACFieldUpCount, MACFieldAsk3Volume, MACFieldAsk4Volume, MACFieldDownCount, MACFieldBidAskDiff, MACFieldConstantNegOne, MACFieldStockRating} {
			bit.applyMACFieldBitmap(bitmap)
		}
	}
}

// MACFieldBitmap 根据字段位和预设组合构造 20 字节 MAC 动态字段位图。
func MACFieldBitmap(selectors ...MACFieldSelector) [20]byte {
	var bitmap [20]byte
	for _, selector := range selectors {
		if selector == nil {
			continue
		}
		selector.applyMACFieldBitmap(&bitmap)
	}
	return bitmap
}

// DefaultMACBoardMembersQuotesFieldBitmap 返回与当前稳定成分报价接口一致的默认字段位图。
func DefaultMACBoardMembersQuotesFieldBitmap() [20]byte {
	return [20]byte{
		0xff, 0xfc, 0xe1, 0xcc, 0x3f, 0x08, 0x03, 0x01, 0x00, 0x00,
		0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	}
}

// FullMACBoardMembersQuotesFieldBitmap 返回 20 字节全 1 位图，适合实验性全字段请求。
func FullMACBoardMembersQuotesFieldBitmap() [20]byte {
	return MACFieldBitmap(MACPresetDebug)
}

// MACBoardMembersQuotesFieldBitmapFromBits 根据 bit 列表组装 20 字节字段位图。
func MACBoardMembersQuotesFieldBitmapFromBits(bits ...int) [20]byte {
	var bitmap [20]byte
	for _, bit := range bits {
		if bit < 0 || bit >= len(bitmap)*8 {
			continue
		}
		bitmap[bit/8] |= 1 << uint(bit%8)
	}
	return bitmap
}

// DefaultMACSymbolQuotesFieldBitmap 返回 0x122B 常用批量报价位图。
func DefaultMACSymbolQuotesFieldBitmap() [20]byte {
	return DefaultMACBoardMembersQuotesFieldBitmap()
}

// FullMACSymbolQuotesFieldBitmap 返回 0x122B 全字段实验位图。
func FullMACSymbolQuotesFieldBitmap() [20]byte {
	return FullMACBoardMembersQuotesFieldBitmap()
}

// MACSymbolQuotesFieldBitmapFromBits 根据 bit 列表组装 0x122B/0x122C 通用位图。
func MACSymbolQuotesFieldBitmapFromBits(bits ...int) [20]byte {
	return MACBoardMembersQuotesFieldBitmapFromBits(bits...)
}
