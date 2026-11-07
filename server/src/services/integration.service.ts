/**
 * integration.service.ts — gateway credentials and pause switches (/admin/platform/integrations,
 * migration 108). The one place that decides what is saved, what the page may see, and what a
 * Test Connection reports.
 *
 * Invariants:
 *  - A credential is stored only encrypted (lib/encryption.ts, PII_ENCRYPTION_KEY). Plain values
 *    never leave this file: the API, the page and the audit log see only `credential_hints` (a
 *    non-secret's value, a secret's last four characters).
 *  - Only fields the catalog (config/integrations.ts) names can be saved.
 *  - Every save, pause, resume and test writes an audit_logs row with before/after hints.
 *  - A saved value overrides the .env variable; clearing it falls back to .env again.
 *  - SMS and WhatsApp cannot be paused (the catalog's `pausable`).
 *
 * WHY Test Connection makes no network call: none of these drivers has a harmless "ping" yet (the
 * courier adapters do not even call their APIs). It reports what is true and checkable now: which
 * driver this deployment runs, and whether every credential the live driver needs is set. It says so
 * in its message rather than inventing a latency.
 */

import { AppError } from '../plugins/errorHandler.ts';
import { encryptField, decryptField } from '../lib/encryption.ts';
import * as integrationRepo from '../repositories/integration.repository.ts';
import { refreshIntegrationCredentials } from '../integrations/credentialStore.ts';
import { INTEGRATIONS, integrationByKey, driverModeOf, type IntegrationDef } from '../config/integrations.ts';

/** Bounds for one credential value; a PEM private key is the longest thing pasted here. */
export const VALUE_LIMITS = Object.freeze({ maxLength: 8192 });
export const REASON_MIN_LENGTH = 10;
export const LOG_LIMITS = Object.freeze({ min: 1, max: 100, fallback: 30 });

const SECRET_MASK = '••••';

function requireDef(key: string): IntegrationDef {
  const def = integrationByKey(String(key || ''));
  if (!def) {
    throw new AppError('NOT_FOUND', 'No such integration.', 'এই ইন্টিগ্রেশনটি পাওয়া যায়নি।', { key });
  }
  return def;
}

