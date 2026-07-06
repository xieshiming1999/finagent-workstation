import { describe, expect, it } from "vitest";
import { formatQuote } from "../../src/agent/tools/market-data-utils";
import type { Quote } from "../../src/agent/data/data-manager";

function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    code: "000001",
    name: "上证指数",
    price: 3000,
    change: 1,
    changePct: 0.03,
    open: 0,
    high: 0,
    low: 0,
    prevClose: 0,
    volume: 0,
    amount: 0,
    ...overrides,
  };
}

describe("formatQuote", () => {
  it("does not present unavailable OHLC fields as real zero values", () => {
    const text = formatQuote(quote());

    expect(text).toContain("上证指数 (000001)");
    expect(text).not.toContain("Open: 0");
    expect(text).not.toContain("High: 0");
    expect(text).not.toContain("Low: 0");
    expect(text).not.toContain("PrevClose: 0");
  });

  it("keeps meaningful OHLC values and marks missing fields unavailable", () => {
    const text = formatQuote(quote({ open: 2990, high: 3010 }));

    expect(text).toContain("Open: 2990");
    expect(text).toContain("High: 3010");
    expect(text).toContain("Low: -");
    expect(text).toContain("PrevClose: -");
  });
});
