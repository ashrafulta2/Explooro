# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Explooro — a social commerce and reseller partnership platform for Bangladesh. Suppliers hold
stock, Salers sell it from zero-inventory branded virtual storefronts, and commissions settle
through an escrow-backed digital vault.

## The build plan lives in docs/prompt.md — read it before building anything

All planning and specification documents live in [`docs/`](docs/), not the repo root.
[`docs/prompt.md`](docs/prompt.md) is the master blueprint: 86 sequential, dependency-ordered
prompts across 12 phases (Foundations → Design System → Auth/RBAC → Admin → Catalog → Checkout →
Vault/Escrow → Logistics/Disputes → Chat → Growth engines → Advanced → Hardening/Deployment). Each
prompt declares its `DEPENDS ON`, exact `FILES`, `REQUIREMENTS`, objectively checkable `ACCEPTANCE`
criteria, and a `PREVIEW` describing what must be visible in the browser afterward.

**Do not skip or reorder prompts, and do not consider one done until every ACCEPTANCE line is
satisfied.** The current state — check the traceability matrix at the end of `docs/prompt.md` and
the Status table in `README.md` — is Phase 0 in progress (0.1–0.3 complete: dev harness, design
system spec, and the next item in sequence — verify against the traceability matrix rather than
trusting this file, since it will drift). Most of what's described below as "architecture" is the
target the prompts build toward, not necessarily code that exists yet — check before assuming.

Source documents that `docs/prompt.md` was synthesized from, useful for "why" context:
`docs/idea proposition.md`, `docs/PRD.md` (product requirements), `docs/DFD.md` (data flow
architecture), `docs/technologyused.md` (stack rationale), `docs/design-system.md` (locked design
direction, from Prompt 0.2). These are still actively cited by name (`§section`) inside
`docs/prompt.md` for phases not yet built — don't treat them as historical.

[`initialDoc/`](initialDoc/) holds superseded early drafts kept only for archival reasons and no
longer referenced by anything active: `prompt.v1.backup.md` (the v1.0 blueprint, replaced by
`docs/prompt.md` v2.0), `Explooro Idea.md` (superseded by the more detailed `idea proposition.md`),
and `technologyneed.md` / `technologyneed_banglish.md` (draft stack spec, superseded by
`docs/technologyused.md`). Don't pull requirements from `initialDoc/` — if it conflicts with
`docs/`, `docs/` wins.

## Commands

```bash
npm install               # root install (npm workspaces: client, server)
cp .env.example .env
npm run dev                # client + server concurrently, hot reload on both
npm run dev:client         # Vite dev server only — port 3000
npm run dev:server         # Fastify API only — port 5000, node --watch
npm run build               # production client bundle -> client/dist
npm run preview             # serve the built bundle — port 3001
```

There is no lint or test command wired up yet (no test runner is installed as of this writing). The
dependency policy names `vitest` as the eventual permitted test runner — check `package.json` in
`client/` and `server/` before assuming test commands exist.

The Vite dev server proxies `/api` → `localhost:5000` and `/ws` → `localhost:5000` (see
`client/vite.config.js`), so the browser only ever sees one origin and no CORS config is needed in
development.

## Non-negotiable constraints (from docs/prompt.md Master Instructions)

These are enforced across every prompt, not stylistic suggestions:

1. **Zero runtime dependencies in the client, permanently.** `client/package.json` `dependencies`
   must stay `{}`. Router, state store, API client, i18n engine, motion helpers, charts, QR
   rendering, virtual scrolling — all hand-written ESM in `client/src`, each spec'd in `docs/prompt.md`.
   Vite/Vitest are `devDependencies` only (build/test tools); no source file outside
   `vite.config.js` may import from `vite`.
2. **Never permitted anywhere:** a CSS framework, UI component library, state-management library,
   charting library, icon library, date library (use `Intl`), HTTP client library (use `fetch`), or
   an ORM (use raw SQL through the repository layer). No React, Vue, Next.js, Tailwind, Bootstrap.
3. **Backend dependencies: short, boring, audited list only** — `fastify` + official `@fastify/*`
   plugins, `pg`, `redis` (behind the adapter from Prompt 2.1), `argon2`, a JWT library, `sharp`,
   the chosen AI provider SDK, `vitest`/`concurrently` (dev). Anything else requires a
   `docs/dependency-ledger.md` justification entry AND isolation behind a single adapter file in
   `server/src/integrations/` (a dependency may be imported from exactly one module).
4. **Exact dependency versions** — no `^`, no `~`. Upgrades are deliberate.
5. **Docker is forbidden until Prompt 12.7.** No `Dockerfile`/`docker-compose.yml`, no telling the
   developer to containerize, before Phase 12. `npm run dev` must keep working natively even after
   Docker lands for production deployment.
6. **PostgreSQL and Redis without Docker:** Postgres via Neon free tier (`DATABASE_URL`) or a local
   installer; Redis via Upstash free tier or the required in-memory fallback (`CACHE_DRIVER=memory`)
   — a developer with no `REDIS_URL` must still be able to run the whole app locally.
7. **Every external integration (payments, courier, SMS, AI) ships a `mock` driver and defaults to
   it in development**, switchable via env var with no code changes (e.g. `VITE_API_MODE=mock|live`).
8. **Performance budget enforced by the build**: 150KB JS gzipped, 40KB CSS gzipped — exceeding it
   fails the build (from Prompt 1.9 onward).
9. **The Vite dev server must never break.** After every prompt, `npm run dev` starts cleanly and
   the site is visually inspectable at `localhost:3000`. Never leave the app non-rendering between
   prompts — ship behind a feature flag if needed. A living style guide at `/dev/gallery` registers
   every component as it's built.
