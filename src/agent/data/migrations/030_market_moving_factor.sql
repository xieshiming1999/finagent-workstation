CREATE TABLE IF NOT EXISTS market_moving_factor (
  factor_id TEXT PRIMARY KEY,
  family TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  source_name TEXT NOT NULL,
  source_url TEXT,
  source_type TEXT NOT NULL,
  source_published_at TEXT,
  fetched_at TEXT NOT NULL,
  event_at TEXT,
  next_catalyst_at TEXT,
  affected_assets_json TEXT,
  affected_regions_json TEXT,
  affected_sectors_json TEXT,
  transmission_channels_json TEXT,
  expected_direction TEXT,
  severity TEXT,
  confidence TEXT,
  status TEXT NOT NULL,
  failure_class TEXT,
  evidence_items_json TEXT,
  macro_values_json TEXT,
  retrieval_test_json TEXT,
  raw_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_market_moving_factor_family
ON market_moving_factor(family, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_moving_factor_status
ON market_moving_factor(status, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_moving_factor_source
ON market_moving_factor(source_name, fetched_at DESC);
