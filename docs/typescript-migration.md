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
   renamed without it silently loses its checking. Put a `@typedef` in an `interface` or `type`
   and export it if other files use it.
   The usual errors after a rename, and their fix:
   - `Property 'x' does not exist on type '{}'`: a parameter defaulting to `= {}`, or a `const out = {}`
     filled later. Annotate it (`body: Record<string, any> = {}`, `const out: Record<string, number> = {}`).
   - `Expected 3 arguments, but got 2`: in a .ts file a parameter without a default is required.
     Mark it optional (`details?: unknown`).
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
   - The app module graph loads: `buildApp()` then `GET /api/v1/health` returns 200.
   - `npm run check:sql`, when a migrated database is available (it scans `.ts` files too).

Order: leaf modules first (pure helpers, then services, then repositories), so that each step only
changes importers that are still `.js`. Files that already have `// @ts-check` are the easiest,
because their JSDoc types already pass.

## Progress

| Step | Date | Files moved to `.ts` | Checks |
| :--- | :--- | :--- | :--- |
| 1 | 2026-10-15 | `services/subscriptionRebate.ts`, `services/salerTierBonus.ts` (pilot, plus the setup above) | typecheck 0 errors; client 871/871, server 1451/1451; app loads, health 200 |
| 2 | 2026-10-15 | 19 `// @ts-check` files with no JSDoc: repositories `cart`, `coupon`, `fastPayout`, `returnProtection`, `trustScore`, `volumeIncentive`; services `checkout`, `codReconciliation`, `coin`, `leaderboard`, `order`, `quest`, `referralAdmin`, `return`, `returnProtection`, `subscription`, `teamPurchase`, `trustTier`, `warranty` | typecheck 0 errors (17 annotations added); client 871/871, server 1451/1451; app loads, health 200; every job module imports |

Remaining: 334 `.js` files under `server/src` (migrations and seeds excluded). The 24 that still carry
`// @ts-check` go next; they have JSDoc types, which must be moved into annotations by hand.
