/**
 * env.js — Environment validation (Prompt 2.1).
 *
 * Every variable the project will ever use is declared here, mirroring .env.example section for
 * section. Only the CORE / DATABASE / CACHE groups are `required` at this phase — everything else
 * is validated for shape when present, but a missing value does not block boot, since the prompt
 * that lights up that integration also switches its driver to `mock` by default.
 *
 * Fails fast with one readable error naming every problem at once (not one-at-a-time), and never
 * logs a secret value — only the variable name.
 */

const TYPES = {
  string: (v) => typeof v === 'string',
  number: (v) => Number.isFinite(v),
  boolean: (v) => typeof v === 'boolean',
};

function toBoolean(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
}

/**
 * key            → process.env name
 * group          → section, for readable error grouping
 * required       → must be present and non-empty
 * type           → 'string' | 'number' | 'boolean' | 'enum'
 * enumValues     → for type 'enum'
 * secret         → never printed, even in error messages
 * default        → applied when absent and not required
 */
const SCHEMA = [
  // CORE (0.1 / 2.1)
  { key: 'NODE_ENV', group: 'core', required: true, type: 'enum', enumValues: ['development', 'test', 'production'] },
  { key: 'LOG_LEVEL', group: 'core', required: false, type: 'string', default: 'info' },
  { key: 'PORT', group: 'core', required: true, type: 'number' },
  { key: 'HOST', group: 'core', required: true, type: 'string' },
  { key: 'PUBLIC_WEB_URL', group: 'core', required: true, type: 'string' },
  { key: 'PUBLIC_API_URL', group: 'core', required: false, type: 'string' },

  // DATABASE (2.1)
  { key: 'DATABASE_URL', group: 'database', required: true, type: 'string', secret: true },
  { key: 'DATABASE_POOL_MAX', group: 'database', required: false, type: 'number', default: 10 },
  { key: 'DATABASE_STATEMENT_TIMEOUT_MS', group: 'database', required: false, type: 'number', default: 10000 },

  // CACHE / REDIS (2.1)
  { key: 'CACHE_DRIVER', group: 'cache', required: true, type: 'enum', enumValues: ['memory', 'redis'] },
  { key: 'REDIS_URL', group: 'cache', required: false, type: 'string', secret: true },

  // AUTH & SECURITY (2.3 / 12.2) — required from 2.3 onward, since real login now depends on them
  { key: 'JWT_SECRET', group: 'auth', required: true, type: 'string', secret: true },
  { key: 'JWT_ACCESS_TTL', group: 'auth', required: false, type: 'string', default: '15m' },
  { key: 'REFRESH_TOKEN_TTL_DAYS', group: 'auth', required: false, type: 'number', default: 30 },
  { key: 'COOKIE_SECRET', group: 'auth', required: true, type: 'string', secret: true },
  { key: 'PII_ENCRYPTION_KEY', group: 'auth', required: true, type: 'string', secret: true },
  { key: 'ADMIN_IP_ALLOWLIST', group: 'auth', required: false, type: 'string', default: '' },
  { key: 'REQUIRE_2FA_FOR_STAFF', group: 'auth', required: false, type: 'boolean', default: true },

  // Everything below is reserved for later phases. Presence is validated for shape; absence never
  // blocks boot, because the owning driver defaults to `mock`/`local`/`postgres` in development.
  { key: 'SMS_DRIVER', group: 'sms', required: false, type: 'string', default: 'mock' },
  { key: 'SMS_API_KEY', group: 'sms', required: false, type: 'string', secret: true },
  { key: 'SMS_SENDER_ID', group: 'sms', required: false, type: 'string', default: 'Explooro' },
  { key: 'PAYMENT_DRIVER', group: 'payments', required: false, type: 'string', default: 'mock' },
  { key: 'COURIER_DRIVER', group: 'courier', required: false, type: 'string', default: 'mock' },
  { key: 'STORAGE_DRIVER', group: 'media', required: false, type: 'string', default: 'local' },
  { key: 'MAX_IMAGE_UPLOAD_MB', group: 'media', required: false, type: 'number', default: 8 },
  { key: 'MAX_VIDEO_UPLOAD_MB', group: 'media', required: false, type: 'number', default: 100 },
  { key: 'SEARCH_DRIVER', group: 'search', required: false, type: 'string', default: 'postgres' },
  { key: 'WHATSAPP_DRIVER', group: 'whatsapp', required: false, type: 'string', default: 'mock' },
  { key: 'EMAIL_DRIVER', group: 'notifications', required: false, type: 'string', default: 'mock' },
  { key: 'STREAM_DRIVER', group: 'streaming', required: false, type: 'string', default: 'mock' },
  { key: 'AI_DRIVER', group: 'ai', required: false, type: 'string', default: 'mock' },
  { key: 'AI_MODEL', group: 'ai', required: false, type: 'string', default: 'claude-sonnet-5' },
  { key: 'AI_MONTHLY_SPEND_CAP_USD', group: 'ai', required: false, type: 'number', default: 100 },

  // BUSINESS DEFAULTS — bootstrap only. From Prompt 3.1, platform_settings in the database wins.
  { key: 'DEFAULT_SALER_SPLIT_PCT', group: 'business', required: false, type: 'number', default: 40 },
  { key: 'DEFAULT_PLATFORM_SPLIT_PCT', group: 'business', required: false, type: 'number', default: 60 },
  { key: 'DEFAULT_ESCROW_HOLD_DAYS', group: 'business', required: false, type: 'number', default: 7 },
  { key: 'DEFAULT_MIN_PAYOUT_BDT', group: 'business', required: false, type: 'number', default: 500 },
  { key: 'DEFAULT_CURRENCY', group: 'business', required: false, type: 'string', default: 'BDT' },
];

