# Explooro — Architecture Map

> **Produced by:** Prompt 0.8
> **Purpose:** Let an agent or developer who has never seen this repository find the right file in
> under two minutes.
>
> This platform will be maintained over years, in short sessions, by AI assistants with no memory
> of previous work. Everything needed to make a correct change must be discoverable **from the
> repository itself** — never from a past conversation.
>
> ⚠️ Most of what follows is the **target** the 86 prompts in [`prompt.md`](prompt.md) build toward.
> Check the traceability matrix at the end of that file for what actually exists today, and verify
> a path before assuming it is there.

---

## 1. Directory Map

```
explooro/
├── CLAUDE.md                    Agent entry point. Read first. An index, not a manual
├── AGENTS.md                    Pointer to CLAUDE.md for non-Claude tools
├── README.md                    Human entry point + phase status
├── package.json                 npm workspaces root; `npm run dev` lives here
├── .env.example                 EVERY env var the project will ever use, documented
│
├── scripts/
│   └── palette.mjs              Generates + verifies the colour ramps in design-system.md
│
├── docs/                        ── Specifications. The contract every phase is checked against ──
│   ├── prompt.md                ⭐ Master blueprint: 86 sequential prompts, 12 phases
│   ├── design-system.md         Colour (OKLCH), type, spacing, motion, craft rules
│   ├── ia-sitemap.md            ~120 routes, 6 role nav trees, locked-state UX
│   ├── rbac-spec.md             Risk tiers, 3 delegation modes, resolution algorithm
│   ├── permission-catalog.json  182 permissions — the authority on permission keys
│   ├── erd.md                   95 tables, fully typed
│   ├── api-contract.md          Envelopes, 37 error codes, idempotency, webhooks
│   ├── module-registry.md       71 toggleable modules
│   ├── architecture-map.md      ← you are here
│   ├── dependency-ledger.md     Every dependency, why it exists, how to remove it
│   ├── how-to-add-a-feature.md  One worked example through every layer
│   └── PRD.md · DFD.md · idea proposition.md · technologyused.md   (source documents)
│
├── client/                      ── Web frontend. ZERO runtime dependencies ──
│   ├── vite.config.js           Dev server :3000, proxies /api and /ws to :5000
│   ├── index.html
│   └── src/
│       ├── main.js              Entry: mounts router + shell
│       ├── core/
│       │   ├── router.js        History API router, guards, lazy routes
│       │   ├── store.js         Pub/sub state, ~80 lines, no library
│       │   └── api.js           fetch wrapper; VITE_API_MODE=mock|live switch
│       ├── config/
│       │   └── navigation.js    Nav tree as DATA. Add a feature = add one object
│       ├── styles/
│       │   ├── tokens.css       Spacing, radius, motion, z-index, type scale
│       │   ├── themes.css       Semantic colours, light + dark. ONLY place raw colour lives
│       │   ├── reset.css · typography.css · craft.css
│       │   └── components/      Per-component CSS
│       ├── components/
│       │   ├── ui/              Button, Input, Modal, Table, Toast, Skeleton …
│       │   ├── shell/           AppShell, Sidebar, TopBar, MobileNav, CommandPalette
│       │   ├── access/          PermissionGate, RequestAccessModal, ElevatedAccessChip
│       │   └── <domain>/        product/, cart/, vault/, chat/, admin/ …
│       ├── pages/               One folder per role: admin/, saler/, supplier/,
│       │                        moderator/, editor/, customer/, dev/
│       ├── services/            i18n.js, format.js, toast.js, permissions.js,
│       │                        session.js, featureFlags.js, websocket.js
│       ├── locales/             en.json, bn.json  ← both, always
│       ├── lib/                 motion.js, optical.js
│       └── mocks/               Fixtures for VITE_API_MODE=mock
│
├── server/                      ── API. Routes → Controllers → Services → Repositories ──
│   └── src/
│       ├── index.js             Boot
│       ├── app.js               Fastify instance + plugin registration
│       ├── config/
│       │   ├── env.js           Validates every env var at boot, fails fast
│       │   ├── db.js            pg Pool + withTransaction()
│       │   ├── cache.js         Driver interface (redis | memory)
│       │   └── modules.seed.json  71 module definitions
│       ├── db/
│       │   ├── migrate.js       Forward-only runner, checksum-verified
│       │   ├── migrations/      NNN_name.sql — immutable once applied
│       │   └── seeds/
│       ├── routes/              Route definitions + JSON schemas
│       ├── controllers/         HTTP in / HTTP out only. No business logic
│       ├── services/            ⭐ ALL business logic lives here
│       ├── repositories/        SQL. The only layer that touches the database
│       ├── middlewares/         authenticate · requirePermission · requireModule ·
│       │                        requireRestriction · idempotency
│       ├── plugins/             errorHandler, requestContext, security, observability
│       ├── integrations/        ⭐ Every third party, each behind an adapter + mock driver
│       │                        payments/ courier/ sms/ storage/ whatsapp/ streaming/ ai/
│       ├── sockets/             WebSocket gateway, chat handler, presence
│       └── jobs/                Cron: escrowRelease, grantExpiry, expiryWarning, cartRecovery
│
└── mobile/                      Flutter (Phase 12). Separate toolchain — no npm here
```

