CREATE TABLE IF NOT EXISTS margin_trading (
  trade_date TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT,
  provider TEXT NOT NULL,
  capability_id TEXT,
  source_action TEXT,
  financing_buy REAL,
  financing_balance REAL,
  margin_sell_volume REAL,
  margin_balance_volume REAL,
  margin_balance REAL,
  total_balance REAL,
  fetched_at TEXT NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (trade_date, code, provider)
);

CREATE INDEX IF NOT EXISTS idx_margin_trading_code_date
  ON margin_trading(code, trade_date DESC);

CREATE INDEX IF NOT EXISTS idx_margin_trading_latest
  ON margin_trading(trade_date DESC, fetched_at DESC, provider);
