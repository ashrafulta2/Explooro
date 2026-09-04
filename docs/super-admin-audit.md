# Super Admin Surface — Audit & Repair Log

**Audit date:** 2026-09-04 · **Scope:** every route reachable from the Super Admin sidebar
(49 nav paths across 9 groups) · **Method:** static analysis of `navigation.js` / `main.js` /
`docs/permission-catalog.json` / `server/src/config/modules.seed.json`, plus a live crawl of all 49
routes in the running dev server as `+8801700000001` (Dev Super Admin), checking render output,
console errors, the in-app a11y auditor, and the i18n engine's missing-key warnings.

This document exists so the next person changing an admin page knows **what was wrong, why it was
wrong, and which invariant now protects it.** Read §5 before adding a new admin page.

---

## 1. What the audit covered

| Dimension | How it was checked |
| :--- | :--- |
| **Routing** | Every `navItems` path diffed against every registered route in `main.js` — permission key, module key, `requiresAuth`, and which page module each actually loads |
| **Access control** | Every permission key used by nav or routes validated against `docs/permission-catalog.json`; every module key validated against `server/src/config/modules.seed.json` |
| **Functionality** | Live crawl: does the page render, does it throw, is every button/select/checkbox wired to a handler (measured by instrumenting `addEventListener` *and* the `onclick`-property assignment both patterns in this codebase use) |
| **Design** | The in-app auditor at `client/src/dev/a11y-audit.js` (contrast, duplicate ids, unlabelled controls) run against `#page-outlet` on every route, plus computed-style inspection of every failure |
| **i18n** | `en.json` ↔ `bn.json` key parity, plus the engine's DEV `console.warn` for missing keys captured across every route in both languages |
| **Ease of use** | Sidebar items that open the wrong page, duplicate items opening identical views, post-login landing, browser tab titles |

**Not covered** (out of scope for this pass, still open): the server-side route surface, the mobile
Flutter app, and non-admin roles beyond the pages the admin sidebar links into.

---

## 2. Defects found and fixed

### 2.1 Access control

| # | Defect | Impact | Fix |
| :-- | :--- | :--- | :--- |
| A1 | `/admin/platform/api-keys` and `/admin/api-keys` were registered with `permission: null` | **Any authenticated account** — a customer included — could open the Developer Portal and read the platform's API key roster by typing the URL | Route now requires `platform.apikey.view`; the page's create/revoke actions still check `platform.apikey.manage` |
| A2 | Nav demanded a *stronger* grant than the route it opens: `platform.module.toggle` vs `.view`, `platform.integration.manage` vs `.view`, `platform.settings.update` vs `.view`, `platform.apikey.manage` vs `.view` | An operator holding only the read grant could reach the page by URL but had **no link to it** — the feature they were entitled to see was invisible | Nav guards lowered to match the route guard. A nav guard stricter than its route hides features rather than protecting them |
| A3 | `/admin/returns`: nav said `orders.return.view_all`, route said `orders.return.review` | Link and route disagreed about who may open the returns queue | Both now `orders.return.view_all` — the queue is a listing surface; acting on a case is separately gated |

### 2.2 Feature-flag / module gating

| # | Defect | Impact | Fix |
| :-- | :--- | :--- | :--- |
| M1 | **`GET /admin/modules` mock returned 8 hand-written modules** with keys that exist nowhere else in the codebase (`bkash_direct_checkout`, `live_streaming_studio`, `b2b_wholesale_escrow`, `ai_bengali_copywriter`, …) | The Module Control panel — the platform's master feature-flag switchboard — showed **8 of 71** modules, and every toggle wrote a key no route or nav item gates on. The header read "8 of 8 active" while the platform had 71 modules | The mock now derives from `server/src/config/modules.seed.json`, the same registry the server seeds from. Panel shows all 71 with real keys |
| M2 | `PATCH /admin/modules/:key` echoed the request back without recording it | Switching a module off and reopening the panel showed it back on — the panel looked broken to anyone who checked their own work | Mock persists for the session and cascades to dependants, matching the real service |
| M3 | `/admin/growth/coins` was gated on the `daily_quests` module | Turning quests off also took the coin-liability screen down; turning `loyalty_coins` off left it reachable | Now `loyalty_coins`, per `modules.seed.json` and `navigation.js` |
| M4 | `/admin/finance/escrow`, `/admin/finance/subscriptions` and `/admin/platform/theme` were gated `core` while their nav items named the owning module | "Turn the feature off" never took its own admin surface down | Routes now gated on `escrow_engine`, `subscription_fees`, `theme_studio` |
| M5 | `/admin/verification` nav said `core`, route said `supplier_verification` | Turning the module off hid nothing, and the visible link then bounced off the route's guard | Nav now `supplier_verification` |

