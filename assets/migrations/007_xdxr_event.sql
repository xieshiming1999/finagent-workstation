CREATE TABLE IF NOT EXISTS xdxr_event (
  code TEXT NOT NULL,
  event_date TEXT NOT NULL,
  category INTEGER NOT NULL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  category_name TEXT,
  a REAL,
  b REAL,
  c REAL,
  d REAL,
  raw_json TEXT,
  PRIMARY KEY (code, event_date, category, source)
);

CREATE INDEX IF NOT EXISTS idx_xdxr_event_code_date
  ON xdxr_event(code, event_date DESC);
