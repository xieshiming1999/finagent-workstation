-- Parity tables for direct MarketData actions with stable structured schemas.
CREATE TABLE IF NOT EXISTS northbound_holding (
  trade_date TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT,
  hold_market_cap REAL,
  hold_ratio REAL,
  source TEXT NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (trade_date, code, source)
);

CREATE TABLE IF NOT EXISTS unusual_activity (
  event_date TEXT NOT NULL,
  code TEXT NOT NULL,
  event_time TEXT NOT NULL,
  event_type TEXT NOT NULL,
  name TEXT,
  info TEXT,
  source TEXT NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (event_date, code, event_time, event_type, source)
);

CREATE TABLE IF NOT EXISTS flow_rank (
  trade_date TEXT NOT NULL,
  period TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT,
  main_net REAL,
  main_pct REAL,
  super_large_net REAL,
  super_large_pct REAL,
  large_net REAL,
  large_pct REAL,
  medium_net REAL,
  medium_pct REAL,
  source TEXT NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (trade_date, period, code, source)
);

CREATE TABLE IF NOT EXISTS chip_distribution (
  code TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  avg_cost REAL,
  profit_ratio REAL,
  concentration70 REAL,
  concentration90 REAL,
  current_price REAL,
  method TEXT,
  source TEXT NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (code, trade_date, source)
);

CREATE INDEX IF NOT EXISTS idx_northbound_holding_code_date
  ON northbound_holding(code, trade_date);
CREATE INDEX IF NOT EXISTS idx_unusual_activity_date_time
  ON unusual_activity(event_date, event_time);
CREATE INDEX IF NOT EXISTS idx_flow_rank_date_period
  ON flow_rank(trade_date, period);
CREATE INDEX IF NOT EXISTS idx_chip_distribution_code_date
  ON chip_distribution(code, trade_date);
