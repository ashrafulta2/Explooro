# Explooro — RBAC, Delegation & Granular Control Specification

> **Produced by:** Prompt 0.4
> **Implemented by:** Prompts 2.2 (schema), 2.4 (resolution), 2.5 (delegation), 2.6 (restrictions), 2.7 (audit), 3.3 (admin UI)
> **Data:** [`permission-catalog.json`](permission-catalog.json) — **182 permissions**, all validated
>
> **The requirement this document exists to satisfy:**
> 1. The Super Admin can control **every activity of every user, at a granular level**.
> 2. A Moderator can perform Admin work — **but only when the Admin has authorised it.**
>
> Neither is possible with a single `role` column, which is what `prompt.md` v1.0 specified. This
> document replaces it.

---

## 1. Permission Catalog

### 1.1 Naming

```
domain.resource.action
```

Pattern: `^[a-z][a-z0-9_]*\.[a-z0-9][a-z0-9_]*\.[a-z][a-z0-9_]*$`
Digits are permitted (`security.2fa.reset`, `finance.b2b_escrow.release`, `content.i18n.update`).

**182 permissions across 19 domains:**

| Domain | # | Domain | # | Domain | # |
| :--- | ---: | :--- | ---: | :--- | ---: |
| finance | 23 | catalog | 15 | content | 9 |
| users | 17 | platform | 14 | logistics | 7 |
| orders | 16 | moderation | 12 | staff | 6 |
| growth | 16 | security | 9 | system | 6 |
| saler | 6 | admin | 5 | chat | 5 |
| supplier | 4 | live | 4 | support | 4 |
| ai | 4 | | | | |

### 1.2 Entry shape

```json
{
  "key": "finance.payout.approve",
  "domain": "finance",
  "label_en": "Approve payouts",
  "label_bn": "পেআউট অনুমোদন",
  "plain_en": "approve withdrawal requests and send money to sellers",
  "plain_bn": "উত্তোলনের আবেদন অনুমোদন করে বিক্রেতাদের টাকা পাঠাতে",
  "risk_tier": "HIGH",
  "delegable": true,
  "default_roles": ["admin", "super_admin"]
}
```

`plain_en` / `plain_bn` fill the `{plainLanguage}` slot in the Request Access modal
(`ia-sitemap.md` §5.3). **LOW-tier entries omit them by rule** — LOW permissions are role defaults
and never appear in a request modal, so the copy would be dead weight.

### 1.3 Validation rules — enforced, not conventional

Prompt 2.2 must fail the seed if any rule is violated:

1. Key matches the pattern above and is unique.
2. `domain` is the key's first segment.
3. `risk_tier` ∈ `LOW | MEDIUM | HIGH | CRITICAL`.
4. `delegable` is a boolean.
5. **Every `CRITICAL` has `delegable: false` and `default_roles: ["super_admin"]`.**
6. Every non-`CRITICAL` has `delegable: true`.
7. Every non-`LOW` has both `plain_en` and `plain_bn`.
8. Every entry has `label_bn`.
9. Every `default_roles` entry is a known role.

Current state: **0 violations.**

---

## 2. Risk Tiers — the engine of the whole model

The tier is not documentation. It **mechanically determines** what happens when someone attempts
the action.

| Tier | Count | Behaviour |
| :--- | ---: | :--- |
| **LOW** | 65 | Included in the role by default. Executes immediately |
| **MEDIUM** | 36 | Not in the role by default. Requires a **standing grant (Mode A)** or a **JIT window (Mode B)**. Executes immediately once held |
| **HIGH** | 47 | **Maker-checker (Mode C).** The actor submits; an authorised approver must sign off before anything is committed |
| **CRITICAL** | 34 | **Super Admin only. `delegable: false`. Never grantable by any path** |

### 2.1 Examples per tier

