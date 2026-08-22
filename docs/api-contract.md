# Explooro — API Contract, Errors & Idempotency

> **Produced by:** Prompt 0.6
> **Implemented by:** Prompt 2.1 (error handler, request context), then every backend prompt
> **Depends on:** [`rbac-spec.md`](rbac-spec.md), [`erd.md`](erd.md)
>
> This document exists so that ~60 backend prompts do not each invent their own response shape.
> Any endpoint that deviates from it is a defect, regardless of whether it "works".

---

## 1. Base, Versioning & Deprecation

```
https://api.explooro.com/api/v1/...
```

In development the Vite proxy makes `/api/v1/...` same-origin (`vite.config.js`), so the **path
shape is identical in dev and production**. No environment-specific base URL logic anywhere in the
client.

### Versioning policy

- The version is in the path (`/api/v1`), not a header. It is greppable, cacheable, and visible in
  logs — a header-based version is invisible exactly when you are debugging.
- **`v1` never breaks.** Additive changes only: new optional fields, new endpoints, new enum values
  that clients are required to tolerate.
- A breaking change means `v2`, served alongside `v1`.
- Deprecation: an endpoint scheduled for removal returns
  `Deprecation: true` and `Sunset: <RFC 1123 date>` headers for **at least 180 days** before it
  stops responding. The mobile app (Prompt 12.3) cannot be force-upgraded on users' phones, so this
  window is not negotiable.

### Client compatibility rule

Clients **must ignore unknown response fields** and **must not fail on unknown enum values** —
they degrade to a neutral rendering instead. Without this rule, adding an order status becomes a
breaking change for every installed mobile app.

---

## 2. The Three Envelopes

Every response is exactly one of three shapes. There is no fourth.

### 2.1 Success — `2xx`

```json
{
  "data": { "...": "..." },
  "meta": { "...": "..." }
}
```

- `data` is **always an object or an array under a named key** — never a bare top-level array.
  A bare array cannot grow: the day you need to add `total` you have a breaking change.
- `meta` is optional; it carries pagination, idempotency notices, and rate-limit context.

```json
{
  "data": { "products": [ { "ref": "PRD-8F2K", "title": "শাড়ি" } ] },
  "meta": { "cursor": { "next": "eyJpZCI6NDIx", "has_more": true }, "count": 20 }
}
```

### 2.2 Deferred — `202 Accepted`

Returned when the caller holds the permission but the effect is **queued for approval**
(maker-checker, `rbac-spec.md` §3.3). This is neither a success nor an error: the request was
valid and accepted, but nothing has changed yet.

```json
{
  "deferred": {
    "code": "PERMISSION_PENDING_APPROVAL",
    "pending_action_ref": "PAA-7K2M9X",
    "action_key": "orders.refund.execute",
    "message_en": "Sent for approval. Your Admin must approve this before it takes effect.",
    "message_bn": "অনুমোদনের জন্য পাঠানো হয়েছে। কার্যকর হওয়ার আগে আপনার অ্যাডমিনকে এটি অনুমোদন করতে হবে।",
    "expires_at": "2026-08-24T09:12:00Z",
    "trace_id": "01J8XQ2K4M7N"
  }
}
```

> **Why a third envelope.** Forcing this into `error` would be wrong — nothing failed. Forcing it
> into `data` would be worse — the client would render success for an action that has not happened.
> A distinct shape means the client cannot accidentally show the wrong outcome.