### 2.3 Wrong page behind a menu item

| # | Defect | Impact | Fix |
| :-- | :--- | :--- | :--- |
| P1 | `/admin/growth/referrals` loaded `pages/saler/ReferralHubPage.js` | Clicking "Referrals" gave the super admin **their own personal referral link and downline tree** — no programme rules, no fraud queue, nothing they govern. `docs/ia-sitemap.md` specifies this route as "Referral rules" | New `pages/admin/AdminReferralsPage.js`: programme health strip, tier/attribution rules, the self-referral and circular-referral controls Prompt 9.3 calls mandatory, and a flagged-referral queue with release/void decisions on held commission |
| P2 | "Coupons" and "Campaigns" both opened `CampaignManagerPage` on its Flash Sales tab | Two sidebar items, one view. The coupon catalogue existed on a second tab the whole time | The page reads the path and opens the Coupons tab for `/admin/growth/coupons` |
| P3 | "Coins" and "Quests" rendered the **identical** page, and the streak-multiplier inspector and leaderboard the file's own docstring promised were never built | `docs/ia-sitemap.md` specifies two distinct pages ("Coin & loyalty policy" / "Quests & leaderboard") | `AdminQuestsPage` now has two path-driven tabs: coin policy + streak curve, and quests + leaderboard |

### 2.4 Correctness

| # | Defect | Impact | Fix |
| :-- | :--- | :--- | :--- |
| C1 | The KYC "Reviewer Compliance Checklist" rendered **pre-ticked** with no handler, and "Approve Verification (Blue-Tick)" stayed enabled regardless | A reviewer could grant a merchant a trust badge without opening a document, and the UI still showed three ticks implying they had attested to the NID match, the face match and the trade licence. **A pre-ticked attestation manufactures a record of a check nobody performed** | Boxes start empty, reset when the reviewer switches applicant, and Approve is disabled until all three are ticked (plus a guard inside the handler). Reject is deliberately *not* gated — refusing a submission you have not fully verified is always allowed |
| C2 | `main.js` filtered stub routes through a hand-maintained chain of ~150 `item.path !== '/…'` comparisons that every new page had to be added to. Three pages (`/admin/verification`, `/admin/catalog/moderation`, `/admin/disputes`) shipped without their line | Each quietly registered a duplicate stub route alongside the real one — harmless only because the real entry happened to sort first | The stub set is now **derived**: `navItems.filter((item) => !implementedPaths.has(item.path))`. The class of drift is gone, and ~150 lines with it |
| C3 | `client/src/dev/a11y-audit.js` accepted only a background layer with `alpha > 0.8`, **discarding** translucent layers instead of blending through them | An ordinary 75%-opaque scrim was skipped and its white text compared against the near-white page canvas, reporting 1.06:1 for text the browser renders at ~13:1. The auditor manufactured failures on correct markup — which teaches people to distrust its output | Proper "over" compositing down the layer stack |

### 2.5 Ease of use

