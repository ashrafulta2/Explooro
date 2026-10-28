# Explooro — Dependency Ledger

> **Produced by:** Prompt 0.8
> **Enforces:** the Dependency Policy in [`prompt.md`](prompt.md) Master Instructions §3
>
> Every dependency in this repository is recorded here with why it exists, what it would take to
> remove it, and **which single file isolates it**. A dependency that is not in this ledger should
> not be in `package.json`.
>
> This exists because dependency creep is how a "zero-bloat, immune to framework churn" project
> quietly becomes neither.

---

## 1. The Rules

1. **`client/package.json` `dependencies` is `{}` and stays `{}`.** Nothing the browser executes
   comes from npm.
2. Adding any dependency not on the permitted list (§3) requires, **in the same change**:
   an entry in this file, and **isolation behind a single file**.
3. **A dependency may be imported from exactly one module.** If it must be replaced later, exactly
   one file changes.
4. **Exact versions.** No `^`, no `~`. Upgrades are deliberate, reviewed changes.
5. Rejected outright: anything with a large transitive tree, a native build step (beyond `sharp`),
   or a history of breaking major releases.

### Never permitted, anywhere

CSS framework · UI component library · state-management library · charting library · icon library ·
date library (use `Intl`) · HTTP client library (use `fetch`) · ORM (use SQL through the repository
layer) · React / Vue / Next.js / Tailwind / Bootstrap.

---

## 2. Currently Installed

Verify with `npm ls --depth=0`. Audited 2026-10-15: **0 vulnerabilities**, after security bumps of
`fastify` 5.12.1 → 5.12.7, `sharp` 0.35.3 → 0.35.5 and `concurrently` 10.0.5 → 10.0.6, plus lockfile-only
updates of transitive `fast-uri`, `shell-quote`, `source-map-js` (via `vite`) and `ip-address` (via
`@fastify/rate-limit`).