### 2.3 Error — `4xx` / `5xx`

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message_en": "Only 2 left of \"হ্যান্ডলুম শাড়ি\".",
    "message_bn": "\"হ্যান্ডলুম শাড়ি\" এর মাত্র ২টি বাকি আছে।",
    "details": { "product_ref": "PRD-8F2K", "requested": 5, "available": 2 },
    "trace_id": "01J8XQ2K4M7N"
  }
}
```

**Field rules**

| Field | Rule |
| :--- | :--- |
| `code` | Machine-readable. From the enum in §3. Clients branch on this, never on message text |
| `message_en` / `message_bn` | **Both always present.** Human-readable, actionable, safe to display verbatim |
| `details` | Optional, structured. Field-level errors, remaining quantities, the reason for a restriction |
| `trace_id` | **Always present.** Same id in the server log and the `audit_logs` row. It is what turns "it broke" into a five-second investigation |

**Never** put a stack trace, SQL fragment, internal path, or table name in a message. `5xx`
responses return a generic message plus the `trace_id`; the real cause goes to the logs only.

---

## 3. Error Code Enum

Complete and closed. Adding a code is a deliberate change to this document.

### 3.1 Authentication — 401

| Code | Status | When |
| :--- | :--- | :--- |
| `AUTH_REQUIRED` | 401 | No credentials on a protected route |
| `AUTH_INVALID` | 401 | Bad or tampered token; refresh-token reuse detected |
| `AUTH_EXPIRED` | 401 | Access token expired — client should refresh once, then retry |
| `TWO_FACTOR_REQUIRED` | 401 | Staff account with a MEDIUM+ permission and no 2FA in this session |
| `TWO_FACTOR_INVALID` | 401 | Wrong TOTP code |
| `OTP_INVALID` | 401 | Wrong OTP |
| `OTP_EXPIRED` | 401 | OTP past its 5-minute TTL |
| `OTP_ATTEMPTS_EXCEEDED` | 429 | More than 5 verification attempts |

### 3.2 Authorization — 403

| Code | Status | When |
| :--- | :--- | :--- |
| `PERMISSION_DENIED` | 403 | Permission not held. **Carries `requestable`** — see §3.6 |
| `MODULE_DISABLED` | 403 | The feature is switched off platform-wide |
| `USER_RESTRICTED` | 403 | A `user_restrictions` rule blocks this capability |
| `ACCOUNT_SUSPENDED` | 403 | Account status is `SUSPENDED` or `BANNED` |
| `KYC_REQUIRED` | 403 | Verification must be completed first |
| `SELF_APPROVAL_FORBIDDEN` | 403 | Actor attempted to approve their own pending action |
| `FORBIDDEN` | 403 | A business-rule ownership/eligibility check failed (e.g. editing someone else's product, reviewing a product never purchased) — distinct from `PERMISSION_DENIED`, which is specifically an RBAC catalog permission gate carrying `requestable`/Request-Access semantics that don't apply here. Added Prompt 4.6, retrofitted onto product.service.js's pre-existing (until now silently 500-ing) ownership check. |

### 3.3 Request problems — 4xx

| Code | Status | When |
| :--- | :--- | :--- |
| `VALIDATION_FAILED` | 400 | Schema validation failed. `details.fields` lists each failure |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | A money/order endpoint was called without the header |
| `IDEMPOTENCY_MISMATCH` | 409 | Same key, different payload — see §5.4 |
| `NOT_FOUND` | 404 | Resource absent, or present but not visible to this caller |
| `CONFLICT` | 409 | Generic state conflict (duplicate slug, already-cancelled order) |
| `PRECONDITION_CHANGED` | 409 | Maker-checker re-validation failed at approval time |
| `MEDIA_TOO_LARGE` | 413 | Above the configured size limit |
| `MEDIA_TYPE_REJECTED` | 415 | Magic-byte sniffing rejected the content type |
| `RATE_LIMITED` | 429 | Rate limit exceeded. `Retry-After` header is set |

### 3.4 Commerce & finance — 409 / 422

| Code | Status | When |
| :--- | :--- | :--- |
| `INSUFFICIENT_STOCK` | 409 | Not enough stock. `details` names the specific line item |
| `INSUFFICIENT_BALANCE` | 422 | Wallet cannot cover the request |
| `PAYOUT_BELOW_MINIMUM` | 422 | Below `min_payout_amount` |
| `COD_OTP_REQUIRED` | 422 | COD order needs OTP confirmation before it can be placed |
| `COUPON_INVALID` | 422 | Expired, wrong scope, min-spend unmet, or per-user limit reached |
| `COUPON_BUDGET_EXHAUSTED` | 409 | The coupon's budget cap is spent |
| `ESCROW_LOCKED` | 409 | Funds are still inside the return window |
| `TEAM_PURCHASE_CLOSED` | 409 | The group-buy window expired or the team is full |

### 3.5 Upstream & system — 5xx

| Code | Status | When |
| :--- | :--- | :--- |
| `PAYMENT_FAILED` | 502 | The gateway declined or errored. `details.gateway_code` carries their code |
| `UPSTREAM_UNAVAILABLE` | 503 | Courier, SMS, storage, or AI provider unreachable |
| `WEBHOOK_SIGNATURE_INVALID` | 401 | Inbound webhook HMAC did not verify |
| `INTERNAL_ERROR` | 500 | Everything else. Generic message + `trace_id` only |
| `SERVICE_DEGRADED` | 503 | Health check failing; the feature is deliberately shed |

### 3.6 Non-error codes

Two codes travel in the same `code` field but are **not** errors. They are listed here so the enum
is complete and greppable, and so no implementer mistakes them for failures.

| Code | Status | Envelope | Meaning |
| :--- | :--- | :--- | :--- |
| `PERMISSION_PENDING_APPROVAL` | 202 | `deferred` (§2.2) | Valid and accepted; queued for maker-checker approval. **Nothing has changed yet** |
| `IDEMPOTENCY_REPLAY` | *original* | `meta.idempotency` (§5.3) | This exact request already succeeded; the stored response is being replayed |

Neither may be rendered as an error by any client. `PERMISSION_PENDING_APPROVAL` renders as
"Sent for approval"; `IDEMPOTENCY_REPLAY` renders as the original success.

### 3.7 `PERMISSION_DENIED` carries the path forward

This is what makes the locked-state UI in `ia-sitemap.md` §5 work. The client must not have to
know the risk tiers — the server tells it what is possible.

```json
{
  "error": {
    "code": "PERMISSION_DENIED",
    "message_en": "You don't have access to this yet.",
    "message_bn": "এতে আপনার এখনো অ্যাক্সেস নেই।",
    "details": {
      "permission_key": "orders.return.approve",
      "risk_tier": "MEDIUM",
      "requestable": true,
      "plain_en": "approve a return so the refund process begins",
      "plain_bn": "রিটার্ন অনুমোদন করে রিফান্ড প্রক্রিয়া শুরু করতে"
    },
    "trace_id": "01J8XQ2K4M7N"
  }
}
```

| `risk_tier` | `requestable` | Client renders |
| :--- | :--- | :--- |
| `MEDIUM` | `true` | Lock + **Request access** button (JIT, Mode B) |
| `HIGH` | `false` | Lock + **Submit for approval** (maker-checker, Mode C) |
| `CRITICAL` | `false` | Lock + "Only a Super Admin can use this." No affordance |

`plain_en` / `plain_bn` come straight from `permission-catalog.json` and fill the
`{plainLanguage}` slot in the Request Access modal.

---

## 4. Pagination

Two modes. Choose by access pattern, not by preference.

### 4.1 Cursor — for feeds and anything real-time

Used by: product catalog, search, chat messages, notifications, activity timelines, ledger.

```
GET /api/v1/products?limit=20&cursor=eyJpZCI6NDIxfQ
```

```json
{
  "data": { "products": [ "..." ] },
  "meta": { "cursor": { "next": "eyJpZCI6NDAxfQ", "has_more": true }, "count": 20 }
}
```

- The cursor is an opaque base64 payload. Clients **must not** decode or construct it.
- `limit` default 20, maximum 100.
- **Why cursor:** with offset pagination, a row inserted while the user is on page 1 pushes an item
  onto page 2 and they see it twice — or miss one. On a live marketplace feed that happens
  constantly.
- The ledger uses cursor pagination for the same reason: entries append while you are reading.

### 4.2 Offset — for admin tables

Used by: admin user lists, moderation queues, payout queues, audit log browsing.

```
GET /api/v1/admin/users?page=3&per_page=50&sort=-created_at&status=ACTIVE
```

```json
{
  "data": { "users": [ "..." ] },
  "meta": { "page": 3, "per_page": 50, "total": 1284, "total_pages": 26 }
}
```

- Admins need "page 7 of 26" and a total count; jumping to an arbitrary page is a real workflow.
- `per_page` default 25, maximum 100.
- `sort` accepts a comma list; `-` prefix means descending. Only whitelisted columns per endpoint —
  never interpolate a client-supplied column name into SQL.
- `total` is a real `COUNT`. On tables past ~1M rows it switches to an estimate and `meta` sets
  `"total_is_estimate": true` rather than making every page load slow.

---

## 5. Idempotency

### 5.1 Where it is required

`Idempotency-Key: <uuid-v4>` is **mandatory** on every `POST` / `PATCH` that moves money, creates
an order, or triggers an irreversible side effect:

```
POST /orders/checkout          POST /vault/withdraw
POST /payments/execute         POST /returns/:ref/refund
POST /team-purchases/join      POST /coupons/redeem
PATCH /admin/pending-actions/:ref   (approve/reject)
POST /admin/payouts/batch
```

Missing on a required endpoint → `400 IDEMPOTENCY_KEY_REQUIRED`. Never silently proceed: a retry
without a key is exactly the scenario that double-charges a customer.

The client generates the key **once per user intent**, not per HTTP attempt. Retrying a timed-out
request reuses the same key — that is the entire point.

### 5.2 Lifecycle

```
1  Request arrives with Idempotency-Key K, on endpoint E, from user U.

