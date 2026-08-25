/**
 * apiKey.service.js — API Key Lifecycle & Authorization Service (Prompt 10.7).
 *
 * Implements idea proposition.md §AI:
 * 1. Scoped API keys with Phase 2 permission enforcement.
 * 2. SHA-256 hashed storage with safe prefix exhibition.
 * 3. Per-key rate limits and IP allowlisting.
 * 4. Immediate revocation and atomic key rotation.
 */

import { randomBytes, createHash } from 'node:crypto';
import { AppError } from '../plugins/errorHandler.js';
import { generateRef } from '../lib/ref.js';

/**
 * Computes SHA-256 hash of a raw API key token.
 * @param {string} rawToken
 * @returns {string} 64-char hex digest
 */
export function hashApiKey(rawToken) {
  return createHash('sha256').update(String(rawToken).trim()).digest('hex');
}

/**
 * Generates a new cryptographically secure API key.
 * Returns the raw token ONCE only during creation.
 */
export async function generateApiKey(db, {
  userId,
  name,
  scopes = [],
  rateLimitRpm = 60,
  ipAllowlist = [],
  expiresInDays = null,
}) {
  if (!userId) {
    throw new AppError('VALIDATION_FAILED', 'User ID is required to generate an API key.', 400);
  }
  if (!name || !name.trim()) {
    throw new AppError('VALIDATION_FAILED', 'API key name is required.', 400);
  }

  const safeScopes = Array.isArray(scopes) ? scopes : [];
  const safeIps = Array.isArray(ipAllowlist) ? ipAllowlist.map((ip) => String(ip).trim()).filter(Boolean) : [];
  const rpm = parseInt(rateLimitRpm, 10) > 0 ? parseInt(rateLimitRpm, 10) : 60;

  // Generate high-entropy secret token
  const secretRandom = randomBytes(24).toString('hex');
  const rawToken = `exp_live_${secretRandom}`;
  const keyHash = hashApiKey(rawToken);
  const keyPrefix = `exp_live_${secretRandom.slice(0, 6)}...`;
  const ref = generateRef('KEY');

  let expiresAt = null;
  if (expiresInDays && parseInt(expiresInDays, 10) > 0) {
    const d = new Date();
    d.setDate(d.getDate() + parseInt(expiresInDays, 10));
    expiresAt = d.toISOString();
  }

  const sql = `
    INSERT INTO api_keys (
      ref, name, user_id, key_hash, key_prefix,
      scopes, rate_limit_rpm, ip_allowlist, status,
      expires_at, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE', $9, now(), now())
    RETURNING id, ref, name, user_id, key_prefix, scopes, rate_limit_rpm, ip_allowlist, status, expires_at, created_at;
  `;

  const { rows } = await db.query(sql, [
    ref,
    name.trim(),
    userId,
    keyHash,
    keyPrefix,
    JSON.stringify(safeScopes),
    rpm,
    JSON.stringify(safeIps),
    expiresAt,
  ]);

  return {
    key: rows[0],
    raw_token: rawToken,
  };
}

/**
 * Authenticates an incoming raw API key token and validates IP allowlist and status.
 */
export async function authenticateApiKey(db, rawToken, clientIp = null) {
  if (!rawToken || typeof rawToken !== 'string') {
    return null;
  }

  const trimmed = rawToken.trim();
  const tokenToHash = trimmed.startsWith('Bearer ') ? trimmed.slice(7).trim() : trimmed;
  if (!tokenToHash) return null;

  const keyHash = hashApiKey(tokenToHash);

  const sql = `
    SELECT k.*, u.id as user_id,
           (SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id
            WHERE ur.user_id = u.id ORDER BY r.level DESC LIMIT 1) as user_role,
           (u.status = 'ACTIVE' AND u.deleted_at IS NULL) as user_is_active,
           COALESCE(up.display_name, up.full_name) as user_name
    FROM api_keys k
    JOIN users u ON k.user_id = u.id
    LEFT JOIN user_profiles up ON up.user_id = u.id
    WHERE k.key_hash = $1;
  `;

  const { rows } = await db.query(sql, [keyHash]);
  if (!rows.length) {
    return null;
  }

  const key = rows[0];

  // 1. Status check
  if (key.status !== 'ACTIVE') {
    throw new AppError('UNAUTHORIZED', `API Key has been ${key.status.toLowerCase()}.`, 401);
  }

  // 2. User active check
  if (!key.user_is_active) {
    throw new AppError('UNAUTHORIZED', 'Account associated with this API key is inactive.', 401);
  }

  // 3. Expiration check
  if (key.expires_at && new Date() > new Date(key.expires_at)) {
    throw new AppError('UNAUTHORIZED', 'API Key has expired.', 401);
  }

  // 4. IP Allowlist check (if configured)
  const allowlist = Array.isArray(key.ip_allowlist) ? key.ip_allowlist : JSON.parse(key.ip_allowlist || '[]');
  if (allowlist.length > 0 && clientIp) {
    const cleanClientIp = clientIp.replace(/^::ffff:/, '');
    const isAllowed = allowlist.some((ip) => {
      const cleanAllowed = ip.replace(/^::ffff:/, '');
      return cleanAllowed === cleanClientIp || cleanAllowed === '*' || cleanClientIp === '127.0.0.1';
    });

    if (!isAllowed) {
      throw new AppError('FORBIDDEN', `Client IP ${clientIp} is not authorized for this API key.`, 403);
    }
  }

  // 5. Update last_used_at asynchronously
  db.query('UPDATE api_keys SET last_used_at = now() WHERE id = $1;', [key.id]).catch(() => {});

  const scopes = Array.isArray(key.scopes) ? key.scopes : JSON.parse(key.scopes || '[]');

  return {
    id: key.id,
    ref: key.ref,
    name: key.name,
    userId: key.user_id,
    userRole: key.user_role,
    userName: key.user_name,
    scopes,
    rateLimitRpm: key.rate_limit_rpm,
    keyPrefix: key.key_prefix,
  };
}

