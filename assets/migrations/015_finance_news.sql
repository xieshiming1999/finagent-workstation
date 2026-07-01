CREATE TABLE IF NOT EXISTS finance_news (
  news_id TEXT NOT NULL,
  title TEXT,
  summary TEXT,
  content TEXT,
  publisher TEXT,
  published_at TEXT,
  url TEXT,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (source, news_id)
);

CREATE INDEX IF NOT EXISTS idx_finance_news_published
  ON finance_news(published_at DESC, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_finance_news_source_published
  ON finance_news(source, published_at DESC, fetched_at DESC);
