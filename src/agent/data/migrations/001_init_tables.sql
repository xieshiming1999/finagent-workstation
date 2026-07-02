-- Initial schema: all 16 tables + indexes
CREATE TABLE IF NOT EXISTS stock_list (
  code TEXT PRIMARY KEY, name TEXT NOT NULL, market TEXT NOT NULL,
  industry TEXT, list_date TEXT, delist_date TEXT, stock_type TEXT DEFAULT 'stock',
  total_share REAL, circ_share REAL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kline_daily (
  code TEXT NOT NULL, date TEXT NOT NULL, open REAL NOT NULL, high REAL NOT NULL,
  low REAL NOT NULL, close REAL NOT NULL, volume REAL, amount REAL,
  change_pct REAL, turnover_rate REAL, adjust TEXT DEFAULT 'qfq', source TEXT,
  PRIMARY KEY (code, date, adjust)
);
CREATE TABLE IF NOT EXISTS fundamental (
  code TEXT NOT NULL, report_date TEXT NOT NULL, pe_ttm REAL, pb REAL, ps_ttm REAL,
  roe REAL, gross_margin REAL, net_margin REAL, revenue REAL, revenue_yoy REAL,
  net_profit REAL, profit_yoy REAL, total_assets REAL, total_liabilities REAL,
  debt_ratio REAL, dividend_yield REAL, market_cap REAL, circ_cap REAL,
  source TEXT, updated_at TEXT, PRIMARY KEY (code, report_date)
);
CREATE TABLE IF NOT EXISTS money_flow (
  code TEXT NOT NULL, date TEXT NOT NULL, main_net REAL, small_net REAL,
  medium_net REAL, large_net REAL, super_large_net REAL,
  close_price REAL, change_pct REAL, source TEXT, PRIMARY KEY (code, date)
);
CREATE TABLE IF NOT EXISTS sector_ranking (
  date TEXT NOT NULL, sector_type TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL,
  change_pct REAL, turnover_rate REAL, up_count INTEGER, down_count INTEGER,
  leading_stock TEXT, leading_pct REAL, rank INTEGER, source TEXT,
  PRIMARY KEY (date, sector_type, code)
);
CREATE TABLE IF NOT EXISTS limit_pool (
  date TEXT NOT NULL, code TEXT NOT NULL, name TEXT, limit_type TEXT NOT NULL,
  change_pct REAL, first_limit_time TEXT, last_limit_time TEXT, open_count INTEGER,
  limit_reason TEXT, continuous_days INTEGER, source TEXT,
  PRIMARY KEY (date, code, limit_type)
);
CREATE TABLE IF NOT EXISTS northbound (
  date TEXT NOT NULL PRIMARY KEY, sh_net REAL, sz_net REAL, total_net REAL,
  sh_buy REAL, sh_sell REAL, sz_buy REAL, sz_sell REAL, source TEXT
);
CREATE TABLE IF NOT EXISTS fund_list (
  code TEXT PRIMARY KEY, name TEXT NOT NULL, fund_type TEXT, company TEXT,
  manager TEXT, setup_date TEXT, total_size REAL, nav REAL, nav_date TEXT,
  return_1y REAL, return_3y REAL, return_ytd REAL, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS fund_nav (
  code TEXT NOT NULL, date TEXT NOT NULL, nav REAL NOT NULL,
  acc_nav REAL, daily_return REAL, source TEXT, PRIMARY KEY (code, date)
);
CREATE TABLE IF NOT EXISTS fund_holding (
  fund_code TEXT NOT NULL, report_date TEXT NOT NULL, stock_code TEXT NOT NULL,
  stock_name TEXT, hold_shares REAL, hold_value REAL, hold_pct REAL,
  rank INTEGER, source TEXT, PRIMARY KEY (fund_code, report_date, stock_code)
);
CREATE TABLE IF NOT EXISTS fund_manager (
  manager_id TEXT PRIMARY KEY, name TEXT NOT NULL, company TEXT, start_date TEXT,
  total_size REAL, fund_count INTEGER, best_return REAL, experience_years REAL, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS trade_calendar (
  date TEXT NOT NULL, market TEXT NOT NULL, is_trading_day INTEGER NOT NULL,
  year INTEGER, month INTEGER, PRIMARY KEY (date, market)
);
CREATE TABLE IF NOT EXISTS industry_map (
  code TEXT PRIMARY KEY, industry_l1 TEXT, industry_l2 TEXT, industry_l3 TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS data_coverage (
  code TEXT NOT NULL, data_type TEXT NOT NULL, earliest_date TEXT, latest_date TEXT,
  row_count INTEGER DEFAULT 0, last_updated TEXT, PRIMARY KEY (code, data_type)
);
CREATE TABLE IF NOT EXISTS fetch_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_type TEXT NOT NULL, code TEXT, params TEXT,
  status TEXT NOT NULL DEFAULT 'pending', priority INTEGER DEFAULT 5,
  progress TEXT, created_at TEXT NOT NULL, updated_at TEXT, error TEXT
);
CREATE TABLE IF NOT EXISTS data_feed_config (
  feed_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, feed_type TEXT NOT NULL,
  enabled INTEGER DEFAULT 1, scope TEXT DEFAULT 'watchlist', scope_codes TEXT,
  history_years INTEGER DEFAULT 5, update_frequency TEXT DEFAULT 'daily_close',
  trigger_time TEXT DEFAULT '15:30', source_priority TEXT DEFAULT '["eastmoney","akshare"]',
  status TEXT DEFAULT 'idle', last_run_at TEXT, last_error TEXT, config_json TEXT, updated_at TEXT
);
-- Indexes
CREATE INDEX IF NOT EXISTS idx_kline_code ON kline_daily(code);
CREATE INDEX IF NOT EXISTS idx_kline_date ON kline_daily(date);
CREATE INDEX IF NOT EXISTS idx_flow_code ON money_flow(code);
CREATE INDEX IF NOT EXISTS idx_sector_date ON sector_ranking(date);
CREATE INDEX IF NOT EXISTS idx_limit_date ON limit_pool(date);
CREATE INDEX IF NOT EXISTS idx_fund_nav_code ON fund_nav(code);
CREATE INDEX IF NOT EXISTS idx_holding_fund ON fund_holding(fund_code);
CREATE INDEX IF NOT EXISTS idx_coverage_type ON data_coverage(data_type);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON fetch_tasks(status);
CREATE INDEX IF NOT EXISTS idx_stock_market ON stock_list(market);
CREATE INDEX IF NOT EXISTS idx_stock_industry ON stock_list(industry);