```
LOW       moderation.product.approve · catalog.product.create · finance.payout.request
MEDIUM    users.account.penalise · orders.return.approve · finance.ledger.view
HIGH      finance.payout.approve · users.kyc.approve · users.account.suspend
          orders.dispute.arbitrate · users.restriction.manage · orders.refund.execute
CRITICAL  finance.split.update · platform.module.toggle · staff.role.assign
          finance.wallet.adjust · system.backup.restore · users.permission.grant
```

### 2.2 HIGH has two approval modes

A blanket "approve before executing" rule would be actively harmful for urgent safety actions.
A moderator watching a policy-violating live stream cannot wait for an Admin to wake up.

| Mode | Behaviour | Applies to |
| :--- | :--- | :--- |
| `approve_before` **(default)** | Nothing is committed until approved | Money movement, account suspension, KYC approval, dispute resolution |
| `execute_then_review` | Executes **immediately**, then lands in the Approval Inbox flagged for **post-hoc review**. The approver can reverse it | Urgent containment only |

`execute_then_review` is deliberately limited to **5 permissions**:

```
live.stream.terminate            harmful content is broadcasting right now
moderation.live.handle           muting an abusive participant mid-stream
growth.campaign.emergency_stop   a campaign is losing money right now
security.session.revoke          an account is compromised right now
finance.escrow.freeze            fraud is in progress; the money must stop moving
```

Every one is **containment, not consequence** — it stops harm, it does not decide an outcome.
Reversing an over-eager freeze costs little; waiting on approval while money leaves costs a lot.
Adding a sixth permission to this list requires the same scrutiny as adding a CRITICAL one.

---

## 3. The Three Delegation Modes

This is the machinery behind *"Moderator can do Admin work, but only with Admin authorisation."*

### 3.1 Mode A — Standing Grant

The Admin proactively gives a Moderator a capability for a bounded period.

```sql
user_permission_overrides (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_key  TEXT   NOT NULL REFERENCES permissions(key) ON DELETE RESTRICT,
  effect          TEXT   NOT NULL CHECK (effect IN ('GRANT','DENY')),
  scope_json      JSONB,          -- optional narrowing, e.g. {"max_amount": 5000}
  reason          TEXT   NOT NULL CHECK (length(reason) >= 10),
  granted_by      BIGINT NOT NULL REFERENCES users(id),
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  revoked_by      BIGINT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON user_permission_overrides (user_id, permission_key)
  WHERE revoked_at IS NULL;
```

**Rules**
- `reason` is mandatory, minimum 10 characters. "test" is not a reason.
- `expires_at` is mandatory and **capped at 90 days**. There is no permanent grant.
- A `CRITICAL` permission is rejected outright at the service layer *and* by a trigger.
- **`DENY` always beats `GRANT`** — see §4.
- `scope_json` narrows a grant: `{"max_amount": 5000}` on `orders.refund.execute` lets the
  moderator refund up to ৳5,000 and no further. The owning service enforces the scope.

**Lifecycle:** `granted → active → (revoked | expired)`. Grant, revoke, and expiry each write an
audit row. Expiry is handled by `grantExpiryCron` (Prompt 2.5) every 5 minutes.

### 3.2 Mode B — Just-In-Time Request

The Moderator hits a locked action and asks for it. This is the path that makes locked-state UI
useful rather than merely informative.

```sql
permission_grant_requests (
  id                 BIGSERIAL PRIMARY KEY,
  requester_id       BIGINT NOT NULL REFERENCES users(id),
  permission_key     TEXT   NOT NULL REFERENCES permissions(key),
  target_scope_json  JSONB,        -- what they want it FOR: {"order_id": 8891}
  reason             TEXT   NOT NULL CHECK (length(reason) >= 10),
  status             TEXT   NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING','APPROVED','REJECTED','EXPIRED','CANCELLED')),
  approver_id        BIGINT REFERENCES users(id),
  approver_note      TEXT,
  decided_at         TIMESTAMPTZ,
  window_minutes     INT,
  window_expires_at  TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (approver_id IS NULL OR approver_id <> requester_id),
  CHECK (window_expires_at IS NULL OR decided_at IS NULL OR window_expires_at > decided_at)
);
```

