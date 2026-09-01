# Explooro

Social commerce and reseller partnership platform for Bangladesh.
Suppliers hold the stock, Salers sell it from branded virtual storefronts with zero inventory,
and every commission settles through an escrow-backed digital vault.

---

## Getting started — 3 commands

```bash
npm install
cp .env.example .env
npm run dev
```

Then open **http://localhost:3000**.

That is the whole setup. You should see the dev harness reporting the client, the API, and the
proxy as healthy.

### 🚫 Docker is NOT required

You do not need Docker, and you should not install it to work on this project.
Everything runs natively on `node` and `npm`.

Docker appears exactly once, at the very end (Prompt 12.7), and only for **production
deployment**. Even after that lands, `npm run dev` keeps working natively with no containers —
that is an explicit acceptance criterion, because a fast local preview loop is worth more than
environment parity during development.

### What you need installed

| Required | Version | Notes |
| :--- | :--- | :--- |
| Node.js | 20+ LTS | That is genuinely all you need today |

| Optional, later | When | Zero-install path |
| :--- | :--- | :--- |
| PostgreSQL | Phase 2 | Use a free [Neon](https://neon.tech) database — paste its URL into `.env` |
| Redis | Phase 2 | Not needed. `CACHE_DRIVER=memory` runs the whole app in-process |
| Cloud storage | Phase 4 | Not needed. `STORAGE_DRIVER=local` writes to `server/storage/` |
| Payment / courier / AI accounts | Phase 5+ | Not needed. Every integration ships a `mock` driver and defaults to it |

---

## Scripts

| Command | What it does |
| :--- | :--- |
| `npm run dev` | Client **and** server together, with hot reload on both |
| `npm run dev:client` | Vite dev server only — port 3000 |
| `npm run dev:server` | Fastify API only — port 5000, `node --watch` |
| `npm run build` | Production client bundle → `client/dist` |
| `npm run preview` | Serve the built bundle locally — port 3001 |
| `npm run migrate --workspace server` | Apply pending database migrations (Prompt 2.1) |
| `npm run migrate:status --workspace server` | List applied vs. pending migrations |
| `npm run seed --workspace server` | Load reference/dev data — roles, the permission catalog, dev users (Prompt 2.2) |

The Vite dev server proxies `/api` → `localhost:5000` and `/ws` → `localhost:5000`, so the browser
only ever sees one origin. No CORS configuration is needed in development.

---

## 🔒 Development only — seeded accounts

Running `npm run migrate && npm run seed` against your `DATABASE_URL` creates one user per role,
all sharing the same password below. **Never run this seed against a production database** — these
credentials are public, checked into this repository.

| Role | Phone | Password |
| :--- | :--- | :--- |
| `super_admin` | `+8801700000001` | `Explooro@Dev2026` |
| `admin` | `+8801700000002` | `Explooro@Dev2026` |
| `moderator` | `+8801700000003` | `Explooro@Dev2026` |
| `editor` | `+8801700000004` | `Explooro@Dev2026` |
| `supplier` | `+8801700000005` | `Explooro@Dev2026` |
| `saler` | `+8801700000006` | `Explooro@Dev2026` |
| `customer` | `+8801700000007` | `Explooro@Dev2026` |

The seeded `moderator` deliberately holds no delegated permissions beyond the `moderator` role's
own defaults from `docs/permission-catalog.json` — no `user_permission_overrides` rows are seeded
for anyone — so it is the account to log in as when testing the locked-state UI
(`docs/ia-sitemap.md` §5) for real rather than by simulation.

**2FA note (Prompt 2.3):** every role above except `customer` holds a MEDIUM+ permission, so
`POST /auth/login` for those returns `401 TWO_FACTOR_REQUIRED` with `details.challenge_token`
instead of a token pair — this is correct, not a bug. First-time enrollment is exactly what that
challenge token is for: `POST /auth/2fa/setup { "challenge_token": "..." }` (no Bearer token needed
or possible yet) returns an `otpauth_uri`/secret to scan, then `POST /auth/2fa/verify
{ "challenge_token": "...", "code": "<TOTP>" }` completes the login and issues real tokens.

Regenerate `server/src/db/seeds/002_dev_users.sql` (e.g. after rotating the password) with:

```bash
node scripts/generate-dev-user-seed.mjs
```

---

## Repository layout

```
explooro/
├── client/          Web frontend — Vite + vanilla modern CSS + modular ESM
│   ├── index.html
│   ├── vite.config.js
│   └── src/
├── server/          API — Node.js + Fastify
│   └── src/         Routes -> Controllers -> Services -> Repositories
├── mobile/          Flutter app (Phase 12)
├── scripts/         palette.mjs — generates + verifies the colour ramps
├── docs/            Active specifications and planning documents
│   ├── prompt.md              ⭐ Master blueprint — 86 sequential prompts, 12 phases
│   ├── design-system.md       Colour (OKLCH), type, spacing, motion, craft rules
│   ├── ia-sitemap.md          ~120 routes, 6 role nav trees, locked-state UX
│   ├── rbac-spec.md           Risk tiers, 3 delegation modes, resolution algorithm
│   ├── permission-catalog.json  182 permissions — authority on permission keys
│   ├── erd.md                 95 tables, fully typed
│   ├── api-contract.md        Envelopes, 37 error codes, idempotency, webhooks
│   ├── module-registry.md     71 toggleable modules
│   ├── architecture-map.md    "Where do I change X?" — start here
│   ├── dependency-ledger.md   Every dependency, why, how to remove
│   ├── how-to-add-a-feature.md  One worked example through every layer
│   └── PRD.md · DFD.md · idea proposition.md · technologyused.md   (sources)
├── initialDoc/      Superseded early drafts, kept for archival reference only
├── CLAUDE.md        Guidance for Claude Code
└── AGENTS.md        Pointer to CLAUDE.md for other agent tools
```

---

## Non-negotiable rules

These exist to keep the platform fast and to keep it alive years from now.
The full reasoning lives in [`docs/prompt.md`](docs/prompt.md) under **Master Instructions**.

1. **Zero runtime dependencies in the client.** `client/package.json` has an empty `dependencies`
   block and it stays empty. The router, state store, API client, i18n engine, motion helpers and
   charts are all hand-written. Nothing the browser executes comes from npm.
2. **No CSS framework, no UI library, no state library, no chart library, no icon library, no
   date library, no HTTP client library, no ORM.**
3. **Vite is a build tool, not a foundation.** No source file may import from `vite`. If Vite were
   to disappear, `client/src` would still be valid ES modules.
4. **Performance budget is enforced by the build** (from Prompt 1.9): 150KB JS gzipped,
   40KB CSS gzipped. Exceed it and the build fails.
5. **Money is `NUMERIC(14,2)`** in PostgreSQL, and split arithmetic exists in exactly one file.
6. **Every external integration ships a `mock` driver** and defaults to it in development.
7. **Exact dependency versions** — no `^`, no `~`. Upgrades are deliberate.

---

## Where to go next

- **Building the platform:** work through [`docs/prompt.md`](docs/prompt.md) in order. Each prompt
  declares its dependencies, its exact file list, its acceptance criteria, and what you should see
  in the browser when it is done.
- **Current phase:** not a single phase — work is proceeding out of strict prompt order across several
  partially-done phases (2–5), with active polish on already-"done" Phase 9/10/11 customer surfaces
  (coupons, team purchases, wishlist, returns, live stream, gamification, and a new saved delivery
  **address book** — an 11.3 extension, `/account/addresses`, added 2026-08-29). See the Status table
  below and the traceability matrix for the honest per-prompt picture; don't trust a single "current
  phase" label.
- **Orientation:** [`docs/architecture-map.md`](docs/architecture-map.md) maps 50 common changes to exact files.
- **Progress:** the honest traceability matrix at the end of `docs/prompt.md`.

## Status

| Phase | State |
| :--- | :--- |
| 0 — Foundations & Contracts | ✅ **Complete** — 0.1–0.8 all done |
| 1 — Design System, App Shell, Router, i18n | ✅ **Complete** — 1.1–1.10 all done |
| 2 — Auth, RBAC Engine, Delegation & Audit | ✅ **Complete** — 2.1–2.8 all done (Fastify & Redis/memory cache, Argon2id & JWT refresh rotation, SMS/email OTP, staff TOTP 2FA, 6-step RBAC resolution, Mode A/B/C delegation & maker-checker, activity control restrictions, tamper-evident audit hash chain, client session manager, permission gates & elevated access chip) |
| 3 — Admin Shell, Module Control & Theme Studio | ✅ **Complete** — 3.1–3.5 all done (Module control backend & dynamic targeting hierarchy, 68-module grouped control panel with optimistic toggles, dependency cascades & DOM gate scanner, users & access governance with JIT/Maker-Checker approval inbox, audit trail explorer & diff viewer, and OKLCH master color engine with WCAG AA validation) |
| 4 — Catalog, Media, Search & Storefronts | ✅ **Complete** — 4.1–4.8 all done (Catalog schema & warehouse batches, media pipeline & derivatives, dynamic pricing & split engine, Bengali-aware search & transliteration, marketplace home, product detail, saler sourcing & profit calculator, virtual storefront builder & Social Seller Kit) |
| 5 — Cart, Checkout, Orders & Payments | ✅ **Complete** — 5.1–5.4 all done (Cart & wishlist with localStorage/server sync, multi-supplier atomic checkout & FEFO allocation, COD anti-fraud & row locking, multi-gateway payments [bKash, Nagad, SSLCommerz, Mock], idempotent webhooks, reconciliation sweeper, checkout UI, Quick Buy modal, and order tracking) |
| 6 — Vault, Escrow, Ledger, Payouts & COD Reconciliation | ✅ **Complete** — 6.1–6.5 all done |
| 7 — Logistics, Returns, Disputes, Moderation & KYC | ✅ **Complete** — 7.1–7.6 all done |
| 8 — Real-Time Chat & Unified Notifications | 🟡 **Partial** — the server halves are sound, but every client surface in this phase was calling a doubled `/api/v1` prefix on top of `core/api.js`'s own, so **8.1, 8.2, 8.3 and 8.4 were all downgraded to 🟡 on 2026-08-30**. 15 call sites corrected across notifications and chat; `NotificationPreferencesPage.js` (`/account/settings`) rewritten and the TopBar bell drawer repaired (it threw a `ReferenceError` on every click and had never opened). `ChatPage.js` was also calling `/me`, a route that does not exist. A `/chat/*` mock driver plus a loopback WebSocket transport were then added, which surfaced a deeper defect: the gateway sends flat camelCase frames while the client destructured a `payload` object that has never been on the wire, so acks, inbound messages and typing indicators were dead in live mode too — both sides now agree. **Still missing:** no stylesheet exists for any chat surface (they are written in Tailwind-style utility classes this project forbids), so `/chat` and `/saler/inbox` render unstyled; read receipts are unreachable end to end; and the What's New modal is still never invoked. See traceability matrix rows 42, 43, 44 |
| 10 — Advanced Subsystems | ✅ **Complete** — 10.1–10.8 all done |
| 11 — Role Dashboards, Analytics, SEO & PWA | ✅ **Complete** — 11.1–11.6 all done; +saved delivery address book (`/account/addresses`); +complete Supplier Account overhaul (Simple Mode 6 core pages + Advanced Mode 15-page suite with `supplier.css`, 4x6" thermal labels, shipments tracking `/supplier/shipments`, B2B quotation inquiries `/supplier/inquiries`, and physical showroom status `/supplier/store-status`) — traceability matrix row 61 |
| 12 — Hardening, Mobile & Deployment | ⬜ Not started |

Rolled up from the per-prompt status markers in `docs/prompt.md`'s traceability matrix as of 2026-08-26 —
that document carries the verification evidence behind each ✅/🟡/⬜ and is the source of truth if the
two ever disagree. This table was not independently re-verified prompt-by-prompt in this pass; it's a
summary, not a substitute for the matrix.

### Design

The design direction is locked in [`docs/design-system.md`](docs/design-system.md):
a **solid, high-contrast, zero-gradient commerce aesthetic** (not glassmorphism — see §0 for the
reasoning). Every colour is authored in OKLCH and every contrast figure is measured, not estimated.

Regenerate and re-verify the palette at any time:

```bash
node scripts/palette.mjs
```

If you change a ramp, re-run this and update the spec from its output — the two must never drift.
Two "expected fail" lines for the switch off-state track are documented in §2; **any other failure
is a real regression.**
