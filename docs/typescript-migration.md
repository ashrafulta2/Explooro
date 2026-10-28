# TypeScript migration (server, then client)

Started 2026-10-15 at the owner's request: move the server from `.js` to `.ts` **step by step,
without ever leaving it in a broken state**. The server is done. The client started on 2026-10-25,
also at the owner's request; see [Client](#client) at the end.

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
     real entry point is started too (`PORT=5099 node src/index.ts`, then the same health check),
     because `index.ts` itself imports moved files.
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
| 9 | 2026-10-15 | 43 leaf files: 14 jobs, `sockets/chat.handler`, 10 route files (`finance`, `supplier`, `order`, `notification`, `module`, `teamPurchase`, ...), 10 controllers (`auth`, `content`, `dispute`, `moderation`, `delegation`, `promotion`, `courierWebhook`, ...), 8 services (`ads`, `liveStream`, `analytics`, `staff`, `salerDashboard`, `restriction`, `kycDecision`, `ai/reviewIntegrity`) | typecheck 0 errors; client 871/871, server 1457/1457; real server health 200; every job, socket and db entry imports; build within budget. **Bug fixed:** `registerJob` reads `intervalMs` and `moduleKey` and has no cron syntax, but `team_purchase_expiry` and `cart_recovery_sweep` passed `cron` and `module`. Both therefore ran on the 1-hour default: expired teams' holds waited up to an hour for their refund (meant 5 min), and cart recovery messaged shoppers with its module off (meant 15 min, gated). Team expiry is deliberately left ungated so switching the feature off cannot strand held money. `jobRegistration.test.js` fails on any unknown key or missing interval in `src/jobs` |
| 10 | 2026-10-15 | 23 leaf files: 10 route files (`auth`, `dispute`, `moderation`, `delegation`, `content`, `customer`, ...), 8 controllers (`ads`, `liveStream`, `kyc`, `chat`, `adminAnalytics`, `staff`, `restriction`, `saler`), 3 services (`product`, `homeSummary`, `review`), `sockets/gateway`, `jobs/analyticsRollup` | typecheck 0 errors; client 871/871, server 1458/1458; real server health 200; every job, socket and db entry imports; build within budget. **Bug fixed:** `saler.controller` threw `new AppError(401, 'UNAUTHORIZED', ...)` (arguments in the wrong order), so the code was the number 401 (unmapped, answered 500) and the message was the word UNAUTHORIZED. It now throws `AUTH_REQUIRED` (401). The routes authenticate first, so this was a fallback branch, but `appErrorArguments.test.js` now also fails on any `new AppError(<number>, ...)` |
| 11 | 2026-10-15 | 14 leaf files: 9 route files (`liveStream`, `kyc`, `chat`, `restriction`, `staff`, `ads`, `adminAnalytics`, `saler`, `homeSummary`), the `product`, `review` and `sourcing` controllers, `discoveryFeed.service`, `ai/sourcingAgent` | typecheck 0 errors; client 871/871, server 1458/1458; real server health 200; every job, socket and db entry imports; build within budget. No bugs; typing only. A destructured parameter with two or more defaults (`{ a = 1, b = 2 } = {}`) is not caught by the mechanical pass and needs `: Record<string, any>` by hand, and a JSDoc-typed `opts = {}` becomes `opts: { ... } = {}` (make its members optional) |
| 12 | 2026-10-15 | The last 17 non-entry files at once (few enough that leaf order no longer mattered): `ai`, `discovery`, `recommendationAdmin`, `search` and `theme` controllers, their 7 route files (with `product` and `review`), and the `theme`, `masterPalette`, `homeRails`, `recommendationAdmin` and `ai/index` services | typecheck 0 errors; client 871/871, server 1458/1458; real server health 200, and `/discovery/feed`, `/discovery/rails`, `/products`, `/catalog/categories` answer 200; every job, socket and db entry imports; build within budget. Typing only, no behaviour change |
| 13 | 2026-10-16 | The last 7: `app`, `index` and the five `db/` CLI scripts (`migrate`, `seed`, `checkSql`, `rebuildCovisits`, `recoMetrics`), with every `server/package.json` script and `main` switched to `.ts`. `tsconfig.json` now includes only `src/**/*.ts` (`allowJs` stays, unchecked, for the shared client modules the server imports, e.g. `client/src/services/colorRamp.js`), and `tsMigration.test.js` fails if any `.js` file appears under `server/src`. Docs, comments and test path strings that still named a moved file were brought up to date, including leftovers from earlier steps; `how-to-add-a-feature.md` now writes server files as `.ts` | typecheck 0 errors; client 871/871, server 1459/1459; `npm start` and `npm run dev` both answer health 200; `migrate:status` (0 pending), `check:sql` (973 statements, 0 failures) and `reco:metrics` run; build within budget. `seed` and `covisit:rebuild` write to the database and were not run (typecheck and the import test cover them) |

