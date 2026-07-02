CREATE TABLE IF NOT EXISTS stock_shareholder (
  code TEXT NOT NULL,
  report_date TEXT NOT NULL,
  holder_name TEXT NOT NULL,
  holder_type TEXT NOT NULL,
  rank INTEGER,
  hold_shares REAL,
  hold_pct REAL,
  share_nature TEXT,
  announcement_date TEXT,
  shareholder_note TEXT,
  shareholder_count REAL,
  average_holding REAL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (code, report_date, holder_name, holder_type, source)
);

CREATE INDEX IF NOT EXISTS idx_stock_shareholder_code_date
  ON stock_shareholder(code, report_date DESC);

CREATE INDEX IF NOT EXISTS idx_stock_shareholder_holder
  ON stock_shareholder(holder_name, report_date DESC);