### The layering rule

```
Routes        declare the path + JSON schema. No logic.
Controllers   parse request → call service → shape response. No SQL, no business rules.
Services      ⭐ all business logic, all transactions, all invariants.
Repositories  SQL only. No business rules.
```

**A controller containing an `if` about money is in the wrong layer.** Business rules live in
services so they can be unit-tested without HTTP and reused by jobs, sockets, and the public API.

---

## 2. Where Do I Change X?

The 35 most likely change requests, with exact paths.

### Business rules & money

| I want to… | Change |
| :--- | :--- |
| Change the profit split (40/60) | `platform_settings` row `default_saler_split_pct` via `/admin/finance/splits`. **Never in code** — `services/pricing.service.js` reads it |
| Add a category- or product-specific split | `commission_rules` table; resolution order is in `services/pricing.service.js` |
| Change the escrow hold period | Module setting `escrow_engine.hold_days` via `/admin/platform/modules`. Read by `services/vault.service.js` |
| Change the minimum payout | `platform_settings.min_payout_amount`. Enforced in `services/payout.service.js` |
| Change the COD OTP threshold | Module setting `cod_protection.otp_threshold_amount`. Read by `services/checkout.service.js` |
| Change the return window | Module setting `returns_engine.return_window_days` |
| Change coin redemption rate | Module setting `loyalty_coins.redemption_rate` |
| Change group-buy team size / window | Module setting `group_buying.default_team_size`, `.window_hours` |
| Fix a pricing calculation | `services/pricing.service.js` — **the only file with split arithmetic** |
| Fix a wallet or ledger bug | `services/ledger.service.js` + `services/vault.service.js`. Re-read `erd.md` §12 first |

### Catalog & commerce

| I want to… | Change |
| :--- | :--- |
| Add a product field | See [`how-to-add-a-feature.md`](how-to-add-a-feature.md) — the full worked example |
| Add a product status | `erd.md` §3 `products.status` CHECK → new migration → `services/product.service.js` |
| Change search ranking | `services/search-drivers/postgres.js` |
| Add a Banglish search mapping | `utils/transliterate.js` |
| Change the product image aspect ratio | `design-system.md` §12 first, then `styles/components/product.css` + `services/media.service.js` derivatives |
| Change FEFO batch selection | `services/inventory.service.js` → `getFEFOBatch()` |
| Change warehouse routing | `services/warehouseRouting.service.js` |

### Access & permissions