function parseValue(spec, rawValue) {
  if (rawValue === undefined || rawValue === '') return undefined;
  if (spec.type === 'number') {
    const n = Number(rawValue);
    return Number.isFinite(n) ? n : rawValue;
  }
  if (spec.type === 'boolean') {
    const b = toBoolean(rawValue);
    return b === undefined ? rawValue : b;
  }
  return rawValue;
}

/**
 * Validates process.env against SCHEMA and returns a frozen, grouped config object.
 * Throws a single Error listing every problem when required variables are missing or malformed.
 */
export function loadEnv(source = process.env) {
  const problems = [];
  const grouped = {};

  for (const spec of SCHEMA) {
    const raw = source[spec.key];
    const parsed = parseValue(spec, raw);
    const value = parsed === undefined ? spec.default : parsed;

    if (spec.required && (value === undefined || value === '')) {
      problems.push(`  - ${spec.key} is required (${spec.group}) but was not set`);
      continue;
    }

    if (value !== undefined) {
      if (spec.type === 'enum') {
        if (!spec.enumValues.includes(value)) {
          problems.push(
            `  - ${spec.key} must be one of [${spec.enumValues.join(', ')}], got "${spec.secret ? '(hidden)' : value}"`
          );
          continue;
        }
      } else if (!TYPES[spec.type](value)) {
        problems.push(`  - ${spec.key} must be a valid ${spec.type}${spec.secret ? '' : ` (got "${value}")`}`);
        continue;
      }
    }

    grouped[spec.group] = grouped[spec.group] ?? {};
    grouped[spec.group][spec.key] = value;
  }

  // Cross-field rule: a real Redis URL is required once CACHE_DRIVER opts into it.
  if (grouped.cache?.CACHE_DRIVER === 'redis' && !grouped.cache?.REDIS_URL) {
    problems.push('  - REDIS_URL is required when CACHE_DRIVER=redis');
  }

  // Cross-field rule: a real Greenweb token is required once SMS_DRIVER opts into it.
  if (grouped.sms?.SMS_DRIVER === 'greenweb' && !grouped.sms?.SMS_API_KEY) {
    problems.push('  - SMS_API_KEY is required when SMS_DRIVER=greenweb');
  }

  // Shape rule: PII_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256), or lib/encryption.js
  // fails confusingly on first use rather than at boot.
  if (grouped.auth?.PII_ENCRYPTION_KEY) {
    const decodedLength = Buffer.from(grouped.auth.PII_ENCRYPTION_KEY, 'base64').length;
    if (decodedLength !== 32) {
      problems.push(`  - PII_ENCRYPTION_KEY must be base64 for exactly 32 bytes (got ${decodedLength})`);
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Explooro API cannot start — invalid environment configuration:\n${problems.join('\n')}\n\n` +
        'Copy .env.example to .env and fill in the missing values, then retry.'
    );
  }

  return Object.freeze({
    core: Object.freeze({
      nodeEnv: grouped.core.NODE_ENV,
      logLevel: grouped.core.LOG_LEVEL,
      port: grouped.core.PORT,
      host: grouped.core.HOST,
      publicWebUrl: grouped.core.PUBLIC_WEB_URL,
      publicApiUrl: grouped.core.PUBLIC_API_URL,
    }),
    database: Object.freeze({
      url: grouped.database.DATABASE_URL,
      poolMax: grouped.database.DATABASE_POOL_MAX,
      statementTimeoutMs: grouped.database.DATABASE_STATEMENT_TIMEOUT_MS,
    }),
    cache: Object.freeze({
      driver: grouped.cache.CACHE_DRIVER,
      redisUrl: grouped.cache.REDIS_URL,
    }),
    auth: Object.freeze({
      jwtSecret: grouped.auth?.JWT_SECRET,
      jwtAccessTtl: grouped.auth?.JWT_ACCESS_TTL,
      refreshTokenTtlDays: grouped.auth?.REFRESH_TOKEN_TTL_DAYS,
      cookieSecret: grouped.auth?.COOKIE_SECRET,
      piiEncryptionKey: grouped.auth?.PII_ENCRYPTION_KEY,
      adminIpAllowlist: grouped.auth?.ADMIN_IP_ALLOWLIST,
      require2faForStaff: grouped.auth?.REQUIRE_2FA_FOR_STAFF,
    }),
    sms: Object.freeze({
      driver: grouped.sms?.SMS_DRIVER,
      apiKey: grouped.sms?.SMS_API_KEY,
      senderId: grouped.sms?.SMS_SENDER_ID,
    }),
    isProduction: grouped.core.NODE_ENV === 'production',
    isDevelopment: grouped.core.NODE_ENV === 'development',
    isTest: grouped.core.NODE_ENV === 'test',
  });
}
