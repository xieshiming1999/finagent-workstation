CREATE TABLE IF NOT EXISTS alpha_factor (
  provider TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  source_action TEXT NOT NULL,
  symbol TEXT NOT NULL,
  factor_name TEXT NOT NULL,
  params_hash TEXT NOT NULL,
  source_date TEXT NOT NULL,
  value REAL,
  bars INTEGER,
  fetched_at TEXT NOT NULL,
  params_json TEXT,
  raw_json TEXT,
  PRIMARY KEY (provider, capability_id, symbol, factor_name, params_hash, source_date)
);

CREATE INDEX IF NOT EXISTS idx_alpha_factor_symbol
  ON alpha_factor(symbol, source_date DESC, factor_name);

CREATE INDEX IF NOT EXISTS idx_alpha_factor_latest
  ON alpha_factor(fetched_at DESC, provider, source_action);
