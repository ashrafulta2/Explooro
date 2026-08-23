/**
 * wallet.repository.js — Data access for wallets, ledger transactions, and balance integrity (Prompt 6.1).
 *
 * Implements:
 * - Row-level exclusive locking (SELECT ... FOR UPDATE) in deterministic ascending wallet ID order
 * - Atomic balance mutations with optimistic/pessimistic concurrency guards
 * - Append-only insertion into partitioned ledger_transactions
 * - Comprehensive multi-bucket ledger integrity verification across all platform wallets
 */

/**
 * Retrieves an existing wallet for a user, or creates a new one with zero balances if none exists.
 * Safe to call with a Pool client or Pool instance.
 */
export async function getOrCreateWallet(db, userId, { client } = {}) {
  const runner = client ?? db;
  const selectQuery = `
    SELECT id, user_id, available_balance, pending_escrow_balance, held_balance,
           lifetime_earned, lifetime_withdrawn, currency, version, created_at, updated_at
    FROM wallets
    WHERE user_id = $1
  `;
  const { rows } = await runner.query(selectQuery, [userId]);
  if (rows.length > 0) {
    return rows[0];
  }

  const insertQuery = `
    INSERT INTO wallets (user_id, available_balance, pending_escrow_balance, held_balance,
                         lifetime_earned, lifetime_withdrawn, currency, version)
    VALUES ($1, 0.00, 0.00, 0.00, 0.00, 0.00, 'BDT', 0)
    ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
    RETURNING id, user_id, available_balance, pending_escrow_balance, held_balance,
              lifetime_earned, lifetime_withdrawn, currency, version, created_at, updated_at
  `;
  const res = await runner.query(insertQuery, [userId]);
  return res.rows[0];
}

/**
 * Gets a wallet by wallet ID.
 */
export async function getWalletById(db, walletId, { client } = {}) {
  const runner = client ?? db;
  const { rows } = await runner.query(
    `SELECT id, user_id, available_balance, pending_escrow_balance, held_balance,
            lifetime_earned, lifetime_withdrawn, currency, version, created_at, updated_at
     FROM wallets
     WHERE id = $1`,
    [walletId]
  );
  return rows[0] ?? null;
}

/**
 * Gets a wallet by user ID.
 */
export async function getWalletByUserId(db, userId, { client } = {}) {
  const runner = client ?? db;
  const { rows } = await runner.query(
    `SELECT id, user_id, available_balance, pending_escrow_balance, held_balance,
            lifetime_earned, lifetime_withdrawn, currency, version, created_at, updated_at
     FROM wallets
     WHERE user_id = $1`,
    [userId]
  );
  return rows[0] ?? null;
}

/**
 * Locks a single wallet row with `SELECT ... FOR UPDATE` inside an active transaction.
 */
export async function getWalletByIdForUpdate(client, walletId) {
  const { rows } = await client.query(
    `SELECT id, user_id, available_balance, pending_escrow_balance, held_balance,
            lifetime_earned, lifetime_withdrawn, currency, version, created_at, updated_at
     FROM wallets
     WHERE id = $1
     FOR UPDATE`,
    [walletId]
  );
  return rows[0] ?? null;
}

/**
 * Locks multiple wallets with `SELECT ... FOR UPDATE` in deterministic ascending ID order
 * to prevent deadlocks during multi-party transaction transfers.
 */
export async function getWalletsByIdsForUpdate(client, walletIds) {
  if (!walletIds || walletIds.length === 0) return [];
  const uniqueSortedIds = [...new Set(walletIds.map(Number))].sort((a, b) => a - b);

  const { rows } = await client.query(
    `SELECT id, user_id, available_balance, pending_escrow_balance, held_balance,
            lifetime_earned, lifetime_withdrawn, currency, version, created_at, updated_at
     FROM wallets
     WHERE id = ANY($1::bigint[])
     ORDER BY id ASC
     FOR UPDATE`,
    [uniqueSortedIds]
  );
  return rows;
}

/**
 * Applies delta updates to balance buckets for a specific wallet row.
 * Runs inside a transaction on a row already locked with FOR UPDATE.
 */
export async function updateWalletBalances(client, walletId, {
  availableDelta = '0.00',
  pendingEscrowDelta = '0.00',
  heldDelta = '0.00',
  lifetimeEarnedDelta = '0.00',
  lifetimeWithdrawnDelta = '0.00',
}) {
  const query = `
    UPDATE wallets
    SET available_balance = available_balance + $2::numeric(14,2),
        pending_escrow_balance = pending_escrow_balance + $3::numeric(14,2),
        held_balance = held_balance + $4::numeric(14,2),
        lifetime_earned = lifetime_earned + $5::numeric(14,2),
        lifetime_withdrawn = lifetime_withdrawn + $6::numeric(14,2),
        version = version + 1,
        updated_at = now()
    WHERE id = $1
    RETURNING id, user_id, available_balance, pending_escrow_balance, held_balance,
              lifetime_earned, lifetime_withdrawn, currency, version, created_at, updated_at
  `;
  const { rows } = await client.query(query, [
    walletId,
    availableDelta,
    pendingEscrowDelta,
    heldDelta,
    lifetimeEarnedDelta,
    lifetimeWithdrawnDelta,
  ]);
  return rows[0];
}

/**
 * Inserts one or more ledger transaction rows into ledger_transactions.
 */