function requireReason(reason: unknown): string {
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (text.length < REASON_MIN_LENGTH) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Give a reason of at least ${REASON_MIN_LENGTH} characters for this change.`,
      `এই পরিবর্তনের জন্য অন্তত ${REASON_MIN_LENGTH} অক্ষরের একটি কারণ লিখুন।`,
      { field: 'reason' }
    );
  }
  return text;
}

/** What the page may show for a value without revealing a secret. */
export function hintFor(secret: boolean, value: string | undefined | null): string | null {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value);
  if (!secret) return text.length > 120 ? `${text.slice(0, 117)}...` : text;
  // WHY no characters from a short secret: four of six characters is most of the secret.
  return text.length >= 12 ? `${SECRET_MASK}${text.slice(-4)}` : SECRET_MASK;
}

export function hintsFor(def: IntegrationDef, values: Record<string, string>): Record<string, string> {
  const hints: Record<string, string> = {};
  for (const f of def.fields) {
    const h = hintFor(f.secret, values[f.key]);
    if (h !== null) hints[f.key] = h;
  }
  return hints;
}

function decryptRow(row, encryptionKey): { values: Record<string, string>; readable: boolean } {
  if (!row?.credentials_encrypted) return { values: {}, readable: true };
  try {
    const parsed = JSON.parse(decryptField(row.credentials_encrypted, encryptionKey));
    return { values: parsed && typeof parsed === 'object' ? parsed : {}, readable: true };
  } catch {
    return { values: {}, readable: false };
  }
}

/** Per field: where the driver gets it from now, and what the page may show of it. */
function describeFields(def: IntegrationDef, hints: Record<string, string>, env: Record<string, string | undefined>) {
  return def.fields.map((f) => {
    const saved = hints?.[f.key];
    const envValue = env[f.env];
    const source = saved ? 'SAVED' : envValue ? 'ENV' : 'MISSING';
    return {
      key: f.key,
      label_en: f.label_en,
      label_bn: f.label_bn,
      env: f.env,
      secret: f.secret,
      required: f.required,
      source,
      hint: saved ?? (envValue ? hintFor(f.secret, envValue) : null),
    };
  });
}

function shapeIntegration(def: IntegrationDef, row, { env, publicApiUrl }) {
  const fields = describeFields(def, row?.credential_hints ?? {}, env);
  const mode = driverModeOf(def, env);
  const missingRequired = fields.filter((f) => f.required && f.source === 'MISSING').map((f) => f.key);
  const base = String(publicApiUrl || '').replace(/\/+$/, '');
  return {
    key: def.key,
    name: def.name,
    type: def.type,
    category_en: def.category_en,
    category_bn: def.category_bn,
    description_en: def.description_en,
    description_bn: def.description_bn,
    driver_env: def.driver_env,
    driver_mode: mode,
    is_enabled: row ? row.is_enabled !== false : true,
    pausable: def.pausable,
    pause_effect_en: def.pause_effect_en,
    pause_effect_bn: def.pause_effect_bn,
    webhook_url: def.webhook_path ? `${base}${def.webhook_path}` : null,
    fields,
    missing_required: missingRequired,
    last_test: row?.last_test_at
      ? { at: row.last_test_at, ok: row.last_test_ok === true, message: row.last_test_message ?? '' }
      : null,
    updated_at: row?.updated_at ?? null,
  };
}

export async function listIntegrations(
  db,
  { env = process.env, publicApiUrl = process.env.PUBLIC_API_URL }: { env?: Record<string, string | undefined>; publicApiUrl?: string } = {}
) {
  let rows = [];
  try {
    rows = await integrationRepo.listIntegrationRows(db);
  } catch {
    // Before migration 108 the page still shows every service, read from .env alone.
  }
  const byKey = new Map(rows.map((r) => [r.integration_key, r]));
  const integrations = INTEGRATIONS.map((def) => shapeIntegration(def, byKey.get(def.key), { env, publicApiUrl }));

  let webhooks = { total: 0, valid: 0 };
  try {
    webhooks = await integrationRepo.countPaymentWebhooksSince(db, 24);
  } catch {
    // The figure is optional; the cards are the page.
  }

  const count = (pred) => integrations.filter(pred).length;
  return {
    integrations,
    metrics: {
      total: integrations.length,
      live: count((i) => i.driver_mode === 'LIVE'),
      mock: count((i) => i.driver_mode === 'MOCK'),
      off: count((i) => i.driver_mode === 'OFF'),
      paused: count((i) => !i.is_enabled),
      // A live service missing a credential its driver needs: the one thing to fix first.
      needs_attention: count((i) => i.driver_mode === 'LIVE' && i.missing_required.length > 0),
      webhooks_24h: webhooks.total,
      webhooks_24h_valid: webhooks.valid,
    },
  };
}

function validateValues(def: IntegrationDef, values: unknown, clear: unknown) {
  const known = new Set(def.fields.map((f) => f.key));
  const set: Record<string, string> = {};
  if (values !== undefined && values !== null) {
    if (typeof values !== 'object' || Array.isArray(values)) {
      throw new AppError('VALIDATION_FAILED', 'Credentials must be an object of field values.', 'ক্রেডেনশিয়াল সঠিক ফরম্যাটে দিন।', { field: 'values' });
    }
    for (const [k, v] of Object.entries(values as Record<string, unknown>)) {
      if (!known.has(k)) {
        throw new AppError('VALIDATION_FAILED', `${def.name} has no field "${k}".`, `${def.name} এ "${k}" নামে কোনো ঘর নেই।`, { field: k });
      }
      if (typeof v !== 'string') {
        throw new AppError('VALIDATION_FAILED', `"${k}" must be text.`, `"${k}" অবশ্যই লেখা হতে হবে।`, { field: k });
      }
      const text = v.trim();
      // WHY empty means "leave as it is": a secret is never sent to the browser, so its box is empty
      // on every edit. Clearing a saved value is the separate `clear` list.
      if (text === '') continue;
      if (text.length > VALUE_LIMITS.maxLength) {
        throw new AppError('VALIDATION_FAILED', `"${k}" is too long.`, `"${k}" অনেক বড়।`, { field: k });
      }
      set[k] = text;
    }
  }

  const cleared: string[] = [];
  if (clear !== undefined && clear !== null) {
    if (!Array.isArray(clear)) {
      throw new AppError('VALIDATION_FAILED', 'clear must be a list of field names.', 'clear অবশ্যই ঘরের নামের তালিকা হতে হবে।', { field: 'clear' });
    }
    for (const k of clear) {
      if (!known.has(k)) {
        throw new AppError('VALIDATION_FAILED', `${def.name} has no field "${k}".`, `${def.name} এ "${k}" নামে কোনো ঘর নেই।`, { field: k });
      }
      if (set[k] !== undefined) {
        throw new AppError('VALIDATION_FAILED', `"${k}" cannot be both set and cleared.`, `"${k}" একসাথে সেট ও মুছে ফেলা যায় না।`, { field: k });
      }
      cleared.push(k);
    }
  }

  if (!Object.keys(set).length && !cleared.length) {
    throw new AppError('VALIDATION_FAILED', 'Nothing to change: type a new value or clear one.', 'পরিবর্তনের কিছু নেই: নতুন মান লিখুন বা একটি মুছুন।');
  }
  return { set, cleared };
}

/** Runs `fn` in one transaction on a dedicated client when the pool offers one. */
async function inTransaction(db, fn) {
  const client = db.connect ? await db.connect() : db;
  const dedicated = Boolean(db.connect);
  try {
    if (dedicated) await client.query('BEGIN');
    const result = await fn(client);
    if (dedicated) await client.query('COMMIT');
    return result;
  } catch (err) {
    if (dedicated) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (dedicated && client.release) client.release();
  }
}

function auditContext({ userId, actorRole, reqContext }) {
  return {
    actorId: userId ?? null,
    actorRole: actorRole ?? null,
    ip: reqContext?.ip ?? null,
    userAgent: reqContext?.userAgent ?? null,
    traceId: reqContext?.traceId ?? null,
  };
}

/** Saves new credential values and/or clears saved ones (falling back to .env). */
export async function updateCredentials(
  db,
  auditService,
  {
    key,
    values,
    clear,
    reason,
    userId = null,
    actorRole = null,
    reqContext = {},
    encryptionKey,
    env = process.env,
    publicApiUrl = process.env.PUBLIC_API_URL,
  }: Record<string, any>
) {
  const def = requireDef(key);
  const why = requireReason(reason);
  const { set, cleared } = validateValues(def, values, clear);
  if (!encryptionKey) {
    throw new AppError('INTERNAL_ERROR', 'PII_ENCRYPTION_KEY is not configured.', 'PII_ENCRYPTION_KEY সেট করা নেই।');
  }

  const { before, after, unreadable } = await inTransaction(db, async (client) => {
    await integrationRepo.lockIntegrationKey(client, def.key);
    const row = await integrationRepo.getIntegrationRowForUpdate(client, def.key);
    const { values: current, readable } = decryptRow(row, encryptionKey);

    const next = { ...current, ...set };
    for (const k of cleared) delete next[k];
    // Drop anything the catalog no longer names, so a removed field cannot linger encrypted.
    for (const k of Object.keys(next)) if (!def.fields.some((f) => f.key === k)) delete next[k];

    const saved = await integrationRepo.upsertIntegrationRow(client, {
      key: def.key,
      isEnabled: row ? row.is_enabled !== false : true,
      credentialsEncrypted: Object.keys(next).length ? encryptField(JSON.stringify(next), encryptionKey) : null,
      credentialHints: hintsFor(def, next),
      updatedBy: userId,
    });

    const prior = {
      is_enabled: row ? row.is_enabled !== false : true,
      credential_hints: row?.credential_hints ?? {},
    };
    if (auditService?.record) {
      await auditService.record(client, {
        action: 'platform.integration.update',
        targetType: 'integration_settings',
        targetRef: def.key,
        beforeJson: prior,
        afterJson: { is_enabled: saved.is_enabled, credential_hints: saved.credential_hints },
        meta: {
          reason: why,
          changed_fields: Object.keys(set),
          cleared_fields: cleared,
          // An unreadable row (the encryption key changed) was replaced by what was typed now.
          ...(readable ? {} : { previous_credentials_unreadable: true }),
        },
        riskTier: 'CRITICAL',
        ...auditContext({ userId, actorRole, reqContext }),
      });
    }
    return { before: prior, after: saved, unreadable: !readable };
  });

  await refreshIntegrationCredentials(db, encryptionKey);
  return {
    integration: shapeIntegration(def, after, { env, publicApiUrl }),
    previous_credentials_unreadable: unreadable,
    before,
  };
}

/** Pauses or resumes a service. Refused for one the catalog marks not pausable. */
export async function setEnabled(
  db,
  auditService,
  {
    key,
    enabled,
    reason,
    userId = null,
    actorRole = null,
    reqContext = {},
    encryptionKey,
    env = process.env,
    publicApiUrl = process.env.PUBLIC_API_URL,
  }: Record<string, any>
) {
  const def = requireDef(key);
  if (typeof enabled !== 'boolean') {
    throw new AppError('VALIDATION_FAILED', 'enabled must be true or false.', 'enabled অবশ্যই true বা false হতে হবে।', { field: 'enabled' });
  }
  const why = requireReason(reason);
  if (!def.pausable && enabled === false) {
    throw new AppError('CONFLICT', def.pause_effect_en, def.pause_effect_bn, { reason: 'NOT_PAUSABLE', key: def.key });
  }

  const after = await inTransaction(db, async (client) => {
    await integrationRepo.lockIntegrationKey(client, def.key);
    const row = await integrationRepo.getIntegrationRowForUpdate(client, def.key);
    const wasEnabled = row ? row.is_enabled !== false : true;
    if (wasEnabled === enabled) {
      return row; // Nothing changes, so nothing is audited.
    }
    const saved = await integrationRepo.upsertIntegrationRow(client, {
      key: def.key,
      isEnabled: enabled,
      credentialsEncrypted: row?.credentials_encrypted ?? null,
      credentialHints: row?.credential_hints ?? {},
      updatedBy: userId,
    });
    if (auditService?.record) {
      await auditService.record(client, {
        action: enabled ? 'platform.integration.resume' : 'platform.integration.pause',
        targetType: 'integration_settings',
        targetRef: def.key,
        beforeJson: { is_enabled: wasEnabled },
        afterJson: { is_enabled: enabled },
        meta: { reason: why },
        riskTier: 'CRITICAL',
        ...auditContext({ userId, actorRole, reqContext }),
      });
    }
    return saved;
  });

  await refreshIntegrationCredentials(db, encryptionKey);
  return { integration: shapeIntegration(def, after, { env, publicApiUrl }) };
}

/**
 * Checks what can be checked without calling the provider (see the file header) and stores the
 * result so the card shows it after a reload.
 */
export async function testIntegration(
  db,
  auditService,
  {
    key,
    userId = null,
    actorRole = null,
    reqContext = {},
    env = process.env,
    publicApiUrl = process.env.PUBLIC_API_URL,
  }: Record<string, any>
) {
  const def = requireDef(key);
  let row = null;
  try {
    row = (await integrationRepo.listIntegrationRows(db)).find((r) => r.integration_key === def.key) ?? null;
  } catch {
    // Without migration 108 the check still reads .env.
  }
  const shaped = shapeIntegration(def, row, { env, publicApiUrl });
  const missing = shaped.fields.filter((f) => f.required && f.source === 'MISSING');
  const missingNames = missing.map((f) => f.env).join(', ');

  let ok: boolean;
  let message_en: string;
  let message_bn: string;
  if (shaped.driver_mode === 'OFF') {
    ok = false;
    message_en = `Switched off for this deployment (${def.driver_env}=none).`;
    message_bn = `এই ডিপ্লয়মেন্টে বন্ধ আছে (${def.driver_env}=none)।`;
  } else if (shaped.driver_mode === 'MOCK') {
    ok = true;
    message_en = `Mock driver: nothing is sent to ${def.name}. Set ${def.driver_env} to go live.`;
    message_bn = `মক ড্রাইভার: ${def.name} এ কিছু পাঠানো হয় না। লাইভ করতে ${def.driver_env} সেট করুন।`;
  } else if (missing.length) {
    ok = false;
    message_en = `Missing: ${missingNames}. The live driver cannot work without them.`;
    message_bn = `নেই: ${missingNames}। এগুলো ছাড়া লাইভ ড্রাইভার কাজ করবে না।`;
  } else {
    ok = true;
    message_en = 'Every credential the live driver needs is set. No live call is made from here yet.';
    message_bn = 'লাইভ ড্রাইভারের সব ক্রেডেনশিয়াল সেট আছে। এখান থেকে এখনো লাইভ কল করা হয় না।';
  }
  if (!shaped.is_enabled) {
    message_en += ' It is paused.';
    message_bn += ' এটি পজ করা আছে।';
  }

  let saved = row;
  try {
    saved = await integrationRepo.recordTestResult(db, { key: def.key, ok, message: message_en });
    if (auditService?.record) {
      await auditService.record(db, {
        action: 'platform.integration.test',
        targetType: 'integration_settings',
        targetRef: def.key,
        beforeJson: row?.last_test_at ? { last_test_ok: row.last_test_ok, last_test_at: row.last_test_at } : null,
        afterJson: { last_test_ok: ok, driver_mode: shaped.driver_mode, missing: missing.map((f) => f.key) },
        riskTier: 'LOW',
        ...auditContext({ userId, actorRole, reqContext }),
      });
    }
  } catch {
    // The check itself is the answer; failing to store it must not hide it.
  }

  return {
    ok,
    driver_mode: shaped.driver_mode,
    missing: missing.map((f) => f.key),
    message_en,
    message_bn,
    integration: shapeIntegration(def, saved, { env, publicApiUrl }),
  };
}

export async function listWebhookLogs(db, { limit }: { limit?: unknown } = {}) {
  const n = Number.parseInt(String(limit ?? ''), 10);
  const bounded = Number.isFinite(n) ? Math.min(LOG_LIMITS.max, Math.max(LOG_LIMITS.min, n)) : LOG_LIMITS.fallback;
  try {
    return { logs: await integrationRepo.listRecentPaymentWebhooks(db, { limit: bounded }) };
  } catch {
    return { logs: [] };
  }
}
