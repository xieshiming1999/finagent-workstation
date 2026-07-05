package types

import (
	"fmt"
	"regexp"
	"strings"
)

func DetectMarket(symbol string) (Market, string, error) {
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	// 获取最后两位
	prefix := symbol[len(symbol)-3:]
	// 判断 prefix 的第一个字符是不是 ., 如果不是返回错误
	if prefix[0] != '.' {
		return 0, "", fmt.Errorf("股票代码错误,例如:000001.SZ")
	}
	// 股票代码
	code := symbol[:len(symbol)-3]
	// 股票交易所
	market := symbol[len(symbol)-2:]
	switch market {
	case MarketSH.String():
		return MarketSH, code, nil
	case MarketSZ.String():
		return MarketSZ, code, nil
	case MarketBJ.String():
		return MarketBJ, code, nil
	case MarketHK.String():
		return MarketHK, code, nil
	case MarketUSA.String():
		return MarketUSA, code, nil
	default:
		return 0, "", fmt.Errorf("股票代码错误,例如:000001.SZ")
	}
}

func DecodeStockCode(code string) (Market, string, error) {
	// 首先判断里面有没有 .
	code = StockPrefix(CleanCode(code))
	return DetectMarket(code)
}

func StockPrefix(code string) string {
	code = CleanCode(code)
	switch {
	case isSHStock(code):
		return fmt.Sprintf("%s.%s", code, MarketSH.String())
	case isSZStock(code):
		return fmt.Sprintf("%s.%s", code, MarketSZ.String())
	case isBJStock(code):
		return fmt.Sprintf("%s.%s", code, MarketBJ.String())
	case isHKStock(code):
		return fmt.Sprintf("%s.%s", code, MarketHK.String())
	case isUSAStock(code):
		return fmt.Sprintf("%s.%s", code, MarketUSA.String())
	case isSHETF(code):
		return fmt.Sprintf("%s.%s", code, MarketSH.String())
	case isSZETF(code):
		return fmt.Sprintf("%s.%s", code, MarketSZ.String())
	case isSHIndex(code):
		return fmt.Sprintf("%s.%s", code, MarketSH.String())
	case isSZIndex(code):
		return fmt.Sprintf("%s.%s", code, MarketSZ.String())
	case isBJIndex(code):
		return fmt.Sprintf("%s.%s", code, MarketBJ.String())
	}
	return code
}

func IndexPrefix(code string) string {
	code = CleanCode(code)
	switch {
	case isSHIndex(code):
		return fmt.Sprintf("%s.%s", code, MarketSH.String())
	case isSZIndex(code):
		return fmt.Sprintf("%s.%s", code, MarketSZ.String())
	case isBJIndex(code):
		return fmt.Sprintf("%s.%s", code, MarketBJ.String())
	}
	return code
}

func IsStock(symbol string) bool {
	return IsSZStock(symbol) || IsSHStock(symbol) || IsBJStock(symbol)
}

func IsSZStock(symbol string) bool {
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	market := symbol[len(symbol)-2:]
	code := symbol[:len(symbol)-3]
	return len(symbol) == 9 && market == MarketSZ.String() && isSZStock(code)
}

func IsSHStock(symbol string) bool {
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	market := symbol[len(symbol)-2:]
	code := symbol[:len(symbol)-3]
	return len(symbol) == 9 && market == MarketSH.String() && isSHStock(code)
}

func IsBJStock(symbol string) bool {
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	market := symbol[len(symbol)-2:]
	code := symbol[:len(symbol)-3]
	return len(symbol) == 9 && market == MarketBJ.String() && isBJStock(code)
}

// IsETF 是否是基金,示例159558.sz
func IsETF(symbol string) bool {
	if len(symbol) != 9 {
		return false
	}
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	market := symbol[len(symbol)-2:]
	code := symbol[:len(symbol)-3]

	code = strings.ToLower(code)
	switch {
	case market == MarketSH.String() && isSHETF(code):
		return true
	case market == MarketSZ.String() && isSZETF(code):
		return true
	}
	return false
}

// IsIndex 是否是指数,000001.sz,399001.sz,899100.bj
func IsIndex(symbol string) bool {
	if len(symbol) != 9 {
		return false
	}
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	market := symbol[len(symbol)-2:]
	code := symbol[:len(symbol)-3]
	switch {
	case market == MarketSH.String() && isSHIndex(code):
		return true
	case market == MarketSZ.String() && isSZIndex(code):
		return true
	case market == MarketBJ.String() && isBJIndex(code):
		return true
	}
	return false
}

func isSHStock(code string) bool {
	// 先清理掉常见的后缀，只判断核心代码
	code = CleanCode(code)
	if len(code) != 6 {
		return false
	}
	return code[:1] == "6"
}

func isSZStock(code string) bool {
	// 先清理掉常见的后缀，只判断核心代码
	code = CleanCode(code)
	if len(code) != 6 {
		return false
	}
	return code[:1] == "0" || code[:2] == "30"
}

func isBJStock(code string) bool {
	// 先清理掉常见的后缀，只判断核心代码
	code = CleanCode(code)
	if len(code) != 6 {
		return false
	}
	return code[:2] == "92"
}

func isHKStock(code string) bool {
	// 先清理掉常见的后缀，只判断核心代码
	code = CleanCode(code)
	if len(code) != 5 {
		return false
	}
	// 判断是不是全部都是数字
	for _, c := range code {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

func isUSAStock(code string) bool {
	// 先清理掉常见的后缀，只判断核心代码
	code = CleanCode(code)
	// 规则: 全部是字母，且长度在 1 到 5 之间
	// 使用正则表达式: ^[A-Za-z]{1,5}$
	matched, _ := regexp.MatchString(`^[A-Za-z]{1,5}$`, code)
	return matched
}

func CleanCode(code string) string {
	if code == "" {
		return ""
	}
	// 寻找 '.' 的位置，如果存在则只取 '.' 之前的部分
	if idx := strings.Index(code, "."); idx != -1 {
		return code[:idx]
	}
	// 如果没有点号，直接返回
	return code
}

func isSHETF(code string) bool {
	if len(code) != 6 {
		return false
	}
	switch code[:2] {
	case "50", "51", "52", "53", "56", "58":
		return true
	}

	return false
}

func isSZETF(code string) bool {
	if len(code) != 6 {
		return false
	}
	return code[:2] == "15" || code[:2] == "16"
}

func isSHIndex(code string) bool {
	if len(code) != 6 {
		return false
	}
	return code[:3] == "000" || code == "999999"
}

func isSZIndex(code string) bool {
	if len(code) != 6 {
		return false
	}
	return code[:3] == "399"
}

func isBJIndex(code string) bool {
	if len(code) != 6 {
		return false
	}
	return code[:3] == "899"
}
