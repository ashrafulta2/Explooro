/**
 * errorHandler.js — Central error handler (Prompt 2.1).
 *
 * Maps every thrown error to the exact envelope in docs/api-contract.md §2.3, attaches the
 * request's trace_id, logs server-side with that same trace_id, and never leaks a stack trace,
 * SQL fragment, or internal path to the client — especially in production.
 */

/** The closed enum from docs/api-contract.md §3. Adding a code is a deliberate doc change first. */
const ERROR_STATUS = {
  // 3.1 Authentication — 401
  AUTH_REQUIRED: 401,
  AUTH_INVALID: 401,
  AUTH_EXPIRED: 401,
  TWO_FACTOR_REQUIRED: 401,
  TWO_FACTOR_INVALID: 401,
  OTP_INVALID: 401,
  OTP_EXPIRED: 401,
  OTP_ATTEMPTS_EXCEEDED: 429,
  // 3.2 Authorization — 403
  PERMISSION_DENIED: 403,
  MODULE_DISABLED: 403,
  USER_RESTRICTED: 403,
  ACCOUNT_SUSPENDED: 403,
  KYC_REQUIRED: 403,
  SELF_APPROVAL_FORBIDDEN: 403,
  // Generic business-rule/ownership denial (Prompt 4.6) — distinct from PERMISSION_DENIED, which
  // is specifically an RBAC catalog gate. Also fixes product.service.js's pre-existing ownership
  // check, which threw this same code and had been silently falling through to 500 until now.
  FORBIDDEN: 403,
  // 3.3 Request problems — 4xx
  VALIDATION_FAILED: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  IDEMPOTENCY_MISMATCH: 409,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PRECONDITION_CHANGED: 409,
  MEDIA_TOO_LARGE: 413,
  MEDIA_TYPE_REJECTED: 415,
  RATE_LIMITED: 429,
  // 3.4 Commerce & finance — 409 / 422
  INSUFFICIENT_STOCK: 409,
  INSUFFICIENT_BALANCE: 422,
  PAYOUT_BELOW_MINIMUM: 422,
  COD_OTP_REQUIRED: 422,
  COUPON_INVALID: 422,
  COUPON_BUDGET_EXHAUSTED: 409,
  ESCROW_LOCKED: 409,
  TEAM_PURCHASE_CLOSED: 409,
  THEME_CONTRAST_FAILED: 422,
  GRADIENTS_FORBIDDEN: 422,
  // 3.5 Upstream & system — 5xx
  PAYMENT_FAILED: 502,
  UPSTREAM_UNAVAILABLE: 503,
  WEBHOOK_SIGNATURE_INVALID: 401,
  INTERNAL_ERROR: 500,
  SERVICE_DEGRADED: 503,
};

/**
 * Throw this anywhere in a service/controller for a documented, client-facing error. Anything
 * else thrown (a bare Error, a driver exception) is treated as INTERNAL_ERROR and its detail is
 * logged but never sent to the client.
 */
export class AppError extends Error {
  constructor(code, messageEn, messageBn, details) {
    super(messageEn);
    this.name = 'AppError';
    this.code = code;
    this.messageEn = messageEn;
    this.messageBn = messageBn;
    this.details = details;
    this.statusCode = ERROR_STATUS[code] ?? 500;
  }
}

/** Bengali messages for Ajv's generic validation keywords — always present, per §7. */
const VALIDATION_RULE_MESSAGES_BN = {
  required: 'এই তথ্যটি আবশ্যক',
  minLength: 'অনেক ছোট',
  maxLength: 'অনেক বড়',
  minimum: 'সর্বনিম্ন মান পূরণ হয়নি',
  maximum: 'সর্বোচ্চ মান ছাড়িয়ে গেছে',
  pattern: 'সঠিক ফরম্যাটে নয়',
  type: 'সঠিক ধরনের নয়',
  enum: 'অনুমোদিত মানের একটি নয়',
  additionalProperties: 'অতিরিক্ত অজানা তথ্য গ্রহণযোগ্য নয়',
};

function mapValidationErrors(ajvErrors) {
  return ajvErrors.map((e) => {
    const field = (e.instancePath || (e.params && e.params.missingProperty ? `/${e.params.missingProperty}` : ''))
      .replace(/^\//, '')
      .replace(/\//g, '.');
    return {
      field: field || '(body)',
      rule: e.keyword,
      message_en: e.message ?? 'Invalid value',
      message_bn: VALIDATION_RULE_MESSAGES_BN[e.keyword] ?? 'তথ্য সঠিক নয়',
    };
  });
}

function toEnvelope(err, traceId) {
  if (err instanceof AppError) {
    return {
      status: ERROR_STATUS[err.code] ?? 500,
      body: {
        error: {
          code: err.code,
          message_en: err.messageEn,
          message_bn: err.messageBn,
          ...(err.details ? { details: err.details } : {}),
          trace_id: traceId,
        },
      },
    };
  }

  // Fastify's own schema-validation errors arrive with a `validation` array (Ajv errors).
  if (err.validation) {
    return {
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          message_en: 'Some fields need attention.',
          message_bn: 'কিছু তথ্য ঠিক করা প্রয়োজন।',
          details: { fields: mapValidationErrors(err.validation) },
          trace_id: traceId,
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message_en: 'Something went wrong on our end.',
        message_bn: 'আমাদের দিক থেকে কিছু একটা সমস্যা হয়েছে।',
        trace_id: traceId,
      },
    },
  };
}

export default function errorHandlerPlugin(app) {
  app.setErrorHandler((err, req, reply) => {
    const traceId = req.traceId ?? 'unknown';
    const { status, body } = toEnvelope(err, traceId);

    if (status >= 500) {
      req.log.error({ err, traceId }, 'unhandled error');
    } else {
      req.log.warn({ code: body.error.code, traceId }, 'request error');
    }

    if (status === 429) {
      const retryAfterS = body.error.details?.retry_after_s ?? err.retryAfterSeconds;
      if (retryAfterS) reply.header('Retry-After', String(retryAfterS));
    }

    reply.code(status).send(body);
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message_en: `No route for ${req.method} ${req.url}`,
        message_bn: `${req.method} ${req.url} এর জন্য কোনো রুট নেই`,
        trace_id: req.traceId ?? 'unknown',
      },
    });
  });
}

errorHandlerPlugin[Symbol.for('skip-override')] = true;
