ALTER TABLE limit_pool ADD COLUMN fetched_at TEXT;
UPDATE limit_pool
SET fetched_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE fetched_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_limit_pool_fetched_at ON limit_pool(fetched_at);

ALTER TABLE northbound_holding ADD COLUMN fetched_at TEXT;
UPDATE northbound_holding
SET fetched_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE fetched_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_northbound_holding_fetched_at
  ON northbound_holding(fetched_at);

ALTER TABLE unusual_activity ADD COLUMN fetched_at TEXT;
UPDATE unusual_activity
SET fetched_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE fetched_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_unusual_activity_fetched_at
  ON unusual_activity(fetched_at);

ALTER TABLE flow_rank ADD COLUMN fetched_at TEXT;
UPDATE flow_rank
SET fetched_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE fetched_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_flow_rank_fetched_at ON flow_rank(fetched_at);

ALTER TABLE chip_distribution ADD COLUMN fetched_at TEXT;
UPDATE chip_distribution
SET fetched_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE fetched_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chip_distribution_fetched_at
  ON chip_distribution(fetched_at);