**Rules**
- Only `MEDIUM`-tier permissions are JIT-requestable. `HIGH` goes through Mode C instead;
  `CRITICAL` is never requestable and the UI shows no affordance.
- Default window: **120 minutes**, admin-configurable, hard cap 8 hours.
- Approval notifies the requester **in real time** over the existing WebSocket — their UI unlocks
  without a reload, and the elevated-access chip appears.
- The requester may cancel their own pending request, and may release an active window early.
- Expiry closes the window automatically. There is no manual cleanup step, because a manual
  cleanup step is a step that gets skipped.

**Lifecycle:** `PENDING → APPROVED (window opens) → EXPIRED` · or `→ REJECTED` · or `→ CANCELLED`.

### 3.3 Mode C — Maker-Checker

Mandatory for every `HIGH` permission with `approval_mode: approve_before`. The actor performs the
action normally; the *effect* is deferred.

```sql
pending_admin_actions (
  id             BIGSERIAL PRIMARY KEY,
  actor_id       BIGINT NOT NULL REFERENCES users(id),
  action_key     TEXT   NOT NULL,     -- the permission key being exercised
  payload_json   JSONB  NOT NULL,     -- the serialised intent
  target_type    TEXT   NOT NULL,
  target_ref     TEXT   NOT NULL,
  actor_note     TEXT,
  status         TEXT   NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING','APPROVED','REJECTED','EXPIRED','APPLIED','FAILED')),
  approver_id    BIGINT REFERENCES users(id),
  approver_note  TEXT,
  decided_at     TIMESTAMPTZ,
  applied_at     TIMESTAMPTZ,
  failure_reason TEXT,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT no_self_approval CHECK (approver_id IS NULL OR approver_id <> actor_id)
);
```

**Rules — the important ones**

1. **No self-approval.** Enforced in the service *and* by `CONSTRAINT no_self_approval`. Two
   independent layers, because this is the constraint that the entire model rests on.
2. **Preconditions are re-validated at approval time, never trusted from the payload.**
   This is the single most important rule in this document. A payout submitted when the balance
   was ৳50,000 must re-check the balance at the moment of approval — the seller may have withdrawn
   in between. Trusting a captured payload is how marketplaces pay out money they no longer hold.
3. **Executor registry.** Each `action_key` registers an executor function so the approval path
   knows how to apply the payload. An action with no registered executor cannot be submitted.
4. Execution runs inside a transaction. On failure: `FAILED` with `failure_reason`, actor notified,
   nothing partially applied.
5. Default expiry **72 hours**, then `EXPIRED` and discarded with a notification.
6. The Approval Inbox renders a **before/after diff** so the approver sees exactly what will happen
   — approving an opaque payload is not approval, it is rubber-stamping.

**Lifecycle:** `PENDING → APPROVED → APPLIED` · or `→ FAILED` · or `→ REJECTED` · or `→ EXPIRED`.

### 3.4 Choosing a mode

```
Attempting a permission the user does not hold
│
├─ CRITICAL ────────────► 403. No path. UI shows lock, no request button.
│
├─ HIGH ────────────────► approve_before      → Mode C: 202 + pending action id
│                         execute_then_review → run now, queue for post-hoc review
│
├─ MEDIUM ──────────────► 403 + requestable:true → Mode B (or a pre-existing Mode A grant)
│
└─ LOW ─────────────────► already in the role; if truly absent, Mode A
```

---

## 4. Permission Resolution Algorithm

`resolvePermissions(userId)` — Prompt 2.4. Ordered, unambiguous, and testable.