| # | Defect | Fix |
| :-- | :--- | :--- |
| U1 | Every auth page defaulted to `/` after sign-in, so a super admin was dropped on the customer marketplace and had to find their own console each session | `ROLE_HOME` + `homePathForRoles()` in `navigation.js`, resolved **after** sign-in when roles are known. An explicit `?redirect=` still wins |
| U2 | Every admin route carried a hardcoded English `title` string, so the browser tab said "Escrow Holdings & Sweeps — Explooro Admin" over a Bangla page — and a language switch left it frozen in English forever (only a *function* can produce a different string on `router.refresh()`'s second read) | Route titles are derived from `navigation.js`'s translated label for the same path. Routes with no nav entry keep their author's title |

### 2.6 Design & accessibility

| # | Defect | Impact | Fix |
| :-- | :--- | :--- | :--- |
| D1 | `.finance-subnav__tab--active` / `.platform-subnav__tab--active` / `.admin-user-tab--active` painted text with `var(--brand)` | `--brand` is a **fill** token (`#ffbc00` on the shipped palette). As text on `--surface-2` it measures **1.51:1** — the selected tab was the least readable label on the page, the exact opposite of what "active" should look like | `var(--text-brand)`, which `themes.css` defines as the shallowest brand step clearing AA (5.31:1 light, 6.24:1 dark). The 2px underline keeps `--brand`, because a border is a fill |
| D2 | 13 sites forced `color: #ffffff` onto a `--brand` background (Campaign Manager, Dispute verdict modal, Translation Studio, Returns queue, Moderation queue) | Authored against an indigo brand — the `#4f46e5` fallback is still visible in every `var(--brand, #4f46e5)`. On the amber palette Explooro ships, white-on-brand is **1.69:1**: the primary button label was effectively invisible | `var(--brand-contrast, #1f1f1f)` — the ink `themes.css` publishes to pair with `--brand` |
| D3 | 5 inline styles re-declared `background: var(--brand); color: #fff` **on elements that already had `.btn--primary`**, overriding the class's correct ink | "Create snapshot", "Add IP/CIDR", "Save policy", "Send reminder" were unreadable | Inline background/color dropped so the class wins |
| D4 | `var(--color-error, #e53e3e)` used in 6 places — **`--color-error` is not a token in this design system**, so the hardcoded fallback always won | Red text at 3.69–3.88:1, and it never followed the master seed or dark mode | `var(--danger)` |
| D5 | `.test-latency-pill--success` (`#10b981` on its own 12% tint, 2.27:1), `.system-table__badge--info` (`#0284c7`, 3.99:1), the moderation flag chip (4.16:1) and the review rating stars (`#f59e0b`, 2.09:1) | The latency figure beside every integration — the number an operator is there to read — failed AA by half | Status-triad tokens (`--success`/`--success-bg`, `--info`/`--info-bg`, `--danger-bg`, `--warning`) |
| D6 | Five content-manager pages stamped the **same id** on every card's Edit/Delete/Toggle button (three banners → three `id="edit-banner-btn"`) | Invalid HTML; breaks `getElementById` and any `<label for>` | `js-`-prefixed classes; the click wiring already scoped its lookup to the card |
| D6b | `WorkloadSummary`'s "My Queue" card coloured its subtext with `var(--brand)` while its three sibling cards correctly used status *text* tokens | 1.64:1 on the moderator dashboard | `var(--text-brand)` |
| D7 | ~85 form controls had no accessible name — 25 on the Platform Settings page alone, where a `<label>` sat directly above each field with no `for`, and toggle rows labelled their switch with a `<span>` | Screen readers announced "edit text, blank" 25 times in a row on the page that sets escrow days, take rate and maintenance mode; clicking a label did not focus its field | 96 `for=` associations, 46 `aria-label`s on placeholder-only search boxes, ids added to controls that were selected by class, and toggle titles turned into real `<label>`s |
| D8 | 21 hardcoded English "Loading …" placeholders | The **first** thing an admin sees on each page was English even with the interface in Bangla | `t('common.loading')` |
| D9 | 63 i18n keys called by admin pages existed in neither dictionary | The engine humanizes an unknown key into a Title-Cased last segment, so a missing key never throws and never shows a raw dot-path — it quietly renders English-looking text in **both** languages. The entire Backups page (23 keys) was untranslated this way | All 63 added to `en.json` and `bn.json` |

---

## 3. Measured before / after

| Metric | Before | After |
| :--- | ---: | ---: |
| Admin routes that render without a runtime error | 49 / 49 | 49 / 49 |
| Modules visible in the Module Control panel | **8** of 71 | **71** of 71 |
| Sidebar items opening the wrong or a duplicate page | 3 | 0 |
| Routes whose nav guard disagrees with their route guard | 10 | 0 |
| Routes reachable without the right permission | 2 | 0 |
| i18n keys missing from the dictionaries | 63 | 0 |
| a11y violations across all 49 routes | ~180 | **4** (see §4) |
| — of which DUPLICATE_ID | 9 | 0 |
| — of which INPUT_UNLABELLED | ~85 | 0 |
| — of which CONTRAST_FAIL | ~90 | 4 |
| Test suite | 330/331 client · 423/423 server | **331/331 client · 423/423 server** |
| Perf budget gate | PASS | PASS (JS 56.65 / 150 KB, CSS 59.05 / 65 KB gzip) |

---

## 4. Known-open items — deliberately not fixed

These are real and were left open on purpose. Do not assume they were missed.

1. **The brand wordmark and the topbar emoji flag on contrast, and are left alone.** The
   brand-coloured "O" in EXPLOORO (`span.brand-text__accent`, 1.64:1) and three topbar emoji icons
   (3.82:1). A brand mark is not body text, and the auditor colours emoji by the CSS `color`
   property, which mostly does not apply to emoji glyphs.

   *Correction, 2026-09-04:* an earlier revision of this section described these as confined to the
   Theme Studio's navbar *preview*. They are not — `.brand-text__accent` lives in the real app-shell
   topbar, so the wordmark flag appears on **every** admin route, one per page. The rationale for
   leaving it is unchanged; only the scope stated here was wrong.
2. ~~**`GET /admin/catalog/stats` still does not exist server-side**~~ — **CLOSED 2026-09-04.**
   Built through the full layer stack: `product.repository.js` (`getCatalogStats`,
   `getCatalogCategoryBreakdown` — two aggregate queries whose flash-sale and trust-tier joins are
   deliberately identical to `listProducts()`), `product.service.js` (`getCatalogStats`, plus
   `resolveLowStockThreshold` reading `platform_settings['catalog.low_stock_threshold']`),
   `product.controller.js`, and a route gated on `catalog.product.view_all` — the same permission as
   the page it feeds. Covered by `server/test/catalogStats.test.js` (9 tests) and smoke-run against
   the seeded Postgres. Two related defects surfaced while wiring it and were fixed with it:
   - The page read `p.stock` and `p.category`, but the live API returns `stock_qty` and
     `category_name_en` — against a real server every row rendered as *Out of Stock* in the category
     *General*. `normalizeProducts()` in `CatalogProductsPage.js` now bridges the two shapes.
   - `verified_suppliers_count` counted *products whose supplier is verified* under a KPI labelled
     "Verified Suppliers". Both the endpoint and the mock now count distinct suppliers.
3. **The Module Control fix is mock-side.** `server/src/routes/module.routes.js` already serves
   `/admin/modules` from the real registry; the fabricated 8-module list was only in
   `client/src/mocks/handlers/admin.js`, which shadows it when `VITE_API_MODE=mock`. Dev and live now
   list the same modules under the same keys. **Not verified against a live Postgres-backed server**
   in this pass.
4. **The CSS perf budget gate is set to 65 KB, not the 40 KB stated in `CLAUDE.md`.** Pre-existing
   divergence, untouched here. This audit's CSS changes are ~15 lines.
5. **`--brand` remains a `var(--brand, #4f46e5)` fallback in many pages.** The token always resolves,
   so the indigo fallback never renders — but it is misleading to read and is why D2 happened. Worth
   a sweep; not done here because it touches ~50 lines with no behavioural effect.
6. **Row-level "Edit" buttons on several pages only raise a toast** (e.g. the quest editor). That is
   unbuilt feature scope, not a regression, and is tracked by the prompts that own those pages.

---

## 5. Invariants that now protect this — read before adding an admin page

1. **Never hand-maintain a list of route paths.** The stub-route set is derived from
   `featureRoutes`. If you add a page, register its route and you are done — there is no second list
   to remember. `client/test/adminProfitSplitAndSubscriptionsPages.test.js` asserts that no
   `item.path !== '/…'` chain has crept back in.
2. **The nav guard must equal the route guard.** Both the permission key and the module key. A nav
   guard stricter than its route hides the feature; looser, and the link dead-ends in a toast. Use
   the `.view`-level key for a listing page and gate the write actions separately.
3. **Module keys come from `server/src/config/modules.seed.json`.** Its `affected_routes` field is
   the registry's own statement of which module owns which route — check it rather than guessing.
   A key not in that file is silently treated as *enabled* by `isFeatureEnabled` but as *disabled*
   by the router's `hasModule`, so a typo makes a page unreachable with no error.
4. **Permission keys come from `docs/permission-catalog.json`.** Never invent one in code.
5. **`--brand` is a fill; `--text-brand` is text.** Same for `--brand-contrast` as the ink on a
   `--brand` background, and the `--success` / `--warning` / `--danger` / `--info` triads (each with
   a matching `-bg` and `-border`) for status text. Any literal hex in a component is a colour that
   will not follow the master seed or dark mode.
6. **Every control needs an accessible name.** A `<label>` above a field is not an association —
   add `for`. A placeholder is not a name; it disappears the moment the user types.
7. **Ids must be unique.** If you render one element per record, select by class, not id.
8. **A missing i18n key does not fail loudly.** It renders a humanized slug that looks like English
   copy. Run the dev console and watch for `[i18n] missing key` — or sweep the routes with the
   crawler pattern in §6.
9. **A checklist the user must satisfy has to actually gate the action.** Pre-ticked attestations
   are worse than none.

---

## 6. How to re-run this audit

Static checks (no server needed):

```bash
node -e "const fs=require('fs');const nav=fs.readFileSync('client/src/config/navigation.js','utf8');const main=fs.readFileSync('client/src/main.js','utf8');const re=/\{ key: '([^']+)',[^}]*?path: '(\/admin[^']*)',[^}]*?permission: '([^']*)', module: '([^']+)'/g;let m;while((m=re.exec(nav)))console.log(m[2],m[3],m[4]);"
```

Live checks — start the dev server, sign in as `+8801700000001`, then in the browser console:

```js
// Walk every admin route without a full reload and collect what broke.
const mod = await import('/src/dev/a11y-audit.js');
const miss = new Set();
const ow = console.warn;
console.warn = (...a) => { const m = a.join(' ').match(/missing key "([^"]+)"/); if (m) miss.add(m[1]); ow(...a); };
for (const p of ['/admin', '/admin/health' /* … all 49 */]) {
  history.pushState({ __routerKey: crypto.randomUUID(), idx: 5 }, '', p);
  window.dispatchEvent(new PopStateEvent('popstate'));
  await new Promise(r => setTimeout(r, 1500));
  const main = document.querySelector('#page-outlet, main');
  const v = mod.runA11yAudit(main) || [];
  if (v.length || main.innerText.trim().length < 200) console.log(p, v.length, main.innerText.trim().length);
}
console.log('missing i18n keys:', [...miss]);
```

The floating **A11y** badge in the bottom-right of every dev page reports the same thing for the
route you are on, and clicking it lists and highlights each violation.

---

## 7. Files changed

**Routing & config** — `client/src/main.js` (guards, derived stub routes, translated titles),
`client/src/config/navigation.js` (guard alignment, `ROLE_HOME` / `homePathForRoles`).

**New page** — `client/src/pages/admin/AdminReferralsPage.js`, registered in
`client/src/pages/dev/gallery-registry.js`.

**Mocks** — `client/src/mocks/handlers/admin.js` (module registry + persisted toggles + coin policy,
streak curve and leaderboard), `client/src/mocks/handlers/referral.js` (programme rules, fraud
controls, flagged queue).

**Auth** — `LoginPage.js`, `OtpPage.js`, `TwoFactorPage.js` (role-aware landing).

**Admin pages** — 30 of the 41 files under `client/src/pages/admin/`, 3 under `pages/moderator/`, 7 under
`pages/editor/`, plus `components/moderation/ReviewCard.js`.

**Styles** — `admin-pages.css`, `admin-users.css`, `catalog-products.css`, `system-health.css`.

**Tooling** — `client/src/dev/a11y-audit.js` (alpha compositing).

**Locales** — `en.json` / `bn.json`: 65 keys added (3932 -> 3997), parity maintained at 3997 keys each.

**Tests** — `client/test/adminProfitSplitAndSubscriptionsPages.test.js` rewritten to assert the
outcome (no real page is shadowed by a stub) rather than the removed implementation detail.