2  Atomically claim (K, E, U):
     cache.setnx("idem:{U}:{E}:{K}", {state: IN_PROGRESS, payload_hash}, ttl 24h)

3  Claim succeeded → first time seeing this key.
     a. Execute the handler inside its transaction.
     b. Store {state: COMPLETE, status, body, payload_hash} under the same key, TTL 24h.
     c. Return the response.

4  Claim failed → the key already exists. Read it.
     IN_PROGRESS  → 409 CONFLICT, Retry-After: 2
                    (a concurrent duplicate is still running; do NOT run a second copy)
     COMPLETE     → compare payload_hash:
                      same     → replay the STORED response verbatim (§5.3)
                      different→ 409 IDEMPOTENCY_MISMATCH (§5.4)

5  If the handler throws, DELETE the key so a genuine retry can proceed.
   Retaining it would make a transient failure permanent.
```

The key is scoped to `(user, endpoint, key)`. A key from one user can never collide with another's.

### 5.3 Replay

A replay returns the **original** status code and body byte-for-byte, plus a notice:

```json
{
  "data": { "order": { "ref": "ORD-8F2K9QX7", "status": "PLACED" } },
  "meta": { "idempotency": { "code": "IDEMPOTENCY_REPLAY", "original_at": "2026-08-21T09:12:00Z" } }
}
```

Header: `Idempotency-Replayed: true`.

The client shows the same success it would have shown originally. From the user's point of view
their retry worked — which is correct, because their intent was fulfilled the first time.

### 5.4 Mismatch

Same key, **different payload** means a client bug — a reused key for a genuinely new intent.
Returning the old response would silently discard the new request; executing it would break the
guarantee. So neither:

```json
{
  "error": {
    "code": "IDEMPOTENCY_MISMATCH",
    "message_en": "This request key was already used with different details.",
    "message_bn": "এই রিকোয়েস্ট কী আগে অন্য তথ্য দিয়ে ব্যবহার করা হয়েছে।",
    "trace_id": "01J8XQ2K4M7N"
  }
}
```

### 5.5 Database-level backstop

The cache is a fast path, not the guarantee. It can be flushed, and in development
`CACHE_DRIVER=memory` does not survive a restart. Therefore the tables that matter also carry a
unique constraint:

```sql
orders.idempotency_key             TEXT UNIQUE
payout_requests.idempotency_key    TEXT UNIQUE
payment_transactions.idempotency_key TEXT UNIQUE
ledger_transactions                UNIQUE (idempotency_key, created_at)
```

A unique-violation on insert is caught and converted into a replay by re-reading the existing row.
**Two independent layers, because losing this guarantee means losing money.**

---

## 6. Rate Limiting

Every response to an authenticated request carries:

```
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 118
X-RateLimit-Reset: 1787292000
```

`429` additionally sets `Retry-After: <seconds>`.

Limits are per identity class, not global — a partner API key and a shopper must not share a bucket:

| Bucket | Limit | Notes |
| :--- | :--- | :--- |
| Anonymous (per IP) | 60/min | Public catalog and search |
| Authenticated user | 300/min | Normal browsing |
| `POST /auth/send-otp` | 3/hour per phone, 10/hour per IP | The most-abused endpoint on any BD platform |
| `POST /auth/login` | 10/min per IP, 5/min per account | Credential stuffing defence |
| Checkout | 10/min per user | |
| Payout request | 5/hour per user | |
| Chat messages | 60/min per user, plus `max_daily_messages` restriction | |
| Media upload | 20/hour per user | |
| Partner API key | per-key `rate_limit_per_min` | From `api_keys` |
| Admin endpoints | 600/min | Bulk work is legitimate here |

Backed by the cache driver, so the in-memory fallback keeps limits working with no Redis.

---

## 7. Request Validation

Every route declares a Fastify JSON Schema for `body`, `querystring`, `params`, and `headers`.
Routes without one do not pass review.

```js
{
  body: {
    type: 'object',
    required: ['product_ref', 'qty'],
    additionalProperties: false,        // ← mandatory on every schema
    properties: {
      product_ref: { type: 'string', pattern: '^PRD-[A-Z0-9]{8}$' },
      qty:         { type: 'integer', minimum: 1, maximum: 999 },
      variant_ref: { type: 'string', nullable: true }
    }
  }
}
```

**`additionalProperties: false` is required everywhere.** Silently accepting unknown fields is how
a client typo (`quantity` instead of `qty`) becomes an order for the default quantity instead of a
loud 400.

Validation failures return every problem at once, not the first:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message_en": "Some fields need correcting.",
    "message_bn": "কিছু তথ্য ঠিক করতে হবে।",
    "details": {
      "fields": [
        { "field": "qty",   "rule": "minimum",  "message_en": "Must be at least 1",       "message_bn": "কমপক্ষে ১ হতে হবে" },
        { "field": "phone", "rule": "pattern",  "message_en": "Enter a valid BD number",  "message_bn": "সঠিক বাংলাদেশি নম্বর দিন" }
      ]
    },
    "trace_id": "01J8XQ2K4M7N"
  }
}
```