Done: all 355 server source files are `.ts`; none is `.js`.

**Correction to the "every job and db entry imports" check in steps 4–12.** `seed`, `rebuildCovisits`
and `recoMetrics` do their work at top level, and `migrate` defaults to `up` (only `checkSql` guards
on `process.argv[1]`). So importing them ran them against the `DATABASE_URL` in `.env`, here the local
dev database: `migrate up` with nothing pending (no-op), `seed` (every seed is `ON CONFLICT DO
NOTHING`, but a seed row deleted by hand comes back), a co-visitation rebuild (derived data the nightly
job rebuilds anyway) and a read-only metrics report. Check these scripts with the typecheck, the import
test and the read-only npm scripts (`migrate:status`, `check:sql`, `reco:metrics`), never by importing
them.

## Client

Started 2026-10-25. Same rule as the server: a few files per step, every check green before a commit.
Nothing changes for the browser: Vite strips the types when it bundles (so the 150 KB JS budget is
unaffected), and `client/package.json` `dependencies` stays `{}` because `typescript` is a root dev
tool only.

### How it runs

- `npm run dev`, `npm run build` and `npm test` are unchanged. Vite serves and bundles `.ts`
  directly; `node --test` loads a `.ts` module by stripping its types (Node >= 22.18).
- `npm run typecheck --workspace client` runs `tsc` with `client/tsconfig.json`: the server's switches
  (`erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions`, `strict` off), plus
  the DOM libraries and `vite/client` types (`import.meta.env`). CI runs it next to the server's.
- Only `src/**/*.ts` is checked. `.js` files stay unchecked until they move.

### Recipe

The server recipe above, with `--client`:

1. `node scripts/ts-migrate.mjs --client src/services/x.js` renames the file and rewrites every
   relative path to it, in `client/src`, `client/test`, the client's config files, `server/` and the
   root `scripts/` (the server and the build import some client modules).
2. Write the types by hand (client files have little JSDoc, so there is nothing to convert).
3. Fix the remaining mentions of the old name that the script lists.
4. Checks: `npm run typecheck` for **both** workspaces (the server reads client modules), `npm test`
   (`client/test/tsMigration.test.js` fails on an import that still names a `.js` file which is now
   `.ts`; Vite would resolve it, `node --test` would not), `npm run build` (budget gate and
   prerender), and the app in the browser with the moved modules loaded and no console errors.

Order: leaf modules that the server does not import first (`services/`, `lib/`, `core/`), then the
components, and the pages last. Files the server or its tests reach (still `.js`:
`services/pageAccess.js`, `config/pageRegistry.js` and `services/offlineQueue.js`;
`grep -rn "client/src" server/src server/test` lists them) move together with a
check that the server typecheck and tests still pass, and that `node src/index.ts` boots: once the
server imports a client `.ts` file, the server's `tsc` checks that file too, with the server's
libraries (no DOM). Root scripts that import client modules (`palette.mjs`, `logo.mjs`) must still
run; `palette.mjs --write` copies its header comment into `themes.css`, so a rename in that comment
means regenerating the file. A test that walks a folder and keeps only
`.js` files must accept `.ts` too (`adminMockContracts.test.js` did, for `mocks/handlers/`).

Tests that read a module's SOURCE TEXT are not rewritten by the script and are the usual reason a
step's first test run fails. Grep `client/test` and `server/test` for the old name in three forms:
a path string (`'client/src/lib/genie.js'`, `read('src', 'lib', 'genie.js')`), an escaped regex
(`/lib\/genie\.js'/`), and a declaration regex such as `/GENIE_LIMITS = Object\.freeze/`, which
stops matching once the declaration gains a type annotation (write `GENIE_LIMITS(?::[^=]+)? =`).
A JSDoc block on a function (`@param {object} o …`) means nothing in a `.ts` file: turn it into an
interface, as `GenieRunOptions` was.

### Progress

