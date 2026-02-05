-- Core Banking Ledger Schema V3.0 (Strict Banking)

-- 0. Enums
CREATE TYPE account_type AS ENUM (
    'ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE', 'OFF_BALANCE'
);

CREATE TYPE account_status AS ENUM (
    'ACTIVE',           
    'FROZEN',           
    'LOCKED_INFLOW',    
    'LOCKED_OUTFLOW'    
);

CREATE TYPE entry_status AS ENUM (
    'PENDING',
    'POSTED',
    'ARCHIVED',
    'VOID'
);

-- 1. Accounts Table
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,                       
  code TEXT UNIQUE NOT NULL,                 
  type account_type NOT NULL,
  status account_status NOT NULL DEFAULT 'ACTIVE',
  
  parent_id TEXT REFERENCES accounts(id),    
  is_header BOOLEAN NOT NULL DEFAULT FALSE,  
  path TEXT,                                 
  
  ledger_balance BIGINT NOT NULL DEFAULT 0,  
  pending_balance BIGINT NOT NULL DEFAULT 0, 
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Banking Controls
  allow_overdraft BOOLEAN NOT NULL DEFAULT FALSE,
  min_balance BIGINT NOT NULL DEFAULT 0      
);

-- 2. Journal Entries
CREATE TABLE journal_entries (
  id TEXT PRIMARY KEY,                       
  description TEXT NOT NULL,       -- Narration
  posted_at TIMESTAMPTZ,                     
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  value_date TIMESTAMPTZ,          -- Banking Value Date
  status entry_status NOT NULL DEFAULT 'PENDING',

  idempotency_key TEXT UNIQUE,
  
  -- Identifiers for Reconciliation
  external_ref TEXT,               -- Unique Reference (e.g. Wire ID)
  correlation_id TEXT,              -- Grouping ID (e.g. Deal ID)
  
  -- Context
  metadata JSONB,
  
  -- Integrity (Hash Chain)
  hash TEXT,
  previous_hash TEXT,
  
  -- Linear Ordering (Vital for Chain Traversal)
  sequence BIGSERIAL UNIQUE, 
  
  UNIQUE(previous_hash) -- Ensures linear chain (no forks)
);

-- Integrity Index
CREATE INDEX idx_entries_hash ON journal_entries(hash);

-- 5. Audit Logs (Admin Actions)
CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  action TEXT NOT NULL,           -- e.g. "CREATE_ACCOUNT", "UPDATE_STATUS"
  target_id TEXT,                 -- Account ID or Transaction ID
  actor_id TEXT,                  -- Who did it (System or User ID)
  payload JSONB,                  -- Details of change
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit Log Indexes (Query Performance)
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_target_id ON audit_logs(target_id);
CREATE INDEX idx_audit_logs_actor_id ON audit_logs(actor_id);

-- 3. Journal Lines
CREATE TABLE journal_lines (
  id TEXT NOT NULL,       
  entry_id TEXT NOT NULL REFERENCES journal_entries(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  amount BIGINT NOT NULL,                    
  balance_after BIGINT NOT NULL,             
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  PRIMARY KEY (id, created_at)               
);

-- Indexes
CREATE INDEX idx_lines_acc_created ON journal_lines(account_id, created_at);
CREATE INDEX idx_lines_entry_id ON journal_lines(entry_id);
CREATE INDEX idx_entries_posted_null ON journal_entries(posted_at) WHERE posted_at IS NULL;
CREATE INDEX idx_entries_posted_at ON journal_entries(posted_at DESC);
CREATE INDEX idx_entries_ext_ref ON journal_entries(external_ref);
CREATE INDEX idx_entries_corr_id ON journal_entries(correlation_id);
CREATE INDEX idx_entries_value_date ON journal_entries(value_date);

-- 4. Balance Snapshots (For Fast History & Fast Rebuild)
CREATE TABLE balance_snapshots (
  id BIGSERIAL PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  balance BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(account_id, created_at) -- One snapshot per timestamp (or use date for daily)
);

CREATE INDEX idx_snapshots_acc_date ON balance_snapshots(account_id, created_at DESC);