A form that reveals its errors one at a time makes the user submit five times.

### Money in transit

Money is sent and returned as a **decimal string**, never a JSON number:

```json
{ "amount": "3200.00" }
```

JSON numbers are IEEE 754 doubles. `0.1 + 0.2 !== 0.3` in every JavaScript client, and a value
that survived `NUMERIC(14,2)` in PostgreSQL should not be corrupted on the way out. Schemas
validate money with `{ "type": "string", "pattern": "^\\d{1,12}(\\.\\d{2})?$" }`.

---

## 8. Authentication Transport

| | |
| :--- | :--- |
| **Access token** | JWT, **15 minutes**, sent as `Authorization: Bearer <token>`. Held in memory only — never `localStorage`, which is readable by any XSS |
| **Refresh token** | Opaque, **30 days**, `HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth` cookie. Rotated on every use |
| **Rotation** | Each refresh issues a new token and marks the old one used. Reuse of a used token = theft → **the entire session family is revoked** and audited |
| **CSRF** | Cookie-authenticated routes require `X-CSRF-Token` matching a double-submit cookie. `SameSite=Lax` alone is not sufficient for `POST` |
| **2FA** | Staff with MEDIUM+ permissions get `401 TWO_FACTOR_REQUIRED` with `details.challenge_token` instead of a token pair |

