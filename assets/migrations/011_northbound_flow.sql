CREATE TABLE IF NOT EXISTS northbound_flow (
  trade_date TEXT NOT NULL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  mutual_type TEXT,
  buy_amount REAL,
  sell_amount REAL,
  net_buy REAL,
  hold_market_cap REAL,
  raw_json TEXT,
  PRIMARY KEY (trade_date, source, mutual_type)
);

CREATE INDEX IF NOT EXISTS idx_northbound_flow_date
  ON northbound_flow(trade_date);
