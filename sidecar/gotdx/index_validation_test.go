package main

import (
	"net/http/httptest"
	"testing"

	"github.com/bensema/gotdx/proto"
)

func TestNormalizeIndexRequestMapsShanghaiCompositeToTdxCode(t *testing.T) {
	transport, market, public := normalizeIndexRequest("000001")
	if transport != "999999" || market != 1 || public != "000001" {
		t.Fatalf("unexpected sh composite mapping: transport=%s market=%d public=%s", transport, market, public)
	}
}

func TestNormalizeIndexRequestKeepsShenzhenIndexMarket(t *testing.T) {
	transport, market, public := normalizeIndexRequest("399001")
	if transport != "399001" || market != 0 || public != "399001" {
		t.Fatalf("unexpected sz index mapping: transport=%s market=%d public=%s", transport, market, public)
	}
}

func TestValidateIndexInfoRejectsMismatchedCode(t *testing.T) {
	err := validateIndexInfoReply("399001", &proto.GetIndexInfoReply{
		Code:  "000001",
		Close: 14963,
		Open:  14900,
		High:  15000,
		Low:   14800,
	})
	if err == nil {
		t.Fatal("expected mismatched index code to be rejected")
	}
}

func TestValidateIndexInfoRejectsImplausiblePrice(t *testing.T) {
	err := validateIndexInfoReply("399001", &proto.GetIndexInfoReply{
		Code:  "399001",
		Close: 4031,
		Open:  4020,
		High:  4050,
		Low:   4000,
	})
	if err == nil {
		t.Fatal("expected mismatched price scale to be rejected")
	}
}

func TestValidateIndexBarsRejectsInvalidRows(t *testing.T) {
	err := validateIndexBarsReply("000001", &proto.GetIndexBarsReply{
		Count: 1,
		List: []proto.IndexBar{{
			Open: 4030, High: 4020, Low: 4040, Close: 4031,
		}},
	})
	if err == nil {
		t.Fatal("expected invalid OHLC row to be rejected")
	}
}

func TestValidateIndexMomentumRejectsCountMismatch(t *testing.T) {
	err := validateIndexMomentumReply("000001", &proto.GetIndexMomentumReply{
		Count:  2,
		Values: []int{1},
	})
	if err == nil {
		t.Fatal("expected count mismatch to be rejected")
	}
}

func TestQueryLimitedUint16AcceptsDefaultAndMax(t *testing.T) {
	req := httptest.NewRequest("GET", "/kline", nil)
	rec := httptest.NewRecorder()
	count, ok := queryLimitedUint16(rec, req, "count", 100, maxSecurityBarsCount)
	if !ok || count != 100 || rec.Code != 200 {
		t.Fatalf("expected default count to pass: count=%d ok=%v status=%d", count, ok, rec.Code)
	}

	req = httptest.NewRequest("GET", "/kline?count=500", nil)
	rec = httptest.NewRecorder()
	count, ok = queryLimitedUint16(rec, req, "count", 100, maxSecurityBarsCount)
	if !ok || count != 500 || rec.Code != 200 {
		t.Fatalf("expected max count to pass: count=%d ok=%v status=%d", count, ok, rec.Code)
	}
}

func TestQueryLimitedUint16RejectsOversizedAndWrappedCounts(t *testing.T) {
	for _, raw := range []string{"501", "65536", "999999", "-1", "abc"} {
		req := httptest.NewRequest("GET", "/kline?count="+raw, nil)
		rec := httptest.NewRecorder()
		if count, ok := queryLimitedUint16(rec, req, "count", 100, maxSecurityBarsCount); ok {
			t.Fatalf("expected count=%s to be rejected, got count=%d", raw, count)
		}
		if rec.Code != 400 {
			t.Fatalf("expected count=%s to return 400, got %d", raw, rec.Code)
		}
	}
}
