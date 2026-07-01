CREATE TABLE IF NOT EXISTS wind_document (
  doc_id TEXT PRIMARY KEY,
  tool TEXT NOT NULL,
  query TEXT,
  title TEXT,
  publisher TEXT,
  published_at TEXT,
  url TEXT,
  summary TEXT,
  entity_code TEXT,
  entity_name TEXT,
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  raw_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_wind_document_published ON wind_document(published_at);
CREATE INDEX IF NOT EXISTS idx_wind_document_entity ON wind_document(entity_code, published_at);

CREATE TABLE IF NOT EXISTS wind_economic_series (
  series_key TEXT NOT NULL,
  metric_query TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  metric_code TEXT,
  date TEXT NOT NULL,
  value_num REAL,
  value_text TEXT,
  unit TEXT,
  frequency TEXT,
  currency TEXT,
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (series_key, date, metric_name)
);

CREATE INDEX IF NOT EXISTS idx_wind_economic_series_metric_date ON wind_economic_series(metric_query, date);

CREATE TABLE IF NOT EXISTS wind_analytics_result (
  result_id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  entity_code TEXT,
  entity_name TEXT,
  value_date TEXT,
  title TEXT,
  content TEXT,
  value_num REAL,
  value_text TEXT,
  unit TEXT,
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  raw_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_wind_analytics_question_date ON wind_analytics_result(question, value_date);
