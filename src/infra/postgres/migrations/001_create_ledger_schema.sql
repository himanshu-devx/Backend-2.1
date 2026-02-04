-- ============================================================
-- FINTECH LEDGER SCHEMA - Banking Grade Double-Entry Accounting
-- ============================================================
-- This schema implements a proper double-entry accounting system
-- with support for pending transfers, balance constraints, and
-- full audit trail. All amounts are stored in paisa (1/100 INR).
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE account_type AS ENUM (
  'MERCHANT_PAYIN',
  'MERCHANT_PAYOUT',
  'MERCHANT_HOLD',
  'LEGAL_ENTITY_MAIN',
  'PROVIDER_PAYIN',
  'PROVIDER_PAYOUT',
  'PROVIDER_EXPENSE',
  'SUPER_ADMIN_INCOME',
  'WORLD_MAIN'
);

CREATE TYPE owner_type AS ENUM (
  'MERCHANT',
  'LEGAL_ENTITY',
  'PROVIDER_LEGAL_ENTITY',
  'SUPER_ADMIN',
  'WORLD'
);

CREATE TYPE transfer_status AS ENUM (
  'PENDING',
  'POSTED',
  'VOIDED'
);

CREATE TYPE ledger_type AS ENUM (
  'ASSET',      -- Provider accounts (money we hold at providers)
  'LIABILITY',  -- Merchant accounts (money we owe to merchants)
  'EQUITY',     -- Owner's equity
  'REVENUE',    -- Income accounts
  'EXPENSE'     -- Expense accounts
);

-- ============================================================
-- LEDGER ACCOUNTS TABLE
-- ============================================================
-- Stores all ledger accounts with real-time balance tracking.
-- Balance updates are done atomically with row-level locking.

CREATE TABLE ledger_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Business context
  owner_id VARCHAR(50) NOT NULL,           -- e.g., MID-001, LE-001, PLE-001
  owner_type owner_type NOT NULL,
  owner_name VARCHAR(255),
  account_type account_type NOT NULL,
  ledger_type ledger_type NOT NULL DEFAULT 'LIABILITY',

  -- Currency (ISO 4217)
  currency_code SMALLINT NOT NULL DEFAULT 356,  -- 356 = INR

  -- Balance tracking (all amounts in paisa)
  debits_pending BIGINT NOT NULL DEFAULT 0 CHECK (debits_pending >= 0),
  debits_posted BIGINT NOT NULL DEFAULT 0 CHECK (debits_posted >= 0),
  credits_pending BIGINT NOT NULL DEFAULT 0 CHECK (credits_pending >= 0),
  credits_posted BIGINT NOT NULL DEFAULT 0 CHECK (credits_posted >= 0),

  -- Constraints
  allow_negative_balance BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  -- Optimistic locking
  version INTEGER NOT NULL DEFAULT 1,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Unique constraint on owner + account type
  CONSTRAINT unique_owner_account UNIQUE (owner_id, account_type)
);

-- Indexes for common queries
CREATE INDEX idx_accounts_owner_id ON ledger_accounts(owner_id);
CREATE INDEX idx_accounts_owner_type ON ledger_accounts(owner_type);
CREATE INDEX idx_accounts_account_type ON ledger_accounts(account_type);
CREATE INDEX idx_accounts_is_active ON ledger_accounts(is_active) WHERE is_active = TRUE;

-- ============================================================
-- LEDGER ENTRIES TABLE (JOURNAL ENTRIES)
-- ============================================================
-- Immutable record of every debit/credit. Never update or delete.
-- This is the source of truth for all financial movements.

CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Transfer reference
  transfer_id UUID NOT NULL,

  -- Account reference
  account_id UUID NOT NULL REFERENCES ledger_accounts(id),

  -- Entry details (amount in paisa)
  amount BIGINT NOT NULL CHECK (amount > 0),
  entry_type VARCHAR(10) NOT NULL CHECK (entry_type IN ('DEBIT', 'CREDIT')),

  -- Status tracking for pending transfers
  status transfer_status NOT NULL DEFAULT 'POSTED',

  -- Operation code for categorization
  operation_code SMALLINT NOT NULL,

  -- Running balance after this entry (for reconciliation)
  balance_after BIGINT NOT NULL,

  -- Metadata
  description TEXT,
  metadata JSONB DEFAULT '{}',

  -- Idempotency
  idempotency_key VARCHAR(255),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  posted_at TIMESTAMPTZ,  -- When pending became posted

  -- Immutability: No updates allowed on ledger entries
  CONSTRAINT entries_immutable CHECK (TRUE)
);

