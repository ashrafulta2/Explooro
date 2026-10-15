# TypeScript migration (server)

Started 2026-10-15 at the owner's request: move the server from `.js` to `.ts` **step by step,
without ever leaving it in a broken state**. The client is not part of this yet.

## How it runs (no build step)

- Node **>= 22.18** runs `.ts` files directly by stripping the types (`engines.node` in the root
  `package.json`; CI uses Node 22). `npm run dev:server`, `npm start` and `npm test` are unchanged.
- `tsc` is still only a checker (`noEmit`). `npm run typecheck --workspace server` checks every `.ts`
  file, plus every `.js` file that starts with `// @ts-check`.
- `server/tsconfig.json` sets:
  - `erasableSyntaxOnly`: no `enum`, `namespace` or constructor parameter properties, because Node
    cannot strip them. Use a `const` object and a union type instead of an enum.
  - `verbatimModuleSyntax`: an import that only brings in types must be written `import type`,
    otherwise Node tries to load a runtime export that does not exist.
  - `allowImportingTsExtensions`: imports name the real file, `./x.ts`.
- `strict` is still off. Turning it on is a separate later step, once most files are `.ts`.

## Recipe for one file

Steps 1, 2 and 4 are automated: `node scripts/ts-migrate.mjs <server-relative paths...>` renames
the files, cleans their headers, rewrites every relative path that points at them, and lists the
places in comments and docs that still name the old files.

1. `git mv src/.../x.js src/.../x.ts` (keeps history).
2. Remove the `// @ts-check` line and rename the file in its own header comment.
3. Move each JSDoc type into a TypeScript annotation (`@param {number} a` becomes `a: number`).
   **This step is required:** inside a `.ts` file TypeScript ignores JSDoc types, so a file
   renamed without it silently loses its checking. Most of it is automated:
   `node scripts/ts-jsdoc-to-annotations.mjs <server-relative .ts paths...>` runs TypeScript's own
   "Annotate with type from JSDoc" quick fix over each file. By hand afterwards:
   - a `@typedef` becomes an exported `interface` or `type`;
   - a cast `/** @type {X} */ (value)` becomes `(value as X)`;
   - a JSDoc `{object}` meant `any` in JavaScript, but the quick fix writes `object`, which allows no
     property access. Write `any` (or a real shape) instead;
   - delete a `/** @type {...} */` line that sits above a declaration the quick fix already annotated.
   The usual errors after a rename, and their fix:
   - `Property 'x' does not exist on type '{}'`: a parameter defaulting to `= {}`, or a `const out = {}`
     filled later. Annotate it (`body: Record<string, any> = {}`, `const out: Record<string, number> = {}`).
   - `Expected 3 arguments, but got 2`: in a .ts file a parameter without a default is required.
     Mark it optional (`details?: unknown`).
   - `Property 'x' does not exist on type 'SomeClass'`: a TypeScript class declares its fields before
     the constructor assigns them. Add `name: string;` lines at the top of the class body.
   - `Property 'x' does not exist on type '{ limit?: number }'`: a destructured parameter
     `{ x, limit = 50 } = {}` where `x` has no default. Write its type out in full.
   - `Property 'x' does not exist on type 'unknown'`: an untyped `res.json()` or `new AsyncLocalStorage()`.
     Give it a type (`Promise<any>`, `AsyncLocalStorage<Record<string, any>>`).
   - `Property 'x' does not exist on type '{...}'. Did you mean 'y'?` on a value from another module:
     read it before silencing it. In step 3 this was a real bug (below).
4. Change every import of the file from `x.js` to `x.ts`, in `src/` **and** `test/`. Also fix
   mentions of the old name in comments and in `docs/architecture-map.md`. Leave applied migrations
   and dated reports (`docs/bug-report-*.md`, `docs/prompt.md`) alone; they record their own date.
   A test helper that takes a path without `./` (e.g. `src('services/x.js')`) is not rewritten by
   the script; the test run catches it.
