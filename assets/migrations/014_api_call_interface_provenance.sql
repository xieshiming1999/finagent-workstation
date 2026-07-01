ALTER TABLE api_call_log ADD COLUMN provider TEXT;
ALTER TABLE api_call_log ADD COLUMN interface_id TEXT;
ALTER TABLE api_call_log ADD COLUMN capability_id TEXT;

UPDATE api_call_log
SET provider = source
WHERE provider IS NULL;

CREATE INDEX IF NOT EXISTS idx_api_call_log_interface_created
  ON api_call_log(interface_id, created_at);

CREATE INDEX IF NOT EXISTS idx_api_call_log_provider_interface_created
  ON api_call_log(provider, interface_id, created_at);