export async function insertLedgerEntries(client, entries) {
  if (!entries || entries.length === 0) return [];

  const results = [];
  for (const entry of entries) {
    const query = `
      INSERT INTO ledger_transactions (
        txn_group_id, wallet_id, entry_type, amount, balance_bucket,
        category, reference_type, reference_id, idempotency_key, memo,
        created_by, created_at
      )
      VALUES ($1, $2, $3, $4::numeric(14,2), $5, $6, $7, $8, $9, $10, $11, COALESCE($12, now()))
      RETURNING id, txn_group_id, wallet_id, entry_type, amount, balance_bucket,
                category, reference_type, reference_id, idempotency_key, memo,
                created_by, created_at
    `;
    const { rows } = await client.query(query, [
      entry.txn_group_id,
      entry.wallet_id,
      entry.entry_type,
      entry.amount,
      entry.balance_bucket,
      entry.category,
      entry.reference_type,
      entry.reference_id,
      entry.idempotency_key ?? null,
      entry.memo ?? null,
      entry.created_by ?? null,
      entry.created_at ?? null,
    ]);
    results.push(rows[0]);
  }
  return results;
}

/**
 * Checks ledger integrity across all wallets in the database:
 * 1. Checks that sum(ledger_transactions) matches available_balance + pending_escrow_balance + held_balance
 * 2. Checks per-bucket breakdown matches respective wallet bucket column
 * 3. Checks that all transaction groups (txn_group_id) sum to exactly zero
 */
export async function checkLedgerIntegrity(db, { client } = {}) {
  const runner = client ?? db;

  // 1. Verify wallet balances against ledger transactions
  const walletCheckQuery = `
    WITH ledger_summary AS (
      SELECT
        wallet_id,
        COALESCE(SUM(CASE WHEN entry_type = 'CREDIT' THEN amount ELSE -amount END), 0.00) AS total_ledger,
        COALESCE(SUM(CASE WHEN balance_bucket = 'AVAILABLE' THEN (CASE WHEN entry_type = 'CREDIT' THEN amount ELSE -amount END) ELSE 0.00 END), 0.00) AS available_ledger,
        COALESCE(SUM(CASE WHEN balance_bucket = 'ESCROW' THEN (CASE WHEN entry_type = 'CREDIT' THEN amount ELSE -amount END) ELSE 0.00 END), 0.00) AS escrow_ledger,
        COALESCE(SUM(CASE WHEN balance_bucket = 'HELD' THEN (CASE WHEN entry_type = 'CREDIT' THEN amount ELSE -amount END) ELSE 0.00 END), 0.00) AS held_ledger
      FROM ledger_transactions
      GROUP BY wallet_id
    )
    SELECT
      w.id AS wallet_id,
      w.user_id,
      w.available_balance,
      w.pending_escrow_balance,
      w.held_balance,
      (w.available_balance + w.pending_escrow_balance + w.held_balance) AS total_wallet_balance,
      COALESCE(ls.total_ledger, 0.00) AS total_ledger,
      COALESCE(ls.available_ledger, 0.00) AS available_ledger,
      COALESCE(ls.escrow_ledger, 0.00) AS escrow_ledger,
      COALESCE(ls.held_ledger, 0.00) AS held_ledger,
      ((w.available_balance + w.pending_escrow_balance + w.held_balance) - COALESCE(ls.total_ledger, 0.00)) AS total_drift,
      (w.available_balance - COALESCE(ls.available_ledger, 0.00)) AS available_drift,
      (w.pending_escrow_balance - COALESCE(ls.escrow_ledger, 0.00)) AS escrow_drift,
      (w.held_balance - COALESCE(ls.held_ledger, 0.00)) AS held_drift
    FROM wallets w
    LEFT JOIN ledger_summary ls ON ls.wallet_id = w.id
    ORDER BY w.id ASC
  `;
  const { rows: walletRows } = await runner.query(walletCheckQuery);

  const drifts = [];
  for (const row of walletRows) {
    const totalDrift = parseFloat(row.total_drift);
    const availableDrift = parseFloat(row.available_drift);
    const escrowDrift = parseFloat(row.escrow_drift);
    const heldDrift = parseFloat(row.held_drift);

    if (Math.abs(totalDrift) > 0.0001 || Math.abs(availableDrift) > 0.0001 || Math.abs(escrowDrift) > 0.0001 || Math.abs(heldDrift) > 0.0001) {
      drifts.push({
        wallet_id: row.wallet_id,
        user_id: row.user_id,
        available_balance: row.available_balance,
        pending_escrow_balance: row.pending_escrow_balance,
        held_balance: row.held_balance,
        total_wallet_balance: row.total_wallet_balance,
        total_ledger: row.total_ledger,
        available_ledger: row.available_ledger,
        escrow_ledger: row.escrow_ledger,
        held_ledger: row.held_ledger,
        total_drift: row.total_drift,
        available_drift: row.available_drift,
        escrow_drift: row.escrow_drift,
        held_drift: row.held_drift,
      });
    }
  }

  // 2. Verify all transaction groups sum to zero
  const groupCheckQuery = `
    SELECT
      txn_group_id,
      COUNT(*) AS entry_count,
      SUM(CASE WHEN entry_type = 'CREDIT' THEN amount ELSE -amount END) AS group_sum
    FROM ledger_transactions
    GROUP BY txn_group_id
    HAVING SUM(CASE WHEN entry_type = 'CREDIT' THEN amount ELSE -amount END) <> 0.00
  `;
  const { rows: unbalancedGroups } = await runner.query(groupCheckQuery);

  const isHealthy = drifts.length === 0 && unbalancedGroups.length === 0;

  return {
    status: isHealthy ? 'HEALTHY' : 'DRIFT_DETECTED',
    checked_at: new Date().toISOString(),
    wallets_checked: walletRows.length,
    drift_count: drifts.length,
    drifts,
    ledger_unbalanced_groups_count: unbalancedGroups.length,
    unbalanced_groups: unbalancedGroups,
  };
}
