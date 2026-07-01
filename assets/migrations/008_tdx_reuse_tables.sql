CREATE TABLE IF NOT EXISTS auction_snapshot (
  code TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  time TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  price REAL,
  volume REAL,
  raw_json TEXT,
  PRIMARY KEY (code, trade_date, time, sequence, source)
);

CREATE TABLE IF NOT EXISTS tdx_index_momentum (
  code TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  value REAL,
  raw_json TEXT,
  PRIMARY KEY (code, trade_date, sequence, source)
);

CREATE TABLE IF NOT EXISTS tdx_top_board (
  board_date TEXT NOT NULL,
  category TEXT NOT NULL,
  side TEXT NOT NULL,
  rank INTEGER NOT NULL,
  code TEXT NOT NULL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  market INTEGER,
  price REAL,
  value REAL,
  raw_json TEXT,
  PRIMARY KEY (board_date, category, side, rank, code, source)
);

CREATE INDEX IF NOT EXISTS idx_auction_snapshot_code_date
  ON auction_snapshot(code, trade_date DESC, sequence DESC);

CREATE INDEX IF NOT EXISTS idx_tdx_index_momentum_code_date
  ON tdx_index_momentum(code, trade_date DESC, sequence ASC);

CREATE INDEX IF NOT EXISTS idx_tdx_top_board_date_rank
  ON tdx_top_board(board_date DESC, category, side, rank);
