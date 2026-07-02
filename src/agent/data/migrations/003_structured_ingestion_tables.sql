-- Structured ingestion tables for normalized generic AkShare/TDX/EastMoney endpoint outputs.
CREATE TABLE IF NOT EXISTS raw_api_payload (
  source TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  request_json TEXT NOT NULL,
  response_json TEXT,
  is_error INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  PRIMARY KEY (source, endpoint, request_hash)
);

CREATE TABLE IF NOT EXISTS tick_chart_intraday (
  code TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  time TEXT NOT NULL,
  price REAL,
  avg_price REAL,
  volume REAL,
  amount REAL,
  source TEXT NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (code, trade_date, time, source)
);

CREATE TABLE IF NOT EXISTS transactions (
  code TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  time TEXT NOT NULL,
  price REAL,
  volume REAL,
  amount REAL,
  direction TEXT,
  source TEXT NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (code, trade_date, time, price, volume, source)
);

CREATE TABLE IF NOT EXISTS volume_profile (
  code TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  price REAL NOT NULL,
  volume REAL,
  pct REAL,
  source TEXT NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (code, trade_date, price, source)
);

CREATE TABLE IF NOT EXISTS tdx_block_member (
  block_code TEXT NOT NULL,
  block_name TEXT,
  code TEXT NOT NULL,
  name TEXT,
  block_type TEXT,
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (block_code, code, source)
);

CREATE TABLE IF NOT EXISTS stock_company_info (
  code TEXT NOT NULL,
  info_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (code, info_type, title, source)
);

CREATE TABLE IF NOT EXISTS hot_rank (
  date TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT,
  rank INTEGER,
  heat REAL,
  rank_change REAL,
  source TEXT NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (date, code, source)
);

CREATE TABLE IF NOT EXISTS dragon_tiger (
  date TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT,
  reason TEXT NOT NULL,
  buy_amt REAL,
  sell_amt REAL,
  net_amt REAL,
  accum_amount REAL,
  source TEXT NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (date, code, reason, source)
);

CREATE INDEX IF NOT EXISTS idx_raw_api_payload_created ON raw_api_payload(created_at);
CREATE INDEX IF NOT EXISTS idx_tick_chart_code_date ON tick_chart_intraday(code, trade_date);
CREATE INDEX IF NOT EXISTS idx_transactions_code_date ON transactions(code, trade_date);
CREATE INDEX IF NOT EXISTS idx_volume_profile_code_date ON volume_profile(code, trade_date);
CREATE INDEX IF NOT EXISTS idx_hot_rank_date_rank ON hot_rank(date, rank);
CREATE INDEX IF NOT EXISTS idx_dragon_tiger_date ON dragon_tiger(date);