5. Run all four checks, and only commit when every one of them is green:
   - `npm run typecheck --workspace server`: 0 errors
   - `npm test`: client and server all pass. `server/test/tsMigration.test.js` fails on any import
     that still points at a `.js` file which is now `.ts`. `tsc` does **not** catch this, because
     NodeNext resolution quietly maps `x.js` to `x.ts`, but Node at runtime does not.
   - The app module graph loads: `buildApp()` then `GET /api/v1/health` returns 200. From step 4 the
     real entry point is started too (`PORT=5099 node src/index.js`, then the same health check),
     because `index.js` itself imports moved files.
   - Scripts outside `server/` that import server code (`scripts/generate-dev-user-seed.mjs` imports
     `lib/password.ts`) are not rewritten by `ts-migrate.mjs`; grep the root `scripts/` folder.
   - `npm run check:sql`, when a migrated database is available (it scans `.ts` files too).

Order: leaf modules first (pure helpers, then services, then repositories), so that each step only
changes importers that are still `.js`. Files that already have `// @ts-check` are the easiest,
because their JSDoc types already pass.

## Progress

| Step | Date | Files moved to `.ts` | Checks |
| :--- | :--- | :--- | :--- |
| 1 | 2026-10-15 | `services/subscriptionRebate.ts`, `services/salerTierBonus.ts` (pilot, plus the setup above) | typecheck 0 errors; client 871/871, server 1451/1451; app loads, health 200 |
| 2 | 2026-10-15 | 19 `// @ts-check` files with no JSDoc: repositories `cart`, `coupon`, `fastPayout`, `returnProtection`, `trustScore`, `volumeIncentive`; services `checkout`, `codReconciliation`, `coin`, `leaderboard`, `order`, `quest`, `referralAdmin`, `return`, `returnProtection`, `subscription`, `teamPurchase`, `trustTier`, `warranty` | typecheck 0 errors (17 annotations added); client 871/871, server 1451/1451; app loads, health 200; every job module imports |
| 3 | 2026-10-15 | The last 24 `// @ts-check` files, the money core: `ledger`, `vault`, `pricing`, `payment`, `payout`, `clawback`, `escrowAdmin`, `fastPayout`, `referral`, `referralEscrow`, `b2bEscrow`, `coupon`, `codGate`, `deliveryCharge`, `sampleKit`, `subscriptionBilling`, `surgePricing`, `volumeIncentive`, `salerTier`, `adPricing` services; `order`, `payment`, `wallet` repositories; `escrowRelease` job | typecheck 0 errors; client 871/871, server 1451/1451; app loads, health 200; every job module imports; build within budget. **Bug found:** `b2bEscrow.service` read `ledgerTxn.txn_group_id`, but the ledger returns `txnGroupId`, so a milestone release, refund or cancellation recorded no transaction group in its response or its audit row. Fixed; `b2bEscrowMilestones.test.js` now fails on the old code |
| 4 | 2026-10-15 | 41 leaf files (they import no other `.js` file), all checked for the first time: `lib/` (`password`, `ref`, `jwt`, `encryption`, `requestMetrics`), `config/` (`loadEnvFile`, `db`, `staffRoles`, `reservedSlugs`, both cache drivers), `plugins/` (`rawBody`, `requestContext`), the SMS, email, WhatsApp and storage drivers, `webhookSecurity`, the Meilisearch driver, 11 repositories, `teamStockReservation` and `totp` services, the `fastPayout`, `order`, `gamification` and `referral` controllers, `db/migrationChecksum`, two notification channels | typecheck 0 errors (class field declarations and 12 annotations added); client 871/871, server 1451/1451; `buildApp` health 200 **and** the real `node src/index.js` health 200; every job and db entry imports; build within budget |

Remaining: 269 `.js` files under `server/src` (migrations and seeds excluded); 86 are `.ts`. Each file
is checked for the first time when it moves. Next: the 51 files that now import no other `.js` file (`config/env.js`,
`plugins/errorHandler.js`, the bigger repositories, `sockets/presence.js`, ...); each step turns more
files into leaves.
