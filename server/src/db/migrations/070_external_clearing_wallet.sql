-- 070_external_clearing_wallet.sql
--
-- A separate account for money that enters or leaves Explooro through the outside world.
--
-- A bKash/Nagad/card payment lands in the company's merchant account, and the cash a courier
-- collects for a COD order lands with the courier. Neither is in anybody's Explooro wallet, yet the
-- escrow for that order must be funded from somewhere inside the ledger. Until now that somewhere
-- was the platform treasury (the first super admin's wallet), and payouts credited the same wallet
-- when money left. The sums met in the end, but in between the treasury showed a large negative
-- balance that mixed the platform's own profit with other people's money still in transit.
--
-- From now on:
--   * the EXTERNAL_CLEARING wallet funds escrow for gateway and COD orders (payment.service.js,
--     shipment.service.js) and takes the offsetting credit when a payout leaves (payout.service.js);
--   * the treasury only receives the platform's share and pays platform costs, so it shows profit.
--
-- The clearing wallet belongs to no person, so wallets.user_id may now be NULL for a system wallet.
-- A negative clearing balance is its normal state: minus the money the company holds outside that
-- the ledger owes to people.

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS system_key TEXT;
ALTER TABLE wallets ALTER COLUMN user_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wallets_system_key_key') THEN
    ALTER TABLE wallets ADD CONSTRAINT wallets_system_key_key UNIQUE (system_key);
  END IF;
  -- Exactly one owner: a person, or a named system account.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wallets_owner_check') THEN
    ALTER TABLE wallets ADD CONSTRAINT wallets_owner_check
      CHECK ((user_id IS NULL) <> (system_key IS NULL));
  END IF;
END $$;

INSERT INTO wallets (user_id, system_key, available_balance, pending_escrow_balance, held_balance,
                     lifetime_earned, lifetime_withdrawn, currency, version)
VALUES (NULL, 'EXTERNAL_CLEARING', 0.00, 0.00, 0.00, 0.00, 0.00, 'BDT', 0)
ON CONFLICT (system_key) DO NOTHING;

-- Move what the treasury already carries for outside money onto the clearing wallet.
--
-- On the treasury, that is: the escrow deposits it funded for paid and delivered-COD orders
-- (idempotency keys from payment.service.js and shipment.service.js), and the credits payouts gave
-- it. The ledger is append-only, so this is one balanced ADJUSTMENT group, not an edit, and its
-- idempotency key keeps a re-run from moving it twice.
DO $$
DECLARE
  treasury_user  BIGINT;
  treasury_id    BIGINT;
  clearing_id    BIGINT;
  net            NUMERIC(14,2);
  grp            UUID := md5('070_external_clearing_reclass')::uuid;
  month_start    DATE := date_trunc('month', now())::date;
BEGIN
  SELECT u.id INTO treasury_user
  FROM users u
  JOIN user_roles ur ON ur.user_id = u.id
  JOIN roles r ON r.id = ur.role_id
  WHERE r.key = 'super_admin'
  ORDER BY u.id ASC LIMIT 1;
  treasury_user := COALESCE(treasury_user, 1);

  SELECT id INTO treasury_id FROM wallets WHERE user_id = treasury_user;
  SELECT id INTO clearing_id FROM wallets WHERE system_key = 'EXTERNAL_CLEARING';
  IF treasury_id IS NULL OR clearing_id IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM ledger_transactions WHERE idempotency_key = 'clearing_reclass:070:treasury') THEN
    RETURN;
  END IF;

  -- Credit minus debit of the outside-money entries on the treasury.
  SELECT COALESCE(SUM(CASE WHEN entry_type = 'CREDIT' THEN amount ELSE -amount END), 0)
    INTO net
  FROM ledger_transactions
  WHERE wallet_id = treasury_id
    AND balance_bucket = 'AVAILABLE'
    AND (
      (category = 'ESCROW_LOCK' AND entry_type = 'DEBIT'
        AND (idempotency_key LIKE 'escrow_lock_paid:%' OR idempotency_key LIKE 'escrow_deposit_delivered:%'))
      OR (category = 'PAYOUT' AND entry_type = 'CREDIT')
    );

  IF net = 0 THEN
    RETURN;
  END IF;

  -- The ledger is partitioned by month and nothing else creates next month's partition.
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF ledger_transactions FOR VALUES FROM (%L) TO (%L)',
    'ledger_transactions_' || to_char(month_start, 'YYYY_MM'),
    month_start, (month_start + interval '1 month')::date
  );

  -- net < 0: the treasury paid for outside money, so it is credited back and clearing debited.
  INSERT INTO ledger_transactions (txn_group_id, wallet_id, entry_type, amount, balance_bucket,
                                   category, reference_type, reference_id, idempotency_key, memo)
  VALUES
    (grp, treasury_id, CASE WHEN net < 0 THEN 'CREDIT' ELSE 'DEBIT' END, abs(net), 'AVAILABLE',
     'ADJUSTMENT', 'MIGRATION', 70, 'clearing_reclass:070:treasury',
     'Outside money moved from the treasury to the external clearing account (migration 070)'),
    (grp, clearing_id, CASE WHEN net < 0 THEN 'DEBIT' ELSE 'CREDIT' END, abs(net), 'AVAILABLE',
     'ADJUSTMENT', 'MIGRATION', 70, 'clearing_reclass:070:clearing',
     'Outside money moved from the treasury to the external clearing account (migration 070)');

  UPDATE wallets SET available_balance = available_balance - net, version = version + 1, updated_at = now()
  WHERE id = treasury_id;
  UPDATE wallets SET available_balance = available_balance + net, version = version + 1, updated_at = now()
  WHERE id = clearing_id;
END $$;
