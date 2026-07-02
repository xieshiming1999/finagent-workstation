CREATE TABLE IF NOT EXISTS fund_dividend_factor (
  code TEXT NOT NULL,
  event_date TEXT NOT NULL,
  dividend REAL,
  factor REAL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (code, event_date, source)
);

CREATE INDEX IF NOT EXISTS idx_fund_dividend_factor_code_date
  ON fund_dividend_factor(code, event_date DESC);
