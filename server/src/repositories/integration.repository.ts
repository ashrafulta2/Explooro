/**
 * integration.repository.ts — raw SQL for `integration_settings` (migration 108) and the payment
 * webhook log the integrations page shows.
 */

const COLUMNS = `integration_key, is_enabled, credentials_encrypted, credential_hints,
  last_test_at, last_test_ok, last_test_message, updated_by, updated_at`;

export async function listIntegrationRows(db) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM integration_settings ORDER BY integration_key`);
  return rows;
}

/** Locks the row for a read-modify-write; null when the service has never been saved. */
export async function getIntegrationRowForUpdate(client, key: string) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM integration_settings WHERE integration_key = $1 FOR UPDATE`,
    [key]
  );
  return rows[0] ?? null;
}

/**
 * Serialises writes to a service that has no row yet: FOR UPDATE locks nothing when there is no
 * row, so two first saves could otherwise both read "empty" and the later would drop the earlier's
 * fields. Transaction-scoped, released on COMMIT/ROLLBACK.
 */
export async function lockIntegrationKey(client, key: string) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('integration_settings:' || $1))`, [key]);
}

export async function upsertIntegrationRow(
  client,
  {
    key,
    isEnabled,
    credentialsEncrypted,
    credentialHints,
    updatedBy,
  }: { key: string; isEnabled: boolean; credentialsEncrypted: string | null; credentialHints: Record<string, any>; updatedBy: any }
) {
  const { rows } = await client.query(
    `INSERT INTO integration_settings (integration_key, is_enabled, credentials_encrypted, credential_hints, updated_by, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, now())
     ON CONFLICT (integration_key) DO UPDATE SET
       is_enabled = EXCLUDED.is_enabled,
       credentials_encrypted = EXCLUDED.credentials_encrypted,
       credential_hints = EXCLUDED.credential_hints,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()
     RETURNING ${COLUMNS}`,
    [key, isEnabled, credentialsEncrypted, JSON.stringify(credentialHints ?? {}), updatedBy ?? null]
  );
  return rows[0];
}

/** Stores a Test Connection result; creates the row (not paused, no credentials) if needed. */
export async function recordTestResult(db, { key, ok, message }: { key: string; ok: boolean; message: string }) {
  const { rows } = await db.query(
    `INSERT INTO integration_settings (integration_key, last_test_at, last_test_ok, last_test_message)
     VALUES ($1, now(), $2, $3)
     ON CONFLICT (integration_key) DO UPDATE SET
       last_test_at = now(), last_test_ok = EXCLUDED.last_test_ok, last_test_message = EXCLUDED.last_test_message
     RETURNING ${COLUMNS}`,
    [key, ok, message]
  );
  return rows[0];
}

/** Webhooks payment gateways sent, newest first. The payload is left out: it carries shopper data. */
export async function listRecentPaymentWebhooks(db, { limit = 30 }: { limit?: number } = {}) {
  const { rows } = await db.query(
    `SELECT id, gateway, provider_event_id, signature_valid, process_result, received_at, processed_at
       FROM payment_webhook_events
      ORDER BY received_at DESC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

/** Counts behind the page's "webhooks (24h)" figure. */
export async function countPaymentWebhooksSince(db, hours = 24) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE signature_valid)::int AS valid
       FROM payment_webhook_events
      WHERE received_at >= now() - make_interval(hours => $1)`,
    [hours]
  );
  return rows[0] ?? { total: 0, valid: 0 };
}