Access-token claims:

```json
{
  "sub": "1042",
  "roles": ["moderator"],
  "pv": 17,          // permission cache version — a bump invalidates instantly
  "sid": "4471",
  "exp": 1787292900
}
```

**Permissions are not in the token.** They are resolved server-side per request
(`rbac-spec.md` §4). A token carrying a permission list cannot be revoked before it expires — and
"revoked access keeps working for 15 minutes" is not acceptable for a payout permission.

---

## 9. Inbound Webhooks

One standard for bKash, Nagad, Steadfast, Pathao, RedX, and Meta.

```
POST /api/v1/webhooks/{provider}
```

**Every handler, in this order:**

1. **Verify the signature** (HMAC-SHA256 over the raw body, timing-safe compare) before parsing.
   Invalid → `401 WEBHOOK_SIGNATURE_INVALID`, and the attempt is still recorded.
2. **Read the raw body**, not the parsed one — re-serialising changes bytes and breaks the HMAC.
3. **Reject stale timestamps** outside a ±5-minute window, where the provider sends one.
4. **Claim the event**: `cache.setnx("wh:{provider}:{event_id}", 1, ttl 7d)`.
   Already claimed → `200 OK` immediately, do nothing. Providers retry aggressively.
5. **Persist first, process second.** Write to `payment_webhook_events` / `shipment_events`
   (both have `UNIQUE (provider, provider_event_id)`) before acting. A crash mid-processing must
   not lose the event.
