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
│       │   ├── themes.css       GENERATED (scripts/palette.mjs --write). Ramps + semantic
│       │   │                  roles, light + dark. ONLY place raw colour lives
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
| Change the profit split (40/60) | `platform_settings` row `commission.default_splits` via `/admin/finance/splits`. **Never in code** — `services/pricing.service.js` reads it |
| Add a category- or product-specific split | `commission_rules` table; resolution order is in `services/pricing.service.js` |
| Change the escrow hold period | Module setting `escrow_engine.hold_days` via `/admin/platform/modules`. Read by `services/vault.service.js` |
| Change the minimum payout | `platform_settings.min_payout_amount`. Enforced in `services/payout.service.js` |
| Change the COD OTP threshold | Module setting `cod_protection.otp_threshold_amount`. Read by `services/checkout.service.js` |
| Change the return window | Module setting `returns_engine.return_window_days` |
| Change coin redemption rate | Module setting `loyalty_coins.redemption_rate` |
| Change group-buy team size / window | Module setting `group_buying.default_team_size`, `.window_hours` |
| Switch Saler Pro on/off, or change its fee, rebate points, grace days or billing period | Configuration, not code. Module `subscription_fees` (default OFF) at `/admin/platform/modules`; plans and policy at `/admin/finance/subscriptions` (`finance.subscription.manage`). The rebate is a per-plan `commission_rebate_pct` applied in `services/subscriptionRebate.js` and called from `pricing.service.js`. Billing/renewal: `services/subscriptionBilling.service.js` + `jobs/subscriptionRenewal.job.js`. Saler page: `pages/saler/SalerProPage.js` |
| Fix a pricing calculation | `services/pricing.service.js` — **the only file with split arithmetic** |
| Fix a wallet or ledger bug | `services/ledger.service.js` + `services/vault.service.js`. Re-read `erd.md` §12 first |

### Catalog & commerce

