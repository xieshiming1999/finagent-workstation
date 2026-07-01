ALTER TABLE fund_list ADD COLUMN fund_category TEXT;

UPDATE fund_list
SET fund_category = CASE
  WHEN lower(COALESCE(fund_category, '')) IN ('money','backend','bond','etf','index','fof','qdii','reits','ordinary','unknown') THEN lower(fund_category)
  WHEN COALESCE(name, '') LIKE '%后端%' OR lower(COALESCE(name, '')) LIKE '%backend%' THEN 'backend'
  WHEN COALESCE(fund_type, '') LIKE '%货币%' OR COALESCE(name, '') LIKE '%货币%' OR lower(COALESCE(fund_type, '')) LIKE '%money%' OR lower(COALESCE(name, '')) LIKE '%money%' OR COALESCE(name, '') LIKE '%现金%' THEN 'money'
  WHEN COALESCE(fund_type, '') LIKE '%债%' OR lower(COALESCE(fund_type, '')) LIKE '%bond%' THEN 'bond'
  WHEN lower(COALESCE(fund_type, '')) LIKE '%etf%' OR lower(COALESCE(name, '')) LIKE '%etf%' THEN 'etf'
  WHEN COALESCE(fund_type, '') LIKE '%指数%' OR lower(COALESCE(fund_type, '')) LIKE '%index%' THEN 'index'
  WHEN lower(COALESCE(fund_type, '')) LIKE '%fof%' THEN 'fof'
  WHEN lower(COALESCE(fund_type, '')) LIKE '%qdii%' THEN 'qdii'
  WHEN lower(COALESCE(fund_type, '')) LIKE '%reit%' THEN 'reits'
  WHEN COALESCE(fund_type, '') = '' AND COALESCE(name, '') = '' THEN 'unknown'
  ELSE 'ordinary'
END
WHERE fund_category IS NULL OR fund_category = '';
