package main

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/bensema/gotdx/proto"
)

var indexPriceRanges = map[string][2]float64{
	"000001": {1000, 10000},
	"399001": {5000, 30000},
	"399006": {1000, 10000},
	"000300": {1000, 10000},
	"000905": {1000, 15000},
	"000852": {1000, 15000},
}

func requireIndexCode(r *http.Request) (transportCode string, market uint8, publicCode string, ok bool) {
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	if code == "" {
		return "", 0, "", false
	}
	transportCode, market, publicCode = normalizeIndexRequest(code)
	if r.URL.Query().Get("market") != "" {
		market = queryUint8(r, "market", market)
	}
	return transportCode, market, publicCode, true
}

func normalizeIndexRequest(code string) (transportCode string, market uint8, publicCode string) {
	clean := strings.TrimSpace(code)
	switch {
	case clean == "999999" || clean == "000001":
		return "999999", 1, "000001"
	case strings.HasPrefix(clean, "399"):
		return clean, 0, clean
	case strings.HasPrefix(clean, "000"):
		return clean, 1, clean
	case strings.HasPrefix(clean, "899"):
		return clean, 2, clean
	default:
		return clean, parseMarket(clean), clean
	}
}

func publicIndexCode(code string) string {
	if code == "999999" {
		return "000001"
	}
	return code
}

func validateIndexInfoReply(expectedCode string, reply *proto.GetIndexInfoReply) error {
	if reply == nil {
		return fmt.Errorf("empty reply")
	}
	if got := publicIndexCode(strings.TrimSpace(reply.Code)); got != "" && expectedCode != "" && got != expectedCode {
		return fmt.Errorf("requested %s but response code is %s", expectedCode, got)
	}
	for name, value := range map[string]float64{
		"close": reply.Close,
		"open":  reply.Open,
		"high":  reply.High,
		"low":   reply.Low,
	} {
		if !plausibleIndexPrice(expectedCode, value) {
			return fmt.Errorf("%s %.4f is outside plausible range for %s", name, value, expectedCode)
		}
	}
	if reply.High < reply.Low || reply.High < reply.Open || reply.High < reply.Close || reply.Low > reply.Open || reply.Low > reply.Close {
		return fmt.Errorf("invalid OHLC order open=%.4f high=%.4f low=%.4f close=%.4f", reply.Open, reply.High, reply.Low, reply.Close)
	}
	return nil
}

func validateIndexBarsReply(expectedCode string, reply *proto.GetIndexBarsReply) error {
	if reply == nil {
		return fmt.Errorf("empty reply")
	}
	if int(reply.Count) != len(reply.List) {
		return fmt.Errorf("count %d does not match rows %d", reply.Count, len(reply.List))
	}
	for i, bar := range reply.List {
		for name, value := range map[string]float64{
			"close": bar.Close,
			"open":  bar.Open,
			"high":  bar.High,
			"low":   bar.Low,
		} {
			if !plausibleIndexPrice(expectedCode, value) {
				return fmt.Errorf("row %d %s %.4f is outside plausible range for %s", i, name, value, expectedCode)
			}
		}
		if bar.High < bar.Low || bar.High < bar.Open || bar.High < bar.Close || bar.Low > bar.Open || bar.Low > bar.Close {
			return fmt.Errorf("row %d invalid OHLC order open=%.4f high=%.4f low=%.4f close=%.4f", i, bar.Open, bar.High, bar.Low, bar.Close)
		}
	}
	return nil
}

func validateIndexMomentumReply(expectedCode string, reply *proto.GetIndexMomentumReply) error {
	if reply == nil {
		return fmt.Errorf("empty reply")
	}
	if int(reply.Count) != len(reply.Values) {
		return fmt.Errorf("count %d does not match values %d", reply.Count, len(reply.Values))
	}
	if reply.Count > 10000 {
		return fmt.Errorf("count %d is implausibly large for %s", reply.Count, expectedCode)
	}
	return nil
}

func plausibleIndexPrice(code string, value float64) bool {
	if value <= 0 {
		return false
	}
	rng, ok := indexPriceRanges[code]
	if !ok {
		return true
	}
	return value >= rng[0] && value <= rng[1]
}