```
INPUT  userId
OUTPUT { permissions: Set<key>, sources: Map<key, Source[]> }

1. ROLES        Load all roles for the user. Collect their permissions.
                Record source: { type: 'ROLE', role }

2. GRANTS       Load user_permission_overrides WHERE user_id = ?
                  AND effect = 'GRANT' AND revoked_at IS NULL AND expires_at > now()
                Union into the set.
                Record source: { type: 'GRANT', granted_by, expires_at, scope }

3. JIT          Load permission_grant_requests WHERE requester_id = ?
                  AND status = 'APPROVED' AND window_expires_at > now()
                Union into the set.
                Record source: { type: 'JIT', approver, window_expires_at }

4. DENY         Load overrides WHERE effect = 'DENY' AND revoked_at IS NULL
                  AND expires_at > now()
                SUBTRACT these from the set — unconditionally.
                DENY beats ROLE, GRANT and JIT. There is no override for a DENY.

5. CRITICAL     If the user does NOT hold the super_admin role,
                remove every permission whose risk_tier = 'CRITICAL'.
                This runs AFTER grants, so no grant path can ever smuggle one in.

6. RETURN       { permissions, sources }
```

`sources` is why a permission is held, and the Admin UI (Prompt 3.3) displays it directly:
*"from role Moderator"*, *"granted by Karim until 12 Sep"*, *"JIT window, 42 min left"*.
Without it, an admin auditing an account cannot tell a role default from a temporary grant.

### 4.1 Per-request checks — resolution is not the whole story

Resolution answers *"does this user hold this permission?"*. Three further gates run per request:

```
resolved permission ✓
   → module enabled?      (requireModule    — Prompt 3.1)  else 403 MODULE_DISABLED
   → user restricted?     (requireRestriction — Prompt 2.6) else 403 USER_RESTRICTED
   → scope satisfied?     (owning service, from scope_json) else 403 PERMISSION_DENIED
   → tier routing         (§3.4)
```

**Order matters.** Module check precedes restriction check: if the business has turned a feature
off, telling a user they are *restricted* from it is misleading.

### 4.2 Cache invalidation — correctness over cleverness

Resolution is cached at `perm:v{globalVersion}:{userVersion}:{userId}` with a 5-minute TTL.

**A revoked permission must stop working within one request — never after a 5-minute wait.**
Therefore every grant, revoke, role change, restriction change, and JIT decision **bumps that
user's version key**, which invalidates their cache entry instantly. A permission catalog change
bumps the global version.

TTL is a safety net against leaks, not the invalidation mechanism. Relying on TTL for revocation
means a fired employee keeps access for five minutes.

---

## 5. Granular Per-User Activity Control

Permissions answer *"what may this staff member do?"*. Restrictions answer *"what may this
individual user do?"* — the Super Admin's control over **every activity of every user**.