| I want to… | Change |
| :--- | :--- |
| Add a permission | `docs/permission-catalog.json` → re-run seed. **Never invent a key in code** |
| Make an action require Admin approval | Change its `risk_tier` to `HIGH` in the catalog. Everything else is automatic |
| Make an action Super-Admin-only | `risk_tier: "CRITICAL"`, `delegable: false`, `default_roles: ["super_admin"]` |
| Give a moderator a capability | `/admin/grants` (Mode A). No code change |
| Restrict one user's activity | `/admin/restrictions` or `POST /api/v1/admin/restrictions` |
| Add a role | `roles` table + `role_permissions`. Update `rbac-spec.md` §1 |
| Change permission resolution | `services/rbac.service.js` — follow `rbac-spec.md` §4 exactly |
| Debug "why can't this user do X?" | `GET /api/v1/me/permissions` returns the `sources` map explaining every permission |

### Platform configuration

| I want to… | Change |
| :--- | :--- |
| Add a module toggle | `server/src/config/modules.seed.json` + `docs/module-registry.md` |
| Turn a feature off | `/admin/platform/modules`. No deploy |
| Change the colour the product boots with | `DEFAULT_MASTER_PRESET` in `client/src/config/master-themes.js`. `initTheme()` mounts it synchronously before it asks the API for a published palette, so it is what a fresh install actually wears — `midnight_slate` today, with `explooro_pink` kept as the alternate |
| Change a colour (the CSS baseline that paints pre-JS) | `styles/themes.css` **only**, after updating `design-system.md`. Run `node scripts/palette.mjs` to re-verify contrast. Not the same as the boot default above |
| Re-theme the product to a different colour at runtime | `client/src/config/master-themes.js` — one seed hex per preset; `services/colorRamp.js` derives all 45 ramp steps and every semantic role for both light and dark. Components read the ramps in ~199 places, which is why repainting semantic tokens alone never worked. Run `npm test --workspace client` to re-verify the AA invariants. The API gate lives in `server/src/services/theme.service.js` (`validateMasterBlock` / `deriveMasterTokens`); it reaches the engine only through `server/src/services/masterPalette.js` — never import `client/` from anywhere else on the server |
| Change the flash-sale strip / FLASH tag colours | Theme Studio → **Flash Sale & Campaign Strip**, or `--flash-bg` / `--flash-text` / `--flash-chip-bg` / `--flash-tag-bg` / `--flash-tag-text` in `styles/themes.css` for the shipped default. `components/product.css` reads only those tokens — it used to hardcode `--danger-300`, which is why the strip was the one piece of chrome no preset and no validator ever touched. The generator resolves the ink by measurement (`flashRole()` in `services/colorRamp.js`) because `statusPull` moves the danger ramp's luminance with the seed |
| Add a language | `i18n_locales` row + `locales/<code>.json`. No code change — `content.i18n.locale_add` |
| Change a UI string | `client/src/locales/en.json` **and** `bn.json`, or `/editor/translations` at runtime |
| Add an env variable | `.env.example` (documented) **and** `server/src/config/env.js` (validated) |

### API & integrations

| I want to… | Change |
| :--- | :--- |
| Add an endpoint | `routes/` (path + schema) → `controllers/` → `services/`. Re-read `api-contract.md` |
| Add an error code | `docs/api-contract.md` §3 first, then `plugins/errorHandler.js` |
| Change an error message | `plugins/errorHandler.js` — **both** `message_en` and `message_bn` |
| Add a payment gateway | `integrations/payments/<name>.js` implementing the same interface. One file |
| Add a courier | `integrations/courier/<name>.js`. One file |
| Add an SMS provider | `integrations/sms/<name>.js`. One file |
| Add an outbound webhook event | `services/webhookDelivery.service.js` + `docs/public-api.md` |
| Change rate limits | `api-contract.md` §6, then `plugins/security.js` |

### UI

