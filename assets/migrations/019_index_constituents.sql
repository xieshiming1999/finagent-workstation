CREATE TABLE IF NOT EXISTS index_constituent (
  index_code TEXT NOT NULL,
  stock_code TEXT NOT NULL,
  stock_name TEXT,
  weight REAL,
  as_of_date TEXT NOT NULL,
  provider TEXT NOT NULL,
  capability_id TEXT,
  source_action TEXT,
  fetched_at TEXT NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (index_code, stock_code, as_of_date, provider)
);

CREATE INDEX IF NOT EXISTS idx_index_constituent_index ON index_constituent(index_code, as_of_date);
CREATE INDEX IF NOT EXISTS idx_index_constituent_stock ON index_constituent(stock_code, as_of_date);
