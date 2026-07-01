-- Structured yfinance/Yahoo Finance tables for non-A-share global data.
-- Quote-like and OHLCV rows continue to use canonical quote_snapshot/kline_daily.

CREATE TABLE IF NOT EXISTS yfinance_profile_fields (
  symbol TEXT NOT NULL,
  field_key TEXT NOT NULL,
  field_value TEXT,
  field_type TEXT,
  source TEXT,
  updated_at TEXT NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (symbol, field_key)
);

CREATE TABLE IF NOT EXISTS yfinance_statement_items (
  symbol TEXT NOT NULL,
  statement_type TEXT NOT NULL,
  period TEXT NOT NULL,
  item TEXT NOT NULL,
  value REAL,
  source TEXT,
  updated_at TEXT NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (symbol, statement_type, period, item)
);

CREATE TABLE IF NOT EXISTS yfinance_recommendations (
  symbol TEXT NOT NULL,
  period TEXT NOT NULL,
  strong_buy REAL,
  buy REAL,
  hold REAL,
  sell REAL,
  strong_sell REAL,
  source TEXT,
  updated_at TEXT NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (symbol, period)
);

CREATE TABLE IF NOT EXISTS yfinance_news (
  symbol TEXT NOT NULL,
  news_id TEXT NOT NULL,
  title TEXT,
  publisher TEXT,
  published_at TEXT,
  link TEXT,
  summary TEXT,
  source TEXT,
  updated_at TEXT NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (symbol, news_id)
);

CREATE TABLE IF NOT EXISTS yfinance_option_expiries (
  symbol TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  source TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (symbol, expiry_date)
);

CREATE TABLE IF NOT EXISTS yfinance_option_contracts (
  symbol TEXT NOT NULL,
  expiry_date TEXT NOT NULL,
  option_type TEXT NOT NULL,
  contract_symbol TEXT NOT NULL,
  strike REAL,
  last_price REAL,
  bid REAL,
  ask REAL,
  change REAL,
  percent_change REAL,
  volume REAL,
  open_interest REAL,
  implied_volatility REAL,
  in_the_money INTEGER,
  currency TEXT,
  last_trade_date TEXT,
  source TEXT,
  updated_at TEXT NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (symbol, expiry_date, option_type, contract_symbol)
);

CREATE TABLE IF NOT EXISTS yfinance_corporate_actions (
  symbol TEXT NOT NULL,
  action_type TEXT NOT NULL,
  action_date TEXT NOT NULL,
  value REAL,
  source TEXT,
  updated_at TEXT NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (symbol, action_type, action_date)
);

CREATE TABLE IF NOT EXISTS yfinance_holders (
  symbol TEXT NOT NULL,
  holder_type TEXT NOT NULL,
  holder_name TEXT NOT NULL,
  reported_date TEXT NOT NULL,
  pct_held REAL,
  shares REAL,
  value REAL,
  pct_change REAL,
  source TEXT,
  updated_at TEXT NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (symbol, holder_type, holder_name, reported_date)
);

CREATE TABLE IF NOT EXISTS yfinance_insider_transactions (
  symbol TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  insider TEXT,
  position TEXT,
  transaction_text TEXT,
  start_date TEXT,
  ownership TEXT,
  shares REAL,
  value REAL,
  source TEXT,
  updated_at TEXT NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (symbol, transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_yfinance_profile_symbol ON yfinance_profile_fields(symbol);
CREATE INDEX IF NOT EXISTS idx_yfinance_statement_symbol ON yfinance_statement_items(symbol, statement_type, period);
CREATE INDEX IF NOT EXISTS idx_yfinance_news_symbol_time ON yfinance_news(symbol, published_at);
CREATE INDEX IF NOT EXISTS idx_yfinance_options_symbol_expiry ON yfinance_option_contracts(symbol, expiry_date);
CREATE INDEX IF NOT EXISTS idx_yfinance_actions_symbol_date ON yfinance_corporate_actions(symbol, action_date);
CREATE INDEX IF NOT EXISTS idx_yfinance_holders_symbol ON yfinance_holders(symbol, holder_type);
CREATE INDEX IF NOT EXISTS idx_yfinance_insider_symbol_date ON yfinance_insider_transactions(symbol, start_date);
