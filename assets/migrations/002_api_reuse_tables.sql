-- Durable API observability, raw result cache, and realtime quote snapshots.
CREATE TABLE IF NOT EXISTS api_call_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  tool TEXT,
  action TEXT,
  endpoint TEXT,
  status INTEGER,
  success INTEGER NOT NULL,
  duration_ms INTEGER,
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_result_cache (
  source TEXT NOT NULL,
  tool TEXT NOT NULL,
  action TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  request_json TEXT NOT NULL,
  response_json TEXT,
  is_error INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (source, tool, action, request_hash)
);

CREATE TABLE IF NOT EXISTS quote_snapshot (
  code TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  source TEXT NOT NULL,
  name TEXT,
  price REAL,
  change REAL,
  change_pct REAL,
  open REAL,
  high REAL,
  low REAL,
  prev_close REAL,
  volume REAL,
  amount REAL,
  pe REAL,
  pb REAL,
  market_cap REAL,
  turnover_rate REAL,
  raw_json TEXT,
  PRIMARY KEY (code, timestamp, source)
);

CREATE INDEX IF NOT EXISTS idx_api_call_log_created ON api_call_log(created_at);
CREATE INDEX IF NOT EXISTS idx_api_call_log_source_created ON api_call_log(source, created_at);
CREATE INDEX IF NOT EXISTS idx_api_result_cache_expires ON api_result_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_quote_snapshot_code_time ON quote_snapshot(code, timestamp);
CREATE INDEX IF NOT EXISTS idx_quote_snapshot_source_time ON quote_snapshot(source, timestamp);