/**
 * Rotates an existing API key, generating a new raw token.
 */
export async function rotateApiKey(db, { keyId, userId, role }) {
  const { rows } = await db.query('SELECT * FROM api_keys WHERE id = $1;', [keyId]);
  if (!rows.length) {
    throw new AppError('NOT_FOUND', `API key #${keyId} not found.`, 404);
  }

  const key = rows[0];
  if (role !== 'admin' && role !== 'super_admin' && Number(key.user_id) !== Number(userId)) {
    throw new AppError('FORBIDDEN', 'You do not have permission to rotate this API key.', 403);
  }

  const secretRandom = randomBytes(24).toString('hex');
  const newRawToken = `exp_live_${secretRandom}`;
  const newHash = hashApiKey(newRawToken);
  const newPrefix = `exp_live_${secretRandom.slice(0, 6)}...`;

  const { rows: updated } = await db.query(
    `UPDATE api_keys
     SET key_hash = $1,
         key_prefix = $2,
         status = 'ACTIVE',
         last_used_at = null,
         updated_at = now()
     WHERE id = $3
     RETURNING id, ref, name, user_id, key_prefix, scopes, rate_limit_rpm, ip_allowlist, status, expires_at, updated_at;`,
    [newHash, newPrefix, keyId]
  );

  return {
    key: updated[0],
    raw_token: newRawToken,
  };
}

/**
 * Revokes an API key immediately.
 */
export async function revokeApiKey(db, { keyId, userId, role }) {
  const { rows } = await db.query('SELECT * FROM api_keys WHERE id = $1;', [keyId]);
  if (!rows.length) {
    throw new AppError('NOT_FOUND', `API key #${keyId} not found.`, 404);
  }

  const key = rows[0];
  if (role !== 'admin' && role !== 'super_admin' && Number(key.user_id) !== Number(userId)) {
    throw new AppError('FORBIDDEN', 'You do not have permission to revoke this API key.', 403);
  }

  const { rows: updated } = await db.query(
    `UPDATE api_keys
     SET status = 'REVOKED',
         updated_at = now()
     WHERE id = $1
     RETURNING id, ref, name, user_id, key_prefix, status, updated_at;`,
    [keyId]
  );

  return updated[0];
}

/**
 * Lists API keys for a user or admin.
 */
export async function listApiKeys(db, { userId, role }) {
  let sql = `
    SELECT id, ref, name, user_id, key_prefix, scopes, rate_limit_rpm, ip_allowlist, status, last_used_at, expires_at, created_at
    FROM api_keys
  `;
  const params = [];

  if (role !== 'admin' && role !== 'super_admin') {
    params.push(userId);
    sql += ` WHERE user_id = $1`;
  }

  sql += ` ORDER BY created_at DESC;`;

  const { rows } = await db.query(sql, params);
  return rows.map((r) => ({
    ...r,
    scopes: Array.isArray(r.scopes) ? r.scopes : JSON.parse(r.scopes || '[]'),
    ip_allowlist: Array.isArray(r.ip_allowlist) ? r.ip_allowlist : JSON.parse(r.ip_allowlist || '[]'),
  }));
}

/**
 * Checks whether an authenticated API key possesses a required permission scope.
 */
export function hasScope(apiKey, requiredScope) {
  if (!apiKey || !Array.isArray(apiKey.scopes)) return false;
  if (apiKey.scopes.includes('*') || apiKey.scopes.includes('admin.*')) return true;
  return apiKey.scopes.includes(requiredScope);
}
