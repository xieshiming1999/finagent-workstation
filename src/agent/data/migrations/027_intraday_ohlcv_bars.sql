CREATE TABLE IF NOT EXISTS intraday_ohlcv_bars (
  code TEXT NOT NULL,
  bar_time TEXT NOT NULL,
  trade_date TEXT,
  interval_minutes INTEGER NOT NULL,
  open REAL,
  high REAL,
  low REAL,
  close REAL,
  volume REAL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (code, bar_time, interval_minutes, source)
);

CREATE INDEX IF NOT EXISTS idx_intraday_ohlcv_code_time
  ON intraday_ohlcv_bars(code, bar_time);