6. **Process idempotently.** The same event twice produces exactly one state change.
7. **Return `200` fast** — under 5 seconds. Slow work is queued. A timeout makes the provider retry,
   which multiplies load precisely when the system is already struggling.

**Always `200` once the event is stored**, even if business processing fails. Returning `5xx` makes
the provider retry an event that is already safely recorded; the failure belongs in a dead-letter
queue and an admin alert, not in the provider's retry loop.

---

## 10. Worked Examples

### Phase 2 — OTP verification

```http
POST /api/v1/auth/verify-otp
Content-Type: application/json

{ "phone": "+8801712345678", "code": "417293", "purpose": "LOGIN" }
```
```http
200 OK
Set-Cookie: rt=<opaque>; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth; Max-Age=2592000
```
```json
{
  "data": {
    "access_token": "eyJhbGciOi...",
    "expires_in": 900,
    "user": { "ref": "USR-3K9M2A", "roles": ["customer"], "locale": "bn", "ui_mode": "simple" }
  }
}
```

### Phase 3 — Toggling a module (CRITICAL, super_admin only)

```http
PATCH /api/v1/admin/modules/sponsored_ads
Authorization: Bearer <token>

{ "enabled": false, "reason": "Pausing ads during the Eid campaign audit" }
```
```json
{
  "data": { "key": "sponsored_ads", "is_enabled": false, "updated_by": "USR-1042",
            "affected_routes": 4, "dependents_warned": [] },
  "meta": { "audit_ref": "AUD-9M2K7X" }
}
```

Attempted by an Admin rather than a Super Admin:

```json
{
  "error": {
    "code": "PERMISSION_DENIED",
    "message_en": "Only a Super Admin can use this.",
    "message_bn": "এটি শুধুমাত্র সুপার অ্যাডমিন ব্যবহার করতে পারেন।",
    "details": { "permission_key": "platform.module.toggle", "risk_tier": "CRITICAL", "requestable": false },
    "trace_id": "01J8XQ2K4M7N"
  }
}
```