10. **Money is `NUMERIC(14,2)`** in PostgreSQL, never `FLOAT`/`REAL`/`DOUBLE`. Split/commission
    arithmetic exists in exactly one file. All balance mutations run inside a transaction with
    `SELECT … FOR UPDATE`.
11. **Every state-changing admin/staff action writes an `audit_logs` row** with before/after JSON.
    Every list endpoint is paginated; every write endpoint accepts an `Idempotency-Key` header.
12. **Zero hardcoded credentials, URLs, or magic numbers** — everything via `.env` (+ committed
    `.env.example` documenting every variable, even ones not yet used).
13. Permission keys follow `domain.resource.action`. Feature-gated code calls
    `requireModule('module_key')`.

## Architecture (target — see docs/prompt.md for the phase that builds each piece)

- **Monorepo**: npm workspaces, `client` + `server`. `mobile/` (Flutter, Phase 12) is a separate,
  unrelated toolchain — don't run npm commands there.
- **`client/`** — Vite + vanilla modern CSS + modular ESM. Solid, high-contrast, zero-gradient
  commerce aesthetic (Amazon/Alibaba/Daraz-like) — glassmorphism only permitted on transient
  overlays (modal scrims, command palette backdrop), never on cards/navbars/tables/product surfaces.
  Design tokens as CSS custom properties; no raw hex in component CSS. i18n is a native JSON
  dictionary engine (English ↔ Bangla).
- **`server/`** — Node.js v20+ LTS + Fastify, strict 3-tier layered architecture:
  `Routes → Controllers → Services → Repositories`. Auth is stateless JWT + HttpOnly refresh
  cookies + local SMS OTP. WebSockets (`ws` / `@fastify/websocket`) for chat/live notifications,
  fanned out via Redis Pub/Sub across nodes.
- **Database**: PostgreSQL 16, **95 tables** fully specified in `docs/erd.md`. ACID transactions
  guarantee atomic balance transfers: Customer payment → Escrow → Saler profit split → Supplier
  payout.
- **Bangladesh-specific integrations**: bKash / Nagad / Rocket (MFS payments), SSLCommerz (backup
  gateway), Steadfast / Pathao / RedX (courier + tracking webhooks), local SMS gateways for OTP —
  each behind its own adapter with a mock driver.

## Where do I change X?

Don't guess — [`docs/architecture-map.md`](docs/architecture-map.md) §2 maps the **35 most likely
change requests to exact file paths**, and §1 annotates the full directory tree. Start there.

The ones that trip people up most:

| Task | Answer |
| :--- | :--- |
| Change the profit split / escrow days / any business number | **Configuration, not code** — `platform_settings` or a module setting. Never hardcode |
| Add a permission | `docs/permission-catalog.json`, then re-seed. Never invent a key in code |
| Make an action need Admin approval | Set its `risk_tier` to `HIGH` in the catalog. The maker-checker flow is automatic |
| Add a nav item | `client/src/config/navigation.js` — one object. Never edit `Sidebar.js` |
| Change the colour the product SHIPS with | Two constants, then one command. Set the seed in `DEFAULT_MASTER` (`client/src/services/colorRamp.js`) and in the matching preset named by `DEFAULT_MASTER_PRESET` (`client/src/config/master-themes.js`), then run `node scripts/palette.mjs --write` to regenerate `client/src/styles/themes.css`. Currently `midnight_slate` (#334155); `explooro_pink` is the alternate |
| Hand-edit `client/src/styles/themes.css` | **Don't.** It is generated — see the row above. `client/test/colorRamp.test.js` parses it and fails if any step or role differs from the engine's output, because the only symptom of drift is a colour flash on cold load that nobody thinks to look for |
| Re-theme the running product to another colour | Theme Studio's **Master Colour** panel, or a seed-only preset in `client/src/config/master-themes.js`. One seed regenerates every ramp step (`services/colorRamp.js`), so borders/hovers/scrollbars/dark mode follow. Never hand-author a hex ramp. The server re-derives and validates the master block on every write — `MASTER_RANGES` in `colorRamp.js` is the single source for both the Studio's sliders and the API's bounds |
| Change the flash-sale / campaign strip colours | Theme Studio → **Flash Sale & Campaign Strip** section, or the `--flash-*` tokens in `client/src/styles/themes.css` for the shipped default. The strip is a themed section (`flash_sale`), not a raw `--danger-300` reference, so it follows the master seed and is contrast-gated on both client and server |
| Adding a whole feature | Follow [`docs/how-to-add-a-feature.md`](docs/how-to-add-a-feature.md) — 14 steps, worked end to end |
| Add a dependency | Read [`docs/dependency-ledger.md`](docs/dependency-ledger.md) first. Most proposals have already been rejected there |

## Before you finish

A change is not done until all of these are true:

- [ ] `npm run dev` still starts and the site renders at localhost:3000
- [ ] Every new user-facing string is in **both** `locales/en.json` and `locales/bn.json`
- [ ] Every new component is registered in `client/src/pages/dev/gallery-registry.js`
- [ ] Every new feature route has `requireModule` + `requirePermission` + `requireRestriction`
- [ ] Every state-changing staff action writes an `audit_logs` row with before/after
- [ ] Business numbers live in settings, not in code
- [ ] `npm test` passes; new business logic has a test for its stated invariant
- [ ] Non-obvious decisions carry a `// WHY:` comment
- [ ] The traceability matrix at the end of `docs/prompt.md` is updated **honestly**, including
      when something is only partly done
