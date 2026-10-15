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
     the constructor assigns them. Add `name: string;` lines at the top of the class body. For drivers
     with many fields, declaring them `any` (what JavaScript had) is acceptable.
   - Moving a module that many files use (`errorHandler`, `env`) gives every caller stricter types at
     once: step 5 went from 0 to 418 errors, 166 of them because `AppError` read as four required
     parameters. Fix the shared module's signature first, then re-count.
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
   - Tests that list source files by name or filter a folder by `.js` (`requirePage.test.js` does
     both for `routes/`) break when such a file moves; they now accept either extension.
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
| 5 | 2026-10-15 | 51 leaf files: `config/env`, `config/cache`, `plugins/errorHandler` (`AppError` now typed: `messageBn` and `details` optional), all payment and courier drivers and the four integration indexes, `sockets/presence`, 13 repositories (`user`, `permission`, `staff`, `store`, `liveStream`, ...), 13 services, 5 controllers, the `gamification` and `referral` routes, `lib/bdDistricts`, `utils/transliterate` | typecheck 0 errors; client 871/871, server 1451/1451; real `node src/index.js` health 200; every job and db entry imports; build within budget. **Two bugs found and fixed, each with a test that fails on the old code:** (1) `b2bEscrow.service` passed the HTTP status as `AppError`'s Bangla message in 25 places, so the API answered `message_bn: 400`; (2) the warranty reverse pickup read `consignment.consignmentId`, but the courier adapters return `courierConsignmentId`, so the real consignment id was never stored (always the `CNG-<ref>` fallback) |
| 6 | 2026-10-15 | 41 leaf files: `middlewares/authenticate`, `lib/idempotency`, `lib/grantScope`, `lib/rateBucket`, the payment and courier indexes (`PaymentGateway` is now an interface), `product.repository`, 19 services (`cart`, `rbac`, `audit`, `store`, `inventory`, `bundle`, `recommendation`, `pageAccess`, ...), 5 controllers, the `b2bEscrow`, `return` and `warranty` routes, `sockets/live.handler`. The `db/` CLI scripts stay `.js` for now (called by name from `package.json` and CI) | typecheck 0 errors; client 871/871, server 1453/1453; real server health 200; every job and db entry imports; build within budget. **Bugs fixed:** the step-5 `AppError` bug was also in `apiKey`, `webhookDelivery`, `publicApi` (controller and routes), `analytics` and `content` (31 more calls, the last 16 still in .js files); `appErrorArguments.test.js` now fails on any such call in .js or .ts. Two of those codes, `UNAUTHORIZED` and `BACKUP_NOT_FOUND`, were missing from `ERROR_STATUS` and answered 500; they now answer 401 and 404 |
| 7 | 2026-10-15 | 31 leaf files: `lib/audit`, the `idempotency`, `requirePage` and `requireRestriction` middlewares, 18 controllers (`cart`, `store`, `supplier`, `publicApi`, `pageAccess`, `localization`, `genie`, `media`, ...), 9 services (`module`, `notification`, `profile`, `search`, `otp`, `shortlink`, `whatsappCommerce`, `ai/demandForecast`, `ai/creativeStudio`), the `payment` and `sitemap` routes | typecheck 0 errors; client 871/871, server 1455/1455; real server health 200; every job and db entry imports; build within budget. **Bug fixed:** `POST /public/orders` called `orderService.createOrder`, which has never existed, so every partner order crashed with a TypeError (500). Placing an order for a customer with no account is an unmade product decision, so it now answers `501 NOT_IMPLEMENTED` after the same scope and payload checks (`publicPartnerOrder.test.js`; `docs/public-api.md` lists the 501) |
| 8 | 2026-10-15 | 42 leaf files: the `requireModule` and `requirePermission` middlewares, `jobs/scheduler` and `jobs/grantExpiryCron`, 15 route files (`store`, `cart`, `media`, `publicApi`, `pageAccess`, `localization`, `genie`, ...), 8 controllers (`finance`, `module`, `teamPurchase`, `notification`, ...), 17 services (`auth`, `chat`, `dispute`, `kyc`, `moderation`, `shipment`, `customerPortal`, `content`, `delegation`, `makerChecker`, `flashSale`, `ai/conciergeAgent`, ...) | typecheck 0 errors; client 871/871, server 1455/1455; real server health 200 (scheduler starts); every job and db entry imports; build within budget. No bugs this time: the 22 errors left after the mechanical passes were typing only (`const err: any` for errors with extra fields, typed `Map`s, `Date#getTime()` where code subtracted or `isNaN`'d a `Date`, which gives the same result). Most errors came from multi-line destructured parameters ending in `} = {}) {`; annotate that line `}: Record<string, any> = {}) {` |

Remaining: 104 `.js` files under `server/src` (migrations and seeds excluded); 251 are `.ts`. 48 of the
remaining files now import no other `.js` file and go next (the five `db/` CLI scripts are among them
but stay until their `package.json` scripts and CI are switched in the same step).