-- Indexes for ledger entries
CREATE INDEX idx_entries_transfer_id ON ledger_entries(transfer_id);
CREATE INDEX idx_entries_account_id ON ledger_entries(account_id);
CREATE INDEX idx_entries_created_at ON ledger_entries(created_at DESC);
CREATE INDEX idx_entries_status ON ledger_entries(status);
CREATE INDEX idx_entries_operation_code ON ledger_entries(operation_code);
CREATE UNIQUE INDEX idx_entries_idempotency ON ledger_entries(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ============================================================
-- LEDGER TRANSFERS TABLE
-- ============================================================
-- Links two entries (debit and credit) for double-entry accounting.
-- Each transfer must balance (total debits = total credits).

CREATE TABLE ledger_transfers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Account references (denormalized for performance)
  debit_account_id UUID NOT NULL REFERENCES ledger_accounts(id),
  credit_account_id UUID NOT NULL REFERENCES ledger_accounts(id),

  -- Amount in paisa
  amount BIGINT NOT NULL CHECK (amount > 0),

  -- Status
  status transfer_status NOT NULL DEFAULT 'POSTED',

  -- Operation categorization
  operation_code SMALLINT NOT NULL,
  operation_name VARCHAR(50),

  -- Pending transfer tracking
  pending_id UUID,  -- References original pending transfer when posting/voiding
  timeout_at TIMESTAMPTZ,  -- For pending transfers that auto-expire

  -- Metadata
  description TEXT,
  metadata JSONB DEFAULT '{}',

  -- Actor tracking
  actor_id VARCHAR(50),
  actor_type VARCHAR(50),

  -- Idempotency
  idempotency_key VARCHAR(255),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  posted_at TIMESTAMPTZ,  -- When the transfer was posted (for pending)

  -- Constraints
  CONSTRAINT different_accounts CHECK (debit_account_id != credit_account_id)
);

-- Indexes for transfers
CREATE INDEX idx_transfers_debit_account ON ledger_transfers(debit_account_id);
CREATE INDEX idx_transfers_credit_account ON ledger_transfers(credit_account_id);
CREATE INDEX idx_transfers_status ON ledger_transfers(status);
CREATE INDEX idx_transfers_created_at ON ledger_transfers(created_at DESC);
CREATE INDEX idx_transfers_operation_code ON ledger_transfers(operation_code);
CREATE INDEX idx_transfers_pending_id ON ledger_transfers(pending_id)
  WHERE pending_id IS NOT NULL;
