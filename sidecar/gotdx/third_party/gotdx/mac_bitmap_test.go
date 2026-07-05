package gotdx

import "testing"

func TestMACFieldBitmapPresets(t *testing.T) {
	defaultBitmap := DefaultMACBoardMembersQuotesFieldBitmap()
	expectedDefault := [20]byte{0xff, 0xfc, 0xe1, 0xcc, 0x3f, 0x08, 0x03, 0x01}
	if defaultBitmap != expectedDefault {
		t.Fatalf("default bitmap mismatch: got %x want %x", defaultBitmap, expectedDefault)
	}

	common := MACFieldBitmap(MACPresetCommon)
	expectedCommon := [20]byte{0xff, 0xfc, 0xa1, 0xcc, 0x3f, 0x28, 0x03, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03}
	if common != expectedCommon {
		t.Fatalf("common preset literal mismatch: got %x want %x", common, expectedCommon)
	}

	custom := MACFieldBitmap(MACPresetOHLC, MACFieldAHCode)
	expected := MACBoardMembersQuotesFieldBitmapFromBits(1, 2, 3, 4, 0x4a)
	if custom != expected {
		t.Fatalf("custom bitmap mismatch: got %x want %x", custom, expected)
	}

	debug := MACFieldBitmap(MACPresetDebug)
	for i, b := range debug {
		if b != 0xff {
			t.Fatalf("debug byte %d = %#x", i, b)
		}
	}
}

func TestMACFieldAliases(t *testing.T) {
	if MACFieldBid2Volume != MACFieldLimitUpCount {
		t.Fatal("bid2 volume alias should match limit up count")
	}
	if MACFieldAsk5Volume != MACFieldDownCount {
		t.Fatal("ask5 volume alias should match down count")
	}
}