| I want to… | Change |
| :--- | :--- |
| Add a page | `pages/<role>/<Name>Page.js` → register in `core/router.js` → add to `config/navigation.js` with its `permission` + `module` |
| Add a nav item | `client/src/config/navigation.js` — one object. Never edit `Sidebar.js` |
| Add a UI component | `components/ui/` + register in `pages/dev/gallery-registry.js` **in the same change** |
| Add a dashboard card | The role's page under `pages/<role>/`, gated by `PermissionGate` |
| Change spacing/radius/motion | `styles/tokens.css`, after updating `design-system.md` |

### Debugging

| Symptom | Start here |
| :--- | :--- |
| "It broke" | Get the `trace_id` from the response, grep the logs. One id links request → error → audit row |
| Sidebar jumps to top on click | `AppShell.js` `render()` — verify `oldSidebar.scrollTop` is preserved and applied to `newSidebar.scrollTop` |
| Payout failed | `payout_requests.failure_reason` → `payment_transactions.raw_response` → `docs/runbook.md` |
| Ledger doesn't balance | `GET /api/v1/admin/finance/integrity` → `erd.md` §12 |
| A user can't access something | `GET /api/v1/me/permissions` (`sources` + `whyDenied`) |
| Webhook not processed | `payment_webhook_events` / `shipment_events` — every event is stored even if processing failed |
| "Who changed this?" | `/admin/security/audit`, filter by `target_ref` |

---

## 3. Request Lifecycle

```
Browser  fetch('/api/v1/orders/checkout', { headers: { Idempotency-Key } })
   │     client/src/core/api.js  — attaches JWT, generates idempotency key, unwraps envelope
   ▼
Vite proxy (dev) / nginx (prod)          vite.config.js  /  nginx/nginx.conf
   ▼
Fastify                                   server/src/app.js
   │
   ├─ plugins/requestContext.js   generate trace_id, capture ip + user agent
   ├─ plugins/security.js         helmet, CORS, rate limit
   ├─ middlewares/idempotency.js  claim the key (api-contract.md §5.2)
   ├─ middlewares/authenticate.js verify JWT → req.user
   ├─ middlewares/requireModule   is the feature on?          → 403 MODULE_DISABLED
   ├─ middlewares/requirePermission  resolve + tier-route     → 403 / 202 deferred
   ├─ middlewares/requireRestriction is this user allowed?    → 403 USER_RESTRICTED
   ├─ route JSON schema           additionalProperties: false → 400 VALIDATION_FAILED
   ▼
controllers/order.controller.js   parse → call service → shape response
   ▼
services/checkout.service.js      ⭐ withTransaction: lock stock, split by supplier,
   │                                 price via pricing.service, allocate FEFO batch
   ├─ services/pricing.service.js
   ├─ services/inventory.service.js
   └─ repositories/*.repository.js   SQL only
   ▼
PostgreSQL   SELECT … FOR UPDATE · CHECK constraints as the last line of defence
   ▼
COMMIT → emit events OUTSIDE the transaction → audit row → response
```

**The middleware order is deliberate.** Module check precedes restriction check: if the business
has turned a feature off, telling a user they are *restricted* from it is misleading.

---

## 4. The Three Highest-Risk Flows

### 4.1 Checkout — where money and stock meet

`services/checkout.service.js`, one transaction:

```
idempotency claim → revalidate cart → validate coupon (budget cap)
→ COD risk check (trust score, OTP) → SELECT … FOR UPDATE on each stock row,
   LOCKED IN ID ORDER (deadlock prevention) → allocate FEFO batch → route warehouse
→ group by supplier → 1 order + N sub_orders → compute splits via pricing.service
→ insert order_items → decrement stock → COMMIT → emit events
```

**Failure modes it must survive:** two buyers racing for the last unit (one wins, one gets
`INSUFFICIENT_STOCK`, stock never negative) · a retried request (idempotent, one order) · a coupon
budget exhausted mid-flight (atomic reservation).

### 4.2 Escrow settlement — where money moves without a user present