| Step | Date | Files moved to `.ts` | Checks |
| :--- | :--- | :--- | :--- |
| 1 | 2026-10-25 | `services/html.ts`, `services/writeOutcome.ts`, `services/attribution.ts` (pilot, plus `client/tsconfig.json`, the `typecheck` script, the CI step, `ts-migrate.mjs --client` and `client/test/tsMigration.test.js`) | typecheck 0 errors (client and server); client 954/954, server 1696/1696; build passes the budget (JS 58.25 KB, CSS 67.54 KB gzip) and prerenders; app on the mock dev server loads both moved modules, records a `?ref=` touch, no console errors |
| 2 | 2026-10-25 | `services/theme.ts`, `services/permissionMatrix.ts`, `services/recoSettings.ts`, `services/floatingScroll.ts` (exported types: `ThemeChoice`, `Role` / `Permission` / `HeldIndex`, `Section` / `RailLayout` / `RailChange`) | typecheck 0 errors (client and server); client 954/954, server 1696/1696; build passes and the entry JS is byte-identical to step 1 (`index-8GSsEHGz.js`, types only); on the mock dev server all four modules load, the theme toggles, the floating scrollbar mounts, no console errors |
| 3 | 2026-10-25 | `core/store.ts` (generic `Store<S>`), `lib/motion.ts`, `lib/optical.ts`. Also `genie.test.js` (asserts genie's one import by name) and `scripts/verify-craft.mjs` (reads motion by path; not rewritten by the script) | typecheck 0 errors (client and server); client 954/954, server 1696/1696; build passes; `verify-craft.mjs` 31/31; in the browser the store's selector fires only on a real change and `countUp`/`optical` give the expected values, no console errors. One runtime change, deliberate: motion's two promises now resolve with no value instead of the cancel event, which nothing reads (neither function has a caller); checked under Node with fake animations that both finish and cancel still resolve. The browser pane does not advance Web Animations at all, so that path cannot be checked there |
| 4 | 2026-10-25 | The first files the server and root scripts import: `services/colorRamp.ts` (`Palette`, `MasterConfig`, `Ramp`, role maps), `services/masterTheme.ts`, `services/seo.ts` (`HeadOptions`, JSON-LD inputs), `services/logoMark.ts`. `services/offlineQueue.js` was left for later because its one importer, `main.js`, had another session's uncommitted edits | typecheck 0 errors (client and server; `MASTER_NEUTRAL_MODES` / `MASTER_ACCENT_HARMONIES` stay mutable arrays because `theme.service.ts` reads them as `string[]`); client 954/954, server 1696/1696; build passes; the real server boots (`node src/index.ts` on port 5099, health 200); `palette.mjs --write` changes only the header comment of `themes.css` and `logo.mjs --write` reproduces every committed icon byte for byte; on the mock dev server the head tags, hreflangs and website JSON-LD are set, a product page emits its Product JSON-LD, the logo renders and a master palette mounts and clears, no console errors |
| 5 | 2026-10-25 | Four more the server's tests read: `config/grant-scopes.ts`, `data/bangladeshGeo.ts` (`GeoDivision`, `BdDistrict`), `lib/genie.ts` (`GenieConfig`, `GenieRunOptions` from its old JSDoc, `GenieRun`), `mocks/releaseNotes.ts` (`ReleaseNote`, `MockReply`). `services/pageAccess.js` and `config/pageRegistry.js` wait, like `offlineQueue.js`, because `main.js` imports them and had another session's uncommitted edits. `server/test/genieEffect.test.js` and `client/test/genie.test.js` updated for the path and for type-annotated declarations | typecheck 0 errors (client and server); client 954/954 (the first run failed one assertion that matched `lib\/genie\.js` in Modal's source, fixed), server 1696/1696; build passes; server boots, health 200; on the mock dev server all four modules load, a 300 ms genie close on a real panel drew 40 strips, resolved `true`, removed its layer and restored the panel; 8 divisions / 64 districts; a grant scope splits into known/unknown; the mock serves the latest release note |
| 6 | 2026-10-28 | The `services/` files with real logic and no blocked importer: `adminDashboard.model.ts` (`KpiDef`, `SeriesPoint`, `ChartModel`, `DashboardAlert`), `websocket.ts` (`WsStatus`, `ChatFrame`, `OutboundItem`, typed class fields), `deliveryCharge.ts`, `sponsoredSourcing.ts` (`SponsoredAd`). The thin `*.api.js` wrappers wait for `core/api.js`, which is blocked (another session's new `AdminAdReviewPage.js` imports it); typed before `api` they would only gain `any`. One call changed: the mock chat socket was passed the ws URL it never read, now it is called with no argument. CLAUDE.md's pointers to `attribution`, `colorRamp` and `genie` now name the `.ts` files | typecheck 0 errors (client and server); client 954/954, server 1696/1696; build passes; server boots, health 200; on the mock dev server the chat socket goes DISCONNECTED → CONNECTING → CONNECTED and answers a ping with a pong, the delivery charge loads (৳60), the cockpit model formats and validates as its tests expect, two sponsored cards come back. Console errors were only `images.unsplash.com` blocked by the network's TLS inspection |
| 7 | 2026-10-28 | The first components, all from `components/ui/`: `FormField.ts` (`FieldElement`, `ControlField<C>`, `FormFieldOptions`), `Select.ts`, `Textarea.ts`, `Badge.ts`, `Card.ts`, `EmptyState.ts`, `Skeleton.ts`, each with an exported options interface. 193 import paths rewritten across the pages. `Button` and `Modal` wait: the other session's `AdminAdReviewPage.js` imports both | typecheck 0 errors (client and server); client 954/954, server 1696/1696; build passes and the entry JS is byte-identical to step 6 (`index-cE_WSxaS.js`); server boots, health 200; `/dev/gallery` renders every moved component (105 badges, 27 cards, 24 skeletons, 14 fields) and a live `Select` / `Textarea` keep their `value`, `setError` → `aria-invalid` + `aria-describedby`, and counter overflow behaviour; the only console errors are external images blocked by the network's TLS inspection |
| 8 | 2026-10-28 | The rest of `components/ui/` that nothing blocks: `Input`, `Checkbox`, `Switch`, `Radio` (+ `RadioGroup`), `Tooltip`, `InfoTip`, `Tabs`, `Pagination`, `Toast`, `Table`, `icons`. A component that returns an element with methods attached gets its own interface (`TabsElement`, `SwitchElement`, `TableElement<R>`, `ToastElement`, `InfoTipElement`, `RadioGroupElement`), so a caller's `tabs.select(id)` or `table.setRows(rows)` is checked. `Button`, `Modal`, `ConfirmDialog` and `Drawer` wait: `Button` and `Modal` are imported by the uncommitted `AdminAdReviewPage.js`, and the other two import `Modal`. Three tests read `icons.js` by path (`community`, `recommendationSettings`, `sidebarToggle`) and now name `icons.ts` | typecheck 0 errors (client and server); client 954/954, server 1696/1696; build passes; server boots, health 200. **Not types-only this time**: the entry bundle changed by 0.01 KB raw (`index-CtUUAVSa.js`) because six expressions were adjusted for the compiler, each checked as behaviour-preserving: `textContent = value ?? ''` became `value == null ? '' : String(value)` (Table cells), `String(tab.badge)` (Tabs), `!maxLength` in the counter guard (Input; the counter only exists when `maxLength` is truthy), `typeof item.icon === 'string'` without the redundant `item.icon &&` (`getItemIcon`), and `active && sort` (Table; this one only changes a case that used to throw: a `null` sort with a column whose key is `undefined`). On `/dev/gallery` the live components were driven through their methods: `Input` counter and prefix, `Checkbox` indeterminate cleared by a toggle, `Switch` pending / revert / commit, `RadioGroup` value and error, `Tabs` arrow key skips a disabled tab and `setPanel` works, `Pagination` offset and cursor, `Table` loading → rows → sort → selection → empty (a `0` cell shows `0`, a `false` cell shows `false`), `InfoTip.setContent`, `Toast.dismiss`, and 90 icons. The only failed requests were external images blocked by the network's TLS inspection |
| 9 | 2026-10-28 | The first components outside `ui/`: pure helpers and data tables, which existing tests cover. `home/homeBands.ts` (`StatRow` / `LinkRow`, `BandSlide` = `LeaderboardSlide` \| `MetricsSlide` \| `LinksSlide`, `RoleBand`, `SlideTone`), `community/dom.ts` (`el` is generic over the tag, so `el('button')` returns an `HTMLButtonElement`), `gamification/questClaimMessage.ts`, `saler/SponsoredTag.ts`, `admin/FinanceSubnav.ts` and `PlatformSubnav.ts` (`SubnavOptions`), the three shop-partner cards (`CommissionTierData`, `PartnerRewardData`, `PartnerScoreData`, from their JSDoc `@param {object} props`), and the three tables (`ProtectionCover`, `FastPayoutEntry`, `IncentivePayout`). 59 import paths rewritten. `WhatsNewModal`, `PwaInstallPrompt` and `AppShell` wait: `main.js` imports them. `FastPayoutTable` still imports `ui/Button.js`, so it declares the one method it uses (`LoadingButton`); drop that when Button moves. Three tests read `PlatformSubnav.js` by path (`genieSettings`, `languageSettings`, `recommendationSettings`) and now name `.ts`; their regexes on the tab list still match because the entries did not change. CLAUDE.md's pointer to `homeBands` names the `.ts` | typecheck 0 errors (client and server); client 954/954, server 1696/1696; build passes and the entry JS is byte-identical to step 8 (`index-CtUUAVSa.js`; every edit is an annotation or a cast); server boots, health 200; on `/dev/gallery` each component was called with realistic data: tier progress 25% and score progress 73% match the arithmetic by hand, a plain subnav click is intercepted while a ctrl-click is left to the browser, `FastPayoutTable` calls `onTake(entry, button)` and a busy entry's button is disabled with `aria-busy`, the supplier cover table has 5 columns and the shop-partner one 4, the incentive table adds a supplier column for a shop partner, and `ROLE_BANDS` keeps its 7 roles (a customer has only a left panel). The only failed requests were external images and video blocked by the network's TLS inspection |

364 `.js` files remain under `client/src`.
