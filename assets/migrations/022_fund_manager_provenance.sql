ALTER TABLE fund_manager ADD COLUMN source TEXT;
ALTER TABLE fund_manager ADD COLUMN capability_id TEXT;
ALTER TABLE fund_manager ADD COLUMN source_action TEXT;
ALTER TABLE fund_manager ADD COLUMN raw_json TEXT;

CREATE INDEX IF NOT EXISTS idx_fund_manager_source
  ON fund_manager(source, company, name);
