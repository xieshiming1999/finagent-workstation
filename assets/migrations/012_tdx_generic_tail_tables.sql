CREATE TABLE IF NOT EXISTS tdx_security_count (
  scope TEXT NOT NULL,
  market TEXT NOT NULL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  count INTEGER NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (scope, market, source, fetched_at)
);

CREATE TABLE IF NOT EXISTS tdx_chart_sampling (
  scope TEXT NOT NULL,
  code TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  market TEXT,
  category TEXT,
  pre_close REAL,
  price REAL,
  change REAL,
  raw_json TEXT,
  PRIMARY KEY (scope, code, sequence, source, fetched_at)
);

CREATE TABLE IF NOT EXISTS ex_table_entry (
  entry_key TEXT NOT NULL,
  category TEXT,
  code TEXT NOT NULL,
  name TEXT,
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (entry_key, source)
);

CREATE INDEX IF NOT EXISTS idx_tdx_security_count_scope_market
  ON tdx_security_count(scope, market, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_tdx_chart_sampling_scope_code
  ON tdx_chart_sampling(scope, code, fetched_at DESC, sequence ASC);

CREATE INDEX IF NOT EXISTS idx_ex_table_entry_code
  ON ex_table_entry(code, updated_at DESC);