### Phase 5 — Checkout, and the same request retried

```http
POST /api/v1/orders/checkout
Idempotency-Key: 8f2c1d90-4a7b-4e11-9c33-b81d6e2f0a55

{ "cart_ref": "CRT-7M2K", "payment_method": "COD",
  "address": { "division": "Dhaka", "district": "Dhaka", "upazila": "Mirpur",
               "line": "House 12, Road 4", "recipient_name": "Rahim Uddin",
               "recipient_phone": "+8801712345678" } }
```
```json
{
  "data": {
    "order": { "ref": "ORD-8F2K9QX7", "total_amount": "3200.00", "payment_status": "PENDING" },
    "sub_orders": [
      { "ref": "SUB-8F2K9QX7-1", "supplier_ref": "USR-2201", "total_amount": "1800.00" },
      { "ref": "SUB-8F2K9QX7-2", "supplier_ref": "USR-5510", "total_amount": "1400.00" }
    ]
  },
  "meta": { "parcels": 2 }
}
```

The client's network dropped; it retries with the **same** key:

```http
200 OK
Idempotency-Replayed: true
```
```json
{
  "data": { "order": { "ref": "ORD-8F2K9QX7", "...": "..." } },
  "meta": { "idempotency": { "code": "IDEMPOTENCY_REPLAY", "original_at": "2026-08-21T09:12:00Z" } }
}
```

**One order. Not two.**

Had stock run out in between:

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message_en": "Only 2 left of \"হ্যান্ডলুম শাড়ি\".",
    "message_bn": "\"হ্যান্ডলুম শাড়ি\" এর মাত্র ২টি বাকি আছে।",
    "details": { "product_ref": "PRD-8F2K", "requested": 5, "available": 2 },
    "trace_id": "01J8XQ2K4M7N"
  }
}
```

### Phase 6 — Moderator approves a payout → deferred

```http
PATCH /api/v1/admin/payouts/PAY-3M7V2WQ1/approve
Idempotency-Key: c41e...

{ "note": "Verified against Eid dispute queue" }
```
```http
202 Accepted
```
```json
{
  "deferred": {
    "code": "PERMISSION_PENDING_APPROVAL",
    "pending_action_ref": "PAA-7K2M9X",
    "action_key": "finance.payout.approve",
    "message_en": "Sent for approval. Your Admin must approve this before it takes effect.",
    "message_bn": "অনুমোদনের জন্য পাঠানো হয়েছে। কার্যকর হওয়ার আগে আপনার অ্যাডমিনকে এটি অনুমোদন করতে হবে।",
    "expires_at": "2026-08-24T09:12:00Z",
    "trace_id": "01J8XQ2K4M7N"
  }
}
```

The Super Admin approves — but the seller withdrew in the meantime:

```json
{
  "error": {
    "code": "PRECONDITION_CHANGED",
    "message_en": "This can no longer be applied: the available balance changed since it was submitted.",
    "message_bn": "এটি আর কার্যকর করা যাবে না: জমা দেওয়ার পর ব্যালেন্স পরিবর্তিত হয়েছে।",
    "details": { "field": "available_balance", "at_submit": "12000.00", "now": "1500.00" },
    "trace_id": "01J8XQ2K4M7N"
  }
}
```

> This is the rule from `rbac-spec.md` §3.3 doing its job. A payload trusted from submission time
> would have paid out ৳12,000 the platform no longer held.

### Phase 7 — Courier webhook

```http
POST /api/v1/webhooks/steadfast
X-Steadfast-Signature: sha256=9f86d0818...

{ "event_id": "sf_evt_8812", "consignment_id": "SF-99213", "status": "delivered",
  "delivered_at": "2026-08-21T14:22:00+06:00", "collected_amount": "3200.00" }
