CREATE TABLE IF NOT EXISTS fund_performance_metrics (
  code TEXT NOT NULL,
  metric_date TEXT NOT NULL,
  provider TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  source_action TEXT NOT NULL,
  nav REAL,
  return_ytd REAL,
  return_1w REAL,
  return_1m REAL,
  return_3m REAL,
  return_6m REAL,
  return_1y REAL,
  return_2y REAL,
  return_3y REAL,
  return_since_inception REAL,
  fetched_at TEXT NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (code, metric_date, provider, source_action)
);

CREATE INDEX IF NOT EXISTS idx_fund_performance_code_date
  ON fund_performance_metrics(code, metric_date DESC);

CREATE INDEX IF NOT EXISTS idx_fund_performance_provider_date
  ON fund_performance_metrics(provider, metric_date DESC);