```
courier webhook: delivered
  → shipment_events (deduped by provider_event_id)
  → sub_orders.delivered_at set
  → escrow_entries created, hold_until = now + returns_engine.return_window_days
  → [COD only] blocked until cod_reconciliation matches
  → jobs/escrowRelease.job.js (hourly): LOCKED and due → release
  → double-entry ledger rows → wallet balances updated → notify
```

**The edge case that costs money:** a return approved *after* escrow released. `clawback.service.js`
must recover from `available_balance`, and create a negative-balance recovery record if that is
insufficient. Never silently skip it.

### 4.3 Permission resolution — on almost every request

`services/rbac.service.js`, algorithm in `rbac-spec.md` §4:

```
roles → union GRANTs → union active JIT windows → SUBTRACT DENYs (always win)
→ strip CRITICAL unless super_admin  (runs AFTER grants, so nothing smuggles one in)
→ cache at perm:v{ver}:{userId}
```

**Revocation must take effect within one request.** Version-key bump invalidates instantly. TTL is
a leak-safety net, not the mechanism — relying on it means a revoked user keeps access for minutes.

---

## 5. Invariants

Things that must never be false. Each has a guarding test (Prompt 12.1).

| Invariant | Guarded by |
| :--- | :--- |
| `SUM(ledger credits − debits) == available + escrow + held`, per wallet | `GET /admin/finance/integrity` + property-based test |
| Every `txn_group_id` sums to zero | Ledger service + integrity check |
| `stock_qty >= 0`, always | `CHECK` constraint + `SELECT … FOR UPDATE` |
| `saler_commission + platform_margin == net_retail_margin` | `CHECK` on `sub_orders` |
| No user approves their own pending action | Service check + `CONSTRAINT no_self_approval` |
| No CRITICAL permission reaches a non-super-admin | Resolution step 5 + dedicated auth test suite |
| A coupon never exceeds its budget cap | `CHECK` + atomic reservation in the checkout transaction |
| An ad campaign never overspends | `CHECK (spent_amount <= total_budget)` + pacing |
| A flash sale never oversells | `CHECK (sold_qty <= allocated_qty)` |
| `audit_logs` and `ledger_transactions` are never updated or deleted | Triggers |
| Client JS bundle ≤ 150KB gzipped | Build fails (Prompt 1.9) |
| Every route has an explicit `permission` and `module` | Router rejects registration otherwise |

**When a change would violate one of these, stop and re-read the relevant spec.** These are not
style preferences; each one exists because violating it loses money, leaks data, or breaks trust.

---

## 6. Conventions an Agent Will Otherwise Get Wrong

1. **Money is a decimal string over the wire** (`"3200.00"`), `NUMERIC(14,2)` in the database, and
   integer paisa inside `pricing.service.js`. Never a JSON number.
2. **Both locale files, always.** A string in `en.json` but not `bn.json` is an incomplete change.
3. **Register new components in `pages/dev/gallery-registry.js`** in the same commit.
4. **Every integration ships a `mock` driver** and defaults to it in development.
5. **Permission keys come from `permission-catalog.json`.** Inventing one in code means it will
   never resolve.
6. **`requireModule` + `requirePermission` + `requireRestriction` on every feature route.** All three.
7. **No raw hex outside `themes.css`.** No magic numbers anywhere — they belong in module settings.
8. **`client/package.json` `dependencies` stays `{}`.** Permanently.
9. **Never edit an applied migration.** Write a new forward one.
10. **`// WHY:` comments on non-obvious decisions.** An agent can read *what* the code does; it
    cannot recover *why*, and that is exactly how correct code gets "refactored" into broken code.

---

## 7. Keeping This Current

Updating `CLAUDE.md` and this file is **part of the definition of done** for any prompt that adds a
subsystem. A stale orientation document is worse than none: it sends the next agent confidently in
the wrong direction.

When you add a subsystem, update: the directory map (§1), the "where do I change X?" table (§2),
and — if it touches money, access, or stock — the invariants (§5).
