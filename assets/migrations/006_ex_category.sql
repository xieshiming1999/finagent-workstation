CREATE TABLE IF NOT EXISTS ex_category (
  category INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  abbr TEXT,
  source TEXT,
  updated_at TEXT NOT NULL,
  raw_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_ex_category_name
  ON ex_category(name);
