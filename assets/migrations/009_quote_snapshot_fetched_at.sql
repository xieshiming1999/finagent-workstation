ALTER TABLE quote_snapshot ADD COLUMN fetched_at TEXT;
UPDATE quote_snapshot SET fetched_at = timestamp WHERE fetched_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_quote_snapshot_fetched_at ON quote_snapshot(fetched_at);