```
```json
{ "data": { "received": true, "event_id": "sf_evt_8812" } }
```

Delivered twice by the provider → `200 OK` immediately, **escrow clock started exactly once**.

### Phase 9 — Coupon budget exhausted under concurrency

```json
{
  "error": {
    "code": "COUPON_BUDGET_EXHAUSTED",
    "message_en": "This offer has just run out.",
    "message_bn": "এই অফারটি এইমাত্র শেষ হয়ে গেছে।",
    "details": { "code": "EID2026", "budget_cap": "10000.00", "budget_used": "10000.00" },
    "trace_id": "01J8XQ2K4M7N"
  }
}
```

### Phase 11 — Cursor-paginated ledger

```http
GET /api/v1/vault/ledger?limit=20&cursor=eyJpZCI6NDIxfQ
```
```json
{
  "data": { "entries": [
    { "ref": "LED-9K2M", "category": "SALE_COMMISSION", "entry_type": "CREDIT",
      "amount": "480.00", "bucket": "ESCROW", "order_ref": "ORD-8F2K9QX7",
      "created_at": "2026-08-21T09:12:00Z" }
  ] },
  "meta": { "cursor": { "next": "eyJpZCI6NDAxfQ", "has_more": true },
            "balances": { "available": "12400.00", "escrow": "3200.00", "held": "0.00" } }
}
```

### Phase 12 — Health and readiness

```http
GET /api/v1/health          →  { "data": { "status": "ok", "ts": "...", "uptime_s": 8412 } }
GET /api/v1/ready           →  { "data": { "status": "ready",
                                            "checks": { "database": "ok", "cache": "ok" } } }
```

Degraded:
```json
{ "error": { "code": "SERVICE_DEGRADED", "message_en": "Some services are unavailable.",
             "message_bn": "কিছু সেবা এখন কাজ করছে না।",
             "details": { "database": "ok", "cache": "unreachable" },
             "trace_id": "01J8XQ2K4M7N" } }
```

---

## 11. Standard Headers

**Request**

| Header | When |
| :--- | :--- |
| `Authorization: Bearer <jwt>` | Authenticated requests |
| `Idempotency-Key: <uuid4>` | Required on money/order endpoints (§5.1) |
| `Accept-Language: bn \| en` | Selects which `message_*` the client should show. Both are always sent |
| `X-CSRF-Token` | Cookie-authenticated writes |
| `X-Client: web/1.4.2 \| android/1.2.0` | Diagnostics and deprecation targeting |

**Response**

| Header | Always? |
| :--- | :--- |
| `X-Trace-Id` | ✅ Every response, matching `trace_id` in the body |
| `X-RateLimit-*` | Authenticated responses |
| `Idempotency-Replayed` | Replays only |
| `Retry-After` | `429` and `503` |
| `Deprecation` / `Sunset` | Deprecated endpoints |
| `Cache-Control` | `public, max-age=60` on public catalog · `no-store` on **everything authenticated** |

`no-store` on authenticated responses is not optional: shared devices are common, and a cached
vault balance in the browser back-button history is a real disclosure.

---

## 12. Implementation Checklist — Prompt 2.1

- [ ] `errorHandler.js` emits exactly the §2.3 shape, with both language messages and a `trace_id`
- [ ] Every error code in §3 has a constant and an HTTP status mapping
- [ ] The deferred (`202`) envelope is supported as a distinct shape
- [ ] `requestContext.js` generates `trace_id` and echoes it as `X-Trace-Id`
- [ ] Idempotency middleware implements the §5.2 lifecycle including `IN_PROGRESS` and key deletion on throw
- [ ] Rate-limit headers on every authenticated response; per-bucket limits from §6
- [ ] Every route declares a schema with `additionalProperties: false`
- [ ] Money serialised as a decimal string, never a JSON number
- [ ] `no-store` on authenticated responses
- [ ] `5xx` bodies never contain a stack trace, SQL, or table name
