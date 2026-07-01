CREATE TABLE IF NOT EXISTS fund_money_yield (
  code TEXT NOT NULL,
  date TEXT NOT NULL,
  million_copies_income REAL,
  seven_day_annualized_yield REAL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (code, date, source)
);

CREATE INDEX IF NOT EXISTS idx_fund_money_yield_code_date
  ON fund_money_yield(code, date DESC);