CREATE UNIQUE INDEX idx_transfers_idempotency ON ledger_transfers(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Composite index for account queries
CREATE INDEX idx_transfers_accounts ON ledger_transfers(debit_account_id, credit_account_id, created_at DESC);

-- ============================================================
-- BALANCE SNAPSHOTS TABLE (For Reconciliation)
-- ============================================================
-- Periodic snapshots of account balances for audit and reconciliation.

CREATE TABLE balance_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES ledger_accounts(id),

  -- Snapshot balances
  debits_pending BIGINT NOT NULL,
  debits_posted BIGINT NOT NULL,
  credits_pending BIGINT NOT NULL,
  credits_posted BIGINT NOT NULL,
  net_balance BIGINT NOT NULL,  -- credits_posted - debits_posted

  -- Snapshot metadata
  snapshot_type VARCHAR(20) NOT NULL DEFAULT 'DAILY',  -- DAILY, MONTHLY, MANUAL
  snapshot_date DATE NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_snapshots_account_date ON balance_snapshots(account_id, snapshot_date DESC);

-- ============================================================
-- RECONCILIATION LOG TABLE
-- ============================================================
-- Tracks reconciliation runs and any discrepancies found.

CREATE TABLE reconciliation_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  account_id UUID REFERENCES ledger_accounts(id),  -- NULL for system-wide reconciliation

  -- Reconciliation results
  status VARCHAR(20) NOT NULL,  -- SUCCESS, DISCREPANCY, ERROR

  -- Calculated vs stored balances
  calculated_balance BIGINT,
  stored_balance BIGINT,
  discrepancy BIGINT,

  -- Details
  details JSONB DEFAULT '{}',

  -- Timestamps
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reconciliation_account ON reconciliation_log(account_id);
CREATE INDEX idx_reconciliation_status ON reconciliation_log(status);
CREATE INDEX idx_reconciliation_created ON reconciliation_log(created_at DESC);

-- ============================================================
-- SETTLEMENT BATCHES TABLE
-- ============================================================
-- Tracks settlement batch operations

CREATE TABLE settlement_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Batch identification
  batch_number VARCHAR(50) NOT NULL UNIQUE,
  batch_type VARCHAR(50) NOT NULL,  -- MERCHANT_SETTLEMENT, PROVIDER_SETTLEMENT, etc.

  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',  -- PENDING, PROCESSING, COMPLETED, FAILED

  -- Totals
  total_amount BIGINT NOT NULL DEFAULT 0,
  total_transfers INTEGER NOT NULL DEFAULT 0,
  successful_transfers INTEGER NOT NULL DEFAULT 0,
  failed_transfers INTEGER NOT NULL DEFAULT 0,

  -- Metadata
  metadata JSONB DEFAULT '{}',
  error_details JSONB DEFAULT '{}',

  -- Actor
  initiated_by VARCHAR(50),
  approved_by VARCHAR(50),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_settlement_batches_status ON settlement_batches(status);
CREATE INDEX idx_settlement_batches_type ON settlement_batches(batch_type);
CREATE INDEX idx_settlement_batches_created ON settlement_batches(created_at DESC);

-- ============================================================
-- SETTLEMENT BATCH ITEMS TABLE
-- ============================================================

CREATE TABLE settlement_batch_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  batch_id UUID NOT NULL REFERENCES settlement_batches(id),
  transfer_id UUID REFERENCES ledger_transfers(id),

  -- Item details
  owner_id VARCHAR(50) NOT NULL,
  amount BIGINT NOT NULL,

  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX idx_batch_items_batch ON settlement_batch_items(batch_id);
CREATE INDEX idx_batch_items_owner ON settlement_batch_items(owner_id);
CREATE INDEX idx_batch_items_status ON settlement_batch_items(status);

-- ============================================================
-- SCHEDULED JOBS TABLE
-- ============================================================
-- Tracks scheduled jobs and their execution history

CREATE TABLE scheduled_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  job_name VARCHAR(100) NOT NULL,
  job_type VARCHAR(50) NOT NULL,  -- SETTLEMENT, RECONCILIATION, SNAPSHOT, CLEANUP

  -- Schedule (cron expression)
  cron_expression VARCHAR(100),

  -- Last run
  last_run_at TIMESTAMPTZ,
  last_run_status VARCHAR(20),
  last_run_duration_ms INTEGER,
  last_run_error TEXT,

  -- Next run
  next_run_at TIMESTAMPTZ,

  -- Config
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  config JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_jobs_name ON scheduled_jobs(job_name);
CREATE INDEX idx_jobs_next_run ON scheduled_jobs(next_run_at) WHERE is_enabled = TRUE;

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Function to get net balance of an account
CREATE OR REPLACE FUNCTION get_account_balance(p_account_id UUID)
RETURNS BIGINT AS $$
DECLARE
  v_balance BIGINT;
BEGIN
  SELECT credits_posted - debits_posted
  INTO v_balance
  FROM ledger_accounts
  WHERE id = p_account_id;

  RETURN COALESCE(v_balance, 0);
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to get available balance (excluding pending)
CREATE OR REPLACE FUNCTION get_available_balance(p_account_id UUID)
RETURNS BIGINT AS $$
DECLARE
  v_balance BIGINT;
BEGIN
  SELECT (credits_posted - debits_posted) - debits_pending
  INTO v_balance
  FROM ledger_accounts
  WHERE id = p_account_id;

  RETURN COALESCE(v_balance, 0);
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to update account timestamp
CREATE OR REPLACE FUNCTION update_account_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  NEW.version = OLD.version + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for account timestamp updates
CREATE TRIGGER trigger_account_updated
  BEFORE UPDATE ON ledger_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_account_timestamp();

-- ============================================================
-- OPERATION CODES REFERENCE TABLE
-- ============================================================

CREATE TABLE operation_codes (
  code SMALLINT PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  description TEXT,
  category VARCHAR(50)
);

-- Insert operation codes
INSERT INTO operation_codes (code, name, description, category) VALUES
  (1, 'PAYIN', 'Customer payment to merchant', 'PAYMENT'),
  (2, 'PAYOUT', 'Merchant payout to customer/beneficiary', 'PAYMENT'),
  (3, 'INTERNAL_TRANSFER', 'Internal fund movement', 'INTERNAL'),
  (10, 'MERCHANT_SETTLEMENT', 'Settle merchant payin to payout', 'SETTLEMENT'),
  (11, 'MERCHANT_PAYOUT_FUND', 'Fund merchant payout account', 'FUNDING'),
  (12, 'MERCHANT_DEDUCT', 'Deduct from merchant (penalty/chargeback)', 'ADJUSTMENT'),
  (13, 'MERCHANT_FEES', 'Collect merchant fees', 'FEE'),
  (14, 'MERCHANT_REFUND', 'Refund to customer', 'REFUND'),
  (15, 'MERCHANT_HOLD', 'Hold/freeze merchant funds', 'HOLD'),
  (16, 'MERCHANT_RELEASE', 'Release held funds', 'RELEASE'),
  (20, 'PROVIDER_SETTLEMENT', 'Settle provider to legal entity', 'SETTLEMENT'),
  (21, 'PROVIDER_TOPUP', 'Top up provider account', 'FUNDING'),
  (22, 'PROVIDER_FEES', 'Provider fee collection', 'FEE'),
  (23, 'PROVIDER_FEES_SETTLE', 'Settle provider fees to income', 'SETTLEMENT'),
  (30, 'INCOME_SETTLE', 'Settle income account', 'SETTLEMENT');

-- ============================================================
-- VIEWS
-- ============================================================

-- View for account balances with calculated fields
CREATE VIEW v_account_balances AS
SELECT
  a.id,
  a.owner_id,
  a.owner_type,
  a.owner_name,
  a.account_type,
  a.ledger_type,
  a.currency_code,
  a.debits_pending,
  a.debits_posted,
  a.credits_pending,
  a.credits_posted,
  (a.credits_posted - a.debits_posted) as net_balance,
  (a.credits_posted - a.debits_posted - a.debits_pending) as available_balance,
  a.allow_negative_balance,
  a.is_active,
  a.version,
  a.created_at,
  a.updated_at
FROM ledger_accounts a;

-- View for transfer history with account details
CREATE VIEW v_transfer_history AS
SELECT
  t.id,
  t.debit_account_id,
  da.owner_id as debit_owner_id,
  da.owner_name as debit_owner_name,
  da.account_type as debit_account_type,
  t.credit_account_id,
  ca.owner_id as credit_owner_id,
  ca.owner_name as credit_owner_name,
  ca.account_type as credit_account_type,
  t.amount,
  t.status,
  t.operation_code,
  oc.name as operation_name,
  t.description,
  t.metadata,
  t.actor_id,
  t.actor_type,
  t.created_at,
  t.posted_at
FROM ledger_transfers t
JOIN ledger_accounts da ON t.debit_account_id = da.id
JOIN ledger_accounts ca ON t.credit_account_id = ca.id
LEFT JOIN operation_codes oc ON t.operation_code = oc.code;

-- ============================================================
-- COMMENTS
-- ============================================================

COMMENT ON TABLE ledger_accounts IS 'Core ledger accounts with real-time balance tracking';
COMMENT ON TABLE ledger_entries IS 'Immutable journal entries - source of truth';
COMMENT ON TABLE ledger_transfers IS 'Double-entry transfers linking debit and credit entries';
COMMENT ON TABLE balance_snapshots IS 'Periodic balance snapshots for reconciliation';
COMMENT ON TABLE reconciliation_log IS 'Audit log for reconciliation operations';
COMMENT ON TABLE settlement_batches IS 'Batch settlement operations tracking';
COMMENT ON TABLE scheduled_jobs IS 'Scheduled job execution tracking';

COMMENT ON COLUMN ledger_accounts.debits_pending IS 'Sum of pending debit entries (reserved funds)';
COMMENT ON COLUMN ledger_accounts.debits_posted IS 'Sum of posted debit entries (confirmed outflows)';
COMMENT ON COLUMN ledger_accounts.credits_pending IS 'Sum of pending credit entries (incoming)';
COMMENT ON COLUMN ledger_accounts.credits_posted IS 'Sum of posted credit entries (confirmed inflows)';
COMMENT ON COLUMN ledger_accounts.version IS 'Optimistic locking version for concurrent updates';