```sql
user_restrictions (
  id             BIGSERIAL PRIMARY KEY,
  subject_type   TEXT NOT NULL CHECK (subject_type IN ('USER','SEGMENT')),
  subject_ref    TEXT NOT NULL,      -- user id, or a segment predicate id
  capability_key TEXT NOT NULL,
  mode           TEXT NOT NULL CHECK (mode IN ('BLOCK','THROTTLE','FORCE_REVIEW_QUEUE','SHADOW_BAN')),
  limit_value    NUMERIC(14,2),      -- for THROTTLE and numeric caps
  reason         TEXT NOT NULL CHECK (length(reason) >= 10),
  reason_bn      TEXT,               -- shown to the user in their language
  applied_by     BIGINT NOT NULL REFERENCES users(id),
  expires_at     TIMESTAMPTZ,        -- NULL = until manually lifted
  lifted_at      TIMESTAMPTZ,
  lifted_by      BIGINT REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 5.1 Capability switches

```
can_login          can_list_products   can_sell          can_buy
can_use_cod        can_withdraw        can_chat          can_live_stream
can_run_ads        can_refer           can_post_review   can_upload_video
```

### 5.2 Numeric limits

| Key | Enforced by |
| :--- | :--- |
| `max_withdrawal_per_day` | payout.service (Prompt 6.3) |
| `max_products` | product.service (Prompt 4.3) |
| `max_cod_order_value` | checkout.service (Prompt 5.2) |
| `max_daily_messages` | chat.service (Prompt 8.1) |
| `ad_budget_cap` | ads.service (Prompt 9.1) |

### 5.3 Enforcement modes

| Mode | Behaviour |
| :--- | :--- |
| `BLOCK` | 403 `USER_RESTRICTED`, with the stored reason **in the user's own language** |
| `THROTTLE` | Rate-limited to `limit_value`; the user is told the limit and when it resets |
| `FORCE_REVIEW_QUEUE` | Allowed, but the resulting record is tagged for moderation before going live |
| `SHADOW_BAN` | Succeeds for the actor; the effect is suppressed for everyone else |

> **A note on `SHADOW_BAN`.** It is genuinely effective against spam rings, because the operator
> cannot tell they have been caught and does not immediately create a new account. It is also
> deceptive toward the individual. Restrict it to accounts with concrete abuse evidence, never as a
> softer alternative to `BLOCK` for ordinary policy disputes, and always attach the evidence to the
> reason field. Every use is audited and reviewable.

### 5.4 Segments

A restriction may target a predicate rather than a user:

```json
{ "role": "saler", "district": "Dhaka", "tier": "starter", "trust_score_lt": 40 }
```

**Segments are evaluated at request time, not materialised.** A user who becomes matching tomorrow
is covered tomorrow — no backfill job, no drift between the rule and reality.

The admin UI runs a dry-run first and shows *"this will affect 1,284 users"* before anything is
applied. Applying a restriction to a segment without knowing its size is how an outage happens.

### 5.5 Who may apply one

`users.restriction.manage` is **HIGH** → a Moderator's attempt creates a pending action; a Super
Admin executes directly. Restricting a user's ability to earn is consequential enough to deserve a
second pair of eyes.

---

## 6. Staff Account Hardening

| Control | Rule |
| :--- | :--- |
| **2FA (TOTP)** | **Mandatory** for any account holding a `MEDIUM`-or-higher permission. Enforced at login: no token is issued, a `TWO_FACTOR_REQUIRED` challenge is returned instead |
| **Session management** | Every staff session is listed with device, IP and last-seen. Force-revoke is `HIGH` with `execute_then_review` |
| **IP allowlist** | Optional per-account allowlist for `/admin/*`. `CRITICAL` to configure |
| **Password policy** | argon2id, minimum 12 characters for staff, breach-list check at set time |
| **Break-glass** | `security.breakglass.use`. Grants temporary super_admin for **30 minutes**, requires a reason, and **immediately alerts every other super_admin by SMS and email**. Every action during the window is tagged `breakglass: true` in the audit log and reviewed afterward |

Break-glass exists because a locked-out organisation will otherwise invent a worse workaround —
a shared password, or a permanently over-privileged account. Making the emergency path loud,
short, and audited is safer than pretending emergencies do not happen.

---

## 7. Audit Requirements

Every one of the following writes an `audit_logs` row with `before_json` and `after_json`:

```
grant · revoke · grant expiry
JIT request · approve · reject · window expiry · early release
maker-checker submit · approve · reject · apply · fail · expire
restriction apply · modify · lift · expiry
role assign · role permission change
2FA enrol / reset · session revoke · break-glass open and close
every CRITICAL action, without exception
```

Audit rows are **append-only and hash-chained** (Prompt 2.2): `UPDATE` and `DELETE` are blocked by
trigger, and each row carries `sha256(prev_hash || payload)` so tampering is detectable by walking
the chain.

**Sensitive fields are redacted before persistence** — `password_hash`, `otp`, `nid_number`,
tokens, and account numbers never reach `before_json` / `after_json`. An audit log that leaks
credentials is a liability, not a control.

---

## 8. Worked Example — the requirement, end to end

**Scenario.** Moderator *Rahim* is handling a dispute. He needs to refund ৳3,200 to a customer.

```
1  Rahim opens /moderator/disputes/4471 and clicks "Refund customer".

2  orders.refund.execute is HIGH / approve_before. Rahim does not hold it.
   → 403 PERMISSION_DENIED, requestable: false   (HIGH is not JIT-requestable)
   → UI shows the action locked, explaining an Admin must approve refunds.

3  Rahim clicks "Submit for approval", enters a note, and submits.
   → pending_admin_actions row:
       actor_id=rahim, action_key='orders.refund.execute',
       payload={ dispute_id:4471, amount:3200.00, method:'ORIGINAL' },
       status='PENDING', expires_at=now()+72h
   → NOTHING is refunded. No ledger entry. No money moves.
   → Rahim sees it under "Awaiting Admin approval" on /moderator/my-access.

4  Admin Karim's TopBar Approval badge increments in real time.
   /admin/approvals shows the request with a full before/after diff:
       customer wallet   0.00 → 3,200.00
       saler commission  480.00 → 0.00  (clawback)
       escrow            3,200.00 → 0.00

5  Karim approves.
   → Preconditions RE-VALIDATED NOW: escrow still holds 3,200.00, dispute still open,
     order still eligible. (Had the escrow already released, approval fails cleanly
     rather than creating a negative balance.)
   → Executor runs inside a transaction: refund issued, ledger balanced, clawback applied.
   → status='APPLIED'. Rahim notified. Two audit rows written (submit, approve).

6  Karim decides Rahim should handle refunds up to ৳5,000 himself in future.
   → /admin/grants → Mode A standing grant:
       permission_key='orders.refund.execute'
       scope_json={"max_amount": 5000}
       reason='Handling dispute queue during Eid surge'
       expires_at=now()+30 days
   → Rahim's permission cache version is bumped; his UI unlocks WITHOUT a reload.
   → An elevated-access indicator appears in his TopBar.

7  Thirty days later grantExpiryCron expires the grant automatically.
   Rahim is notified. The capability locks again. Nobody had to remember.
```

**What this demonstrates:**
- The Moderator did Admin work — **only with Admin authorisation**. ✅
- The Admin retained granular control: the specific permission, a ৳5,000 scope, a 30-day
  expiry, a recorded reason. ✅
- Nothing was trusted from a stale payload. ✅
- Every step is auditable, and the access expired on its own. ✅

---

## 9. Implementation Checklist

**Prompt 2.2 — schema**
- [ ] All four tables with every CHECK constraint above, especially `no_self_approval`
- [ ] Seed loader validates the catalog against §1.3 and fails on any violation
- [ ] `audit_logs` append-only trigger + hash chain

**Prompt 2.4 — resolution**
- [ ] The §4 algorithm implemented in exactly that order
- [ ] `sources` map populated and returned
- [ ] Version-key invalidation, not TTL, drives revocation
- [ ] Test: DENY beats a simultaneous role permission and GRANT
- [ ] Test: no path grants a CRITICAL permission to a non-super-admin

**Prompt 2.5 — delegation**
- [ ] All three modes with the lifecycles in §3
- [ ] Preconditions re-validated at approval time — with a test that mutates state between
      submit and approve and asserts the approval fails cleanly
- [ ] Self-approval blocked in the service AND proven blocked at the database level
- [ ] `execute_then_review` runs immediately and still queues for review
- [ ] `grantExpiryCron` closes grants, windows and pending actions within 5 minutes

**Prompt 2.6 — restrictions**
- [ ] All 4 modes, all 12 capabilities, all 5 numeric limits
- [ ] Segment predicates evaluated at request time
- [ ] Dry-run count endpoint matches the number actually affected
- [ ] `BLOCK` reason surfaces to the user in their own language