| I want to… | Change |
| :--- | :--- |
| Change how suppliers are graded in the Sourcing Catalog (window, minimum orders, dispatch SLA, weights, grade cut-offs) | **Configuration, not code** — the `supplier.scorecard` OBJECT row in `platform_settings` (migration 062). Scoring rules are `scoreMetrics` / `resolveRules` in `services/supplierScorecard.service.js`; the daily `supplier_scorecard` job rebuilds `supplier_scorecards`. Weights must sum to 100 or the stored set is ignored. There is no admin editor for the row yet |
| Sell a supplier a paid slot above the Sourcing Catalog, or change who may buy it / how rank reacts to the scorecard grade | **Configuration, not code** — price is the `sourcing_boost` rate card at /admin/growth/ad-pricing. The slot-specific rules (`max_slots`, `grade_rank_bonus`, `blocked_grades`) are the `supplier.sponsored_sourcing` OBJECT row in `platform_settings` (migration 063), read by `services/sponsoredSourcing.service.js`; `ads.service.runAuction` applies them and `product.service.listSponsoredSourcing` serves `GET /sourcing/sponsored`. There is no admin editor for the row yet |
| Let a supplier pay a monthly rebate to the salers who sell the most of their stock, or change the caps on it | **Configuration, not code** — the caps (`max_rebate_pct`, `max_tiers`, `min_threshold`, `platform_fee_pct` = what the platform keeps, `settle_lag_days`, `funding_retry_days`, `blocked_grades`, `timezone`) are the `supplier.volume_incentive` OBJECT row in `platform_settings` (migration 064), read by `services/volumeIncentive.service.js`. The supplier's own tiers are rows of `volume_incentive_programs`, versioned and never edited in place; the monthly `jobs/volumeIncentive.job.js` creates `volume_incentive_payouts` and pays them from the supplier's wallet (ledger category `VOLUME_INCENTIVE`). Routes: `GET`/`PUT /supplier/incentive`, `GET /sourcing/incentives`. There is no admin editor for the settings row yet |
| Let a supplier offer paid samples and publish a marketing kit, or change the caps on either | **Configuration, not code** — the caps (`platform_fee_pct` = what the platform keeps of the sample price, `min_price`, `max_price`, `max_shipping_fee`, `response_days`, `auto_confirm_days`, `max_open_per_saler`, `blocked_grades`, and the kit limits) are the `supplier.sample_kit` OBJECT row in `platform_settings` (migration 065), read by `services/sampleKit.service.js`. Offers are `sample_offers`, requests are `sample_requests` (price, shipping and the platform's share snapshotted on the row), kits are `marketing_kits`. The saler's money is held in their own wallet's HELD bucket (ledger categories `SAMPLE_HOLD` / `SAMPLE_RELEASE` / `SAMPLE_REFUND`); the only place a request changes state is `transition()` in the service, and the hourly `jobs/sampleKit.job.js` expires unshipped requests and auto-confirms unconfirmed ones. Routes: `/supplier/samples…`, `/supplier/marketing-kits…`, `/sourcing/samples…`, `/sourcing/marketing-kits`; permissions `supplier.sample.manage`, `saler.sample.request`. There is no admin editor for the settings row yet |
| Change what an early escrow payout costs, who may take one, or how Return Protection is priced and capped | **Configuration, not code** — `fee_pct_by_grade`, `ungraded_fee_pct`, `min_amount`, `max_per_request`, `max_outstanding`, `min_days_saved`, `blocked_grades` are the `supplier.fast_payout` OBJECT row in `platform_settings` (migration 066), read by `services/fastPayout.service.js`; `premium_pct`, `max_claim_amount`, `max_claims_per_saler_30d`, `enabled`, `blocked_grades` are the `supplier.return_protection` row, read by `services/returnProtection.service.js`. Early releases are `fast_payouts` (one per escrow entry, UNIQUE); protection is `return_protection_enrollments` (a history, so leaving never strips cover from orders already sold) and `return_protection_covers` (one per sub-order). Money moves as balanced ledger groups (`ESCROW_RELEASE` + `FAST_PAYOUT_FEE`, `RETURN_PROTECTION_PREMIUM`, `RETURN_PROTECTION_CLAIM`); a claim is paid from `return.service.js` `executeRefund` inside a savepoint (so it can never block a refund) and, if that fails, by the hourly `jobs/returnProtection.job.js` claim sweep, which also charges premiums. Routes: `/supplier/fast-payout`, `/supplier/return-protection`, `/sourcing/fast-payout`, `/sourcing/return-protection`; permissions `finance.fast_payout.request`, `supplier.return_protection.manage`. There is no admin editor for either settings row yet |
| Add a product field | See [`how-to-add-a-feature.md`](how-to-add-a-feature.md) — the full worked example |
| Add a product status | `erd.md` §3 `products.status` CHECK → new migration → `services/product.service.js` |
| Change search ranking | `services/search-drivers/postgres.js` |
| Add a Banglish search mapping | `utils/transliterate.js` |
| Change the product image aspect ratio | `design-system.md` §12 first, then `styles/components/product.css` + `services/media.service.js` derivatives |
| Change FEFO batch selection | `services/inventory.service.js` → `getFEFOBatch()` |
| Change warehouse routing | `services/warehouseRouting.service.js` |
| Add/modify product image fallback keywords | `client/src/components/product/ProductCard.js` (`KEYWORD_IMAGE_RULES`, `CATEGORY_DUMMY_IMAGES`, `resolveProductImage`) |
| Modify customer wishlist | `client/src/pages/customer/WishlistPage.js` (UI), `server/src/services/wishlist.service.js` (logic), `server/src/repositories/cart.repository.js` (SQL) |
| Modify customer returns listing | `client/src/pages/customer/ReturnsPage.js` (UI), `server/src/services/return.service.js` (logic), `server/src/routes/return.routes.js` (`/returns/my-returns`) |
| Modify customer coupons & vouchers hub | `client/src/pages/customer/CouponsPage.js` (`/account/coupons`), `client/src/components/customer/CouponCard.js`, `server/src/services/coupon.service.js` (logic), `client/src/mocks/handlers/campaigns.js` (mock data) |
| Modify team purchases / group buying UI | `client/src/pages/TeamPurchasePage.js` (`/team/:id`, `/account/team-purchases`), `server/src/services/teamPurchase.service.js` (logic), `client/src/mocks/handlers/teamPurchase.js` (mock data) |

### Access & permissions

| I want to… | Change |
| :--- | :--- |
| Add a permission | `docs/permission-catalog.json` → re-run seed. **Never invent a key in code** |
| Change the default language | `/admin/platform/language` → the `localization` group in `platform_settings`. Code path: `routes/localization.routes.js` → `controllers/localization.controller.js` → `services/localization.service.js` → `repositories/setting.repository.js`; the client reads it in `client/src/services/i18n.js` (`resolveInitialLocale`). `VITE_DEFAULT_LOCALE` is the pre-policy fallback only |
| Change the popup genie effect (on/off, duration, smoothness) | `/admin/platform/genie` → the `genie` group in `platform_settings`. Code path: `routes/genie.routes.js` → `controllers/genie.controller.js` → `services/genie.service.js` → `repositories/setting.repository.js`; the client applies it in `client/src/services/genieSettings.js` → `configureGenie()` in `client/src/lib/genie.js` (the engine). The slicing/easing constants (`NECK`, `SWAY`, `MAX_FRAME_DT_MS`) are still named constants in `genie.js`, not settings |
| Tune the personalized home feed (signal weights, windows, rails, diversity, "also viewed", cache) or read which surface converts | `/admin/platform/recommendations` → the `recommendation` group in `platform_settings` (one OBJECT row per tab). Code path: `routes/recommendationAdmin.routes.js` → `controllers/recommendationAdmin.controller.js` → `services/recommendationAdmin.service.js`, which validates strictly against the limits exported by `recommendation`, `homeRails`, `diversity`, `covisit` and `recoCache` services (change a bound THERE, never in the page). The page is `client/src/pages/admin/RecommendationSettingsPage.js`, drawn from the API's field descriptions; its pure helpers are `client/src/services/recoSettings.js`; the browser mock's copy of the fields is `client/src/mocks/handlers/recommendations.js` and `server/test/recommendationAdmin.test.js` fails if it drifts. Permissions `platform.recommendation.view` / `.update` |
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
| Change the colour the product ships with | The seed lives in TWO places that a test keeps equal: `DEFAULT_MASTER` in `client/src/services/colorRamp.js` (what `styles/themes.css` is generated from, so it is the pre-JS paint) and the preset named by `DEFAULT_MASTER_PRESET` in `client/src/config/master-themes.js` (what `initTheme()` mounts a beat later). Change both, then `node scripts/palette.mjs --write`, then paste that script's `--markdown` output into `design-system.md` §1.2–§2 |
| Hand-edit `styles/themes.css` | **Never.** Generated by `scripts/palette.mjs --write`; `client/test/colorRamp.test.js` parses the file and fails on any divergence from the engine, including an OKLCH override that is one 8-bit step off its own hex fallback |
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
| Change what an ad format costs | **Configuration, not code** — `/admin/growth/ad-pricing` edits the `ad_products.rate_card` JSONB behind `growth.ad.govern` (HIGH risk, delegable, so it can be handed to one staff member). Never a constant: `services/adPricing.js` only ever reads a stored rate card |
| Add a new kind of ad the platform sells | One `ad_products` row (see the seed block in `server/src/db/migrations/041_ad_marketplace.sql`). If it prices like one of the five existing models (CPC, CPM, FLAT_DAILY, FLAT_SLOT, CPS) that is the whole change — the seller's Ad Store, the wizard's fields and the quote engine all branch on `pricing_model`. A genuinely new *model* is the only case that touches `services/adPricing.js` |
| Fix an ad price that looks wrong | `server/src/services/adPricing.js` — every ad price the platform quotes, charges or displays is computed there and nowhere else. `server/test/adPricing.test.js` states the invariants |
| Add a nav item | `client/src/config/navigation.js` — one object. Never edit `Sidebar.js` |
| Hide a page from users, or release it to one of them | **Configuration, not code** — **/admin/platform/pages** (`platform.page.view` / `.toggle`, CRITICAL so super admin only). Four states per route: Live / Coming soon (nav badge + placeholder) / Hidden (no nav item, URL 404s) / Limited (live only for listed roles and user ids). It is a layer BESIDE the module system, not above it: a module answers "does the feature work", a page toggle answers "may this viewer see it", and the 101 `module: 'core'` routes have no module to switch. `/`, `/login` and the page itself are locked on. One resolver — `client/src/services/pageAccess.js` — serves the router, the sidebar and the command palette; never re-implement the states. On the server the same states are enforced for the **56 endpoints that belong to exactly one page**: that route declares `config: { page: '/its/path' }` and the `onRoute` hook in `server/src/middlewares/requirePage.js` appends the guard, which answers `403 PAGE_UNAVAILABLE`. An endpoint two pages share cannot be refused (the other page may be Live), so for those the toggle stays visibility-only |
| Add a UI component | `components/ui/` + register in `pages/dev/gallery-registry.js` **in the same change** |
| Add a field a user edits about themselves | `user_profiles` (Prompt 2.2 migration) → the whitelist in `server/src/repositories/user.repository.js` → validation in `profile.service.js` → a control in `client/src/pages/settings/ProfilePage.js` → the same key in `mocks/handlers/me.js`. Never add a writable column without adding it to BOTH whitelists |
| Add an item to the avatar (account) menu | `AvatarMenu()` in `client/src/components/shell/TopBar.js`. It is the only account entry point every role shares — the sidebar is per-role |
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
11. **`Modal()` returns a real `<dialog>` element — call `openModal()`/`closeModal()`, never
    `.open()`/`.close()`.** `open` is a native boolean *attribute* on `<dialog>`, not a method, so
    `modal.open()` throws `TypeError: modal.open is not a function`; `.close()` happens to work
    (native `HTMLDialogElement.close()` exists and fires the same `close` event) but skips the
    component's own `result` bookkeeping. `QuickBuyModal.js` and the order-cancel dialog in
    `OrderDetailPage.js` both shipped calling `.open()`/`.close()` and neither modal ever opened
    until fixed 2026-08-26 — see `docs/prompt.md` traceability rows 30 and 61.

---

## 7. Keeping This Current

Updating `CLAUDE.md` and this file is **part of the definition of done** for any prompt that adds a
subsystem. A stale orientation document is worse than none: it sends the next agent confidently in
the wrong direction.

When you add a subsystem, update: the directory map (§1), the "where do I change X?" table (§2),
and — if it touches money, access, or stock — the invariants (§5).
