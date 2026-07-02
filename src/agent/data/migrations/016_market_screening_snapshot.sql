CREATE TABLE IF NOT EXISTS market_screening_snapshot (
  provider TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  source_action TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT,
  market TEXT,
  rank INTEGER,
  score REAL,
  screened_at TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  universe_json TEXT,
  filters_json TEXT,
  sort_json TEXT,
  fields_json TEXT,
  raw_json TEXT,
  PRIMARY KEY (provider, source_action, symbol, screened_at)
);

CREATE INDEX IF NOT EXISTS idx_market_screening_snapshot_latest
  ON market_screening_snapshot(screened_at DESC, fetched_at DESC, provider);

CREATE INDEX IF NOT EXISTS idx_market_screening_snapshot_symbol
  ON market_screening_snapshot(symbol, screened_at DESC);