| Package | Version | Where | Isolated in | Why | Removal cost |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `vite` | 8.2.2 | client, **dev only** | `client/vite.config.js` | Dev server with sub-500ms start and HMR; production bundling | **Low.** No source file outside `vite.config.js` may import from `vite`. `client/src` is plain ES modules — swap the bundler, or serve natively |
| `fastify` | 5.12.7 | server | `server/src/app.ts` + `routes/` | 30k+ req/s, built-in JSON schema validation, small memory footprint | **Medium.** The 3-tier architecture keeps Fastify in routes/plugins only; `services/` and `repositories/` are plain Node and would be unaffected |
| `concurrently` | 10.0.6 | root, **dev only** | root `package.json` scripts | Runs client + server in one terminal | **Trivial.** Two terminals |
| `typescript` | 5.9.3 | root, **dev only** | root `package.json` (never imported by source) | Type **checker** only, run with `noEmit`. Since 2026-10-15 the server (done) and since 2026-10-25 the client are moving from `.js` to `.ts` file by file ([typescript-migration.md](typescript-migration.md)); Node >= 22.18 runs the `.ts` files directly by stripping the types and Vite strips them when it bundles, so there is still **no separate build step and nothing new ships to the browser**. `.js` files not yet moved keep opting in with `// @ts-check` and JSDoc. Catches shape mismatches (e.g. a ledger `entryType` typo) that otherwise surface as runtime or money bugs | **Small.** Strip the annotations from the `.ts` files (they are erasable-only syntax by rule), rename them back to `.js`, delete the package and the `tsconfig.json` files |
| `@types/node` | 22.20.5 | root, **dev only** | root `package.json` (never imported by source) | Type declarations for Node built-ins so the checker can resolve `node:crypto` etc. Pinned to 22.x to match `engines.node >=22.18` (the first 22.x that strips types without a flag) so the checker never accepts an API newer than the minimum supported Node | **Trivial.** Same as `typescript` |
| `pg` | 8.23.0 | server | `server/src/config/db.ts` | The PostgreSQL wire protocol is not something to reimplement | **Medium.** Only `db.ts` and `db/migrate.ts` import it; repositories receive a client/pool, never the driver |
| `redis` | 6.2.1 | server | `server/src/config/cache-drivers/redis.ts` | Real Redis client for `CACHE_DRIVER=redis` | **Trivial.** `CACHE_DRIVER=memory` runs the whole app with this package never touched at runtime |
| `@fastify/cors` | 11.3.0 | server | `server/src/app.ts` | Official plugin; same release cadence as Fastify | **Low.** One `app.register` call |
| `@fastify/helmet` | 13.1.1 | server | `server/src/app.ts` | Official plugin; hand-rolling security headers is error-prone | **Low.** One `app.register` call |
| `@fastify/cookie` | 11.1.2 | server | `server/src/app.ts` | Official plugin; cookie parsing/signing for the refresh-token cookie (Prompt 2.3) | **Low.** One `app.register` call |
| `@fastify/rate-limit` | 11.2.0 | server | `server/src/app.ts` | Official plugin; wired to a custom Store class backed by `config/cache.ts` so `CACHE_DRIVER=memory` keeps limiting working with no Redis | **Low.** One `app.register` call plus the Store class in `app.ts` |
| `argon2` | 0.45.1 | server | `server/src/lib/password.ts` | Password hashing must never be hand-rolled. Pulled forward from Phase 2.3 into 2.2 because the dev-user seed needs real argon2id hashes, not placeholders; 2.3's `auth.service.ts` imports from `password.ts`, never from `argon2` directly, so it still has exactly one importer | **Low.** `hashPassword`/`verifyPassword` in one file; swapping the algorithm touches only `password.ts` |
| `jose` | 6.2.10 | server | `server/src/lib/jwt.ts` | Access-token signing/verification. Zero runtime dependencies of its own (vs. `jsonwebtoken`'s 9 transitive packages including several `lodash.*` micro-packages) — the deciding factor given docs/prompt.md's "reject anything with a large transitive tree" rule | **Low.** `signAccessToken`/`verifyAccessToken` in one file; `authenticate.ts` and `auth.service.ts` both import from there, never from `jose` |
| `sharp` | 0.35.5 | server | `server/src/services/media.service.ts` | Image resize/encode in native code (libvips). The one permitted native build; ships prebuilt `@img/*` binaries per platform, so no compiler is needed | **Medium.** Only `media.service.ts` imports it. Removing it means serving originals unresized or moving image work to a separate service |

**Fourteen direct dependencies (two are type-only dev tools). Zero of them run in the browser.**

---

## 3. Pre-Approved — Add Without a New Justification

These are named in the Dependency Policy. Adding one still requires a ledger row when it lands.

| Package | Phase | Isolated in | Why not hand-written |
| :--- | :--- | :--- | :--- |
| `@fastify/websocket` `@fastify/postgres` | 8.1 | `server/src/app.ts` | Official plugins; same release cadence as Fastify. (`cors`/`helmet`/`cookie`/`rate-limit` landed in 2.1 — see §2) |
| `sharp` | 4.2 | `server/src/services/media.service.ts` | Image resize/encode in native code. The one permitted native build |
| `@anthropic-ai/sdk` 0.120.0 | 10.2 | `server/src/services/ai/provider.ts` | Streaming, retries, token accounting |
| `vitest` | 12.1 | `vitest.config.js`, **dev only** | Vite-native; no second toolchain |

---

## 4. Deliberately Hand-Written

Each of these is a library we did **not** install. The size column is why.

| What | Where | Typical library cost | Ours |
| :--- | :--- | ---: | ---: |
| Router | `client/src/core/router.js` | react-router ~20KB | ~150 lines |
| State store | `client/src/core/store.ts` | Redux + toolkit ~40KB | ~80 lines |
| HTTP client | `client/src/core/api.ts` | axios ~14KB | ~200 lines |
| i18n | `client/src/services/i18n.ts` | i18next ~40KB | ~120 lines |
| Charts | inline SVG | Chart.js ~200KB | per-chart |
| Icons | SVG sprite | lucide / fontawesome ~50KB+ | 0 |
| Dates & currency | `client/src/services/format.ts` | date-fns / moment ~20–70KB | `Intl` (built in) |
| Motion | `client/src/lib/motion.ts` | framer-motion ~120KB | < 3KB |
| Toasts, modals, tables | `client/src/components/ui/` | any UI kit ~100KB+ | own code |
| QR codes | `server/src/services/flyer.service.ts` | qrcode lib | server-side |
| Migration runner | `server/src/db/migrate.ts` | knex / node-pg-migrate | ~120 lines |
| Cron scheduler | `server/src/jobs/scheduler.ts` | agenda / bull | ~80 lines + advisory lock |
| Colour + contrast maths | `scripts/palette.mjs` | culori / chroma-js | ~140 lines |
| TOTP (RFC 6238) + base32 | `server/src/services/totp.service.ts` | otplib / speakeasy | ~90 lines, verified against the official RFC 6238 SHA1 test vector |
| Envelope encryption (AES-256-GCM) | `server/src/lib/encryption.ts` | node-jose / cryptr | ~35 lines — Node's built-in `crypto` already implements the primitive |
| Public ref/short-code generator | `server/src/lib/ref.ts` | nanoid / shortid | ~15 lines |

Roughly **600KB of avoided browser payload**, against a 150KB total budget that the build
enforces. Hand-writing was not ideology here — the budget makes most of these arithmetically
impossible.

Each is small because it does only what this project needs. A general-purpose router handles
twenty cases; ours handles four.

---

## 5. Adding a Dependency — the checklist

Before installing, answer these in a new §6 row:

1. **What does it do**, in one sentence?
2. **Why is hand-writing it worse?** "It would take a day" is not a reason. "It implements a
   security protocol / native codec / wire format" is.
3. **Install size and transitive dependency count.** `npm i --dry-run <pkg>` reports both.
4. **Maintenance status.** Last release, open issues, single maintainer?
5. **Which single file will isolate it?**
6. **What breaks if it is abandoned in three years?**

Then:

```bash
npm install --save-exact <pkg>     # exact version, never ^ or ~
npm audit                          # must report 0 vulnerabilities
```

Add the row to §6, and confirm the import appears in exactly one file.

---

## 6. Rejected & Reconsidered

Recording what was turned down is as useful as recording what was accepted — it stops the same
proposal being re-litigated every few months.

| Considered | Verdict | Reason |
| :--- | :--- | :--- |
| `pino-pretty` | ❌ Rejected | Log formatting is a developer convenience. Production consumes raw JSON anyway; `server/src/index.ts` carries a `// WHY` note |
| `dotenv` | ❌ Rejected | Node 20.6+ has `--env-file` built in. Prompt 2.1 validates env vars itself |
| `nodemon` | ❌ Rejected | `node --watch` is built in |
| `uuid` | ❌ Rejected | `crypto.randomUUID()` is built in |
| `axios` | ❌ Rejected | `fetch` is built in on both platforms |
| `date-fns` / `moment` | ❌ Rejected | `Intl.DateTimeFormat` and `Intl.NumberFormat` cover every case, including Bengali locale |
| Tailwind CSS | ❌ Rejected | Contradicts the zero-framework mandate; the design system is CSS custom properties |
| Any chart library | ❌ Rejected | Smallest credible option exceeds a third of the entire JS budget |
| Any icon library | ❌ Rejected | An SVG sprite of the ~40 icons actually used costs a fraction |
| `sharp` | ✅ **Accepted** | Image encoding in JavaScript is orders of magnitude slower. The one permitted native build. Isolated in `media.service.ts` |
| `argon2` | ✅ **Accepted** | Hand-rolling password hashing is malpractice |
| Meilisearch | ⏸️ **Deferred** | Postgres FTS + `pg_trgm` is sufficient at launch scale. The driver interface in `services/search-drivers/` makes the switch a one-file change when it is not |

---

## 7. Audit Cadence

| When | Do |
| :--- | :--- |
| Every dependency addition | `npm audit` must report 0 vulnerabilities |
| Monthly | `npm audit` + `npm outdated`; review, do not auto-upgrade |
| Before each release | `npm ls --depth=0` matches §2, and `client` `dependencies` is still `{}` |
| Any major-version bump | Read the changelog, run the full test suite, update this ledger |

A **CI check** (Prompt 12.7) fails the build if `client/package.json` gains a runtime dependency —
the single most important line in this document, enforced mechanically rather than by memory.
