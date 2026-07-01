CREATE TABLE IF NOT EXISTS technical_indicator_series (
  provider TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  source_action TEXT NOT NULL,
  symbol TEXT NOT NULL,
  indicator TEXT NOT NULL,
  field_name TEXT NOT NULL,
  params_hash TEXT NOT NULL,
  source_date TEXT NOT NULL,
  value REAL,
  fetched_at TEXT NOT NULL,
  params_json TEXT,
  raw_json TEXT,
  PRIMARY KEY (provider, capability_id, symbol, indicator, field_name, params_hash, source_date)
);

CREATE INDEX IF NOT EXISTS idx_technical_indicator_series_symbol
  ON technical_indicator_series(symbol, indicator, source_date DESC);

CREATE INDEX IF NOT EXISTS idx_technical_indicator_series_latest
  ON technical_indicator_series(fetched_at DESC, provider, indicator);
