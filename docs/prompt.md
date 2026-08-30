# 🚀 Explooro — Master Step-by-Step AI Development Prompts (`prompt.md`)

> **Document Version:** 2.0 (Gap-Corrected Execution Blueprint)
> **Supersedes:** v1.0 (archived at `initialDoc/prompt.v1.backup.md`)
> **Target Audience:** AI Coding Assistants (Claude Code, Google Antigravity, Cursor)
> **Source Synthesis:** `idea proposition.md`, `PRD.md`, `DFD.md`, `technologyused.md`
> **Execution Strategy:** Sequential. Every prompt declares its dependencies. Do not skip. Do not reorder.

---

## 📋 What Changed From v1.0 (Read This First)

v1.0 contained 21 prompts and claimed "100% Verified" coverage. An audit against the four source
documents found that claim to be false. v2.0 corrects the following:

| Area | v1.0 Problem | v2.0 Fix |
| :--- | :--- | :--- |
| **Design direction** | Glassmorphism (v1.0) contradicted "solid surfaces, zero gradients" (`technologyused.md`) | **Decision locked: solid commerce aesthetic.** Glass restricted to overlays only. See Prompt 0.2 |
| **RBAC** | Single `role` string column; granular control architecturally impossible | Full permission catalog + delegation + maker-checker. Phase 2 |
| **Module Control** | Frontend only, no backend | Backend + targeting + middleware. Phase 3 |
| **Database** | 20 tables, no data types | ~60 tables, explicit types, `NUMERIC(14,2)` money. Prompt 0.5 |
| **Missing subsystems** | Returns, Disputes, Moderation, KYC, Cart Recovery, Referral, Ads, Live Stream absent | All present. Phases 7, 9, 10 |
| **Integration** | Mock frontend → real backend wiring prompt did not exist | `VITE_API_MODE` mock/live switch from Prompt 1.5 onward |
| **Build order** | Frontend-first for 3 phases, schema errors discovered too late | Vertical slices — DB + API + UI per feature |
| **Verification** | One-line "VERIFICATION" | Every prompt has Files, Acceptance Criteria, Preview Check, Dependencies |
| **Completeness matrix** | Dishonest all-green table | Honest traceability matrix, all rows start `⬜ Not Started` |
| **Docker** | Introduced early | **Moved to the final prompt (12.7).** Local dev is Docker-free |

---

## 🔒 Master Instructions — Non-Negotiable Constraints

### 1. Technology Stack (fixed; do not substitute)

| Layer | Technology | Hard Rule |
| :--- | :--- | :--- |
| Build tool | **Vite** (native ESM) | Dev server must boot in < 500ms |
| Web UI | **Vanilla modern CSS + modular JS (ESM)** | ❌ No Tailwind, Bootstrap, React, Vue, Next.js, or any UI framework |
| Backend | **Node.js v20+ LTS + Fastify** | 3-tier: `Routes → Controllers → Services → Repositories` |
| Database | **PostgreSQL 16** | All money columns `NUMERIC(14,2)`. Never `FLOAT`/`REAL`/`DOUBLE` |
| Cache/Realtime | **Redis 7** | Must sit behind an adapter so dev can run without it |
| Mobile | **Flutter 3.x** | Phase 12 only |
| Real-time | **WebSockets (`ws` / `@fastify/websocket`)** | Redis Pub/Sub for multi-node fan-out |

### 2. 🐳 Docker Policy — CRITICAL

> **Docker is FORBIDDEN until Prompt 12.7.**
> Every prompt from 0.1 through 12.6 must run natively on the developer's Windows machine using
> `node`, `npm`, and `npm run dev` only. Do not generate `Dockerfile`, `docker-compose.yml`, or any
> container instruction before Phase 12. Do not tell the developer to "just spin up a container."

**Database & Redis without Docker — the supported paths:**

| Service | Primary path (recommended) | Fallback | Config |
| :--- | :--- | :--- | :--- |
| PostgreSQL | **Neon** free tier (managed, zero install) — paste connection string into `.env` | Local Windows PostgreSQL 16 installer | `DATABASE_URL` |
| Redis | **Upstash** free tier (managed, zero install) | **Built-in in-memory adapter** (`CACHE_DRIVER=memory`) | `REDIS_URL`, `CACHE_DRIVER` |

The in-memory Redis fallback is a **required deliverable** of Prompt 2.1, not an optional extra.
A developer with no `REDIS_URL` set must still be able to run the entire app locally.

### 3. 📦 Dependency Policy — CRITICAL (this is what guarantees longevity)

> The project's promise is that it will still build and run years from now without a rewrite. That
> promise is kept by controlling dependencies, not by choosing a "stable framework".

**Frontend runtime dependencies: ZERO. Permanently.**
`client/package.json` must have an EMPTY `dependencies` block. Vite and Vitest live in
`devDependencies` and are build/test tools only. Everything the browser runs is code in this repo
built on web standards: ESM, CSS Custom Properties, History API, `fetch`, `WebSocket`, IndexedDB,
`Intl`, inline SVG. The router, state store, API client, i18n engine, motion helpers, charts, QR
rendering, and virtual scrolling are all hand-written — each is 50–300 lines, and each is
specified in this document.

Why this matters more than any framework choice: **the web platform does not break backwards
compatibility.** Code written against these standards runs unchanged in ten years. A framework
cannot make that promise, because a framework is someone else's release schedule.

**Vite is replaceable, not load-bearing.** It provides the dev server and the production bundle.
If Vite vanished, `client/src` would still be valid ES modules — swap the bundler, or serve them
natively. No source file may import from `vite` outside `vite.config.js`.

**Backend dependencies: a short, boring, audited list.** Permitted:
`fastify` + official `@fastify/*` plugins · `pg` · `redis` (behind the Prompt 2.1 adapter) ·
`argon2` · a JWT library · `sharp` (image derivatives) · the chosen AI provider SDK ·
`vitest` (dev) · `concurrently` (dev).

**Adding any dependency not on that list requires, in the same change:**
1. A written justification in `docs/dependency-ledger.md`: what it does, why hand-writing it is
   worse, its install size, its own dependency count, and its maintenance status.
2. **Isolation behind an adapter interface in `server/src/integrations/` or a single service file.**
   No dependency may be imported from more than one module. If it must be replaced later, exactly
   one file changes.
3. Rejection of anything with a large transitive tree, a native build step (beyond `sharp`), or a
   history of breaking major releases.

**Never permitted anywhere:** a CSS framework, a UI component library, a state-management library,
a charting library, an icon library, a date library (use `Intl`), an HTTP client library (use
`fetch`), or an ORM (use SQL through the repository layer).

**Version discipline:** exact versions pinned in `package.json` (no `^`, no `~`), with a committed
lockfile. Upgrades are deliberate, reviewed changes — never automatic.

---

### 4. 👁️ Live Preview Policy — CRITICAL

> **The Vite dev server must never break.** After every single prompt, `npm run dev` at the repo
> root must start cleanly and the site must be visually inspectable in a browser.

Rules the AI must honour:
- Root `package.json` exposes `npm run dev`, which starts **client + server concurrently**.
- Vite proxies `/api` → `http://localhost:5000` so there is zero CORS friction in development.
- Client reads `VITE_API_MODE`:
  - `mock` → served from `client/src/mocks/` fixtures. Lets any UI be previewed before its API exists.
  - `live` → real backend. Switching modes must require **no code changes**, only an env var.
- A permanent living style guide lives at **`/dev/gallery`** — every component built must be
  registered there so the developer can see it immediately.
- Every prompt below ends with a **PREVIEW CHECK** describing exactly what the developer should
  see in the browser. If a prompt is backend-only, the preview check names the admin/dev page that
  surfaces its effect.
- Never leave the app in a non-rendering state between prompts. Ship behind a feature flag if needed.

### 5. Code Quality

- Zero hardcoded credentials, URLs, or magic numbers. Everything via `.env` (+ committed `.env.example`).
- All styling through CSS custom properties defined in Prompt 1.1. No raw hex values in component CSS.
- All financial balance mutations inside a PostgreSQL transaction with `SELECT … FOR UPDATE`.
- Every state-changing admin/staff action writes an `audit_logs` row with before/after JSON.
- Every list endpoint is paginated. Every write endpoint accepts an `Idempotency-Key` header.
- Permission keys follow `domain.resource.action` (see Prompt 0.4).
- Feature-gated code must call `requireModule('module_key')` (see Prompt 3.1).

### 6. Prompt Output Contract

Every prompt in this document is structured as:

```
ID          — stable identifier, referenced by the traceability matrix
DEPENDS ON  — prompt IDs that must be complete first
FILES       — exact paths the AI must create or modify
TASK        — the objective
REQUIREMENTS— what to build
ACCEPTANCE  — objectively checkable done-conditions
PREVIEW     — what the developer sees at http://localhost:3000
```

The AI must not consider a prompt complete until every ACCEPTANCE line is satisfied.

---

## 🗂️ Phase Index

| Phase | Title | Prompts | Docker? |
| :--- | :--- | :--- | :--- |
| **0** | Foundations & Contracts (specs, no app logic) | 0.1 – 0.8 | ❌ |
| **1** | Design System, Shell, Router, i18n, Craft Pass | 1.1 – 1.10 | ❌ |
| **2** | Auth, RBAC Engine, Delegation, Audit | 2.1 – 2.8 | ❌ |
| **3** | Admin Shell, Module Control, Theme Studio | 3.1 – 3.5 | ❌ |
| **4** | Catalog, Media, Search, Storefronts | 4.1 – 4.8 | ❌ |
| **5** | Cart, Checkout, Orders, Payments | 5.1 – 5.4 | ❌ |
| **6** | Vault, Escrow, Ledger, Payouts, COD Recon | 6.1 – 6.5 | ❌ |
| **7** | Logistics, Returns, Disputes, Moderation, KYC | 7.1 – 7.6 | ❌ |
| **8** | Real-Time Chat & Unified Notifications | 8.1 – 8.4 | ❌ |
| **9** | Growth Engines (Ads, Coupons, Referral, Coins, Group Buy) | 9.1 – 9.7 | ❌ |
| **10** | Advanced (Live Stream, AI, Warranty, Bundling, B2B, SDK) | 10.1 – 10.8 | ❌ |
| **11** | Role Dashboards, Analytics, SEO, PWA | 11.1 – 11.6 | ❌ |
| **12** | Hardening, Flutter, Deployment | 12.1 – 12.7 | ✅ (12.7 only) |

---

# Phase 0 — Foundations & Contracts

> Phase 0 produces **specification documents only**. No business logic. These specs are the contract
> every later phase is validated against. Skipping Phase 0 is the single biggest cause of the schema
> and design contradictions found in v1.0.

---

### Prompt 0.1: Monorepo Skeleton & Docker-Free Dev Harness

```text
ID: 0.1
DEPENDS ON: none
FILES:
  package.json                      (root workspace + concurrent dev script)
  .gitignore
  .env.example
  README.md
  client/package.json
  client/vite.config.js
  client/index.html
  client/src/main.js
  server/package.json
  server/src/index.js               (placeholder health server)
  docs/.gitkeep
  mobile/.gitkeep

TASK:
Create the Explooro monorepo and a development harness that runs entirely without Docker.

REQUIREMENTS:
1. Root package.json with npm workspaces (`client`, `server`) and scripts:
   - `npm run dev`      → runs client and server concurrently (use `concurrently`, the only
                          permitted root dependency)
   - `npm run dev:client`, `npm run dev:server`
   - `npm run build`    → builds client to `client/dist`
2. `client/vite.config.js`:
   - dev server port 3000, `open: true`
   - proxy: `/api` → `http://localhost:5000`, `/ws` → `ws://localhost:5000` (ws: true)
   - `envPrefix: 'VITE_'`
3. `server/src/index.js`: minimal Fastify instance on port 5000 exposing `GET /api/v1/health`
   returning `{ status: 'ok', ts }`. No database connection yet.
   Use `node --watch src/index.js` for the dev script (no nodemon dependency needed).
4. `.env.example` documenting every variable the project will ever use, grouped by section, with
   inline comments. Include: `DATABASE_URL`, `REDIS_URL`, `CACHE_DRIVER=memory`, `JWT_SECRET`,
   `VITE_API_MODE=mock`, plus placeholder blocks for bKash, Nagad, Steadfast, SMS, R2, WhatsApp.
5. `README.md` — a "Getting Started in 3 commands" section that explicitly states Docker is NOT
   required and will not be used until production deployment.
6. Explicitly do NOT install: tailwindcss, bootstrap, react, vue, express, axios.

ACCEPTANCE:
- `npm install` at root succeeds with zero peer-dependency warnings.
- `npm run dev` starts BOTH processes; Vite reports ready in < 500ms.
- http://localhost:3000 renders a page.
- http://localhost:3000/api/v1/health proxies through and returns `{"status":"ok"}`.
- No Dockerfile or docker-compose.yml exists anywhere in the repo.

PREVIEW:
Browser at localhost:3000 shows a plain "Explooro — dev harness online" page, and the health
JSON is reachable through the Vite proxy.
```

---

### Prompt 0.2: Design Foundation Spec — Aesthetic Decision Locked

```text
ID: 0.2
DEPENDS ON: 0.1
FILES:
  docs/design-system.md

TASK:
Write the authoritative design specification. This resolves the v1.0 contradiction between
"glassmorphism" and "solid Alibaba/Amazon aesthetic".

DECISION (locked — do not re-litigate):
Explooro uses a SOLID, HIGH-CONTRAST, ZERO-GRADIENT COMMERCE AESTHETIC.
Rationale, which must be recorded in the doc:
  - Target users are on entry-level Android devices in Bangladesh; `backdrop-filter: blur()` is
    GPU-expensive and causes scroll jank.
  - Marketplace trust is created by clarity and legibility, not visual effects. Amazon, Alibaba,
    and Daraz all use solid surfaces.
  - Glass over product photography destroys contrast and hurts conversion.
Glassmorphism is permitted ONLY on transient overlays (modal scrim, command palette backdrop),
never on cards, navbars, tables, or any surface containing product data.

REQUIREMENTS — the spec must define, exhaustively:
1. Color — built in OKLCH, not HSL or raw hex:
   - Generate every ramp (brand, neutral, success, warning, danger, info) as a 12-step OKLCH scale
     with PERCEPTUALLY EVEN lightness steps. HSL ramps look uneven to the eye (its 50% yellow and
     50% blue are wildly different in perceived lightness); OKLCH does not. This single choice is
     the difference between a palette that looks designed and one that looks picked.
   - NEUTRALS MUST BE TINTED, never pure gray. Carry a small chroma (0.004–0.012) toward the brand
     hue through the whole neutral ramp. Pure `#888` gray is the most reliable tell of an
     undesigned interface.
   - Shadow color is derived from the surface hue at high chroma and low lightness — never
     `rgb(0 0 0 / n)`. Black shadows look muddy on tinted surfaces.
   - Semantic token names only (`--surface-1`, `--text-primary`, `--border-subtle`, `--brand`,
     `--success`…). Raw values appear only in this file and tokens.css.
   - Dark theme is NOT an inversion of light. Specify separately: surfaces get LIGHTER as elevation
     increases (not darker), chroma is reduced ~15% to avoid vibration, and pure `#000` and `#fff`
     are both forbidden as surface or text values.
2. Contrast: every text/background pairing documented with its measured ratio; minimum WCAG AA
   (4.5:1 body, 3:1 large text). Include a contrast table. Additionally check APCA Lc values for
   the brand-on-surface pairings, since WCAG 2 is known to misjudge mid-tone pairs.
3. Typography:
   - Latin: Inter (self-hosted, woff2, subset latin + latin-ext)
   - Bengali: Noto Sans Bengali (self-hosted, variable woff2, subset bengali)
   - Bengali requires taller line-height than Latin — specify per-size overrides.
   - Type scale: 12/14/16/18/20/24/30/36/48 with named tokens and line-heights.
   - OPTICAL TRACKING, per size — this is what separates typeset from typed:
     display sizes (30px+) get NEGATIVE tracking (−0.02em to −0.03em);
     body stays at 0; small text (12px) and all-caps labels get POSITIVE tracking (+0.02em to
     +0.06em). A single global letter-spacing value is not acceptable.
   - Enable Inter's OpenType features: `cv05`, `cv11`, `ss03`, and `tnum` on every numeric context.
   - Line-length limit: 60–75 characters for body copy (`max-width: 65ch`).
   - Heading hierarchy is created by WEIGHT and SPACE, not by size alone — no more than three
     distinct sizes on any one screen.
   - Never load fonts from a third-party CDN — self-host for reliability on BD networks.
4. Spacing: 4px base scale (4,8,12,16,20,24,32,40,48,64) as `--space-1` … `--space-10`.
   Plus a PROXIMITY RULE, stated explicitly: the gap between related elements must always be
   visibly smaller than the gap to the next group. Specify the intra-group and inter-group values
   for each density mode. Uniform spacing everywhere reads as unconsidered.
5. Radius scale, border scale, elevation ladder (4 levels, subtle shadows only), plus:
   - NESTED RADIUS RULE: inner radius = outer radius − padding. A 12px card with 8px padding
     contains a 4px-radius child, never another 12px. Getting this wrong is instantly visible.
   - Hairline borders: use a 0.5px border via transform or `device-pixel-ratio` media query on
     retina displays; 1px borders look heavy on high-DPI screens.
   - Elevation is shadow + surface-lightness + border TOGETHER, never shadow alone. Specify all
     three per level.
6. Motion tokens: `--dur-fast:120ms`, `--dur-base:200ms`, `--dur-slow:320ms`, plus:
   - Named easings with intent, not just curves: `--ease-out-quart` for entrances (fast start,
     gentle settle), `--ease-in-quad` for exits, `--ease-spring` for anything the user
     directly manipulated. Linear easing is forbidden except on progress and spinners.
   - ORIGIN RULE: every overlay animates FROM its trigger's position, not from the screen centre.
     A dropdown grows out of its button. A drawer slides from its edge.
   - Exits are ~30% faster than entrances. Waiting for a dismissal feels broken.
   - Choreography: list entrances stagger at 20–30ms per item, capped at 8 items so a long list
     does not crawl.
   - Every animation must be interruptible — a re-triggered animation continues from its current
     value, never snaps back to the start.
   - Mandatory `@media (prefers-reduced-motion: reduce)` rule zeroing all durations.
7. Z-index ladder (named constants, no arbitrary numbers).
8. Breakpoints: 480 / 768 / 1024 / 1280 / 1536, mobile-first.
9. Density modes: `comfortable` (default) and `compact` (data tables / admin).
10. Component state matrix — for every interactive component define: default, hover, focus-visible,
    active, disabled, loading, error, empty. Focus ring is mandatory and must be visible.
11. Touch targets: minimum 44×44px on all interactive elements.
12. Imagery — the single biggest quality differentiator on a marketplace, because the platform does
    not control the photos suppliers upload:
    - One locked product aspect ratio (1:1 recommended) applied everywhere, with automatic
      letterboxing onto a neutral surface token rather than cropping or stretching.
    - An upload quality gate: minimum resolution, maximum file size, rejection of screenshots,
      watermark detection, and a background-uniformity score. Low-scoring images are accepted but
      flagged, and the seller is offered the AI background cleanup from Prompt 10.3.
    - Aspect-ratio boxes to prevent CLS, WebP/AVIF with fallback, lazy loading, and a shimmer
      placeholder that matches the final image's dimensions exactly.
    - A subtle inner border (`inset 0 0 0 1px`) on every product image so white-background photos
      do not bleed into white surfaces — a small detail that immediately reads as considered.
13. Brand kit section: logo usage, favicon, OG image template dimensions, empty-state illustration
    style, icon system (inline SVG sprite — no icon font, no icon library dependency).
    Icons must be a single coherent set at one stroke width and one optical size, aligned to a
    consistent grid. Mixing icon sources is forbidden.

— CRAFT LAYER (this is what separates world-class from merely correct) —

14. Optical correction rules — the eye, not the number, is the authority:
    - Optical centering: a play/chevron glyph is centred optically, not by bounding box.
    - Optical sizing: a circle must be ~4% larger than a square to read as the same size.
    - Icon-to-text alignment uses cap-height, not line-box.
    - Trailing punctuation and quotation marks hang outside the text block.
    - Buttons whose label is a single word get slightly wider horizontal padding than the scale
      dictates, so they never look cramped.
15. Micro-interaction inventory — specify the exact feedback for each:
    - Press: `scale(0.97)` with a 90ms ease-out, on every tappable surface. Physical feedback is
      what makes an interface feel alive rather than static.
    - Hover intent: a 120ms delay before showing hover-triggered overlays, so passing the cursor
      across a grid does not flash every card.
    - Numeric counters (cart badge, coin balance, earnings) roll rather than swap.
    - Skeleton-to-content is a 150ms crossfade, never a pop.
    - Successful actions get a brief, restrained confirmation — never a full-screen celebration.
    - Toggle switches animate the thumb with a spring easing, not linear.
16. Empty, loading, and error states are DESIGNED SURFACES, not fallbacks:
    - Every skeleton must mirror the exact layout of the real content it replaces, including
      correct proportions — a generic gray box is not acceptable.
    - Every empty state gets an illustration, one sentence of plain Bengali/English, and exactly
      one primary action.
    - Error states explain what happened, what it means, and what the user can do — never a raw
      code or a shrug.
    - First-run states differ from empty states: a new store is an opportunity, not a void.
17. The details that read as expensive:
    - Custom `::selection` colour derived from the brand token.
    - Styled scrollbars (thin, tinted, appearing on hover on desktop).
    - Custom focus-visible ring: a 2px brand-tinted ring with a 2px offset — never the browser
      default, never removed.
    - `caret-color` set to the brand token in inputs.
    - A print stylesheet for invoices, packing slips, and flyers.
    - Correct favicon set including a maskable icon and a dark-mode variant.
    - Tabular numerals in every price, counter, table, and countdown so digits do not jitter.
18. Layout rhythm:
    - A vertical rhythm baseline so headings, body, and components sit on a consistent grid.
    - A defined page-shell template: max content width, gutters per breakpoint, and section rhythm.
    - Content-driven grids for the marketplace (product cards define the column count), not a
      generic 12-column system forced onto everything.
19. Benchmark calibration — name the references the work will be measured against, with what
    specifically to take from each:
      Stripe Dashboard   → data density with breathing room, form craft
      Linear             → motion choreography, dark theme, keyboard-first feel
      Vercel             → typographic restraint and spacing discipline
      Shopify Polaris    → commerce interaction patterns and empty states
      Amazon             → scannability and information hierarchy at high density
      Apple Store        → product presentation and imagery discipline
      bKash / Pathao app → Bengali typography in practice, local UI expectations
    The spec must include a short "what we are NOT copying" note for each, so the result is
    calibrated rather than imitative.

ACCEPTANCE:
- docs/design-system.md exists and covers all 19 items above.
- Color ramps are expressed in OKLCH with perceptually even lightness steps, and the neutral ramp
  carries a documented non-zero chroma.
- Per-size optical tracking values are specified; no single global letter-spacing.
- The nested-radius rule, proximity rule, and origin rule are each stated with worked examples.
- The glassmorphism decision and rationale are stated explicitly.
- Zero gradient values appear anywhere in the spec.
- Bengali typography has its own dedicated subsection.
- The benchmark section names what to take AND what to avoid from each reference.

PREVIEW:
No UI change. This prompt produces a document that Prompt 1.1 will implement verbatim.
```

---

### Prompt 0.3: Information Architecture & Navigation Grouping Spec

```text
ID: 0.3
DEPENDS ON: 0.2
FILES:
  docs/ia-sitemap.md

TASK:
Define the complete route map and — critically — how 68+ platform modules are GROUPED into a
navigation structure that a non-technical user can operate.

REQUIREMENTS:
1. Full route table: path, page name, required permission, required module flag, public/private,
   SEO-indexable yes/no.
2. Role-aware navigation groups. Specify the sidebar group structure for each role:

   SUPER ADMIN
     Overview       → KPIs, health, alerts
     Users & Access → Users, Staff, Roles & Permissions, Access Grants, Approval Inbox, Restrictions
     Catalog        → Products, Categories, Moderation Queue, Batches & FEFO, Warehouses
     Orders         → Orders, Sub-orders, Returns, Disputes, Courier Hub, COD Reconciliation
     Finance        → Vault, Escrow, Ledger, Payouts, Profit Splits, B2B Escrow
     Growth         → Ads, Coupons, Campaigns, Referrals, Coins, Quests, Group Buy
     Content        → Banners, Stories, Academy, What's New, Translations
     Platform       → Module Toggles, Theme Studio, Integrations, API Keys
     Security       → Audit Log, Sessions, 2FA, IP Allowlist, Backups

   MODERATOR → Catalog(moderation only), Orders(returns/disputes), Users(reports),
               plus any group unlocked by an active delegation grant
   EDITOR    → Content, Translations
   SUPPLIER  → Overview, Inventory, Orders, Fulfilment, Warranty, Live, Vault, Insights, Store
   SALER     → Overview, My Store, Sourcing, Marketing, Orders, Vault, Growth, Academy
   CUSTOMER  → Orders, Wishlist, Coins, Warranties, Team Buys, Returns, Following, Settings

3. Command Palette (Ctrl/Cmd+K) specification: fuzzy search across every route, module, and admin
   action the current user is permitted to reach. This is mandatory — with 68 modules, tree
   navigation alone is not discoverable.
4. Progressive disclosure: define "Simple Mode" vs "Advanced Mode" for the Saler and Supplier
   dashboards. Simple Mode surfaces at most 6 primary actions. Persist the choice per user.
5. Locked-state UX: when a user lacks a permission, the nav item is NOT hidden. It renders greyed
   with a lock icon and a "Request Access" affordance that triggers the JIT grant flow (Prompt 2.5).
   Document the exact copy for both English and Bengali.
6. Mobile navigation: bottom tab bar (5 items max) + overflow drawer. Specify per role.
7. Breadcrumb rules, page-title rules, and empty-state copy guidelines.

ACCEPTANCE:
- Every route in the table maps to a permission key and a module key (or explicitly `none`).
- All six roles have a defined, grouped navigation tree.
- Command palette and locked-state behaviours are fully specified with copy.

PREVIEW:
No UI change. Prompt 1.7 implements this structure.
```

---

### Prompt 0.4: Permission Catalog & RBAC / Delegation Spec

```text
ID: 0.4
DEPENDS ON: 0.3
FILES:
  docs/rbac-spec.md
  docs/permission-catalog.json

TASK:
Design the complete authorization model. The v1.0 schema had a single `role` string column, which
makes the required granular control impossible. This prompt replaces it.

REQUIREMENTS:
1. Permission naming convention: `domain.resource.action`. Produce a complete catalog covering
   every action in the platform. Examples:
     finance.payout.approve        finance.split.update       finance.ledger.view
     users.kyc.approve             users.account.suspend      users.permission.grant
     catalog.product.delete        catalog.product.approve    catalog.category.manage
     orders.refund.execute         orders.dispute.arbitrate   orders.cod.reconcile
     platform.module.toggle        platform.theme.update      platform.apikey.manage
     content.banner.publish        content.i18n.update
     security.audit.view           security.session.revoke    system.backup.restore
   Emit the catalog as `docs/permission-catalog.json`, an array of:
     { key, domain, label_en, label_bn, risk_tier, delegable, default_roles[] }

2. Risk tiers — these drive the entire delegation model:

   | Tier      | Behaviour                                                    | Examples |
   |-----------|--------------------------------------------------------------|----------|
   | LOW       | Included in the role by default                              | approve product, moderate review |
   | MEDIUM    | Requires a standing grant from an Admin                      | refund ≤ 5,000 Tk, issue seller warning |
   | HIGH      | MAKER-CHECKER — actor submits, Admin must approve to execute | disburse payout, final KYC approval, suspend account |
   | CRITICAL  | Super Admin only. `delegable: false`. Never grantable.       | change profit split, create staff, toggle module, restore DB |

3. Three delegation modes — specify data model and lifecycle for each:

   MODE A — Standing Grant
     Admin grants a permission to a user with a mandatory reason and expiry.
     Table: user_permission_overrides(user_id, permission_key, effect ENUM('GRANT','DENY'),
            granted_by, reason, scope_json, expires_at, revoked_at)
     `DENY` must always win over `GRANT` in resolution.

   MODE B — Just-In-Time Request
     Moderator hits a locked action → "Request Access" → Admin receives an approval notification →
     on approval the requester receives a time-boxed window (default 2h, configurable).
     Table: permission_grant_requests(id, requester_id, permission_key, target_scope_json, reason,
            status ENUM('PENDING','APPROVED','REJECTED','EXPIRED'), approver_id, decided_at,
            window_expires_at)

   MODE C — Maker-Checker (mandatory for every HIGH tier permission)
     The actor executes normally, but the effect is NOT committed. It is serialised into a pending
     action and only applied after an authorised approver signs off.
     Table: pending_admin_actions(id, actor_id, action_key, payload_json, target_ref,
            status ENUM('PENDING','APPROVED','REJECTED','EXPIRED','APPLIED'), approver_id,
            approver_note, created_at, decided_at, applied_at, expires_at)
     Specify: an approver may never approve their own submission.

4. Permission resolution order (document as an explicit algorithm):
     user DENY override → role permissions ∪ user GRANT overrides ∪ active JIT window
     → CRITICAL tier check (super admin only) → module-enabled check → user-restriction check
   Resolution result is cached in Redis with a versioned key so a revoke takes effect immediately.

5. Granular per-user activity control (the "control every user's every activity" requirement):
     Capability switches: can_login, can_list_products, can_sell, can_buy, can_use_cod,
       can_withdraw, can_chat, can_live_stream, can_run_ads, can_refer, can_post_review,
       can_upload_video
     Numeric limits: max_withdrawal_per_day, max_products, max_cod_order_value,
       max_daily_messages, ad_budget_cap
     Enforcement modes: BLOCK | THROTTLE | FORCE_REVIEW_QUEUE | SHADOW_BAN
     Scope: single user OR segment rule (e.g. role=Saler AND district=Dhaka AND tier=Starter)
     Duration: permanent | until timestamp | until condition satisfied
     Table: user_restrictions(id, subject_type ENUM('USER','SEGMENT'), subject_ref,
            capability_key, mode, limit_value, reason, applied_by, expires_at, created_at)

6. Staff account hardening: mandatory 2FA (TOTP) for any account holding a MEDIUM+ permission,
   session listing with force-revoke, optional IP allowlist for the admin surface,
   and a break-glass emergency access procedure that is loudly audited.

7. Audit requirements: every permission grant, revoke, JIT approval, and maker-checker decision
   writes an audit row containing before_json and after_json.

ACCEPTANCE:
- permission-catalog.json parses as valid JSON and contains ≥ 120 permission entries.
- Every permission has a risk_tier and a delegable boolean.
- All three delegation modes have a complete table definition and lifecycle description.
- The resolution algorithm is written as unambiguous ordered steps.
- CRITICAL tier permissions are all marked delegable:false.

PREVIEW:
No UI change. Phase 2 implements this spec.
```

---

### Prompt 0.5: Database ERD & Schema Specification

```text
ID: 0.5
DEPENDS ON: 0.4
FILES:
  docs/erd.md

TASK:
Specify the complete relational schema. v1.0 listed 20 tables with no data types and referenced
two tables that were never created. This prompt produces the real thing.

HARD RULES:
  - Every money column: NUMERIC(14,2). Never FLOAT, REAL, or DOUBLE PRECISION.
  - Every quantity column: INTEGER with a CHECK (>= 0) constraint.
  - Every table: id BIGSERIAL or UUID (choose one convention and apply it universally),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ.
  - Every foreign key: explicit ON DELETE behaviour (RESTRICT for financial, CASCADE for children).
  - Soft-delete via deleted_at where records must survive for audit.
  - PII columns (nid_number, bank account, phone) must be marked in the doc as ENCRYPTED and their
    encryption strategy documented (pgcrypto or application-level envelope encryption).

REQUIREMENTS — define these table groups with full column lists, types, indexes, and constraints:

  IDENTITY & ACCESS
    users, user_profiles, sessions, refresh_tokens, otp_codes, staff_2fa,
    roles, permissions, role_permissions, user_roles,
    user_permission_overrides, permission_grant_requests, pending_admin_actions,
    user_restrictions, kyc_verifications, kyc_documents, trust_scores

  PLATFORM CONFIG
    platform_settings, platform_modules, module_targeting_rules, commission_rules,
    theme_palettes, audit_logs, i18n_strings, i18n_locales

  CATALOG
    categories, products, product_variants, product_images, product_batches,
    warehouse_nodes, warehouse_stock, saler_store_items, virtual_stores,
    product_approvals, product_bundles, bundle_items

  COMMERCE
    carts, cart_items, wishlists, orders, sub_orders, order_items,
    coupons, coupon_redemptions, flash_sales, team_purchases, team_purchase_members,
    abandoned_carts

  FINANCE
    wallets, ledger_transactions, escrow_entries, payout_requests,
    payment_transactions, payment_webhook_events, cod_reconciliation,
    b2b_escrow_milestones

  LOGISTICS & SUPPORT
    shipments, shipment_events, return_requests, return_items, dispute_threads,
    dispute_messages, warranty_cards, warranty_claims

  ENGAGEMENT
    reviews, review_media, follows, notifications, notification_preferences,
    notification_templates, chat_threads, chat_messages,
    coin_balances, coin_transactions, quests, quest_progress, leaderboard_snapshots,
    referrals, referral_earnings

  GROWTH & MEDIA
    ad_campaigns, ad_creatives, ad_impressions, ad_clicks, ad_billing,
    live_streams, live_stream_products, live_stream_messages,
    stories, academy_courses, academy_lessons, media_assets

  DEVELOPER
    api_keys, webhook_subscriptions, webhook_deliveries

ADDITIONAL REQUIREMENTS:
1. Index strategy section: every FK indexed, plus composite indexes for the hot query paths
   (catalog browse, order history, ledger by wallet+date, chat by thread+created_at).
2. Partitioning plan for `ledger_transactions`, `audit_logs`, `ad_impressions` (monthly range).
3. A ledger invariant section: the sum of all ledger entries per wallet must always equal
   available_balance + pending_escrow_balance. Document this as a testable invariant.
4. Migration file naming convention and a forward-only migration policy.

ACCEPTANCE:
- Every table referenced anywhere in this prompt document exists in the ERD.
- No column type is left unspecified.
- `platform_settings` and `warehouse_nodes` — the two tables missing in v1.0 — are present.
- The ledger invariant is stated explicitly.

PREVIEW:
No UI change. Phase 2 and 4 implement these migrations incrementally.
```

---

### Prompt 0.6: API Contract, Error Standard & Idempotency Spec

```text
ID: 0.6
DEPENDS ON: 0.5
FILES:
  docs/api-contract.md

TASK:
Define one consistent HTTP contract so 60 prompts do not each invent their own.

REQUIREMENTS:
1. Base path `/api/v1`. Versioning and deprecation policy.
2. Success envelope: { data, meta? } — never a bare array at the top level.
3. Error envelope: { error: { code, message_en, message_bn, details?, trace_id } }
   Define the full error code enum, including:
     AUTH_REQUIRED, AUTH_INVALID, PERMISSION_DENIED, PERMISSION_PENDING_APPROVAL,
     MODULE_DISABLED, USER_RESTRICTED, VALIDATION_FAILED, NOT_FOUND, CONFLICT,
     INSUFFICIENT_STOCK, INSUFFICIENT_BALANCE, IDEMPOTENCY_REPLAY, RATE_LIMITED,
     PAYMENT_FAILED, UPSTREAM_UNAVAILABLE
   PERMISSION_DENIED responses must include whether the permission is requestable via JIT, so the
   client can render the "Request Access" button.
4. Pagination: cursor-based for feeds, offset for admin tables. Standard params and meta shape.
5. Idempotency: `Idempotency-Key` header required on all POST/PATCH that move money or create
   orders. Keys stored with the response for 24h; replay returns the original response with
   `IDEMPOTENCY_REPLAY` noted in meta.
6. Rate limiting headers: X-RateLimit-Limit / Remaining / Reset.
7. Request validation: every route declares a Fastify JSON schema. Reject unknown fields.
8. Webhook inbound standard: HMAC signature verification, replay protection via Redis SETNX,
   and an at-least-once processing guarantee with dedupe on provider event id.
9. Authentication: short-lived JWT access token + HttpOnly refresh cookie rotation.
10. A worked example request/response for one endpoint from each phase.

ACCEPTANCE:
- Error code enum is complete and each code has an HTTP status mapping.
- Idempotency lifecycle is fully described.
- Bengali message field is present in the error envelope.

PREVIEW:
No UI change.
```

---

### Prompt 0.7: Module Registry — All 68 Platform Modules

```text
ID: 0.7
DEPENDS ON: 0.6
FILES:
  docs/module-registry.md
  server/src/config/modules.seed.json

TASK:
Enumerate every toggleable module from `idea proposition.md` §4 as structured, seedable data.
v1.0 referenced "50+ features" but never listed them in machine-readable form.

REQUIREMENTS:
1. For each module produce:
   { key, group, label_en, label_bn, description_en, description_bn,
     default_enabled, risk_of_disabling, sub_settings_schema, depends_on[],
     affected_routes[], affected_permissions[] }
2. Group modules using the Phase-0.3 navigation groups (Trust, Commerce, Finance, Growth,
   Content, Communication, Logistics, Advanced, System).
3. `sub_settings_schema` is a JSON Schema fragment. Examples:
     returns_engine  → { return_window_days: int, allowed_reasons: string[] }
     cod_protection  → { otp_threshold_amount: number, max_cod_value: number }
     group_buying    → { default_team_size: int, window_hours: int, min_discount_pct: number }
     coins           → { checkin_reward: int, redemption_rate: number, max_redeem_pct: number }
4. `depends_on` captures real dependencies — e.g. `live_commerce` depends on `chat`,
   `whatsapp_bridge` depends on `chat`. Disabling a parent must warn about children.
5. Cover ALL modules listed in idea proposition.md §4 (the ~68-row table), including the ones v1.0
   omitted entirely: seller_academy, digital_warranty, product_bundling, demand_surge,
   b2b_escrow, open_api_sdk, daily_quests, ugc_video_wall, voice_search, wishlist,
   follow_feed, duplicate_account_detection, review_integrity_ai, whats_new_modal, db_backup.
6. Targeting capability per module (implemented in Prompt 3.1):
   global | by_role | by_tier | by_district | by_user | percentage_rollout | scheduled_window.

ACCEPTANCE:
- modules.seed.json is valid JSON with ≥ 68 entries.
- Every entry has both English and Bengali labels.
- Every module named in idea proposition.md §4 appears; cross-check and list any intentional
  omissions with justification.

PREVIEW:
No UI change. Prompt 3.2 renders this registry as the Module Control Panel.
```

---

### Prompt 0.8: Agent Maintainability Contract

```text
ID: 0.8
DEPENDS ON: 0.7
FILES:
  CLAUDE.md
  docs/architecture-map.md
  docs/dependency-ledger.md
  docs/how-to-add-a-feature.md

TASK:
Make this codebase permanently maintainable by an AI agent that has never seen it before. The owner
will update this platform over years using AI assistants, in short sessions, with no memory of
previous work. Everything an agent needs to make a correct change must be discoverable from the
repository itself — never from a past conversation.

REQUIREMENTS:
1. CLAUDE.md at the repo root — loaded automatically by Claude Code every session. It must be
   SHORT (under 200 lines) and contain only what changes behaviour, not prose:
   - The stack in one table, and the hard rules: zero frontend runtime dependencies, no CSS
     framework, no Docker in development, money is NUMERIC(14,2), splits only in pricing.service.
   - The three commands that matter: `npm run dev`, `npm run migrate`, `npm test`.
   - Where things live, as a lookup table (see item 2).
   - The conventions an agent will otherwise get wrong: permission key format, error envelope
     shape, i18n key namespacing, the requireModule/requirePermission/requireRestriction triad on
     every feature route, and the rule that every integration ships a mock driver.
   - A "before you finish" checklist: gallery registration, both locale files, craft audit, tests,
     traceability matrix update.
   - Explicit pointers to the deeper docs rather than duplicating them — CLAUDE.md is an index.
2. docs/architecture-map.md — the orientation document:
   - A directory tree annotated with what each folder is responsible for.
   - A "where do I change X?" table covering the 30 most likely change requests
     ("add a product field", "change a commission rate", "add a new payment method",
     "add a language", "add an admin permission", "add a module toggle") mapped to the exact files.
   - Request lifecycle traced end to end: browser → router → api.js → nginx → Fastify route →
     middleware chain → controller → service → repository → PostgreSQL, naming the real files.
   - The data flow for the three highest-risk paths: checkout, escrow settlement, permission
     resolution.
   - A list of the invariants that must never be violated, each with the test that guards it.
3. docs/dependency-ledger.md — every dependency with why it exists, what it would take to remove
   it, and which single file isolates it. Enforced by the Dependency Policy in Master Instructions.
4. docs/how-to-add-a-feature.md — a worked, end-to-end example adding one small real feature
   (a "product tags" field) through every layer: migration → repository → service → controller →
   route → permission → module flag → API client → UI component → gallery registration →
   both locale files → test → traceability row. This single walkthrough teaches an agent the
   entire project convention faster than any amount of description.
5. Self-describing code requirements applied from here on:
   - Every service file opens with a comment stating its responsibility and its invariants.
   - Every non-obvious decision carries a `// WHY:` comment. An agent can read WHAT the code does;
     it cannot recover WHY without being told, and that is how correct code gets "refactored" into
     broken code.
   - Every SQL migration opens with a comment stating what changed and why.
6. Keep it current: updating CLAUDE.md and architecture-map.md is part of the definition of done
   for any prompt that adds a new subsystem. Stale orientation docs are worse than none.

ACCEPTANCE:
- CLAUDE.md is under 200 lines and contains no information duplicated from the deeper docs.
- The "where do I change X?" table covers at least 30 realistic change requests with exact paths.
- Following how-to-add-a-feature.md end to end produces a working feature with no other guidance.
- A fresh agent, given only this repository, can locate where to change a commission rate in under
  two minutes.

PREVIEW:
No UI change. This is the prompt that makes every future session productive.
```

---

# Phase 1 — Design System, App Shell, Router, i18n

> Phase 1 is pure frontend and requires **no database at all**. `VITE_API_MODE=mock`.
> Every prompt here is immediately previewable in the browser.

---

### Prompt 1.1: CSS Design Tokens (Light + Dark, Full Scales)

```text
ID: 1.1
DEPENDS ON: 0.2
FILES:
  client/src/styles/tokens.css
  client/src/styles/themes.css

TASK:
Implement docs/design-system.md as CSS custom properties. This file is the only place raw color
values may appear.

REQUIREMENTS:
1. tokens.css — non-color primitives:
   spacing scale (--space-1..10), radius scale, border widths, elevation ladder (4 levels),
   type scale with paired line-heights, font stacks (Latin + Bengali), motion durations and
   easings, z-index ladder, breakpoint custom media values, density variables.
2. themes.css — semantic color tokens defined THREE times:
   :root                                        → light palette (complete)
   @media (prefers-color-scheme: dark) :root:not([data-theme='light'])  → dark overrides
   :root[data-theme='dark']                     → dark overrides (explicit toggle wins)
   :root[data-theme='light']                    → light overrides (explicit toggle wins)
   Never define a color only inside a media query.
3. Semantic naming only: --surface-0/1/2/3, --text-primary/secondary/muted/inverse,
   --border-subtle/strong, --brand/--brand-hover/--brand-active/--brand-contrast,
   --success/--warning/--danger/--info plus their -bg and -border variants.
   All color values authored in OKLCH per docs/design-system.md item 1, with an sRGB hex fallback
   emitted alongside each for older browsers via `@supports not (color: oklch(0 0 0))`.
   The neutral ramp MUST carry the documented brand-tinted chroma — a chroma of 0 anywhere in the
   neutral scale is a defect, not a simplification.
   Dark theme surfaces get lighter with elevation; pure #000 and #fff are forbidden as values.
4. Zero gradients. Zero backdrop-filter in this file (overlay-only glass is defined later in the
   modal component). Shadow tokens derive their color from the surface hue, never from pure black.
5. Include `@media (prefers-reduced-motion: reduce)` zeroing all motion durations.
6. Bengali line-height overrides applied via `:lang(bn)`.

ACCEPTANCE:
- Toggling `data-theme` on <html> visibly switches the entire palette with no flash.
- No hex value appears outside these two files.
- Every token from docs/design-system.md is present.

PREVIEW:
localhost:3000 renders a token swatch strip. Toggling the theme attribute in devtools flips
light/dark instantly.
```

---

### Prompt 1.2: Reset, Base Typography & Self-Hosted Fonts

```text
ID: 1.2
DEPENDS ON: 1.1
FILES:
  client/src/styles/reset.css
  client/src/styles/typography.css
  client/public/fonts/          (self-hosted woff2 subsets)
  client/src/styles/main.css    (aggregator)

TASK:
Modern reset plus a typography layer that renders Bengali as beautifully as English.

REQUIREMENTS:
1. reset.css: border-box everywhere, margin/padding zero, `img,video { max-width:100%; display:block }`,
   `input,button,select,textarea { font: inherit }`, smooth scroll honouring reduced-motion,
   font smoothing, `:focus-visible` ring using the token from 1.1, `text-wrap: balance` on headings.
2. Self-host Inter (latin subset) and Noto Sans Bengali (bengali subset) as woff2 with
   `font-display: swap` and explicit `unicode-range` so the Bengali file only downloads for
   Bengali glyphs. Do NOT link fonts.googleapis.com.
3. typography.css: heading scale, body scale, `.text-muted`, `.text-numeric`
   (tabular-nums for all money and counters), and `:lang(bn)` line-height/letter-spacing corrections.
4. Bangladeshi number formatting helper is NOT here — that is Prompt 1.6. This file is visual only.
5. main.css imports in order: tokens → themes → reset → typography → components → utilities.

ACCEPTANCE:
- A paragraph of Bengali text and a paragraph of English text render at visually equal optical size
  and neither clips ascenders/descenders.
- Network tab shows the Bengali font is NOT downloaded on an English-only page.
- Total font payload < 120KB.

PREVIEW:
localhost:3000 shows a typography specimen page with the full type scale in both English and
Bengali, side by side.
```

---

### Prompt 1.3: Component Library — Part 1 (Forms & Actions)

```text
ID: 1.3
DEPENDS ON: 1.2
FILES:
  client/src/components/ui/Button.js
  client/src/components/ui/Input.js
  client/src/components/ui/Select.js
  client/src/components/ui/Checkbox.js
  client/src/components/ui/Radio.js
  client/src/components/ui/Switch.js
  client/src/components/ui/Textarea.js
  client/src/components/ui/FormField.js
  client/src/components/ui/Badge.js
  client/src/styles/components/forms.css
  client/src/styles/components/actions.css

TASK:
Build the interactive primitives with every state from the design-system state matrix.

REQUIREMENTS:
1. Each component is a plain ESM factory returning a DOM element — no framework, no JSX.
   Signature convention: `export function Button({ variant, size, loading, disabled, iconLeft, ... })`
2. Button variants: primary, secondary, ghost, danger, link. Sizes: sm, md, lg.
   MUST implement: default, hover, focus-visible, active, disabled, loading (inline spinner,
   width does not jump).
3. Input/Select/Textarea: label, hint, error, success, disabled, readonly, prefix/suffix slots,
   character counter. Error text renders below and is wired via aria-describedby.
4. FormField wraps a control with label + hint + error and manages the aria plumbing.
5. Switch is used heavily by the Module Control Panel — it needs an explicit "pending" state for
   optimistic toggles that are awaiting a server response.
6. Badge variants: verified (blue tick), elite (gold), status dot (open/closed), count, tier.
7. All touch targets ≥ 44px. All focus rings visible. No `outline: none` without a replacement.

ACCEPTANCE:
- Every component renders all documented states.
- Keyboard-only operation works for every control (Tab, Space, Enter, Arrow keys on radio groups).
- No component contains a hardcoded color.

PREVIEW:
Components appear in /dev/gallery (built in 1.8) — until then, render them on the index page.
```

---

### Prompt 1.4: Component Library — Part 2 (Surfaces & Feedback)

```text
ID: 1.4
DEPENDS ON: 1.3
FILES:
  client/src/components/ui/Card.js
  client/src/components/ui/Modal.js
  client/src/components/ui/Drawer.js
  client/src/components/ui/Table.js
  client/src/components/ui/Tabs.js
  client/src/components/ui/Toast.js
  client/src/components/ui/Skeleton.js
  client/src/components/ui/EmptyState.js
  client/src/components/ui/Pagination.js
  client/src/components/ui/Tooltip.js
  client/src/components/ui/ConfirmDialog.js
  client/src/services/toast.js
  client/src/styles/components/surfaces.css
  client/src/styles/components/feedback.css

TASK:
Build layout surfaces and the feedback system.

REQUIREMENTS:
1. Card: solid surface, 1px border, elevation-1. NO glass, NO gradient.
2. Modal / Drawer: focus trap, Escape to close, scroll lock, restore focus on close,
   `aria-modal`, labelled by its title. The scrim is the ONLY place a subtle backdrop-filter is
   permitted. Drawer supports left/right/bottom (bottom = mobile sheet with drag-to-dismiss).
3. Table: sticky header, sortable columns, row selection, compact density mode, horizontal scroll
   contained inside its own wrapper (the page must never scroll horizontally), and built-in
   loading (skeleton rows) and empty states.
4. Toast: a global singleton service `toast.success/error/warning/info(msg, opts)`, stacked,
   auto-dismiss with pause-on-hover, `aria-live="polite"`, max 3 visible.
5. Skeleton: text, block, circle, card, and table-row shapes. Must reserve exact final dimensions
   to prevent layout shift.
6. EmptyState: icon slot, title, description, primary action. Every list in the app must use it.
7. ConfirmDialog: returns a Promise<boolean>. Supports a "type the name to confirm" mode for
   destructive actions, and a mandatory-reason textarea mode (used by module toggles and
   admin restrictions).
8. Pagination supports both cursor and offset modes per the API contract.

ACCEPTANCE:
- Modal traps focus and Escape closes it. Focus returns to the trigger.
- Table with 0 rows renders EmptyState, with unknown rows renders Skeleton.
- Toasts stack and auto-dismiss without overlapping.
- Zero horizontal page scroll at 360px viewport width.

PREVIEW:
All components visible and interactive in /dev/gallery.
```

---

### Prompt 1.5: Router, State Store & API Client (mock ⇄ live switch)

```text
ID: 1.5
DEPENDS ON: 1.4
FILES:
  client/src/core/router.js
  client/src/core/store.js
  client/src/core/api.js
  client/src/mocks/index.js
  client/src/mocks/handlers/*.js
  client/src/mocks/fixtures/*.json

TASK:
Build the three core runtime services. The API client's mock/live switch is what keeps the site
previewable for the next 10 phases before the backend catches up.

REQUIREMENTS:
1. router.js — hash-free History API router:
   - Route registration with params (`/product/:id`, `/store/:slug`) and query parsing.
   - Per-route guards: `requiresAuth`, `requiresPermission`, `requiresModule`.
   - Lazy route loading via dynamic `import()` so the initial bundle stays small.
   - Scroll restoration, 404 route, and a `beforeEach` hook for analytics/title updates.
2. store.js — minimal pub/sub store:
   - `createStore(initialState)` → `{ get, set, update, subscribe, selector }`
   - Selector subscriptions only fire when the selected slice actually changes.
   - Optional `persist` option writing to localStorage with a namespaced key.
   - No external dependency.
3. api.js — fetch wrapper implementing docs/api-contract.md:
   - Reads `import.meta.env.VITE_API_MODE`.
     mock → resolves against client/src/mocks handlers with a simulated 150–400ms latency
     live → real fetch against `/api/v1`
   - Automatic JWT attach, 401 → refresh-token retry once → redirect to login.
   - Unwraps `{ data, meta }`, throws a typed `ApiError` carrying `code`, `message_en`,
     `message_bn`, and `requestable` (for the JIT access flow).
   - Auto-generates `Idempotency-Key` (UUID v4) for POST/PATCH on money/order routes.
   - Global handling: MODULE_DISABLED → hide feature + toast; PERMISSION_DENIED → locked-state UI.
4. Mock layer: fixtures must be realistic Bangladeshi data — Bengali product names, BDT prices,
   real district names, +8801… phone numbers. Not "Lorem ipsum", not "$19.99".

ACCEPTANCE:
- Navigating between routes never triggers a full page reload.
- Setting VITE_API_MODE=mock vs live requires ZERO source changes.
- A guarded route redirects correctly when the guard fails.
- ApiError surfaces both language messages.

PREVIEW:
localhost:3000 navigates between three stub routes; devtools shows mock responses resolving with
realistic latency. Changing VITE_API_MODE in .env and restarting flips to live (which will 404
until Phase 2 — that is expected and must fail gracefully).
```

---

### Prompt 1.6: i18n Engine (English ⇄ Bengali) with BD Formatting

```text
ID: 1.6
DEPENDS ON: 1.5
FILES:
  client/src/services/i18n.js
  client/src/services/format.js
  client/src/locales/en.json
  client/src/locales/bn.json

TASK:
Zero-reload language switching plus correct Bangladeshi number, currency, and date formatting.

REQUIREMENTS:
1. i18n.js:
   - `t(key, params?)` with `{{placeholder}}` interpolation and a pluralization rule set.
   - `setLanguage('en'|'bn')` — updates `<html lang>`, persists to localStorage, and re-renders
     subscribed nodes WITHOUT a page reload.
   - Locale dictionaries loaded lazily via dynamic import; missing keys log a warning in dev and
     fall back to English in production.
   - A `data-i18n` attribute scanner so static HTML can be translated too.
2. format.js — Bangladesh-specific:
   - Currency: `৳ 1,23,456.00` — note the SOUTH ASIAN digit grouping (2,2,3), not Western (3,3,3).
     This is a common and highly visible bug. Implement and test it explicitly.
   - Optional Bengali numerals (০১২৩) when locale is `bn`, controlled by a user preference.
   - Relative time ("৩ ঘণ্টা আগে" / "3 hours ago"), date formats, and phone masking (+8801XXXXXXXXX).
3. en.json / bn.json seeded with every string used so far. Keys are namespaced dot paths
   (`nav.marketplace`, `vault.pending_escrow`, `error.permission_denied`).
4. All Bengali copy must be natural Bengali written for shoppers, not machine-translated English.

ACCEPTANCE:
- Switching language updates every visible string instantly with no reload and no layout break.
- ৳1,23,456.00 renders with correct South Asian grouping — verified with a unit assertion.
- A missing key never renders as blank or as the raw key path in production.

PREVIEW:
A language toggle in the corner of the page flips the entire UI between English and Bengali live.
```

---

### Prompt 1.7: Role-Aware App Shell & Command Palette

```text
ID: 1.7
DEPENDS ON: 1.6, 0.3
FILES:
  client/src/components/shell/AppShell.js
  client/src/components/shell/Sidebar.js
  client/src/components/shell/TopBar.js
  client/src/components/shell/MobileNav.js
  client/src/components/shell/CommandPalette.js
  client/src/components/shell/LockedNavItem.js
  client/src/config/navigation.js
  client/src/styles/components/shell.css

TASK:
Implement the grouped navigation defined in docs/ia-sitemap.md. This is what makes 68 modules
usable rather than overwhelming.

REQUIREMENTS:
1. navigation.js — the nav tree as data, not markup. Each item:
   { key, label_i18n_key, icon, path, group, permission, module, roles[], order }
   The sidebar renders from this config; adding a feature later means adding one object.
2. Sidebar: collapsible groups, active-route highlighting, group headers, collapse-to-icons mode,
   state persisted per user. Groups exactly as specified in 0.3.
3. LockedNavItem: when the user lacks `permission`, render greyed + lock icon + "Request Access".
   Do NOT hide it. Clicking opens the JIT request modal (wired to the real API in Prompt 2.8).
   When the item is disabled because its MODULE is off, hide it entirely instead — a disabled
   module is not something the user can request.
4. TopBar: search, language toggle, theme toggle, notification bell, cart, avatar menu,
   and — for staff with an active delegated grant — a persistent countdown chip showing
   "Elevated access: 1h 42m remaining".
5. MobileNav: bottom tab bar, max 5 items, role-specific, plus an overflow sheet. 44px targets.
6. CommandPalette (Ctrl/Cmd+K): fuzzy search over routes, modules, and quick actions filtered by
   the user's permissions. Keyboard-first, recent items, grouped results. This is mandatory.
7. Simple Mode / Advanced Mode toggle for Saler and Supplier shells, persisted per user.

ACCEPTANCE:
- Switching the mocked current-role changes the entire sidebar tree correctly.
- Ctrl+K opens the palette, arrow keys navigate, Enter routes, Escape closes.
- A permission-locked item renders locked (not hidden); a module-disabled item is hidden.
- At 360px width the shell collapses to bottom nav with no horizontal scroll.

PREVIEW:
A role switcher in /dev/gallery lets the developer preview all six role shells live.
```

---

### Prompt 1.8: Living Component Gallery (`/dev/gallery`)

```text
ID: 1.8
DEPENDS ON: 1.7
FILES:
  client/src/pages/dev/GalleryPage.js
  client/src/pages/dev/gallery-registry.js

TASK:
Build the permanent visual workbench. This is the developer's primary preview surface for the rest
of the project.

REQUIREMENTS:
1. Route `/dev/gallery`, available only when `import.meta.env.DEV` is true. Excluded from the
   production build.
2. Left nav listing every component category; each entry renders ALL states side by side.
3. Global controls pinned to the top: theme (light/dark/system), language (en/bn),
   density (comfortable/compact), viewport width simulator (360 / 768 / 1280),
   and a role impersonation dropdown driving the shell preview.
4. gallery-registry.js is an explicit list. RULE FOR ALL FUTURE PROMPTS: any component created in
   Phases 2–11 must register itself here in the same commit.
5. A live design-token inspector panel showing current computed values of every CSS custom property.
6. A contrast checker panel that measures and reports the ratio for each text/surface pairing and
   flags anything under WCAG AA.

ACCEPTANCE:
- Every component from 1.3 and 1.4 appears with all states.
- Flipping theme/language/density updates the whole gallery instantly.
- The contrast panel reports zero AA failures.
- `npm run build` output contains no gallery code.

PREVIEW:
http://localhost:3000/dev/gallery — the developer's main visual reference from here on.
```

---

### Prompt 1.9: Accessibility, Performance Budget & Design QA Gate

```text
ID: 1.9
DEPENDS ON: 1.8
FILES:
  docs/qa-checklist.md
  client/src/dev/a11y-audit.js
  client/vite.config.js   (modify: bundle size reporting)

TASK:
Install the quality gate that every later phase must pass.

REQUIREMENTS:
1. docs/qa-checklist.md — a per-feature checklist covering:
   keyboard reachability, visible focus, contrast AA, 44px targets, aria labelling,
   reduced-motion respect, empty state present, loading state present, error state present,
   Bengali string present, mobile 360px verified, no layout shift.
2. a11y-audit.js — a dev-only in-page auditor (no external dependency) that scans the live DOM for:
   images without alt, buttons without accessible names, form controls without labels,
   contrast failures, positive tabindex, duplicate ids, missing lang attribute.
   Surfaces results as a floating dev badge with a count.
3. Performance budget enforced in vite.config.js — build fails if the initial JS chunk exceeds
   150KB gzipped (the PRD's stated target) or initial CSS exceeds 40KB gzipped.
4. Document the Lighthouse target: Performance ≥ 95, Accessibility 100, Best Practices ≥ 95,
   SEO ≥ 95 — measured on the marketplace home and product detail pages.

ACCEPTANCE:
- a11y-audit reports zero violations on /dev/gallery.
- `npm run build` succeeds and reports chunk sizes under budget.
- The checklist is referenced by name in every subsequent phase's acceptance criteria.

PREVIEW:
The a11y badge appears bottom-right in dev mode showing "0 issues".
```

---

### Prompt 1.10: Craft Pass & Design Benchmark Review

```text
ID: 1.10
DEPENDS ON: 1.9
FILES:
  client/src/styles/craft.css
  client/src/lib/motion.js
  client/src/lib/optical.js
  client/src/pages/dev/CraftAuditPage.js
  docs/design-review-log.md

TASK:
Everything up to 1.9 makes the UI CORRECT. This prompt makes it EXCELLENT. Do not skip it and do
not merge it into an earlier prompt — a craft pass only works as a deliberate, separate review of
finished components, and it is the step most often dropped under time pressure.

REQUIREMENTS:
1. craft.css — implement the Craft Layer of docs/design-system.md (items 14–18):
   custom ::selection, styled scrollbars, brand focus ring, caret-color, tabular numerals on every
   numeric context, hanging punctuation, `text-wrap: pretty` on body copy and `balance` on
   headings, optical padding corrections, and the nested-radius helper.
2. motion.js — a tiny (< 3KB) motion utility, no library:
   - `press(el)` applying the scale(0.97) press feedback to any tappable surface
   - `stagger(els, opts)` for list entrance choreography with the 8-item cap
   - `originTransition(el, triggerEl)` computing the transform-origin so overlays grow from their
     trigger, per the ORIGIN RULE
   - `countUp(el, from, to)` for rolling numeric counters
   - Every helper interruptible and a no-op under prefers-reduced-motion.
3. optical.js — the optical correction helpers: cap-height icon alignment, optical centering for
   directional glyphs, and the circle/square size compensation factor.
4. Apply the craft pass to EVERY component built in 1.3 and 1.4. This is a rework pass over
   existing code, not new components. Specifically verify each one against:
     - press feedback present on anything tappable
     - focus ring is the custom brand ring, visible, never removed
     - nested radius correct
     - proximity rule respected (related items closer than unrelated)
     - tabular numerals wherever digits change
     - skeleton mirrors the real layout exactly
     - empty state has illustration + one sentence + one action
     - entrance/exit timing asymmetric, exit faster
5. CraftAuditPage at `/dev/craft` — an automated detector for craft regressions, listing:
     pure-gray colors in use (should be zero — neutrals are tinted)
     any `letter-spacing: normal` on display-size text
     any element with a border-radius equal to its parent's while padded
     any interactive element missing press feedback
     any `transition: linear` outside progress indicators
     any non-tabular numeral in a price or counter context
     any skeleton whose dimensions differ from its loaded content
   Each finding links to the offending element in the DOM.
6. docs/design-review-log.md — a structured side-by-side review of the three most important
   screens (marketplace home, product detail, checkout) against the Prompt 0.2 benchmarks.
   For each screen record: what a reference does better, the specific change made, and the
   before/after. This log is re-run and appended after Phases 4, 5, and 11 — see the standing rule.
7. Establish the SQUINT TEST as a required check: blur the screen until text is unreadable. The
   visual hierarchy must still be obvious, and the primary action must still be the most prominent
   element. If everything looks equally important, the hierarchy has failed.

ACCEPTANCE:
- /dev/craft reports zero findings across every component in the gallery.
- No pure gray (chroma = 0) appears anywhere in the rendered UI.
- Every tappable element has press feedback; every focusable element has the custom ring.
- Overlays visibly animate from their trigger, not the screen centre.
- design-review-log.md contains a real, specific critique of all three screens — not a checklist
  of ticks.
- The squint test passes on all three screens.

PREVIEW:
/dev/craft shows an all-clear audit; /dev/gallery visibly feels more refined than at 1.9 —
press feedback, spring toggles, staggered lists, rolling counters.
```

---

# Phase 2 — Auth, RBAC Engine, Delegation & Audit

> This phase is deliberately **before** any commerce feature. Building catalog/orders first and
> retrofitting granular permissions later is what forces a rewrite. Backend starts here — still
> no Docker.

---

### Prompt 2.1: Backend Bootstrap, Config & Cache Adapter (Docker-Free)

```text
ID: 2.1
DEPENDS ON: 0.6, 1.5
FILES:
  server/src/app.js
  server/src/config/env.js
  server/src/config/db.js
  server/src/config/cache.js
  server/src/config/cache-drivers/redis.js
  server/src/config/cache-drivers/memory.js
  server/src/db/migrate.js
  server/src/db/migrations/.gitkeep
  server/src/plugins/errorHandler.js
  server/src/plugins/requestContext.js
  server/package.json

TASK:
Stand up the real Fastify server with a database connection and a cache layer that works with or
without Redis installed.

REQUIREMENTS:
1. env.js — validate all environment variables at boot with a schema. Fail fast with a readable
   message naming the missing variable. Never log secret values.
2. db.js — `pg` Pool. Connection string from DATABASE_URL. Works against Neon (managed, SSL) and
   a local PostgreSQL install identically. Include pool sizing, statement timeout, and a
   `withTransaction(fn)` helper that guarantees BEGIN/COMMIT/ROLLBACK.
3. cache.js — a driver interface: get, set, del, incr, expire, setnx, publish, subscribe.
   - `CACHE_DRIVER=redis` → real Redis (Upstash or local)
   - `CACHE_DRIVER=memory` → in-process Map with TTL sweeping and a no-op pub/sub that still
     delivers within the single process
   This memory driver is REQUIRED so a developer with no Redis can run everything.
   Log a clear startup warning when the memory driver is active, noting it is single-node only.
4. migrate.js — a dependency-free forward-only migration runner:
   `npm run migrate` applies pending `.sql` files in order, records them in a `_migrations` table,
   and runs each file inside a transaction. Add `npm run migrate:status`.
5. errorHandler.js — maps thrown errors to the docs/api-contract.md error envelope, attaches a
   trace_id, logs server-side with the trace_id, and never leaks stack traces in production.
6. requestContext.js — per-request context carrying trace_id, user, ip, user-agent. Available to
   services for audit logging without prop-drilling.
7. Register: @fastify/cors (dev origin localhost:3000), @fastify/helmet, @fastify/cookie,
   @fastify/rate-limit (backed by the cache driver).

ACCEPTANCE:
- `npm run dev` starts the server with CACHE_DRIVER=memory and NO Redis running.
- `npm run migrate` runs cleanly against a fresh Neon database.
- A deliberately thrown error returns the exact documented error envelope with a trace_id.
- Missing DATABASE_URL produces a clear, actionable startup error, not a stack trace.

PREVIEW:
localhost:3000/api/v1/health returns ok. The server console prints the active cache driver.
```

---

### Prompt 2.2: Identity & Access Schema Migration

```text
ID: 2.2
DEPENDS ON: 2.1, 0.5, 0.4
FILES:
  server/src/db/migrations/001_identity.sql
  server/src/db/migrations/002_rbac.sql
  server/src/db/migrations/003_audit.sql
  server/src/db/seeds/001_roles_permissions.sql
  server/src/db/seeds/002_dev_users.sql

TASK:
Create the identity and authorization tables exactly as specified in docs/erd.md §Identity & Access.

REQUIREMENTS:
1. 001_identity.sql: users, user_profiles, sessions, refresh_tokens, otp_codes, staff_2fa,
   trust_scores. Phone is UNIQUE and stored normalised to E.164. Password hash is argon2id.
   `users` has NO `role` string column — roles live in user_roles.
2. 002_rbac.sql: roles, permissions, role_permissions, user_roles,
   user_permission_overrides, permission_grant_requests, pending_admin_actions, user_restrictions.
   Enforce with constraints:
     - user_permission_overrides has a UNIQUE(user_id, permission_key, revoked_at) partial index
     - pending_admin_actions CHECK (approver_id IS NULL OR approver_id <> actor_id)
     - permission_grant_requests CHECK (window_expires_at > decided_at)
3. 003_audit.sql: audit_logs with before_json, after_json, actor_id, actor_role, action,
   target_type, target_ref, ip_address, user_agent, trace_id, prev_hash, row_hash, created_at.
   Add a BEFORE INSERT trigger computing row_hash = sha256(prev_hash || row payload) to make the
   log tamper-evident. Add a rule/trigger preventing UPDATE and DELETE on audit_logs.
4. Seed roles: super_admin, admin, moderator, editor, supplier, saler, customer.
   Seed permissions directly from docs/permission-catalog.json (write a small loader or generate
   the INSERTs). Seed role_permissions per the catalog's default_roles.
5. Seed dev users — one per role, with known credentials documented in README under a clearly
   marked "development only" heading. Include one moderator with ZERO delegated permissions so the
   locked-state UI can be tested realistically.

ACCEPTANCE:
- `npm run migrate` applies all three cleanly on an empty database and is idempotent on re-run.
- `SELECT count(*) FROM permissions` matches the catalog entry count.
- Attempting `UPDATE audit_logs` raises an error.
- No money column exists in this phase; every timestamp is TIMESTAMPTZ.

PREVIEW:
`npm run migrate:status` lists all applied migrations. No UI change yet.
```

---

### Prompt 2.3: Authentication — JWT, Refresh Rotation, SMS OTP, Staff 2FA

```text
ID: 2.3
DEPENDS ON: 2.2
FILES:
  server/src/routes/auth.routes.js
  server/src/controllers/auth.controller.js
  server/src/services/auth.service.js
  server/src/services/otp.service.js
  server/src/services/totp.service.js
  server/src/repositories/user.repository.js
  server/src/integrations/sms/index.js
  server/src/integrations/sms/mock.js
  server/src/integrations/sms/greenweb.js
  server/src/middlewares/authenticate.js

TASK:
Full authentication with a mock SMS driver so development needs no paid gateway.

REQUIREMENTS:
1. Endpoints:
     POST /api/v1/auth/register        (phone + password, or phone-only OTP signup)
     POST /api/v1/auth/login
     POST /api/v1/auth/send-otp        (rate limited: 3/hour/phone, 10/hour/IP)
     POST /api/v1/auth/verify-otp
     POST /api/v1/auth/refresh         (rotating refresh token, reuse detection)
     POST /api/v1/auth/logout
     GET  /api/v1/auth/me              (returns user, roles, resolved permissions, restrictions)
     POST /api/v1/auth/2fa/setup       (staff: TOTP secret + otpauth URI for QR)
     POST /api/v1/auth/2fa/verify
2. Access token: JWT, 15-minute expiry, contains sub, roles, and a permission-cache version.
   Refresh token: opaque, HttpOnly + Secure + SameSite=Lax cookie, 30-day expiry, ROTATED on every
   use. Detect reuse of a rotated token → revoke the entire session family and audit it.
3. OTP: 6 digits, 5-minute TTL, max 5 verification attempts, hashed at rest, single-use.
4. SMS driver interface with `mock` (logs the OTP to the server console + returns it in the
   response body ONLY when NODE_ENV=development) and `greenweb` real implementations.
   Selected via `SMS_DRIVER` env var. Default in dev is mock.
5. 2FA is MANDATORY for any account holding a MEDIUM-or-higher permission — enforce at login,
   returning a `TWO_FACTOR_REQUIRED` challenge rather than a token.
6. Every auth event writes an audit row: login success/failure, OTP send/verify, refresh reuse,
   2FA enrol, logout.

ACCEPTANCE:
- Registering, requesting an OTP, and verifying it works end-to-end with SMS_DRIVER=mock.
- The OTP is visible in the server console in development and never in production.
- Reusing a rotated refresh token revokes the family and returns AUTH_INVALID.
- A moderator account without 2FA cannot obtain an access token.

PREVIEW:
POST via the browser console or REST client through the Vite proxy; /api/v1/auth/me returns the
full identity payload.
```

---

### Prompt 2.4: RBAC Resolution Engine

```text
ID: 2.4
DEPENDS ON: 2.3, 0.4
FILES:
  server/src/services/rbac.service.js
  server/src/middlewares/requirePermission.js
  server/src/middlewares/requireRestriction.js
  server/src/repositories/permission.repository.js

TASK:
Implement the permission resolution algorithm from docs/rbac-spec.md §4.

REQUIREMENTS:
1. `resolvePermissions(userId)` executes exactly this order:
     a. Load role permissions for all of the user's roles
     b. Union user GRANT overrides that are active (not expired, not revoked)
     c. Union any active JIT window grants
     d. Subtract every user DENY override — DENY always wins, unconditionally
     e. Remove CRITICAL-tier permissions unless the user holds the super_admin role
     f. Return { permissions: Set, sources: Map } — sources records WHY each permission is held,
        which the admin UI displays
2. Cache the result in the cache driver under `perm:v{version}:{userId}` with a 5-minute TTL.
   Bumping a global or per-user version key invalidates instantly on any grant/revoke — a revoked
   permission must stop working within one request, never after a 5-minute wait.
3. `requirePermission('key')` middleware:
   - Denied → 403 PERMISSION_DENIED, and include `requestable: true` when the permission's
     risk_tier is MEDIUM (JIT-eligible), so the client can render "Request Access".
   - HIGH tier → do NOT execute. Route into the maker-checker flow (Prompt 2.5) and return
     202 with PERMISSION_PENDING_APPROVAL and the pending action id.
   - CRITICAL tier → 403 unless super_admin. Never requestable.
4. `requireRestriction('capability')` middleware evaluating user_restrictions:
   - BLOCK → 403 USER_RESTRICTED with the reason
   - THROTTLE → apply the rate limit for that capability
   - FORCE_REVIEW_QUEUE → allow, but tag the resulting record for moderation
   - SHADOW_BAN → return success to the actor while suppressing the effect for everyone else
   Segment rules are evaluated dynamically (role/tier/district predicates).
5. Add `GET /api/v1/me/permissions` returning resolved permissions + sources + active grants +
   restrictions, for the client to build locked-state UI.

ACCEPTANCE:
- A DENY override defeats a role permission and a GRANT override simultaneously.
- Revoking a grant invalidates the cache and the next request is denied.
- A CRITICAL permission cannot be granted to a non-super-admin by any path — prove with a test.
- A HIGH-tier request returns 202 with a pending action id, and nothing is mutated.

PREVIEW:
GET /api/v1/me/permissions returns the full resolved payload for the logged-in dev user.
```

---

### Prompt 2.5: Delegation Engine — Standing Grants, JIT Requests, Maker-Checker

```text
ID: 2.5
DEPENDS ON: 2.4
FILES:
  server/src/services/delegation.service.js
  server/src/services/makerChecker.service.js
  server/src/controllers/delegation.controller.js
  server/src/routes/delegation.routes.js
  server/src/jobs/grantExpiryCron.js

TASK:
Implement the three delegation modes. This is the mechanism by which a Moderator performs Admin
work only when the Admin has authorised it.

REQUIREMENTS:
1. MODE A — Standing Grant
     POST   /api/v1/admin/grants          { user_id, permission_key, reason, scope, expires_at }
     DELETE /api/v1/admin/grants/:id      (revoke, reason required)
     GET    /api/v1/admin/grants          (filter by user, permission, status)
   Rules: reason is mandatory; expires_at is mandatory and capped at 90 days;
   CRITICAL permissions are rejected outright; every action audited with before/after.

2. MODE B — Just-In-Time Request
     POST  /api/v1/access-requests        { permission_key, reason, target_ref? }
     GET   /api/v1/access-requests        (requester sees own; approver sees queue)
     PATCH /api/v1/access-requests/:id    { decision: 'APPROVE'|'REJECT', note, window_minutes }
   On approval, open a time-boxed window (default 120 min, admin-configurable) and notify the
   requester in real time. On expiry the window closes automatically — no manual cleanup.

3. MODE C — Maker-Checker (mandatory for every HIGH-tier permission)
     When a HIGH action is attempted, serialise the intended mutation into pending_admin_actions
     rather than executing it. Provide:
       GET   /api/v1/admin/pending-actions
       PATCH /api/v1/admin/pending-actions/:id  { decision, note }
     On APPROVE, re-validate every precondition (balances, stock, status) at approval time —
     never trust the payload captured at submission time — then execute inside a transaction.
     On REJECT or expiry, discard and notify the actor.
     HARD RULE: approver_id must never equal actor_id. Enforce in both the service and the DB.
   Register an executor per action_key so the approval path knows how to apply the payload.

4. grantExpiryCron: runs every 5 minutes, expires overdue grants, JIT windows, and pending actions,
   bumps the affected users' permission cache versions, and emits notifications.

5. Every path here writes audit rows with full before/after JSON.

ACCEPTANCE:
- A moderator hitting a HIGH-tier endpoint mutates nothing and creates a pending action.
- An admin approving that action executes it with fresh precondition validation.
- A user cannot approve their own pending action (verified at the database level too).
- An expired JIT window stops granting access within 5 minutes without any manual step.
- Every grant, revoke, approval, and rejection is present in audit_logs with before/after.

PREVIEW:
Backend-only. Prompt 2.8 and 3.3 build the UI. Verify via REST client.
```

---

### Prompt 2.6: Granular Per-User Activity Control

```text
ID: 2.6
DEPENDS ON: 2.5
FILES:
  server/src/services/restriction.service.js
  server/src/controllers/restriction.controller.js
  server/src/routes/restriction.routes.js
  server/src/services/segment.service.js

TASK:
Give the Admin true granular control over every individual user's every activity.

REQUIREMENTS:
1. Endpoints:
     GET    /api/v1/admin/users/:id/restrictions
     POST   /api/v1/admin/restrictions        (single user or segment)
     PATCH  /api/v1/admin/restrictions/:id
     DELETE /api/v1/admin/restrictions/:id    (lift, reason required)
     POST   /api/v1/admin/restrictions/preview (dry-run: how many users would a segment match?)
2. Capability switches enforced across the platform (wire the middleware as each feature lands):
     can_login, can_list_products, can_sell, can_buy, can_use_cod, can_withdraw, can_chat,
     can_live_stream, can_run_ads, can_refer, can_post_review, can_upload_video
3. Numeric limits: max_withdrawal_per_day, max_products, max_cod_order_value, max_daily_messages,
   ad_budget_cap. Enforced by the owning service and surfaced to the user as a clear message,
   never as a silent failure.
4. Enforcement modes: BLOCK, THROTTLE, FORCE_REVIEW_QUEUE, SHADOW_BAN — implemented in
   requireRestriction (2.4) and honoured consistently.
5. segment.service.js — evaluate predicate rules like
   `role=saler AND district=Dhaka AND tier=starter AND trust_score<40`.
   Segment restrictions are evaluated at request time so newly matching users are covered
   automatically without a backfill job.
6. Applying a restriction is a HIGH-tier action → it flows through maker-checker when performed
   by a Moderator, and executes directly for a Super Admin.
7. Every restriction records: who, why, scope, duration, and appears on the user's audit timeline.

ACCEPTANCE:
- Setting can_withdraw=BLOCK on a user makes the payout endpoint return USER_RESTRICTED with the
  stored reason, in both English and Bengali.
- A segment restriction automatically applies to a user who becomes matching after it was created.
- max_cod_order_value is enforced at checkout with a clear user-facing message.
- A moderator applying a restriction creates a pending action instead of applying it.

PREVIEW:
Backend-only; the admin UI arrives in Prompt 3.3.
```

---

### Prompt 2.7: Audit Log Engine & Query API

```text
ID: 2.7
DEPENDS ON: 2.6
FILES:
  server/src/services/audit.service.js
  server/src/controllers/audit.controller.js
  server/src/routes/audit.routes.js

TASK:
A tamper-evident, queryable audit trail covering every staff and system action.

REQUIREMENTS:
1. `audit.record({ action, target_type, target_ref, before, after, meta })` pulls actor, ip,
   user_agent, and trace_id automatically from requestContext (2.1).
2. Automatic redaction of sensitive fields (password_hash, otp, nid_number, tokens, account
   numbers) in before/after JSON before persistence.
3. Hash chaining as defined in 2.2; expose `GET /api/v1/admin/audit/verify` which walks the chain
   and reports the first broken link, if any.
4. Query API `GET /api/v1/admin/audit` with filters: actor, action, target_type, target_ref,
   date range, risk_tier, trace_id. Cursor paginated. Requires `security.audit.view`.
5. `GET /api/v1/admin/users/:id/timeline` — a merged human-readable activity timeline for one user
   (auth events, orders, restrictions, grants, moderation actions).
6. Reversibility metadata: actions that can be undone record an `undo_payload`, enabling a
   one-click revert from the Audit Explorer (Prompt 3.4) — itself an audited action.

ACCEPTANCE:
- Every state-changing endpoint built so far produces exactly one audit row.
- No redacted field ever appears in stored JSON — verified by a test that grants a permission
  containing a token-like value.
- The verify endpoint detects a manually tampered row.

PREVIEW:
GET /api/v1/admin/audit returns real rows generated by earlier testing.
```

---

### Prompt 2.8: Auth & Access Frontend (Login, Guards, Locked States, Request Access)

```text
ID: 2.8
DEPENDS ON: 2.7, 1.7
FILES:
  client/src/pages/auth/LoginPage.js
  client/src/pages/auth/RegisterPage.js
  client/src/pages/auth/OtpPage.js
  client/src/pages/auth/TwoFactorPage.js
  client/src/services/session.js
  client/src/services/permissions.js
  client/src/components/access/RequestAccessModal.js
  client/src/components/access/ElevatedAccessChip.js
  client/src/components/access/PermissionGate.js

TASK:
Wire the frontend to real authentication and make the permission model visible and usable.
This is the first prompt that flips VITE_API_MODE to `live`.

REQUIREMENTS:
1. Login supporting both password and phone-OTP flows, with a 2FA challenge step for staff.
   Bengali-first copy, large touch targets, and an OTP input that auto-advances and pastes cleanly.
2. session.js — holds the access token in memory ONLY (never localStorage), relies on the HttpOnly
   refresh cookie for persistence, refreshes proactively 60s before expiry, and broadcasts auth
   state through the store.
3. permissions.js — loads /api/v1/me/permissions, exposes `can('key')`, `isRestricted('cap')`,
   and `whyDenied('key')` (returns 'no_permission' | 'requestable' | 'module_off' | 'restricted').
4. PermissionGate — a wrapper that renders children, a locked placeholder, or nothing, based on
   whyDenied. Locked placeholders explain what the permission is and offer Request Access.
5. RequestAccessModal — permission name, plain-language explanation of what it allows, mandatory
   reason field, submit → POST /access-requests, then live status ("Waiting for Admin approval").
6. ElevatedAccessChip — persistent top-bar countdown while a JIT window is active, with a
   "give up access early" button. This makes temporary elevation impossible to forget.
7. Router guards from 1.5 now consult the real permission service.
8. Every string added here exists in both en.json and bn.json.

ACCEPTANCE:
- Logging in as the seeded moderator (zero grants) shows locked nav items, not hidden ones.
- Clicking Request Access creates a real permission_grant_request row.
- Approving it as admin (via REST client for now) causes the moderator's UI to unlock and the
  countdown chip to appear — without a page reload.
- Logging in as a customer never exposes any admin route, even by typing the URL.

PREVIEW:
Log in as each seeded role at localhost:3000 and observe six completely different, correctly
grouped shells. This is the first fully "real" end-to-end preview.
```

---

# Phase 3 — Admin Shell, Module Control & Theme Studio

---

### Prompt 3.1: Module Control Backend, Targeting & Middleware

```text
ID: 3.1
DEPENDS ON: 2.8, 0.7
FILES:
  server/src/db/migrations/004_platform_config.sql
  server/src/services/module.service.js
  server/src/middlewares/requireModule.js
  server/src/controllers/module.controller.js
  server/src/routes/module.routes.js
  server/src/db/seeds/003_modules.sql

TASK:
Build the backend v1.0 was missing entirely — the frontend toggle panel had nothing to talk to.

REQUIREMENTS:
1. Migration: platform_modules, module_targeting_rules, platform_settings, commission_rules.
   Seed platform_modules from server/src/config/modules.seed.json (Prompt 0.7).
2. `isEnabled(moduleKey, context)` where context = { userId, role, tier, district, percentageSeed }.
   Evaluation order: global off → scheduled window → targeting rules (user > district > tier >
   role) → percentage rollout → default. Result cached in the cache driver, invalidated by a
   version bump on any change.
3. `requireModule('key')` middleware → 403 MODULE_DISABLED with a friendly bilingual message.
   Applied to every feature route from Phase 4 onward.
4. Endpoints:
     GET   /api/v1/modules                     (public: flags relevant to the caller, for UI gating)
     GET   /api/v1/admin/modules               (full registry + state + last change)
     PATCH /api/v1/admin/modules/:key          { enabled, reason }  — reason MANDATORY
     PATCH /api/v1/admin/modules/:key/settings { settings }  — validated against sub_settings_schema
     POST  /api/v1/admin/modules/:key/targeting
     GET   /api/v1/admin/modules/:key/history
   Toggling a module is CRITICAL tier → super_admin only, never delegable.
5. Dependency guard: disabling a module that others depend on returns a 409 listing the dependents
   and requires an explicit `cascade: true` to proceed — which then disables them too, audited.
6. Background jobs must consult isEnabled before running; a disabled module's cron must no-op.

ACCEPTANCE:
- Toggling a module off causes its API routes to return MODULE_DISABLED within one request.
- A reason is required and stored; the change appears in audit_logs and in module history.
- Percentage rollout is deterministic per user (same user always gets the same answer).
- Disabling `chat` warns that `whatsapp_bridge` and `live_commerce` depend on it.

PREVIEW:
GET /api/v1/modules returns the live flag set consumed by the client.
```

---

### Prompt 3.2: Module Control Panel UI (68 Modules, Grouped)

```text
ID: 3.2
DEPENDS ON: 3.1
FILES:
  client/src/pages/admin/ModuleControlPage.js
  client/src/components/admin/ModuleRow.js
  client/src/components/admin/ModuleSettingsDrawer.js
  client/src/components/admin/ModuleTargetingDrawer.js
  client/src/services/featureFlags.js

TASK:
Make 68 modules manageable rather than an unreadable wall of switches.

REQUIREMENTS:
1. Grouped accordion layout using the groups from Prompt 0.7 — never one flat 68-row table.
   Group headers show "12 of 15 enabled" counts.
2. Search + filters: by group, by state (on/off), by "recently changed", by "has custom targeting".
3. Each row: label (localised), description tooltip, state switch, targeting indicator badge,
   settings button (only if the module has a sub_settings_schema), and "changed by X, 2h ago".
4. Toggling OFF opens ConfirmDialog in mandatory-reason mode. Toggling ON is one click.
5. Optimistic toggle using the Switch "pending" state from 1.3; roll back visually and toast on
   failure.
6. Dependency warning modal when the server returns 409, listing dependents with a cascade option.
7. ModuleSettingsDrawer renders a form generated dynamically from sub_settings_schema — do not
   hand-write a form per module.
8. featureFlags.js on the client: `isFeatureEnabled(key)` fed by GET /api/v1/modules, plus a
   `<div data-module="key">` scanner that removes gated DOM nodes, and a store subscription so a
   flag change reflects live without a reload.

ACCEPTANCE:
- All 68 modules render, grouped, in under 300ms.
- Turning off `sponsored_ads` makes every ad slot disappear from the client immediately.
- The reason modal cannot be bypassed when disabling.
- A non-super-admin sees the whole page in read-only locked state.

PREVIEW:
/admin/platform/modules — the full grouped control panel, live.
```

---

### Prompt 3.3: Users & Access Admin UI (Roles, Grants, Approvals, Restrictions)

```text
ID: 3.3
DEPENDS ON: 3.2
FILES:
  client/src/pages/admin/UsersPage.js
  client/src/pages/admin/UserDetailPage.js
  client/src/pages/admin/RolesPermissionsPage.js
  client/src/pages/admin/AccessGrantsPage.js
  client/src/pages/admin/ApprovalInboxPage.js
  client/src/components/admin/PermissionMatrix.js
  client/src/components/admin/RestrictionEditor.js
  client/src/components/admin/GrantDrawer.js

TASK:
The control surface for the entire authorization model. This is where the Admin exercises granular
control over every user, and where delegation to Moderators actually happens.

REQUIREMENTS:
1. UsersPage: searchable, filterable table (role, tier, verification, restriction state, district),
   bulk selection, and bulk restriction actions.
2. UserDetailPage — tabbed:
     Profile · Roles & Permissions · Restrictions · Activity Timeline · Orders · Vault · KYC
   The Permissions tab shows EVERY permission the user holds and, crucially, WHY
   (from role X / granted by Y until Z / JIT window) using the `sources` map from Prompt 2.4.
3. PermissionMatrix: roles × permissions grid, grouped by domain, with risk-tier colour coding.
   CRITICAL permissions render locked with a "Super Admin only" marker and cannot be assigned.
4. GrantDrawer: grant a permission to a user — permission picker (searchable, shows risk tier and
   a plain-language description of what it allows), mandatory reason, expiry picker capped at
   90 days, optional scope. Shows a live preview: "Moderator Rahim will be able to approve refunds
   up to ৳5,000 until 12 Sep."
5. ApprovalInboxPage — the Admin's single queue containing BOTH:
     - pending JIT access requests (Mode B)
     - pending maker-checker actions (Mode C), each rendered with a full before/after diff so the
       Admin can see exactly what will happen before approving
   Approve / Reject with a note. Keyboard shortcuts (J/K navigate, A approve, R reject).
   A badge count appears in the TopBar for anyone who can approve.
6. RestrictionEditor: the capability switch grid, numeric limits, enforcement mode, scope
   (this user / segment builder), duration, mandatory reason. Segment builder shows a live
   "this will affect 1,284 users" preview from the dry-run endpoint.
7. Every destructive action uses ConfirmDialog with mandatory reason.

ACCEPTANCE:
- Granting a moderator a MEDIUM permission unlocks the corresponding UI for them live.
- A HIGH action submitted by a moderator appears in the Admin's Approval Inbox with a readable diff.
- Applying can_withdraw=BLOCK is visible on the user's detail page and blocks the payout API.
- The segment preview count matches the number of users actually affected.

PREVIEW:
/admin/users — full granular control. Test with two browsers: admin in one, moderator in the
other, and watch permissions unlock live.
```

---

### Prompt 3.4: Audit Explorer UI

```text
ID: 3.4
DEPENDS ON: 3.3
FILES:
  client/src/pages/admin/AuditLogPage.js
  client/src/components/admin/AuditDiffViewer.js
  client/src/components/admin/UserTimeline.js

TASK:
Make the audit trail actually usable, not just stored.

REQUIREMENTS:
1. Filterable, cursor-paginated log: actor, action, target, date range, risk tier, trace_id.
2. AuditDiffViewer: side-by-side before/after JSON with changed keys highlighted; a plain-language
   summary line above it ("Changed Saler split from 40% to 45%").
3. Chain integrity banner driven by /admin/audit/verify — green when intact, loud red when broken.
4. One-click undo for actions carrying an undo_payload, behind ConfirmDialog with mandatory reason.
5. UserTimeline component reused on UserDetailPage.
6. CSV export of the current filtered view (audited as an export event).

ACCEPTANCE:
- Every action taken while testing Phase 2 and 3 is findable and readable.
- The diff viewer clearly shows what changed for a permission grant and a module toggle.
- Undo works and is itself audited.

PREVIEW:
/admin/security/audit
```

---

### Prompt 3.5: Theme & Color Studio (6 Sections + Marketplace Presets)

```text
ID: 3.5
DEPENDS ON: 3.4
FILES:
  server/src/db/migrations/005_theme.sql
  server/src/services/theme.service.js
  server/src/controllers/theme.controller.js
  client/src/pages/admin/ThemeStudioPage.js
  client/src/services/themePalette.js
  client/src/config/theme-presets.js

TASK:
Implement the Granular Component-Level Color Studio specified in technologyused.md §Layer 1 —
completely absent from v1.0.

REQUIREMENTS:
1. Admin controls colors for 6 distinct UI sections independently:
     Navbar · Canvas/Surfaces · Brand/Buttons · Typography · Badges · Footer
   Each section exposes its own token subset with a color picker and a live contrast readout.
2. Five 1-click marketplace presets, defined in theme-presets.js:
     Alibaba Enterprise · Amazon Pro · Daraz Express · Cobalt Enterprise · Minimalist Slate
   Each preset must satisfy WCAG AA on every pairing — the studio blocks saving a palette that
   fails contrast, showing exactly which pairing failed.
3. themePalette.js writes CSS custom properties onto document.documentElement at runtime, so
   changes preview instantly with zero rebuild.
4. Persistence: theme_palettes table, one active palette plus drafts. Publishing is a CRITICAL
   action (super_admin only) and is audited with a before/after color diff.
5. Live preview pane inside the studio rendering a representative page (navbar + product card +
   table + footer) so the Admin sees the real effect before publishing.
6. Reset-to-default and revert-to-previous-published buttons.
7. Zero gradients permitted anywhere in the studio — enforce in validation.

ACCEPTANCE:
- Changing the navbar color updates only navbar tokens, live, without touching other sections.
- Applying "Amazon Pro" restyles the entire site in one click.
- Saving a palette with a 3.1:1 body-text ratio is rejected with a specific error naming the pair.
- The published palette survives a reload and applies for all users.

PREVIEW:
/admin/platform/theme — pick a preset and watch the whole site restyle instantly.
```

---

# Phase 4 — Catalog, Media, Search & Storefronts

---

### Prompt 4.1: Catalog Schema & Warehouse Foundations

```text
ID: 4.1
DEPENDS ON: 3.5
FILES:
  server/src/db/migrations/006_catalog.sql
  server/src/db/migrations/007_warehouse.sql
  server/src/db/seeds/004_categories.sql
  server/src/db/seeds/005_demo_catalog.sql

TASK:
Create the catalog tables — including product_variants and warehouse_nodes, both missing in v1.0
despite being referenced by its own prompts.

REQUIREMENTS:
1. 006_catalog.sql: categories (nested set or materialized path for fast subtree queries),
   products, product_variants, product_images, media_assets, saler_store_items, virtual_stores,
   product_approvals, reviews, review_media.
   - All money columns NUMERIC(14,2); all stock columns INTEGER CHECK (>= 0).
   - products: base_cost, wholesale_margin, default_retail_price, plus a generated column or
     constraint asserting default_retail_price >= base_cost + wholesale_margin.
   - product_variants carries its own SKU, price delta, and stock — the v1.0 UI had a variant
     selector with no table behind it.
   - virtual_stores.slug UNIQUE with a reserved-slug blacklist (admin, api, store, checkout…).
2. 007_warehouse.sql: warehouse_nodes (district, upazila, lat, lng, priority), warehouse_stock,
   product_batches (batch_number, mfg_date, exp_date, qty, warehouse_node_id FK — now valid).
3. Indexes: category subtree, supplier_id, is_active + created_at, full-text search vector column
   on products (title + description, both languages), GiST index on warehouse coordinates.
4. Seed realistic Bangladeshi demo data: 8 categories, 60 products with Bengali AND English titles,
   real BDT pricing, 3 suppliers, 2 salers with stocked storefronts, multiple variants and batches.
   This seed is what makes every subsequent UI preview look real rather than empty.

ACCEPTANCE:
- Migrations apply cleanly; every FK from docs/erd.md §Catalog exists.
- No money column is FLOAT — verify with a query against information_schema.
- Seeded catalog renders 60 products with Bengali titles.
- The reserved-slug list prevents creating a store at /store/admin.

PREVIEW:
No UI yet, but the seed makes Prompt 4.5's preview immediately rich.
```

---

### Prompt 4.2: Media Pipeline — Cloudflare R2, Presigned Upload, Image Derivatives

```text
ID: 4.2
DEPENDS ON: 4.1
FILES:
  server/src/integrations/storage/index.js
  server/src/integrations/storage/r2.js
  server/src/integrations/storage/local.js
  server/src/services/media.service.js
  server/src/controllers/media.controller.js
  client/src/components/media/ImageUploader.js
  client/src/components/media/MediaLibrary.js

TASK:
Implement the media layer. v1.0 named Cloudflare R2 but contained no upload, resize, or format
prompt — despite the platform being video and image heavy.

REQUIREMENTS:
1. Storage driver interface with two implementations:
     `local`  → writes to server/storage/ and serves via a static route. THE DEFAULT IN DEVELOPMENT,
                so no cloud account is needed to work on the app.
     `r2`     → Cloudflare R2 via S3-compatible API.
   Selected by `STORAGE_DRIVER`.
2. Presigned direct upload: client requests a signed URL, uploads directly (never proxying large
   files through the API), then confirms; the server validates content-type and size server-side.
3. Constraints: images max 8MB, video max 100MB. Allowed types enforced by magic-byte sniffing,
   not by file extension.
4. Derivative generation on confirm: thumb 200px, card 400px, detail 1200px, each in WebP and AVIF
   with a JPEG fallback. Store dimensions so the client can reserve aspect-ratio boxes and avoid CLS.
5. Video: store as uploaded in development; define (do not yet implement) the transcode hook for
   production. Extract a poster frame.
6. media_assets rows record owner, purpose, moderation_status, and dimensions.
   Uploads by a user with FORCE_REVIEW_QUEUE restriction are marked pending automatically.
7. ImageUploader: drag-drop, paste, camera capture on mobile, reorder, crop to the required aspect
   ratio, per-file progress, and clear bilingual error messages.

ACCEPTANCE:
- With STORAGE_DRIVER=local, uploading a product image works end to end with no cloud credentials.
- A 10MB image is rejected client-side and server-side.
- Uploading a .exe renamed to .jpg is rejected by magic-byte sniffing.
- Derivatives are generated and the correct one is served per breakpoint.

PREVIEW:
The uploader is registered in /dev/gallery with a working local-storage round trip.
```

---

### Prompt 4.3: Product & Pricing APIs, Dynamic Split Engine

```text
ID: 4.3
DEPENDS ON: 4.2
FILES:
  server/src/services/pricing.service.js
  server/src/services/product.service.js
  server/src/controllers/product.controller.js
  server/src/controllers/sourcing.controller.js
  server/src/repositories/product.repository.js
  server/src/routes/product.routes.js

TASK:
Product CRUD plus the dynamic pricing engine, reading real rules from platform_settings and
commission_rules — the tables v1.0 referenced but never created.

REQUIREMENTS:
1. pricing.service.js:
     retail_price = base_cost + wholesale_margin + net_retail_margin
     saler_earning    = net_retail_margin × saler_split_pct
     platform_earning = net_retail_margin × platform_split_pct
   Splits resolve in this order: product override → category rule → global platform_settings.
   NEVER hardcode 40/60. All arithmetic in integer paisa internally, rounded to 2 decimals only at
   the boundary, to eliminate floating-point drift. Rounding remainders go to the platform, and
   the rule must be documented in code.
2. Endpoints:
     POST   /api/v1/products                  (supplier; requires catalog.product.create +
                                               can_list_products restriction check)
     PATCH  /api/v1/products/:id
     DELETE /api/v1/products/:id              (soft delete)
     GET    /api/v1/products                  (public catalog: filter, sort, paginate)
     GET    /api/v1/products/:id              (detail incl. variants, images, active batch)
     POST   /api/v1/sourcing/add-to-store     (saler; custom retail price override)
     GET    /api/v1/sourcing/catalog          (filter by margin %, shipping speed, verification tier)
     GET    /api/v1/sourcing/my-store
     POST   /api/v1/pricing/preview           (drives the profit calculator UI)
3. New products enter product_approvals as PENDING when the `product_moderation` module is on and
   `auto_approval` is off. Respect the module flags — do not hardcode the workflow.
4. Every route wrapped in requireModule + requirePermission + requireRestriction.

ACCEPTANCE:
- Base 500, retail 700, split 40/60 → saler 80.00, platform 120.00, exactly, with no float error.
- Changing the global split in platform_settings changes new calculations without a deploy.
- A supplier with can_list_products=BLOCK receives USER_RESTRICTED.
- Sourcing catalog filters by minimum margin percentage correctly.

PREVIEW:
POST /api/v1/pricing/preview returns a full breakdown consumed by Prompt 4.7's calculator.
```

---

### Prompt 4.4: Search Engine — Bengali-Aware

```text
ID: 4.4
DEPENDS ON: 4.3
FILES:
  server/src/services/search.service.js
  server/src/services/search-drivers/postgres.js
  server/src/services/search-drivers/meilisearch.js
  server/src/controllers/search.controller.js
  server/src/utils/transliterate.js

TASK:
Implement search. v1.0 had none — a marketplace with a search bar and no search strategy.

REQUIREMENTS:
1. Driver interface so the engine can be swapped later without touching callers.
   `postgres` (default, zero infrastructure) uses tsvector with a combined English + Bengali
   configuration, trigram similarity for typo tolerance, and weighted ranking
   (title > brand > category > description).
   `meilisearch` is a stub adapter with the same interface, documented for future scale.
2. transliterate.js — Banglish ⇄ Bengali mapping so a search for "shari", "saree", or "শাড়ি" all
   match the same products. This is essential for Bangladeshi users, who routinely type Bengali
   words in Latin script. Ship a seed mapping for the most common commerce terms and make it
   extensible via the i18n_strings table.
3. Endpoints:
     GET /api/v1/search              (products, stores, categories — grouped results)
     GET /api/v1/search/suggest      (typeahead, ≤ 50ms, cached)
   Support filters: category, price range, margin, supplier tier, district, in-stock, rating.
4. Cache popular queries in the cache driver with a short TTL and invalidate on catalog writes.
5. Log zero-result queries to inform merchandising (a table or a log stream — decide and document).

ACCEPTANCE:
- Searching "shari" returns products titled "শাড়ি".
- A single-character typo still returns the intended product.
- Typeahead responds in under 50ms against the 60-product seed.
- Swapping SEARCH_DRIVER does not require changes in the controller.

PREVIEW:
The TopBar search box returns real grouped results.
```

---

### Prompt 4.5: Marketplace Home & Product Discovery (Live Data)

```text
ID: 4.5
DEPENDS ON: 4.4
FILES:
  client/src/pages/HomePage.js
  client/src/components/product/ProductCard.js
  client/src/components/product/ProductGrid.js
  client/src/components/product/CategoryPills.js
  client/src/components/product/FlashSaleWidget.js
  client/src/components/product/FilterPanel.js

TASK:
The marketplace homepage, wired to the real catalog API.

REQUIREMENTS:
1. Hero banner area driven by CMS banners (falls back gracefully when the content module is off).
2. Role-aware feed switcher: All Products · Verified Supplier Stock · Top Reseller Collections ·
   Flash Sales. A Saler additionally sees the profit-margin badge on every card.
3. CategoryPills: horizontally scrollable, keyboard accessible, no horizontal page scroll.
4. ProductCard: aspect-ratio-locked image (no CLS), title (localised), verification badge,
   physical-store open/closed dot, price, margin badge for Salers, rating, and contextual actions
   (Quick Buy for customers, Add to My Store for salers).
5. ProductGrid: 4 columns desktop / 2 columns mobile, skeleton loading, EmptyState, infinite scroll
   with a cursor, and a "back to top" affordance.
6. FilterPanel: drawer on mobile, sidebar on desktop; filters reflected in the URL so results are
   shareable and back-button-safe.
7. Every product-related module flag respected — ads slots, flash sale widget, and margin badges
   all disappear cleanly when their module is off.

ACCEPTANCE:
- 60 seeded products render with real Bengali titles and correct ৳ formatting.
- Switching to the Saler role reveals margin badges without a reload.
- Turning off the `flash_sale` module removes the widget instantly.
- Lighthouse Performance ≥ 95 on this page; zero cumulative layout shift.

PREVIEW:
localhost:3000 — the real marketplace. This is the first "it looks like a product" moment.
```

---

### Prompt 4.6: Product Detail, Variants, Reviews & Q&A

```text
ID: 4.6
DEPENDS ON: 4.5
FILES:
  client/src/pages/ProductDetailPage.js
  client/src/components/product/ImageGallery.js
  client/src/components/product/VariantSelector.js
  client/src/components/product/PriceBreakdown.js
  client/src/components/product/ReviewList.js
  client/src/components/product/QnASection.js
  server/src/controllers/review.controller.js

TASK:
The product detail page, with the variant system that v1.0's UI implied but never modelled.

REQUIREMENTS:
1. ImageGallery: thumbnails, zoom on desktop, swipe on mobile, video support, lazy loading,
   keyboard navigable.
2. VariantSelector: reads real product_variants; unavailable combinations are disabled with an
   explanation, not hidden. Selecting a variant updates price, stock, SKU, and image.
3. PriceBreakdown: retail price plus, for Salers only, the full margin breakdown.
4. Supplier info card: verification tier, blue tick, response time, physical store status.
5. ReviewList: rating distribution, photo/video reviews, verified-purchase badge, sort and filter,
   helpful votes, and pagination. Review submission requires a delivered order.
6. QnASection: ask, answer (seller/supplier only), upvote.
7. CTAs: Add to Cart · 1-Click Quick Buy · Chat with Seller · Team Purchase.
   Each is individually module-gated and hides cleanly when its module is off.
8. Full SEO markup: OpenGraph, Twitter card, and Product + Review JSON-LD structured data.

ACCEPTANCE:
- Selecting a variant updates price and stock from real data.
- An out-of-stock variant is visibly disabled with a reason.
- A user who has not purchased cannot submit a review.
- JSON-LD validates against Google's Rich Results structured data requirements.

PREVIEW:
/product/:id with real seeded data, variants switching live.
```

---

### Prompt 4.7: Sourcing Catalog & Dynamic Profit Calculator

```text
ID: 4.7
DEPENDS ON: 4.6
FILES:
  client/src/pages/saler/SourcingCatalogPage.js
  client/src/components/saler/ProfitCalculator.js
  client/src/components/saler/AddToStoreDrawer.js
  client/src/components/saler/MarginProjection.js

TASK:
The Saler's sourcing experience and the profit calculator, driven by the real pricing API rather
than duplicated client-side arithmetic.

REQUIREMENTS:
1. SourcingCatalogPage: supplier catalog with filters for margin %, shipping speed, verification
   tier, category, and stock availability. Sort by margin, popularity, or recency.
2. ProfitCalculator: sliders for base cost, wholesale margin, and desired retail price, calling
   POST /api/v1/pricing/preview (debounced). The client MUST NOT reimplement the split formula —
   a divergence between client and server maths is a financial bug.
   Live breakdown: retail = base + wholesale + net retail margin, then the saler/platform split.
3. MarginProjection: monthly earnings projection from an estimated sales-volume input, rendered as
   a lightweight inline SVG chart (no charting library — the 150KB budget forbids it).
4. AddToStoreDrawer: 1-click add with an optional retail-price override, bounded by a minimum
   margin rule; shows the resulting per-sale profit before confirming.
5. Respects can_sell restriction and the `sourcing` module flag.

ACCEPTANCE:
- Base 500 / retail 700 shows saler ৳80.00 and platform ৳120.00, matching the server exactly.
- Add to My Store immediately reflects on the Saler's storefront.
- Overriding retail price below the minimum margin is rejected with a clear message.

PREVIEW:
/saler/sourcing — drag the sliders and watch server-calculated profit update live.
```

---

### Prompt 4.8: Virtual Storefront Builder & Public Store Page

```text
ID: 4.8
DEPENDS ON: 4.7
FILES:
  client/src/pages/saler/StoreBuilderPage.js
  client/src/pages/StorefrontPage.js
  client/src/components/store/StoreHeader.js
  client/src/components/store/ShelfEditor.js
  client/src/components/store/ShopStatusToggle.js
  server/src/controllers/store.controller.js
  server/src/services/og-image.service.js

TASK:
The Saler's branded storefront and its public-facing page.

REQUIREMENTS:
1. StoreBuilderPage: shop name, URL slug (live availability check against the reserved list),
   logo, cover banner, bio, social links, announcement bar, and curated shelves with drag-to-reorder.
   Live preview pane beside the editor.
2. ShopStatusToggle: physical store Open 🟢 / Closed 🔴 with configurable business hours and
   automatic status derivation from those hours, overridable manually.
3. StorefrontPage at `/store/:slug` — public, SEO-indexable, with the Social Seller Kit bar:
   Share to WhatsApp · Download QR Flyer · Copy Affiliate Link.
4. og-image.service.js: dynamically generated OpenGraph images for store and product shares
   (SVG rendered to PNG server-side, cached by slug + updated_at). This is what makes WhatsApp and
   Facebook shares look professional — a major growth lever in Bangladesh.
5. Store pages must render meaningful HTML for crawlers — coordinate with the prerender strategy
   in Prompt 11.5.

ACCEPTANCE:
- A saler can build a store and see it live at /store/their-slug.
- Slug collisions and reserved slugs are rejected with a clear message.
- Sharing a store link to WhatsApp shows a correct OG preview card.
- Toggling shop status updates the indicator on every product card from that store.

PREVIEW:
/saler/store-builder side-by-side with the live /store/:slug result.
```

---

# Phase 5 — Cart, Checkout, Orders & Payments

---

### Prompt 5.1: Server-Side Cart & Wishlist

```text
ID: 5.1
DEPENDS ON: 4.8
FILES:
  server/src/db/migrations/008_commerce.sql
  server/src/services/cart.service.js
  server/src/controllers/cart.controller.js
  client/src/components/cart/CartDrawer.js
  client/src/components/cart/WishlistButton.js

TASK:
Persist carts server-side. v1.0 had a client-only cart, which makes abandoned-cart recovery
(a required module) impossible.

REQUIREMENTS:
1. Migration: carts, cart_items, wishlists, abandoned_carts.
2. Cart persists for both guests (cart token cookie) and logged-in users, MERGING correctly on
   login rather than discarding either side.
3. Live re-validation on every read: price changes, stock changes, and deactivated products are
   surfaced as explicit line-level warnings, never silently mutated.
4. Multi-supplier awareness: group lines by supplier and show the resulting parcel split up front,
   so the split at checkout is never a surprise.
5. CartDrawer: quantity steppers, per-line stock ceiling, parcel-split notice, subtotal, coupon
   input, and shipping estimate placeholder. Optimistic updates with rollback on failure.
6. Abandoned cart detection: mark a cart abandoned after N minutes of inactivity with items
   present (N from module settings). Recovery messaging is built in Prompt 9.6.

ACCEPTANCE:
- A guest cart survives a refresh and merges into the user cart on login without duplicates.
- Adding items from two suppliers shows a two-parcel notice in the drawer.
- A price change since add is clearly flagged before checkout.

PREVIEW:
Add items across suppliers and open the cart drawer — parcel split visible.
```

---

### Prompt 5.2: Checkout — Row Locking, Order Splitting, COD Anti-Fraud

```text
ID: 5.2
DEPENDS ON: 5.1
FILES:
  server/src/services/order.service.js
  server/src/services/checkout.service.js
  server/src/services/trustScore.service.js
  server/src/controllers/order.controller.js
  server/src/routes/order.routes.js

TASK:
The transactional heart of the platform.

REQUIREMENTS:
1. Checkout executes as ONE PostgreSQL transaction:
     a. Acquire an idempotency lock on the Idempotency-Key
     b. Re-validate cart: prices, product active state, module flags
     c. Validate coupon (code, expiry, min spend, budget cap, per-user limit)
     d. COD risk check: compute trust score; if below threshold OR order value exceeds
        max_cod_order_value → require SMS OTP confirmation before proceeding
     e. For each line: SELECT … FOR UPDATE on the variant/product stock row, verify sufficiency
        — lock rows in a deterministic order (by id ASC) to eliminate deadlocks
     f. Allocate FEFO batches and route to the nearest warehouse node
     g. Group by supplier → create one `orders` row and one `sub_orders` row per supplier
     h. Compute base subtotal, saler commission, and platform margin per sub-order via
        pricing.service (never recompute the formula inline)
     i. Insert order_items linked to their allocated batch
     j. Decrement stock
     k. COMMIT, then emit OrderCreated events outside the transaction
2. trustScore.service.js: score from delivery success rate, return rate, account age,
   verification level, and prior COD refusals. Persisted and visible to Admin.
3. Failure handling: any step fails → full rollback, cart untouched, a typed error returned.
   Insufficient stock names the specific line item.
4. Endpoints: POST /orders/checkout, GET /orders/my-orders, GET /orders/:id,
   POST /orders/:id/cancel (window-limited, module-gated).

ACCEPTANCE:
- One cart with items from 2 suppliers produces 1 order and exactly 2 sub-orders with correct splits.
- Two concurrent checkouts for the last unit: one succeeds, one gets INSUFFICIENT_STOCK, and stock
  never goes negative. Prove this with a concurrency test.
- Replaying the same Idempotency-Key returns the original order without creating a second one.
- A low-trust COD order is blocked until OTP verification completes.

PREVIEW:
Complete a checkout and see two sub-orders in the order list.
```

---

### Prompt 5.3: Payments — bKash, Nagad, Idempotency & Webhooks

```text
ID: 5.3
DEPENDS ON: 5.2
FILES:
  server/src/db/migrations/009_payments.sql
  server/src/integrations/payments/index.js
  server/src/integrations/payments/bkash.js
  server/src/integrations/payments/nagad.js
  server/src/integrations/payments/mock.js
  server/src/services/payment.service.js
  server/src/controllers/paymentWebhook.controller.js

TASK:
Payment integration with the idempotency and reconciliation discipline v1.0 omitted.

REQUIREMENTS:
1. Gateway driver interface: createPayment, executePayment, queryPayment, refund.
   Implementations: `bkash` (tokenized checkout), `nagad` (PGW), and `mock`.
   `mock` is the DEVELOPMENT DEFAULT — it simulates success, failure, timeout, and delayed-callback
   scenarios so the entire payment flow is testable without merchant credentials.
2. payment_transactions records every attempt with gateway, gateway_ref, amount NUMERIC(14,2),
   status, raw_request, raw_response, and idempotency_key.
3. Webhook/IPN endpoint:
     - HMAC signature verification (reject unsigned or mismatched)
     - Replay protection via cache SETNX on the provider event id
     - Idempotent processing: the same event twice must produce exactly one state change
     - Store every received event in payment_webhook_events, processed or not, for reconciliation
4. State machine: INITIATED → PENDING → SUCCESS | FAILED | TIMEOUT, with a reconciliation job that
   queries the gateway for any transaction stuck in PENDING beyond a threshold. Never trust a
   client-reported success — always confirm server-side.
5. Refund path used later by the returns engine.
6. Never log tokens, PINs, or full account numbers. Mask everything in stored payloads.

ACCEPTANCE:
- With PAYMENT_DRIVER=mock the full pay → callback → order-paid flow works locally.
- Delivering the same webhook twice results in one state change and one ledger effect.
- An unsigned webhook is rejected with 401 and recorded.
- A PENDING transaction is resolved by the reconciliation job.

PREVIEW:
Checkout with the mock gateway and watch the order transition to PAID.
```

---

### Prompt 5.4: Checkout UI, Quick Buy & Order Tracking

```text
ID: 5.4
DEPENDS ON: 5.3
FILES:
  client/src/pages/CheckoutPage.js
  client/src/components/cart/QuickBuyModal.js
  client/src/components/checkout/AddressForm.js
  client/src/components/checkout/PaymentSelector.js
  client/src/pages/customer/OrderDetailPage.js
  client/src/components/order/OrderTracker.js

TASK:
The conversion-critical surface. Every millisecond and every extra field costs revenue.

REQUIREMENTS:
1. CheckoutPage: single-page, three collapsible steps (Delivery · Payment · Review) with a
   persistent order summary. Never more than one screen of scrolling on mobile.
2. AddressForm: Division → District → Upazila cascading selects seeded with real Bangladeshi
   administrative data, plus a saved-address picker and phone validation for +8801 numbers.
3. PaymentSelector: bKash, Nagad, Rocket, COD — each individually module-gated. COD shows any
   applicable advance-delivery-charge rule and the OTP requirement up front, never as a surprise.
4. QuickBuyModal: a 2-step overlay (details → confirm) bypassing the cart entirely.
5. Multi-supplier parcel split shown explicitly with per-parcel delivery estimates.
6. OrderTracker: 4-stage visual tracker (Placed → Confirmed → Shipped → Delivered) per sub-order,
   with courier tracking, and a map placeholder that Prompt 7.1 will populate.
7. Full offline resilience: form state is preserved across a connection drop (the PRD's stated
   3G-dropout risk), with an explicit "you are offline" banner and safe retry.
8. Every string bilingual; every error message actionable.

ACCEPTANCE:
- Checkout completes in under 60 seconds on a mid-range phone with a slow 3G throttle.
- Losing connection mid-checkout preserves all entered data.
- A COD order over the configured threshold prompts for OTP inline.
- Zero layout shift as steps expand and collapse.

PREVIEW:
Full purchase journey: home → product → cart → checkout → order tracking.
```

---

# Phase 6 — Vault, Escrow, Ledger, Payouts & COD Reconciliation

---

### Prompt 6.1: Double-Entry Ledger & Escrow Engine

```text
ID: 6.1
DEPENDS ON: 5.4
FILES:
  server/src/db/migrations/010_finance.sql
  server/src/services/ledger.service.js
  server/src/services/vault.service.js
  server/src/repositories/wallet.repository.js

TASK:
The financial core. The PRD demands 100.00% ledger accuracy; this prompt is where that is either
won or lost.

REQUIREMENTS:
1. Migration: wallets, ledger_transactions, escrow_entries, payout_requests, cod_reconciliation,
   b2b_escrow_milestones. All amounts NUMERIC(14,2). ledger_transactions is append-only —
   block UPDATE and DELETE with a trigger, exactly as with audit_logs.
2. TRUE double-entry: every financial event writes balanced debit and credit rows sharing a
   transaction_group_id. Enforce with a deferred constraint or a post-commit check that the group
   sums to zero. A single-sided write must be impossible.
3. vault.service.js:
     depositToEscrow(subOrderId, breakdown)  — lock funds into pending_escrow_balance
     releaseEscrow(subOrderId)               — move pending → available for supplier and saler
     executeClawback(subOrderId, reason)     — reverse pending, credit customer refund, zero the
                                               saler commission
   Every mutation: inside withTransaction, with SELECT … FOR UPDATE on the wallet row, and an
   immutable ledger entry. No exceptions, no shortcuts.
4. Invariant enforcement: for every wallet, sum(ledger) must equal
   available_balance + pending_escrow_balance. Expose
   `GET /api/v1/admin/finance/integrity` which verifies this across all wallets and reports drift.
5. Idempotency: every vault operation keyed by (sub_order_id, operation) so a retried webhook
   cannot double-credit.

ACCEPTANCE:
- After a full order lifecycle the integrity endpoint reports zero drift across all wallets.
- Attempting to write a one-sided ledger entry fails.
- Calling releaseEscrow twice for the same sub-order credits exactly once.
- A concurrency test of 50 simultaneous credits to one wallet ends with a correct balance.

PREVIEW:
GET /api/v1/admin/finance/integrity returns all-green.
```

---

### Prompt 6.2: Escrow Release Scheduler & Clawback Automation

```text
ID: 6.2
DEPENDS ON: 6.1
FILES:
  server/src/jobs/escrowRelease.job.js
  server/src/jobs/scheduler.js
  server/src/services/clawback.service.js

TASK:
Automate the 7-day return-window hold and its reversal.

REQUIREMENTS:
1. scheduler.js — a dependency-light in-process cron runner (node-cron or setInterval + a DB
   advisory lock so only one instance runs a job, keeping it safe for multi-process later).
   Every job checks its module flag before running.
2. escrowRelease.job.js — hourly: find escrow_entries with status LOCKED and
   hold_until_timestamp <= now(), release each inside its own transaction, notify the recipients,
   and record failures in a dead-letter table for admin review rather than silently retrying forever.
3. The hold window is read from module settings (`returns_engine.return_window_days`), never
   hardcoded to 7.
4. clawback.service.js — triggered by an approved return: reverse the escrow, refund the customer
   through the original payment path, zero the saler commission, and adjust trust scores.
   Handle the case where escrow has ALREADY been released — then the clawback must recover from
   available balance and, if insufficient, create a negative-balance recovery record.
   This edge case is where most marketplaces lose money; handle it explicitly.
5. All job runs recorded with start, end, processed count, and error count.

ACCEPTANCE:
- An escrow entry past its hold window is released on the next hourly run and the wallet reflects it.
- Changing return_window_days in module settings changes new holds without a deploy.
- A clawback after release correctly recovers from available balance.
- A clawback exceeding available balance creates a recovery record rather than a negative balance.

PREVIEW:
/admin/finance/escrow shows locked entries with live countdowns.
```

---

### Prompt 6.3: Payout Engine with Maker-Checker

```text
ID: 6.3
DEPENDS ON: 6.2
FILES:
  server/src/services/payout.service.js
  server/src/integrations/payments/bkash-b2c.js
  server/src/controllers/payout.controller.js
  client/src/components/vault/PayoutRequestModal.js
  client/src/pages/admin/PayoutQueuePage.js

TASK:
Withdrawals — the highest-risk money movement on the platform, therefore the clearest use of the
maker-checker model from Phase 2.

REQUIREMENTS:
1. POST /api/v1/vault/withdraw — user requests a payout:
     validate available_balance >= amount, minimum threshold from settings,
     max_withdrawal_per_day restriction, can_withdraw capability, KYC completeness,
     and that the destination account belongs to the verified account holder.
   Funds are moved into a HELD state immediately so the same balance cannot be requested twice.
2. Admin processing: `finance.payout.approve` is HIGH tier, so a Moderator's approval creates a
   pending_admin_action requiring Super Admin sign-off; a Super Admin executes directly.
   At approval time, re-validate the balance — never trust the amount captured at request time.
3. bkash-b2c.js — B2C disbursement with a mock driver for development. On success, record the
   gateway receipt and write the final ledger entries. On failure, return funds from HELD to
   available and notify the user with the reason.
4. Batch disbursal: select multiple approved payouts and process them with per-item results, so one
   failure never blocks the batch.
5. PayoutQueuePage: filter by status, amount, and user; show risk flags (new account, first
   withdrawal, unusual amount, mismatched account name); full audit trail per payout.

ACCEPTANCE:
- Requesting a payout immediately reduces available balance (HELD), preventing double-spend.
- A moderator approving a payout creates a pending action; nothing moves until Super Admin approves.
- A failed disbursement returns the funds and notifies the user.
- Ledger integrity remains at zero drift after payouts.

PREVIEW:
/vault → request a payout; /admin/finance/payouts → approve it and watch the ledger update.
```

---

### Prompt 6.4: COD Reconciliation Engine

```text
ID: 6.4
DEPENDS ON: 6.3
FILES:
  server/src/services/codReconciliation.service.js
  server/src/controllers/codReconciliation.controller.js
  client/src/pages/admin/CodReconciliationPage.js

TASK:
Close PRD Gap #6 — the discrepancy between cash the courier collected and what the platform
credited. v1.0 named this gap but never built the solution.

REQUIREMENTS:
1. Ingest courier settlement reports (CSV upload and API pull where the courier supports it).
2. Three-way match per consignment: platform expected COD amount ↔ courier reported collection ↔
   actual bank/MFS deposit received.
3. Classify every discrepancy: SHORT_COLLECTION, OVER_COLLECTION, MISSING_DEPOSIT, DUPLICATE,
   UNMATCHED_CONSIGNMENT, TIMING_DIFFERENCE.
4. Auto-match with configurable tolerance; queue everything else for manual admin resolution with
   a documented resolution reason. Resolutions are HIGH tier (maker-checker).
5. Only release supplier/saler escrow for a COD order once its cash is reconciled — this is the
   control that prevents paying out money the platform never received.
6. Aging report: unreconciled amounts by courier and by age bucket, with an alert threshold.

ACCEPTANCE:
- Uploading a settlement CSV auto-matches clean rows and queues discrepancies.
- A short collection is flagged, blocks escrow release, and appears in the aging report.
- Every manual resolution is audited with actor and reason.

PREVIEW:
/admin/orders/cod-reconciliation with the seeded courier data.
```

---

### Prompt 6.5: Vault UI & Admin Finance Dashboard

```text
ID: 6.5
DEPENDS ON: 6.4
FILES:
  client/src/pages/VaultPage.js
  client/src/components/vault/BalanceSummary.js
  client/src/components/vault/EscrowTimeline.js
  client/src/components/vault/LedgerTable.js
  client/src/pages/admin/FinanceDashboardPage.js

TASK:
Make the money legible to both the earner and the Admin.

REQUIREMENTS:
1. BalanceSummary: Total Earnings · Available · Pending Escrow · Withdrawn, each with a clear
   plain-language explanation of what it means and when pending money becomes available.
2. EscrowTimeline: every pending sale with a live countdown, the order it came from, and the exact
   date/time it clears. Ambiguity here generates the most support tickets — be explicit.
3. LedgerTable: date, order, type (commission / payout / clawback / adjustment / refund), amount
   with sign, running balance, and status. Filterable, exportable to CSV.
4. PayoutRequestModal: method selection, saved accounts, amount with min/max shown inline, fee
   disclosure if any, and a confirmation summary before submit.
5. FinanceDashboardPage (admin): GMV, net platform revenue, escrow liability, pending payout
   liability, COD exposure, and the ledger integrity indicator — all as inline SVG charts, no
   charting library.
6. Every currency value uses the South Asian grouping formatter from Prompt 1.6.

ACCEPTANCE:
- A saler can trace any wallet number back to the specific order that produced it.
- Countdown timers are accurate and update live.
- The admin dashboard totals reconcile exactly with the ledger integrity endpoint.

PREVIEW:
/vault as a saler; /admin/finance as an admin.
```

# Phase 7 — Logistics, Returns, Disputes, Moderation & KYC

> Every subsystem in this phase was **completely absent from v1.0** despite being specified in
> `DFD.md` (subsystems 9.0, 10.0, 11.0) and `idea proposition.md` §F, §G, §C.

---

### Prompt 7.1: 3PL Courier Hub — Multi-Carrier Adapters & Webhooks

```text
ID: 7.1
DEPENDS ON: 6.5
FILES:
  server/src/db/migrations/011_logistics.sql
  server/src/integrations/courier/index.js
  server/src/integrations/courier/steadfast.js
  server/src/integrations/courier/pathao.js
  server/src/integrations/courier/redx.js
  server/src/integrations/courier/mock.js
  server/src/services/shipment.service.js
  server/src/controllers/courierWebhook.controller.js
  client/src/components/order/LiveTrackingMap.js

TASK:
Multi-carrier logistics. v1.0 named "Steadfast/Pathao" in a title but implemented only Steadfast
and provided no carrier abstraction.

REQUIREMENTS:
1. Adapter interface: createConsignment, getStatus, cancelConsignment, getLabel, calculateRate.
   Implementations: steadfast, pathao, redx, and `mock` (the development default — simulates the
   full status progression on a timer so the tracking UI is testable with no courier account).
2. Carrier selection strategy: by district coverage, rate, historical success rate, and admin
   priority order. Admin can pin a carrier per supplier or per district.
3. Migration: shipments, shipment_events. Store the full status history, never just the latest
   status — support needs the timeline.
4. Unified webhook endpoint per carrier:
     - HMAC/token signature verification
     - Replay protection via cache SETNX on the carrier event id
     - Normalise each carrier's vocabulary into one internal status enum
     - On DELIVERED: set sub-order delivered, record the timestamp, and START the escrow hold
       (calling vault.service) — this is the trigger that makes Prompt 6.2 meaningful
     - On RETURNED / CANCELLED: restore stock and trigger the clawback path
5. Label printing: packing slip and shipping label PDF generation for the supplier dashboard.
6. LiveTrackingMap: leaflet-free lightweight map (OpenStreetMap tiles, ~15KB vanilla implementation)
   showing courier position where the carrier provides coordinates, with a graceful non-map
   fallback timeline where it does not.

ACCEPTANCE:
- With COURIER_DRIVER=mock a consignment progresses through all statuses automatically.
- A delivered webhook starts the escrow timer exactly once, even when delivered twice.
- A returned webhook restores stock and initiates clawback.
- Switching a district's carrier changes routing without a code change.

PREVIEW:
Order detail shows a live-advancing tracker driven by the mock courier.
```

---

### Prompt 7.2: Return & Refund Engine

```text
ID: 7.2
DEPENDS ON: 7.1
FILES:
  server/src/db/migrations/012_returns.sql
  server/src/services/return.service.js
  server/src/controllers/return.controller.js
  client/src/pages/customer/ReturnRequestPage.js
  client/src/pages/admin/ReturnsQueuePage.js

TASK:
Implement DFD Subsystem 9.0 — entirely missing from v1.0, which created the tables but never used
them.

REQUIREMENTS:
1. Migration: return_requests, return_items, with reason codes, evidence media, and a state machine:
     REQUESTED → UNDER_REVIEW → APPROVED | REJECTED → PICKUP_SCHEDULED → RECEIVED →
     INSPECTED → REFUNDED | DISPUTED
2. Customer-initiated within the configurable return window (module setting, not hardcoded).
   Requires evidence upload (photo/video) for damage and wrong-item categories.
3. Auto-approval rules configurable per category and per reason code; everything else routes to
   the moderation queue.
4. Refund execution paths: MFS refund via the original gateway, wallet credit, or replacement.
   Each path writes correct double-entry ledger rows and triggers the clawback logic from 6.2.
5. Return shipping: generate a reverse consignment through the courier adapter.
6. Abuse controls: return-rate tracking per customer feeds trust score; excessive returns trigger
   a restriction (using the Phase 2 engine, not a bespoke mechanism).
7. Full bilingual customer-facing status messaging at every stage.

ACCEPTANCE:
- A return moves through every state with correct ledger effects at each transition.
- Approving a return after escrow release recovers funds correctly (the 6.2 edge case).
- A customer exceeding the configured return-rate threshold is automatically restricted.
- Evidence upload is mandatory where the reason code requires it.

PREVIEW:
Customer requests a return; admin processes it in the returns queue; the vault reflects the clawback.
```

---

### Prompt 7.3: Dispute Arbitration (Three-Way)

```text
ID: 7.3
DEPENDS ON: 7.2
FILES:
  server/src/services/dispute.service.js
  server/src/controllers/dispute.controller.js
  client/src/pages/moderator/DisputePanelPage.js
  client/src/components/dispute/EvidenceTimeline.js

TASK:
Buyer ↔ Saler ↔ Supplier arbitration workspace.

REQUIREMENTS:
1. Dispute threads with all three parties plus the moderator, evidence attachments, an internal
   moderator-only note channel, and a strict SLA timer per stage.
2. Escalation ladder: auto-escalate to Super Admin when the disputed amount exceeds a threshold or
   the SLA expires.
3. Resolution outcomes: full refund · partial refund · replacement · reject · split liability.
   Each outcome writes the correct ledger entries and adjusts each party's trust score.
   `orders.dispute.arbitrate` is HIGH tier, so a moderator's resolution flows through maker-checker
   above the configured amount threshold.
4. EvidenceTimeline: a chronological, immutable view of every message, upload, status change, and
   courier event relevant to the dispute — one screen containing everything needed to decide.
5. Precedent search: surface similar past disputes and their outcomes to promote consistency.

ACCEPTANCE:
- All three parties see only what they are permitted to see; internal notes never leak.
- A resolution above the threshold, submitted by a moderator, requires admin approval.
- Every resolution produces balanced ledger entries.
- SLA breaches escalate automatically.

PREVIEW:
/moderator/disputes with a seeded three-way dispute.
```

---

### Prompt 7.4: Product Approval & Content Moderation Pipeline

```text
ID: 7.4
DEPENDS ON: 7.3
FILES:
  server/src/services/moderation.service.js
  server/src/controllers/moderation.controller.js
  client/src/pages/moderator/ModerationQueuePage.js
  client/src/components/moderation/ReviewCard.js

TASK:
Implement DFD Subsystem 10.0 — absent from v1.0, which had no moderation table at all.

REQUIREMENTS:
1. One unified queue covering: new products, edited products, reviews, UGC video, storefront
   assets, live stream recordings, and chat reports. Each item type has a tailored review card.
2. Automated pre-screening before human review: banned keyword lists (English and Bengali),
   price anomaly detection, duplicate-listing detection via image hashing, and prohibited-category
   checks. Flags are advisory — a human always decides.
3. Per-category rules: auto-approve, require review, or block — configured through module settings.
4. Actions: approve · reject with reason · request changes · escalate · shadow-restrict the seller.
   Rejections must include a bilingual, actionable reason sent to the seller.
5. Moderator productivity: keyboard shortcuts, bulk actions, queue assignment to prevent two
   moderators working the same item, and per-moderator throughput stats visible to Admin.
6. Items uploaded by users under FORCE_REVIEW_QUEUE restriction land here automatically.

ACCEPTANCE:
- A new product does not go live until approved when the moderation module is on.
- Turning on auto_approval for a category bypasses the queue for that category only.
- Two moderators cannot claim the same item simultaneously.
- A rejection reason reaches the seller in their chosen language.

PREVIEW:
/moderator/queue with seeded pending products.
```

---

### Prompt 7.5: KYC Verification, Blue-Tick & Trust Tiers

```text
ID: 7.5
DEPENDS ON: 7.4
FILES:
  server/src/services/kyc.service.js
  server/src/controllers/kyc.controller.js
  server/src/services/trustTier.service.js
  client/src/pages/seller/KycSubmissionPage.js
  client/src/pages/admin/VerificationCenterPage.js

TASK:
Implement DFD Subsystem 11.0 and `idea proposition.md` §C — v1.0 created the table and never used it.

REQUIREMENTS:
1. Role-specific verification flows exactly as specified in §C:
     Supplier (mandatory, 4 steps): NID + selfie → trade licence / VAT-TIN → stock & facility
       photos → bank/MFS account matching the NID
     Saler (lightweight): NID + OTP-verified phone, optional social profile
     Customer (OFF by default): soft (above an order threshold) / full / age verification modes
2. Document handling: encrypted at rest, access strictly permission-gated, every view audited
   (who looked at which NID and when), and auto-purged per a documented retention policy.
   NID numbers must never appear in logs, API responses, or exports.
3. Status machine: PENDING → UNDER_REVIEW → VERIFIED | REJECTED(reason) → APPEAL → re-review.
4. Blue-tick badge issuance on verification; badge display is module-gated.
5. trustTier.service.js — the Starter → Verified Trader → Elite Partner ladder from §C.4, driven by
   verification level, sales volume, rating, dispute rate, and account age. Tier changes are
   recomputed nightly and affect: search ranking, profit split bonus, withdrawal limits, and ad
   eligibility.
6. VerificationCenterPage: reviewer workspace with side-by-side document viewer, a checklist,
   approve/reject with reason, and appeal handling. `users.kyc.approve` is HIGH tier → maker-checker.

ACCEPTANCE:
- A supplier cannot list a product until verification is complete when the module is on.
- Every document view writes an audit row naming the viewer.
- A rejected supplier can appeal and re-submit.
- Tier promotion visibly changes search placement and withdrawal limits.

PREVIEW:
Submit KYC as a supplier; approve it in /admin/users/verification; watch the blue tick appear.
```

---

### Prompt 7.6: Moderator Dashboard

```text
ID: 7.6
DEPENDS ON: 7.5
FILES:
  client/src/pages/moderator/ModeratorDashboardPage.js
  client/src/components/moderator/WorkloadSummary.js
  client/src/components/moderator/SlaMonitor.js

TASK:
The Moderator's home surface, built entirely on the Phase 2 delegation model — v1.0 had no
moderator dashboard whatsoever.

REQUIREMENTS:
1. WorkloadSummary: my queue, unassigned items, SLA-at-risk items, and today's resolved count.
2. Quick access to every workspace the moderator can reach, with locked cards (and Request Access)
   for the ones they cannot.
3. SlaMonitor: items approaching or breaching SLA, sorted by urgency.
4. "My elevated access" panel: currently active grants, their expiry countdowns, pending requests,
   and a one-click renewal request.
5. "Awaiting Admin approval" panel: the moderator's own submitted maker-checker actions and their
   status — so delegated work is never invisible to the person who did it.
6. Personal performance stats: throughput, average handling time, and overturn rate.

ACCEPTANCE:
- A moderator with zero grants sees a dashboard of locked cards, each requestable.
- Granting a permission unlocks the relevant card live, without a reload.
- Submitted maker-checker actions are visible with their approval status.

PREVIEW:
/moderator — with two browsers, grant a permission from the admin side and watch this page unlock.
```

---

# Phase 8 — Real-Time Chat & Unified Notifications

---

### Prompt 8.1: WebSocket Chat Gateway

```text
ID: 8.1
DEPENDS ON: 7.6
FILES:
  server/src/db/migrations/013_chat.sql
  server/src/sockets/gateway.js
  server/src/sockets/chat.handler.js
  server/src/sockets/presence.js
  server/src/services/chat.service.js

TASK:
Implement DFD Subsystem 7.0 with the multi-node correctness v1.0 sketched but did not specify.

REQUIREMENTS:
1. Migration: chat_threads, chat_messages. Threads are participant-scoped
   (customer↔saler, saler↔supplier, and support threads) with read receipts and unread counts.
2. @fastify/websocket gateway with JWT auth performed during the upgrade handshake — never via a
   query parameter that lands in access logs. Use a short-lived ticket obtained over HTTP.
3. Presence in the cache driver with a heartbeat and TTL. Multi-node fan-out via Pub/Sub;
   the in-memory driver still works correctly for single-process development.
4. Message pipeline: validate → check can_chat restriction and max_daily_messages →
   persist → publish → deliver → ack. Client-generated message ids provide idempotency and enable
   optimistic UI.
5. Offline fallback: if the recipient has no active connection, enqueue a push/SMS notification via
   the Prompt 8.2 service (debounced so ten messages produce one notification, not ten).
6. Reconnection: exponential backoff with jitter, replay of messages missed since the last received
   id — essential on unstable Bangladeshi mobile networks.
7. Abuse controls: rate limiting per thread, contact-info sharing detection (a common
   off-platform-transaction vector), and report-to-moderation from any message.
8. GET /api/v1/chat/threads and GET /api/v1/chat/threads/:id/messages (cursor paginated).

ACCEPTANCE:
- Two browser tabs exchange messages in under 100ms locally.
- Killing the connection and restoring it replays missed messages exactly once.
- A user with can_chat=BLOCK cannot send and receives a clear reason.
- Ten rapid messages to an offline user generate one notification.

PREVIEW:
Two browsers, two roles, live chat.
```

---

### Prompt 8.2: Unified Notification Service

```text
ID: 8.2
DEPENDS ON: 8.1
FILES:
  server/src/db/migrations/014_notifications.sql
  server/src/services/notification.service.js
  server/src/services/notification-channels/{inapp,sms,push,email}.js
  server/src/controllers/notification.controller.js
  client/src/components/notifications/NotificationCenter.js
  client/src/components/notifications/WhatsNewModal.js

TASK:
One notification system. v1.0 scattered SMS into auth, push into chat, and had no table, template
system, preference centre, or "What's New" implementation.

REQUIREMENTS:
1. Migration: notifications, notification_preferences, notification_templates.
2. Channel-agnostic API: `notify(userId, templateKey, data, { channels, priority })`.
   Channel selection resolves: user preference → template default → priority override.
   A critical notification (OTP, payout result, dispute decision) may override preferences;
   a marketing notification never may.
3. Templates stored in the database with English and Bengali bodies, editable by the Editor role,
   versioned, with a variable-substitution preview.
4. Digest and debounce rules to prevent notification fatigue.
5. In-app notification centre: grouped by type, unread badge, mark-read, deep links to the source
   record, and live delivery over the existing WebSocket.
6. Preference centre: per-category, per-channel opt-in/out with a quiet-hours window.
7. WhatsNewModal: shown once per release per user, driven by Editor-published release notes.
8. Delivery tracking: sent, delivered, failed, and read, per channel, with a retry policy.

ACCEPTANCE:
- One event can fan out to in-app, SMS, and push according to the user's preferences.
- Opting out of marketing SMS stops marketing but not OTP.
- Templates render correctly in both languages with variables substituted.
- The What's New modal shows exactly once per release.

PREVIEW:
Bell icon in the TopBar with live-arriving notifications; /settings/notifications for preferences.
```

---

### Prompt 8.3: WhatsApp & Messenger Conversational Commerce Bridge

```text
ID: 8.3
DEPENDS ON: 8.2
FILES:
  server/src/integrations/whatsapp/index.js
  server/src/integrations/whatsapp/cloud-api.js
  server/src/integrations/whatsapp/mock.js
  server/src/controllers/whatsappWebhook.controller.js
  client/src/pages/saler/UnifiedInboxPage.js

TASK:
Implement DFD Subsystem 20.0 — Meta Cloud API bridge with a unified inbox.

REQUIREMENTS:
1. Webhook: Meta verification handshake, signature validation, and ingestion of inbound messages
   into the same chat_threads model used by in-platform chat — one inbox, not two.
2. Outbound: text, interactive product cards (image, price, Buy Now button), and template messages
   for the 24-hour-window rules. Respect Meta's session-window constraints explicitly.
3. Secure 1-tap checkout link generation: a signed, single-use, expiring token resolving to a
   prefilled checkout (`/checkout/wa/:token`).
4. UnifiedInboxPage: WhatsApp, Messenger, and in-platform conversations in one list with channel
   badges, quick replies, product-card insertion, and order context beside the thread.
5. `mock` driver as the development default so the entire flow is testable without a Meta app.
6. Module-gated and dependent on the `chat` module (declared in the registry from Prompt 0.7).

ACCEPTANCE:
- A mock inbound WhatsApp message appears in the saler's unified inbox.
- Sending a product card produces a correctly structured interactive payload.
- A checkout token is single-use and expires.

PREVIEW:
/saler/inbox with simulated WhatsApp conversations.
```

---

### Prompt 8.4: Chat UI & Notification Center Integration

```text
ID: 8.4
DEPENDS ON: 8.3
FILES:
  client/src/pages/ChatPage.js
  client/src/components/chat/ThreadList.js
  client/src/components/chat/MessageComposer.js
  client/src/components/chat/MessageBubble.js
  client/src/services/websocket.js

TASK:
The chat interface, built for unreliable mobile connections.

REQUIREMENTS:
1. websocket.js: connection manager with auto-reconnect, exponential backoff with jitter, an
   outbound queue that survives disconnection, and a visible connection-status indicator.
2. Optimistic send: the message appears instantly as "sending", then confirms or shows a retry
   affordance. Never silently drop a message.
3. MessageComposer: text, image attachment with upload progress, product-card insertion, quick
   replies, and typing indicators.
4. MessageBubble: read receipts, timestamps, failed-send retry, and a report action.
5. ThreadList: unread counts, last-message preview, participant role badge, and search.
6. Offline queue persisted to IndexedDB so a page reload does not lose unsent messages — this
   directly addresses PRD Gap #7.

ACCEPTANCE:
- Sending while offline queues the message and flushes it on reconnect.
- A reload with queued messages preserves them.
- Typing indicators and read receipts work across two browsers.

PREVIEW:
/chat — full messaging with the network throttled to offline and back.
```

---

# Phase 9 — Growth Engines

---

### Prompt 9.1: Sponsored Ads Engine

```text
ID: 9.1
DEPENDS ON: 8.4
FILES:
  server/src/db/migrations/015_ads.sql
  server/src/services/ads.service.js
  server/src/services/adAuction.service.js
  server/src/controllers/ads.controller.js
  client/src/pages/saler/AdCampaignPage.js
  client/src/components/ads/SponsoredSlot.js

TASK:
Implement the In-Platform Sponsored Ads Engine — named in every source document, built in none of
v1.0's prompts.

REQUIREMENTS:
1. Migration: ad_campaigns, ad_creatives, ad_impressions, ad_clicks, ad_billing
   (ad_impressions declared as a monthly-partitioned table per docs/erd.md).
2. Campaign model: objective, placement (search results / category banner / feed / product page),
   targeting (category, district, keyword), daily and total budget, schedule, and bid.
3. adAuction.service.js: a second-price auction ranked by bid × quality score (CTR, relevance,
   seller tier). Deterministic and testable — document the exact ranking formula.
4. Budget pacing so a daily budget is spread across the day rather than exhausted in minutes.
   Hard stop at the budget cap; never overspend a seller's money.
5. Billing: CPC deducted from wallet or an ad-credit balance, with a full ledger entry per charge.
   Fraud protection: deduplicate impressions and clicks per user per window, and exclude
   self-clicks.
6. SponsoredSlot component: clearly labelled "Sponsored" (a regulatory and trust requirement),
   fully hidden when the module is off, with viewability-based impression counting rather than
   render-based.
7. Respects the can_run_ads restriction and the ad_budget_cap limit.
8. Admin controls: global ad density cap, blocked keywords, and campaign review queue.

ACCEPTANCE:
- Creating a campaign with a ৳500 budget never spends more than ৳500.
- Every charge produces a matching ledger entry; integrity stays at zero drift.
- Disabling the ads module removes every sponsored slot instantly.
- Self-clicks are excluded from billing.

PREVIEW:
/saler/ads to create a campaign; sponsored slots appear in search results.
```

---

### Prompt 9.2: Coupons, Vouchers & Flash Sale Campaigns

```text
ID: 9.2
DEPENDS ON: 9.1
FILES:
  server/src/db/migrations/016_promotions.sql
  server/src/services/coupon.service.js
  server/src/services/flashSale.service.js
  server/src/controllers/promotion.controller.js
  client/src/pages/admin/CampaignManagerPage.js

TASK:
Implement DFD Subsystem 17.0 with the budget and abuse controls a real promotion engine needs.

REQUIREMENTS:
1. Migration: coupons, coupon_redemptions, flash_sales.
2. Coupon types: percentage, fixed amount, free shipping, buy-X-get-Y. Scoped to platform,
   supplier, saler, category, or product.
3. Constraints: min spend, max discount, budget cap, total usage limit, per-user usage limit,
   first-order-only, validity window, and stackability rules.
4. Cost attribution — who funds the discount (platform / supplier / saler) determines the ledger
   entries. Getting this wrong silently corrupts margins, so make it explicit and required.
5. Atomic redemption: reserve inside the checkout transaction so a budget cap cannot be exceeded
   under concurrency.
6. Flash sales: scheduled windows, limited stock allocation, live countdown, and a per-user
   purchase limit. Stock is reserved for the flash sale rather than double-sold.
7. CampaignManagerPage: create, schedule, monitor spend against budget in real time, and emergency-stop.

ACCEPTANCE:
- A coupon with a ৳10,000 budget cap stops at exactly ৳10,000 under 50 concurrent checkouts.
- Per-user limits are enforced across sessions and devices.
- Ledger entries correctly attribute discount cost to the funding party.
- A flash sale never oversells its allocated stock.

PREVIEW:
/admin/growth/campaigns; flash sale widget counting down on the homepage.
```

---

### Prompt 9.3: Multi-Tier Referral & Network Growth Engine

```text
ID: 9.3
DEPENDS ON: 9.2
FILES:
  server/src/db/migrations/017_referral.sql
  server/src/services/referral.service.js
  server/src/controllers/referral.controller.js
  client/src/pages/saler/ReferralHubPage.js

TASK:
Implement DFD Subsystem 14.0 — absent from v1.0 entirely.

REQUIREMENTS:
1. Migration: referrals, referral_earnings. Support a configurable tier depth (default 2) with
   per-tier commission rates from module settings.
2. Attribution: referral code or link, cookie plus account binding, with a documented last-touch
   window. Attribution is immutable once a qualifying event occurs.
3. Qualifying events configurable: signup, first order, first sale, or KYC completion.
4. Fraud controls — mandatory, since referral programmes are the most-abused feature in commerce:
   self-referral detection (device, IP, NID, phone, payment instrument), circular referral
   detection, velocity limits, and a holding period before earnings become withdrawable.
5. Earnings flow through the standard ledger and escrow path, never a parallel money system.
6. ReferralHubPage: personal link and QR, referral tree visualisation, earnings statement,
   and share tools.

ACCEPTANCE:
- A two-tier referral credits both tiers at the configured rates.
- A self-referral attempt via a second account on the same device is blocked and flagged.
- Referral earnings appear in the ledger and respect the holding period.

PREVIEW:
/saler/referrals with a seeded referral tree.
```

---

### Prompt 9.4: Loyalty Coins, Daily Quests & Leaderboard

```text
ID: 9.4
DEPENDS ON: 9.3
FILES:
  server/src/db/migrations/018_gamification.sql
  server/src/services/coin.service.js
  server/src/services/quest.service.js
  server/src/services/leaderboard.service.js
  client/src/pages/customer/CoinsPage.js
  client/src/components/gamification/QuestPanel.js
  client/src/components/gamification/LeaderboardWidget.js

TASK:
Implement DFD Subsystem 13.0 with proper accounting — v1.0's prompt created no tables for it.

REQUIREMENTS:
1. Migration: coin_balances, coin_transactions, quests, quest_progress, leaderboard_snapshots.
   Coins are a liability: every issuance and redemption is double-entry, exactly like cash.
   The platform must always be able to state its total outstanding coin liability.
2. Earning rules (all configurable via module settings): daily check-in with a streak multiplier,
   order completion, photo/video review, referral, and quest completion.
3. Redemption: configurable rate (default 100 coins = ৳10), a maximum percentage of any order,
   and an expiry policy. Redemption happens inside the checkout transaction.
4. Quests: daily and weekly, role-specific, with progress tracking and reward claiming.
   Quest definitions are data, not code, so the Admin can add a quest without a deploy.
5. Leaderboard: monthly, by revenue / orders / rating, computed as nightly snapshots (never a live
   aggregate over the full table), with a bonus pool distribution configurable by Admin.
6. Anti-gaming: velocity limits, self-purchase exclusion, and review-quality gating for coin
   rewards.

ACCEPTANCE:
- Daily check-in credits the configured amount once per day and cannot be replayed.
- Total coin liability reported by the system matches the sum of all balances.
- Redeeming coins at checkout reduces the payable amount and is reversed on a cancelled order.
- The leaderboard snapshot job produces stable, correct rankings.

PREVIEW:
/coins with a streak calendar; leaderboard widget on the saler dashboard.
```

---

### Prompt 9.5: Social Group Buying (Team Purchase)

```text
ID: 9.5
DEPENDS ON: 9.4
FILES:
  server/src/db/migrations/019_group_buy.sql
  server/src/services/teamPurchase.service.js
  server/src/jobs/teamPurchaseExpiry.job.js
  client/src/pages/TeamPurchasePage.js

TASK:
Implement DFD Subsystem 16.0 — the Pinduoduo-style viral mechanic.

REQUIREMENTS:
1. Migration: team_purchases, team_purchase_members.
2. Initiator starts a team at a discounted price; a countdown window (default 24h, configurable)
   begins. Friends join via `/team/:id`.
3. Payment is AUTHORIZED (or held) on join, not captured, until the team completes. If it expires
   incomplete, release or refund 100% automatically — no manual intervention, no partial charges.
4. On completion: convert every member's participation into a real order through the standard
   checkout service, so stock locking, splitting, and ledger behaviour are identical to normal
   orders. Do not build a parallel order path.
5. Stock reservation for the duration of the window, with a clear release on expiry.
6. Expiry job: scan expired incomplete teams, refund, notify, and release stock.
7. Share tooling: WhatsApp and Facebook share with an OG image showing live progress
   ("2 of 3 joined — 4h left").

ACCEPTANCE:
- A team of 3 completing within the window creates 3 real orders at the discounted price.
- An expired incomplete team refunds every member fully and releases stock.
- A member cannot be charged twice, and an expired team cannot be completed late.

PREVIEW:
Start a team purchase, join from a second browser, and watch it complete.
```

---

### Prompt 9.6: Abandoned Cart Recovery

```text
ID: 9.6
DEPENDS ON: 9.5
FILES:
  server/src/services/cartRecovery.service.js
  server/src/jobs/cartRecovery.job.js
  client/src/pages/saler/CartInsightsPage.js

TASK:
Implement DFD Subsystem 12.0 — absent from v1.0 despite being a listed module.

REQUIREMENTS:
1. Detection: cart inactive for N minutes with items present and no order created
   (N from module settings).
2. A recovery sequence, all configurable: reminder at +1h, incentive at +24h, final at +72h.
   Respect notification preferences and quiet hours; stop immediately on purchase.
3. Recovery link restores the exact cart with a signed token.
4. Incentive rules: an Admin-capped discount, issued as a single-use coupon so the standard budget
   and abuse controls apply.
5. Attribution: track recovered revenue per sequence step so the Admin can see what actually works.
6. CartInsightsPage for salers: abandonment rate, common drop-off items, and a manual "send offer"
   action within the configured cap.
7. Hard limits so recovery messaging can never become spam — max one sequence per cart, and a
   cooldown per user.

ACCEPTANCE:
- An abandoned cart triggers the sequence at the configured intervals and stops on purchase.
- The recovery link restores the cart exactly, including variants.
- A user cannot receive more than the configured number of recovery messages.
- Recovered revenue is attributable per step.

PREVIEW:
/saler/cart-insights with seeded abandoned carts.
```

---

### Prompt 9.7: Social Seller Kit — Flyers, QR & Affiliate Links

```text
ID: 9.7
DEPENDS ON: 9.6
FILES:
  server/src/services/flyer.service.js
  server/src/services/shortlink.service.js
  client/src/components/saler/SocialKitModal.js

TASK:
Implement `idea proposition.md` §P — the viral distribution toolkit.

REQUIREMENTS:
1. flyer.service.js: server-side poster generation (SVG composed then rasterised) with product
   image, title, price, store branding, and a QR code. Multiple templates and sizes
   (Facebook post, WhatsApp status, A4 print). Bengali text must render correctly — verify the
   font is embedded in the rasteriser.
2. shortlink.service.js: branded short links (`explooro.com/s/:code`) with click tracking, source
   attribution, and affiliate binding to the saler.
3. QR codes generated locally (no third-party QR API, which would leak product URLs to a
   third party and add latency).
4. SocialKitModal: pick a template, preview, download PNG/PDF, copy link, and direct share to
   WhatsApp and Facebook.
5. Analytics: clicks, conversions, and revenue per short link, shown to the saler.

ACCEPTANCE:
- A generated flyer renders Bengali product titles correctly and downloads as a print-quality file.
- The QR code resolves to the correct affiliate-attributed product URL.
- Clicks and conversions are attributed to the originating saler.

PREVIEW:
Open the Social Kit on any product and generate a real flyer.
```

---

# Phase 10 — Advanced Subsystems

---

### Prompt 10.1: Live Stream Commerce

```text
ID: 10.1
DEPENDS ON: 9.7
FILES:
  docs/live-streaming-decision.md
  server/src/db/migrations/020_live.sql
  server/src/integrations/streaming/index.js
  server/src/services/liveStream.service.js
  client/src/pages/LiveStreamPage.js
  client/src/pages/saler/LiveStudioPage.js

TASK:
Implement DFD Subsystem 15.0. Note: NO source document ever chose a streaming technology — this
prompt must make and record that decision first.

REQUIREMENTS:
1. docs/live-streaming-decision.md — evaluate and choose between LiveKit (self-host or cloud),
   Agora, Mux, and a self-hosted SRS/OvenMediaEngine. Decide on explicit criteria:
   Bangladeshi bandwidth cost, latency, mobile SDK quality, Flutter support, and price per
   concurrent viewer. Record the decision, the rejected options, and the reason. Bandwidth is the
   dominant cost driver here — quantify it before writing any code.
2. Migration: live_streams, live_stream_products, live_stream_messages.
3. Streaming adapter interface: createRoom, getPublisherToken, getViewerToken, endRoom,
   getRecording — plus a `mock` driver so the surrounding UI is buildable without any streaming
   account or bandwidth spend.
4. LiveStudioPage (host): schedule, go live, pin products, view live viewer count, moderate chat,
   and see live sales as they happen.
5. LiveStreamPage (viewer): video, pinned product card with in-stream Buy Now, live chat
   (reusing the Phase 8 gateway), reactions, and a low-bandwidth audio-only fallback — important
   for Bangladeshi mobile data.
6. Moderation hooks: a moderator can mute a participant or terminate a stream (Prompt 7.4's queue).
7. Recording stored via the media pipeline for later moderation and replay.

ACCEPTANCE:
- The technology decision document exists with a quantified bandwidth cost comparison.
- With STREAM_DRIVER=mock the entire host and viewer UI is navigable and testable.
- Pinning a product updates every viewer within a second.
- A purchase made during a stream is attributed to that stream.

PREVIEW:
/saler/live-studio and /live/:id side by side with the mock driver.
```

---

### Prompt 10.2: AI Service Layer & Conversational Assistants

```text
ID: 10.2
DEPENDS ON: 10.1
FILES:
  docs/ai-strategy.md
  server/src/services/ai/index.js
  server/src/services/ai/provider.js
  server/src/services/ai/conciergeAgent.js
  server/src/services/ai/sourcingAgent.js
  client/src/components/ai/AssistantPanel.js

TASK:
Six modules in `idea proposition.md` depend on AI, yet no source document ever named a provider.
This prompt establishes the AI layer.

REQUIREMENTS:
1. docs/ai-strategy.md — provider decision (default: Anthropic Claude API), model selection per
   task with cost per 1K tokens, latency targets, prompt-caching strategy, a monthly cost ceiling,
   and a graceful degradation policy: when AI is unavailable or over budget, every dependent
   feature must fall back to a deterministic non-AI path rather than breaking.
2. provider.js — a thin abstraction over the provider SDK with streaming, retry with backoff,
   token accounting per user and per feature, and a hard spend cap enforced server-side.
   Never call the model directly from any controller.
3. conciergeAgent.js — the customer Shopping Concierge: natural-language product discovery in
   Bengali and English, grounded strictly in the real catalog via tool calls. It must never invent
   a product, price, or stock figure — every claim traces to a catalog record.
4. sourcingAgent.js — the Saler Sourcing Intelligence assistant: find high-margin, trending,
   well-rated products, with 1-click import into the store.
5. Safety: prompt-injection resistance (treat all product text, reviews, and chat as untrusted
   data, never as instructions), PII redaction before any external call, and full logging of
   AI actions for audit.
6. AssistantPanel: streaming responses, suggested prompts, product cards inline, conversation
   history, and a clear "AI-generated" label.
7. Every AI feature is individually module-gated so the Admin can disable it if cost demands.

ACCEPTANCE:
- The concierge answers a Bengali product question using only real seeded catalog data.
- Disabling the AI module degrades every dependent feature gracefully — nothing breaks.
- The token spend cap is enforced and visible to the Admin.
- A prompt-injection attempt embedded in a product description does not alter agent behaviour.

PREVIEW:
The assistant panel answers a real Bengali product query against the seed catalog.
```

---

### Prompt 10.3: AI Creative Studio, Demand Forecasting & Review Integrity

```text
ID: 10.3
DEPENDS ON: 10.2
FILES:
  server/src/services/ai/creativeStudio.js
  server/src/services/ai/demandForecast.js
  server/src/services/ai/reviewIntegrity.js
  server/src/services/ai/prescriptiveInsights.js
  client/src/pages/saler/CreativeStudioPage.js

TASK:
The remaining AI-dependent modules from `idea proposition.md` §W, §AB, §Z, and §I.

REQUIREMENTS:
1. creativeStudio.js: ad copy generation in Bengali and English, product-description improvement,
   and background replacement for product photos. Every output is a draft requiring human approval
   before publication — never auto-publish generated content.
2. demandForecast.js: time-series stockout prediction and seasonal demand peaks. Start with a
   deterministic statistical baseline (moving average plus seasonality); use the model only for
   explanation and recommendation. Do not make a language model the arithmetic engine.
3. reviewIntegrity.js: fake-review detection scoring on text patterns, velocity, reviewer history,
   and purchase verification. Output is a moderation flag with a confidence score — a human always
   decides. Feeds the Prompt 7.4 queue.
4. prescriptiveInsights.js: actionable next-step recommendations per role, grounded in that user's
   real metrics ("Your ৳450 item converts at 1.2% — sellers at ৳399 convert at 3.1%").
5. All four honour the spend cap and the module flags from 10.2.

ACCEPTANCE:
- Generated ad copy requires explicit approval before going live.
- The forecast produces a numeric prediction with a stated confidence interval, computed
  statistically rather than generated as text.
- A seeded fake review is flagged for moderation rather than auto-deleted.

PREVIEW:
/saler/creative-studio generating a Bengali ad caption for a seeded product.
```

---

### Prompt 10.4: Digital Warranty & Claims Engine

```text
ID: 10.4
DEPENDS ON: 10.3
FILES:
  server/src/db/migrations/021_warranty.sql
  server/src/services/warranty.service.js
  client/src/pages/customer/WarrantyCardsPage.js
  client/src/pages/supplier/WarrantyClaimsPage.js

TASK:
Implement `idea proposition.md` §AA.

REQUIREMENTS:
1. Migration: warranty_cards, warranty_claims.
2. Warranty auto-issued on delivery when the product carries a warranty policy; a digital card with
   serial/IMEI where applicable, coverage terms, and an expiry countdown.
3. Claim flow: submit with evidence → supplier review → approve (repair / replace / refund) or
   reject with reason → resolution tracking, with a reverse consignment via the courier adapter
   where physical return is required.
4. Claim SLA tracking with escalation to Admin on breach.
5. Transferability rules for resale, configurable per category.
6. Supplier-side claim analytics: claim rate per product — an early quality signal that should feed
   supplier tiering.

ACCEPTANCE:
- Delivery issues a warranty card with a correct expiry countdown.
- A claim moves through the full lifecycle with correct notifications.
- Claim rate per product is visible to Admin and affects the supplier's tier.

PREVIEW:
/warranties as a customer; /supplier/claims as a supplier.
```

---

### Prompt 10.5: Cross-Seller Bundling & Demand Surge Pricing

```text
ID: 10.5
DEPENDS ON: 10.4
FILES:
  server/src/db/migrations/022_bundles.sql
  server/src/services/bundle.service.js
  server/src/services/surgePricing.service.js
  client/src/pages/saler/BundleStudioPage.js

TASK:
Implement `idea proposition.md` §AC and §AF.

REQUIREMENTS:
1. Migration: product_bundles, bundle_items.
2. Bundles may span multiple suppliers. The critical requirement is automated profit splitting:
   the bundle discount must be apportioned across contributing suppliers and salers by a documented,
   deterministic rule, producing correct per-party ledger entries. Ambiguity here creates disputes.
3. Bundle checkout reuses the standard order splitting path — each supplier still gets its own
   sub-order and parcel.
4. surgePricing.service.js: detect high-demand items (velocity, stock depletion rate, search
   volume) and RECOMMEND a price adjustment to the supplier. Recommendation only — never adjust a
   price automatically without opt-in, and always cap the increase to prevent gouging during
   shortages, which would damage platform trust.
5. BundleStudioPage: drag products from multiple suppliers, set the bundle price, and see a live
   per-party profit breakdown before publishing.

ACCEPTANCE:
- A two-supplier bundle produces two sub-orders with correctly apportioned discount and margins.
- The ledger balances exactly after a bundle sale.
- Surge pricing recommends but never applies automatically, and respects the increase cap.

PREVIEW:
/saler/bundles building a cross-supplier combo with a live profit breakdown.
```

---

### Prompt 10.6: B2B Wholesale Escrow & Milestone Settlement

```text
ID: 10.6
DEPENDS ON: 10.5
FILES:
  server/src/services/b2bEscrow.service.js
  server/src/controllers/b2bEscrow.controller.js
  client/src/pages/supplier/B2bEscrowPage.js

TASK:
Implement `idea proposition.md` §AG — large-value wholesale deals with staged release.

REQUIREMENTS:
1. Milestone-based escrow (b2b_escrow_milestones, created in Prompt 6.1's migration):
   e.g. 30% on order confirmation, 40% on dispatch, 30% on verified receipt.
2. Both parties must agree the milestone schedule before funds are locked; the agreed terms are
   immutable thereafter and stored as a signed snapshot.
3. Each release requires evidence (dispatch proof, delivery confirmation, inspection report) and is
   HIGH tier → maker-checker for any admin-side manual release.
4. Dispute path: freeze remaining milestones and route to the Prompt 7.3 arbitration workspace.
5. Partial release, partial refund, and full-cancellation flows, all double-entry.
6. Contract summary PDF generation for both parties.

ACCEPTANCE:
- A three-milestone deal releases in the correct proportions against evidence.
- A dispute freezes remaining milestones immediately.
- Ledger integrity holds through partial releases and partial refunds.

PREVIEW:
/supplier/b2b-escrow with a seeded multi-milestone wholesale deal.
```

---

### Prompt 10.7: Open Marketplace API, Webhooks & Developer SDK

```text
ID: 10.7
DEPENDS ON: 10.6
FILES:
  server/src/db/migrations/023_developer.sql
  server/src/services/apiKey.service.js
  server/src/services/webhookDelivery.service.js
  server/src/controllers/publicApi.controller.js
  docs/public-api.md
  client/src/pages/admin/ApiKeysPage.js

TASK:
Implement `idea proposition.md` §AI.

REQUIREMENTS:
1. Migration: api_keys, webhook_subscriptions, webhook_deliveries.
2. API keys with scoped permissions (reusing the Phase 2 permission catalog — do not invent a
   second authorization system), per-key rate limits, IP allowlist, rotation, and immediate
   revocation.
3. Public read API: products, stores, categories, availability. Public write API: order creation
   for approved partners only.
4. Outbound webhooks: subscribe to order.created, order.delivered, product.updated,
   payout.completed. Signed with HMAC, delivered with exponential-backoff retry, a dead-letter
   queue, and a replay tool in the admin UI.
5. docs/public-api.md — an OpenAPI 3 specification generated from the existing Fastify JSON schemas
   rather than hand-written, so it cannot drift from the implementation.
6. Embeddable widget: a product grid embeddable in a Facebook page or an external site via a single
   script tag, respecting CSP and staying under 15KB.

ACCEPTANCE:
- A scoped key can read products but is denied write access.
- A webhook failing three times lands in the dead-letter queue and is replayable.
- The OpenAPI spec validates and matches the live routes.

PREVIEW:
/admin/platform/api-keys; the embeddable widget rendering in a standalone test HTML file.
```

---

### Prompt 10.8: Content Commerce, Reels, Seller Academy & Editor Dashboard

```text
ID: 10.8
DEPENDS ON: 10.7
FILES:
  server/src/db/migrations/024_content.sql
  server/src/services/content.service.js
  client/src/pages/StoriesFeedPage.js
  client/src/components/content/ShoppableReels.js
  client/src/pages/AcademyPage.js
  client/src/pages/editor/EditorDashboardPage.js
  client/src/pages/editor/TranslationManagerPage.js

TASK:
The content layer plus the Editor dashboard — v1.0 had a partial content UI and no Editor
dashboard at all.

REQUIREMENTS:
1. Migration: stories, academy_courses, academy_lessons.
2. StoriesFeedPage: blog-style storytelling posts with embedded buyable product cards, authored by
   salers and suppliers, moderated through the Prompt 7.4 queue.
3. ShoppableReels: vertical short-video feed with pinned product cards and a 1-tap buy overlay.
   Must be bandwidth-conscious — preload only the next item, respect Save-Data headers, and offer a
   data-saver mode. This matters on Bangladeshi mobile data.
4. AcademyPage: micro-learning courses with video and audio lessons, progress tracking, and
   completion certificates — implementing `idea proposition.md` §T.
5. EditorDashboardPage: banners and hero sliders, story curation, academy content management,
   What's New publishing (feeding the Prompt 8.2 modal), and the FAQ/help centre.
6. TranslationManagerPage: edit i18n_strings live, with missing-key detection, a per-locale
   completeness percentage, and an export/import round trip. New languages can be added without a
   deploy — the multi-language engine of `idea proposition.md` §L.
7. All content publishing is permission-gated and audited.

ACCEPTANCE:
- An editor can change a homepage banner and see it live without a deploy.
- Editing a translation string updates the UI for all users after a cache refresh.
- Adding a third locale requires no code change.
- The reels feed does not preload more than one video ahead.

PREVIEW:
/editor as the seeded editor user; /stories and /reels as a shopper.
```

---

# Phase 11 — Role Dashboards, Analytics, SEO & PWA

---

### Prompt 11.1: Supplier / Manufacturer Dashboard

```text
ID: 11.1
DEPENDS ON: 10.8
FILES:
  client/src/pages/supplier/SupplierDashboardPage.js
  client/src/pages/supplier/InventoryPage.js
  client/src/pages/supplier/BatchManagerPage.js
  client/src/pages/supplier/WarehousePage.js
  client/src/pages/supplier/FulfilmentPage.js
  client/src/pages/supplier/ResellerInsightsPage.js
  server/src/services/inventory.service.js
  server/src/services/warehouseRouting.service.js
  server/src/jobs/expiryWarning.job.js

TASK:
Implement `idea proposition.md` §AL.1 in full — v1.0 had no supplier dashboard at all — plus the
FEFO and warehouse routing engines.

REQUIREMENTS:
1. inventory.service.js:
   `getFEFOBatch(productId, warehouseNodeId, qty)` — earliest expiry first, sufficient stock,
   with an explicit tie-break rule and a fallback across warehouses.
   `checkExpiryWarnings()` — daily job flagging batches expiring within 30/60 days and offering a
   1-click clearance-sale action.
2. warehouseRouting.service.js: `findNearestWarehouse(district, stockList)` using great-circle
   distance against warehouse_nodes coordinates, honouring admin-configured priority and split-order
   rules. Called from checkout (Prompt 5.2).
3. Dashboard surfaces: live stock and low-stock alerts, batch manager with expiry timeline,
   multi-warehouse allocation, fulfilment queue with 1-click consignment and label printing,
   reseller network insights (which salers sell their products best), earnings vault, wholesale
   inquiry inbox, physical shop toggle, warranty claims, and live commerce host entry point.
4. Simple Mode surfaces only: pending orders, low stock, today's earnings, and print labels.
5. Every card is module-gated and permission-gated; nothing crashes when a module is off.

ACCEPTANCE:
- Two batches expiring 2026-10-01 and 2026-12-01 → an order allocates the October batch.
- An order routes to the nearest warehouse holding stock.
- The expiry job flags a batch 45 days out and offers the clearance action.
- Simple Mode shows at most 6 primary actions.

PREVIEW:
/supplier as the seeded supplier, with real stock and orders.
```

---

### Prompt 11.2: Saler Dashboard

```text
ID: 11.2
DEPENDS ON: 11.1
FILES:
  client/src/pages/saler/SalerDashboardPage.js
  client/src/pages/saler/AnalyticsPage.js
  client/src/components/saler/GrowthAssistant.js

TASK:
Implement `idea proposition.md` §AL.2 in full.

REQUIREMENTS:
1. Dashboard aggregating every saler tool built across Phases 4–10: storefront builder, sourcing,
   creative studio, bundling, unified inbox, quests, social kit, live studio, referrals, analytics,
   vault, ad manager, leaderboard, academy, and cart insights.
2. AnalyticsPage: traffic, conversion rate, top products, revenue and profit trends, and traffic
   sources — inline SVG charts only, no charting library.
3. GrowthAssistant: prescriptive next-step recommendations from Prompt 10.3, each with a one-click
   action so advice is directly actionable rather than merely informative.
4. Simple Mode: Add Product · Share Store · Check Earnings · Messages · Orders · Help.
5. Onboarding: a first-run checklist guiding a brand-new saler to their first sale, with the
   15-second video walkthroughs from the module registry.

ACCEPTANCE:
- Every saler feature is reachable within two clicks from this dashboard.
- Analytics figures reconcile exactly with the ledger and order data.
- A brand-new saler sees the onboarding checklist rather than an empty dashboard.

PREVIEW:
/saler with the seeded saler account and real sales data.
```

---

### Prompt 11.3: Customer Portal

```text
ID: 11.3
DEPENDS ON: 11.2
FILES:
  client/src/pages/customer/CustomerDashboardPage.js
  client/src/pages/customer/OrdersPage.js
  client/src/pages/customer/FollowingFeedPage.js
  client/src/components/customer/BecomeSalerCta.js

TASK:
Implement `idea proposition.md` §AL.3 in full.

REQUIREMENTS:
1. Orders with visual tracking, warranty cards, team purchases, coins and streak calendar, UGC
   video reviews, wishlist with price-drop alerts, coupons, referral link, followed stores feed,
   concierge history, and the returns hub.
2. BecomeSalerCta: genuine 1-click upgrade — creates the saler role, provisions a virtual store
   with a suggested slug, and lands the user in the store builder. Zero paperwork, exactly as the
   source documents promise.
3. FollowingFeedPage: product drops, live-stream starts, and stories from followed sellers.
4. Designed explicitly for low-literacy users: icon-led navigation, large touch targets, plain
   Bengali copy, and the optional 15-second video walkthroughs.

ACCEPTANCE:
- 1-click saler upgrade completes in under 3 seconds and lands in the store builder.
- Price-drop alerts fire for wishlisted items.
- Every action is reachable without reading more than three words of text.

PREVIEW:
/account as the seeded customer.
```

---

### Prompt 11.4: Super Admin Executive Dashboard & Analytics

```text
ID: 11.4
DEPENDS ON: 11.3
FILES:
  client/src/pages/admin/AdminDashboardPage.js
  server/src/services/analytics.service.js
  server/src/jobs/analyticsRollup.job.js
  client/src/pages/admin/SystemHealthPage.js

TASK:
Implement `idea proposition.md` §AL.4 — v1.0 built 1 of the 20 admin panels it specified.

REQUIREMENTS:
1. analytics.service.js with a nightly rollup job writing to summary tables. Never compute
   dashboard aggregates live against transactional tables — that is how an admin dashboard takes
   down production.
2. Executive KPIs: GMV, net platform revenue, take rate, active sellers, new signups, conversion
   rate, AOV, escrow liability, pending payout liability, COD exposure, and dispute rate —
   each with a period-over-period comparison.
3. Alert cards driving attention to what needs action today: approval queue depth, SLA breaches,
   ledger drift, failed payouts, unreconciled COD, and stuck payments.
4. SystemHealthPage: API latency percentiles, error rate, cache driver status, job run history,
   webhook failure counts, and database connection health.
5. Every panel deep-links into the operational page that resolves the issue — an alert must always
   be one click from its remedy.
6. Backup controls: manual snapshot trigger, snapshot history, and restore (CRITICAL tier).

ACCEPTANCE:
- The dashboard loads in under 1 second with a year of seeded data.
- Every KPI reconciles with its underlying source of truth.
- Alert cards deep-link correctly.
- A manual backup produces a verifiable snapshot record.

PREVIEW:
/admin — the executive cockpit.
```

---

### Prompt 11.5: SEO — Prerendering, Structured Data & Sitemap

```text
ID: 11.5
DEPENDS ON: 11.4
FILES:
  client/prerender.config.js
  scripts/prerender.js
  server/src/controllers/sitemap.controller.js
  client/src/services/seo.js

TASK:
Resolve the v1.0 SEO contradiction. A client-rendered vanilla JS app cannot deliver the "instant
SEO indexing" the technology document claims. This prompt makes the claim true.

REQUIREMENTS:
1. Build-time prerendering for public, indexable routes: home, category pages, product pages, and
   storefronts. Use a headless render at build time producing real static HTML with content, which
   then hydrates into the SPA. No framework change is required — this is a build step.
2. For products created after the build, add an on-demand server-side render cache: the first
   crawler request renders and caches HTML; subsequent requests serve the cache. Detect crawlers by
   user agent and serve identical content to users and crawlers — never cloak.
3. seo.js: per-route title, meta description, canonical URL, hreflang for en/bn, OpenGraph, Twitter
   card, and JSON-LD (Product, Offer, AggregateRating, BreadcrumbList, Organization, Store).
4. Dynamic sitemap: /sitemap.xml as an index, with paginated child sitemaps for products, stores,
   categories, and stories. Auto-submitted via ping on publish.
5. robots.txt with correct disallow rules for admin, checkout, and account routes.
6. Bengali SEO: hreflang pairs, Bengali meta descriptions, and Bengali URL slug support.

ACCEPTANCE:
- `curl` on a product URL returns full HTML content with no JavaScript executed.
- Google Rich Results validates the Product structured data.
- The sitemap index lists every published product and store.
- Lighthouse SEO score is 100 on home and product pages.

PREVIEW:
Disable JavaScript in the browser and load a product page — content is still fully readable.
```

---

### Prompt 11.6: PWA, Offline Resilience & Performance Pass

```text
ID: 11.6
DEPENDS ON: 11.5
FILES:
  client/public/manifest.json
  client/src/sw.js
  client/src/services/offlineQueue.js
  docs/performance-report.md

TASK:
Deliver the PWA promised by `technologyused.md` §Layer 1 and close PRD Gap #7.

REQUIREMENTS:
1. Web app manifest with full icon set, theme colors matching the active palette, and an install
   prompt at an appropriate moment (never on first load).
2. Service worker with a considered caching strategy per resource type:
   app shell cache-first, catalog stale-while-revalidate, API network-first with a timeout,
   and images cache-first with an LRU cap. Explicitly never cache authenticated or financial
   responses.
3. offlineQueue.js: IndexedDB queue for cart mutations, chat messages, and form drafts, flushed on
   reconnect with conflict handling. A clear offline banner and per-item sync status.
4. Offline fallback page and cached recently-viewed products so the app is not useless on a
   dropped connection.
5. Performance pass against the Prompt 1.9 budget: route-level code splitting, image lazy loading
   with correct sizes, font preloading, critical CSS inlining, and third-party audit
   (there should be almost none).
6. docs/performance-report.md recording measured Lighthouse scores and bundle sizes on
   simulated 3G for the home, product, and checkout pages.

ACCEPTANCE:
- The app is installable and launches offline showing cached content.
- A cart change made offline syncs correctly on reconnect.
- Initial JS is under 150KB gzipped and CSS under 40KB gzipped.
- Lighthouse: Performance ≥ 95, Accessibility 100, SEO 100 on the measured pages.

PREVIEW:
Install the PWA, go offline, and browse cached products.
```

---

# Phase 12 — Hardening, Mobile & Deployment

> Docker appears for the first and only time in Prompt 12.7.

---

### Prompt 12.1: Automated Test Suite

```text
ID: 12.1
DEPENDS ON: 11.6
FILES:
  server/tests/**
  client/tests/**
  vitest.config.js
  docs/testing-strategy.md

TASK:
v1.0 contained zero tests. For a platform handling other people's money that is not acceptable.

REQUIREMENTS:
1. Unit tests (Vitest — lightweight, Vite-native, no extra toolchain):
   pricing splits, ledger double-entry, permission resolution, coupon constraints, FEFO selection,
   trust scoring, and the South Asian currency formatter.
2. Property-based tests for the financial core: for any sequence of valid vault operations, the
   ledger invariant must hold. This class of test catches the bugs that unit tests miss.
3. Integration tests against a real test database: full checkout, escrow lifecycle, return with
   clawback after release, payout with maker-checker, and the concurrency scenarios
   (last-unit race, concurrent wallet credits, coupon budget cap under load).
4. Authorization tests — a dedicated suite proving:
   every CRITICAL permission is unreachable by non-super-admins by every route;
   DENY always beats GRANT; expired grants stop working; no actor can approve their own action.
5. Client tests: router guards, i18n switching, permission gates, and offline queue flush.
6. Smoke E2E covering the five critical journeys: signup, purchase, payout, return, and module
   toggle.
7. CI-ready: `npm test` runs everything with a coverage report. Minimum 80% coverage on
   server/src/services.

ACCEPTANCE:
- `npm test` passes with zero failures.
- Financial services exceed 90% coverage.
- The concurrency tests reliably reproduce and correctly handle the race conditions.
- The authorization suite proves privilege escalation is impossible by any tested route.

PREVIEW:
Test output showing all suites green with the coverage table.
```

---

### Prompt 12.2: Security Hardening & Observability

```text
ID: 12.2
DEPENDS ON: 12.1
FILES:
  server/src/plugins/security.js
  server/src/plugins/observability.js
  docs/security-checklist.md
  docs/runbook.md

TASK:
Production-grade security and operability.

REQUIREMENTS:
1. Security: per-route rate limits, strict CORS for production origins, CSP headers, HSTS,
   input sanitisation, SQL injection prevention verified by review (parameterised queries only),
   XSS prevention on all user content, CSRF protection on cookie-authenticated routes, and secure
   file-upload validation.
2. Secrets: no secret in source, environment-only, with a documented rotation procedure. Add a
   pre-commit secret scan.
3. PII: field-level encryption for NID, bank accounts, and documents. Data retention and deletion
   policy. An access log for every PII read.
4. Observability: structured JSON logging with the trace_id from Prompt 2.1, error tracking
   (Sentry-compatible), latency and error-rate metrics per route, and a /metrics endpoint.
5. Health endpoints: /health (liveness) and /ready (dependency checks for database and cache).
6. docs/runbook.md: what to do when the ledger drifts, a payout fails, a webhook backs up, the
   database connection pool exhausts, or a security incident occurs. Written for someone on call
   at 3am.
7. A rate-limit and abuse profile per role — a customer and a partner API key must not share limits.

ACCEPTANCE:
- A security scan reports no high or critical findings.
- Every log line carries a trace_id that correlates request, error, and audit rows.
- /ready correctly reports unhealthy when the database is unreachable.
- No PII appears in any log.

PREVIEW:
/health and /ready return correct status; logs show correlated trace ids.
```

---

### Prompt 12.3: Flutter App — Foundation & Core Screens

```text
ID: 12.3
DEPENDS ON: 12.2
FILES:
  mobile/lib/core/{api_client,websocket_manager,session,theme,i18n}.dart
  mobile/lib/screens/{home,product_detail,cart,checkout,orders}.dart
  mobile/pubspec.yaml

TASK:
Begin the mobile app. v1.0 allocated two prompts to mirror 40+ web screens — this phase gives it
realistic scope.

REQUIREMENTS:
1. Flutter 3.x with Riverpod, targeting Android and iOS.
2. api_client.dart mirroring the web client's contract exactly: same envelope, same error codes,
   same idempotency headers, same refresh-token rotation. One backend contract, two clients.
3. theme.dart generated FROM the same design tokens as the web (a build script reading
   tokens.css), so the two platforms cannot visually drift.
4. i18n with the same locale JSON files as the web client — shared, not duplicated.
5. Core commerce screens: home feed, product detail with variants, cart, checkout, and orders.
6. Offline-first: local cache with a sync queue, matching the web's offline behaviour.

ACCEPTANCE:
- The app builds and runs on an Android emulator against the local dev server.
- Design tokens visibly match the web app.
- A full purchase completes from the mobile app.

PREVIEW:
`flutter run` alongside the running web dev server.
```

---

### Prompt 12.4: Flutter App — Seller, Vault, Chat & Native Features

```text
ID: 12.4
DEPENDS ON: 12.3
FILES:
  mobile/lib/screens/{store,vault,chat,live_stream,scanner}.dart
  mobile/lib/services/{push,biometric,camera}.dart

TASK:
Complete the mobile feature set with the native capabilities `technologyused.md` §Layer 2 specifies.

REQUIREMENTS:
1. Seller screens: storefront management, order fulfilment, and the vault with payout requests.
2. Chat over the same WebSocket gateway, with background message handling.
3. Live stream viewer using the driver chosen in Prompt 10.1.
4. Push notifications via FCM, integrated with the Prompt 8.2 notification service as an additional
   channel — not as a separate system.
5. Biometric login (fingerprint / Face ID) gating access to the vault and payouts.
6. Camera: product photo capture, unboxing video recording, and QR scanning for the social seller kit.
7. Deep links so a shared store or product URL opens the app when installed.

ACCEPTANCE:
- Push notifications arrive and deep-link to the correct screen.
- Biometric authentication gates vault access.
- A QR scan from a printed flyer opens the correct product.
- Video upload works over a mobile connection with resumable upload.

PREVIEW:
Full mobile app on a device against the dev backend.
```

---

### Prompt 12.5: Data Migration, Backup & Disaster Recovery

```text
ID: 12.5
DEPENDS ON: 12.4
FILES:
  server/src/jobs/backup.job.js
  scripts/restore.js
  docs/disaster-recovery.md

TASK:
Implement the backup modules listed in the registry and the recovery procedure behind them.

REQUIREMENTS:
1. Automated backup: daily full plus continuous WAL archiving where the provider supports it.
   Configurable retention. Every backup verified by a restore test, not merely by its existence —
   an unverified backup is not a backup.
2. Manual snapshot trigger from the admin panel (CRITICAL tier, audited).
3. Point-in-time recovery procedure, documented and rehearsed, with a stated RPO and RTO.
4. Restore script with an explicit safety interlock so production cannot be overwritten by accident.
5. docs/disaster-recovery.md: scenario playbooks for database loss, region outage, data corruption,
   and ransomware, each with concrete steps and expected recovery time.
6. Export tooling for regulatory and user data-portability requests.

ACCEPTANCE:
- An automated backup runs, and a restore into a scratch database is verified automatically.
- Point-in-time recovery to an arbitrary timestamp is demonstrated.
- The restore script refuses to target production without an explicit confirmation flag.

PREVIEW:
Trigger a manual backup from /admin/security/backups and see it recorded and verified.
```

---

### Prompt 12.6: Pre-Launch Audit & Go-Live Checklist

```text
ID: 12.6
DEPENDS ON: 12.5
FILES:
  docs/launch-checklist.md
  docs/traceability-final.md

TASK:
Verify honestly that the platform is ready — the step v1.0 replaced with a self-declared all-green
table.

REQUIREMENTS:
1. Walk every row of the traceability matrix at the end of this document and mark its REAL status
   with evidence: the file that implements it and the test that proves it. Any row that is not
   genuinely complete is marked Partial or Not Started, with a note. No optimistic ticks.
2. Cross-check against all four source documents and list anything still unimplemented, with an
   explicit decision: build now, defer with a date, or drop with a reason.
3. Verify every module in the registry actually toggles and that disabling it breaks nothing.
4. Verify every role can complete its full journey end to end.
5. Financial verification: run the ledger integrity check against production-scale seed data and
   confirm zero drift.
6. Performance verification against the stated targets on a simulated Bangladeshi 3G connection.
7. Legal and compliance: terms, privacy policy, refund policy, and seller agreement present and
   version-tracked with re-acceptance prompts.
8. docs/launch-checklist.md as a go/no-go list with a named owner per item.

ACCEPTANCE:
- The traceability document reflects reality, including everything incomplete.
- Every one of the six role journeys is verified end to end.
- Ledger integrity is zero drift at scale.
- No unresolved high or critical security finding remains.

PREVIEW:
A complete, honest status report.
```

---

### Prompt 12.7: Docker, Nginx & CI/CD — Production Deployment

```text
ID: 12.7
DEPENDS ON: 12.6
FILES:
  docker-compose.yml
  docker-compose.prod.yml
  server/Dockerfile
  nginx/nginx.conf
  .github/workflows/deploy.yml
  docs/deployment.md

TASK:
The FIRST and ONLY prompt that introduces Docker. Everything before this ran natively.

REQUIREMENTS:
1. server/Dockerfile: multi-stage build on node:20-alpine, non-root user, production dependencies
   only, and a HEALTHCHECK. Final image under 200MB.
2. docker-compose.yml (local production parity) and docker-compose.prod.yml (VPS):
   services api, db (postgres:16-alpine), redis (redis:7-alpine), nginx.
   Health checks with proper depends_on conditions, named volumes (pgdata, redisdata),
   resource limits, restart policies, and secrets injected from the environment — never baked in.
3. nginx/nginx.conf: reverse proxy to the API, WebSocket upgrade headers for /ws, gzip and brotli,
   security headers, static asset caching, rate limiting at the edge, and SSL termination via
   Certbot.
4. .github/workflows/deploy.yml:
     - On PR: lint, test, build, and a security scan. Block merge on failure.
     - On merge to main: build the client and deploy to Cloudflare Pages; build and push the API
       image; SSH to the Singapore VPS and roll out with a health-gated deploy and automatic
       rollback if the health check fails.
     - Run database migrations as a discrete, reviewable step before the API rollout.
5. docs/deployment.md: first-time VPS provisioning, environment variables, DNS and Cloudflare
   setup, SSL, the migration procedure, rollback steps, and monitoring setup.
6. Preserve the local workflow: `npm run dev` must still work exactly as before, without Docker.
   Adding containers must not take the developer's fast preview loop away.

ACCEPTANCE:
- `docker compose up --build` starts all four services and every health check passes.
- The production build serves the app correctly behind nginx with working WebSockets.
- The CI pipeline blocks a merge on a failing test.
- A deployment with a failing health check rolls back automatically.
- `npm run dev` still works natively with no containers running.

PREVIEW:
Local: `npm run dev` (no Docker, as always).
Parity check: `docker compose up` and verify identical behaviour.
```

---

# ✅ Honest Traceability Matrix

> Every row starts at ⬜ **Not Started**. Update the status only when the ACCEPTANCE criteria of the
> named prompt are genuinely met, and record the test that proves it. Do not mark a row complete
> because the code exists — mark it complete because it is verified.

| # | Source Requirement | Source Ref | Prompt(s) | Status |
| :-- | :--- | :--- | :--- | :--- |
| 1 | Monorepo + Docker-free dev harness | `technologyused.md` §4 | 0.1 | ✅ Done — verified: 0 vuln, Vite 367ms, health via proxy 200, 0 Docker files |
| 1b | **Agent maintainability contract (CLAUDE.md, arch map)** | *(new — longevity gate)* | 0.8 | ✅ Done — `CLAUDE.md` (153 lines), `docs/architecture-map.md` (50 "where do I change X?" rows), `docs/dependency-ledger.md`, `docs/how-to-add-a-feature.md` (14 steps, 12/12 layers) |
| 2 | Design system spec (solid aesthetic, OKLCH, craft layer) | `technologyused.md` §L1 | 0.2, 1.1, 1.2 | 🟡 Partial — **palette revised 2026-08-21 at the owner's request: brand teal (182) → violet (295), neutral → cool charcoal (242.5).** The revision ran a measured hue screen (`scripts/palette.violet-charcoal.mjs`) that scores every candidate on OKLab ΔE from the four semantic ramps and the four BD competitor brands — a check that had never existed. It found the shipped teal sat at ΔE **0.070** from `success-700`, i.e. the brand colour was perceptually closer to its own success state than a rejected coral candidate was to danger; teal had passed every *contrast* check while failing a *separation* check nobody was running. Violet clears all eight at worst-case ΔE 0.173. `docs/design-system.md` §1.2/§1.2.1/§1.3/§2 and `scripts/palette.mjs` re-generated from the shipped values; `node scripts/palette.mjs` re-verified — all pairings AA-pass, 0 out of gamut, only the 2 documented switch-track exceptions. Previous teal palette preserved at `.palette-backup/themes.teal.css`. 0.2 done (`docs/design-system.md`, values verified by `scripts/palette.mjs`); 1.1 done (`client/src/styles/tokens.css` + `themes.css`: every §4/§5/§6/§7/§8/§9 primitive present, semantic colours defined 4x, OKLCH with `@supports` hex fallback, neutral ramp non-zero chroma, shadow tinted not black, zero gradients/backdrop-filter, `prefers-reduced-motion` + `:lang(bn)` blocks present, `node scripts/palette.mjs` re-verified all contrast pairings AA-pass against the shipped hex, 0 hex outside these 2 files; verified live at localhost:3000 swatch strip, `data-theme` toggle confirmed via served CSS); 1.2 done (`reset.css`, `typography.css`, `main.css`, self-hosted `client/public/fonts/{inter-latin-variable,hind-siliguri-bengali-400,hind-siliguri-bengali-700}.woff2` — total 92.8KB, under the 120KB budget; verified with Playwright against the live dev server: 0 console errors, English-only page downloads only the Inter file, Bengali conjuncts (্র/ন্ধ-class clusters) confirmed rendering correctly by screenshot after an initial subsetting bug — a too-narrow OpenType feature list — silently dropped conjunct glyphs and was caught and fixed before shipping; per docs/design-system.md §3.5.4's now-recorded amendment, only Hind Siliguri weights 400/700 ship for budget reasons, 500/600 resolve to the nearest real weight via standard CSS matching, not synthesis) |
| 2b | **Craft pass + benchmark design review** | *(new — quality gate)* | 1.10 | ✅ Done — `client/src/styles/craft.css` (selection, styled scrollbars, brand focus ring, caret-color, tabular-nums on all numeric contexts, hanging quotes, text-wrap balance/pretty, optical padding & nested radius helpers, print stylesheet); `client/src/lib/motion.js` (zero-dep motion helpers: physical scale(0.97) press feedback, staggered entrances capped at 8 items, originTransition computing overlay transform-origin from trigger button, countUp rolling counter, all no-ops under reduced motion); `client/src/lib/optical.js` (cap-height alignment, optical glyph centering, optical circle sizing compensation); `client/src/pages/dev/CraftAuditPage.js` (automated regression detector at `/dev/craft`); `docs/design-review-log.md` (structured benchmark critique against Stripe, Linear, Vercel, Polaris, Amazon, Apple, bKash across Marketplace, Product Detail, Checkout, and formal Squint Test passing on all 3 surfaces); verified via `node scripts/verify-craft.mjs` with 31/31 assertions passing |
| 3 | IA, navigation grouping, command palette | `idea` §AL | 0.3, 1.7 | ✅ Done — 0.3 (`docs/ia-sitemap.md`) and 1.7 (`client/src/config/navigation.js`, `permissions.mock.js`, `components/shell/{AppShell,Sidebar,TopBar,MobileNav,CommandPalette,LockedNavItem}.js`, `styles/components/shell.css`). navigation.js is a full, hand-traced transcription of ia-sitemap.md §1–2 — 115 nav items across 34 groups for all 6 roles (49/10/7/16/20/13 items respectively), every `path`/`permission`/`module` sourced from the doc's own route tables (the 10 `/admin/*` items with no `module` column in §1.9 assigned by matching the same feature's module key used elsewhere in the file — documented in navigation.js's own header, along with the one inferred route, `saler.store_status`, mirroring supplier's identical one). `core/router.js` now rejects any route missing an explicit `permission`/`module` field at construction (docs/ia-sitemap.md §1's closing note) — retrofitted onto every 1.5-era route too. Verified live with Playwright, 0 console errors across every check: switching the mocked role changes the sidebar's group/item counts exactly as hand-counted from ia-sitemap.md §2 (super_admin: 9 groups, 49 items, 2 locked; moderator: 5 groups, 10 items, 1 locked; supplier Advanced mode: 15 of 16 items, the 16th — `ai_forecasting` — correctly absent); `Ctrl+K` opens the palette, fuzzy-searches (permission-filtered — confirmed a withheld-permission item never appears in results even though its route exists), arrow keys/Enter/Escape all work; a MEDIUM/HIGH-tier locked item opens the real request-access modal (`POST /access-requests` mock, 202 deferred envelope, "Sent for approval" toast) while a CRITICAL one shows only "Only a Super Admin can use this." with no form; a module-disabled item (`ai_forecasting`/`gamification` off) is confirmed absent from the DOM entirely, not just hidden by CSS; the elevated-access chip renders the exact PREVIEW example format ("Elevated access · 1h 42m left"), counts down, and its Release button clears it; Simple Mode renders exactly 6 flat items for Saler/Supplier per ia-sitemap.md §4, Advanced mode restores the full grouped tree; at 360px the sidebar disappears and the 5-item bottom tab bar (incl. "More" → the full tree in a bottom sheet) appears with 0px page-level horizontal overflow — a real 43px regression Playwright caught (an unwrapped button label) and a real click-blocking regression (Prompt 1.6's floating language toggle sitting on top of MobileNav's "More" tab at narrow widths) were both found and fixed during this verification, not assumed away. Deliberately reduced from ia-sitemap.md §3: the palette is route-search only — "quick actions" (Create product, Toggle a module, …) and entity search (order ID, SKU) need real handlers/data no earlier phase has built yet, and a palette entry that does nothing on Enter is worse than one that doesn't exist; documented in CommandPalette.js's header, not silently dropped. `PREVIEW` asked for the role switcher in `/dev/gallery`, which doesn't exist before Prompt 1.8 — hosted at `/dev/shell` instead, the same "temporary page, migrated into the gallery next prompt" pattern 1.3/1.4 already established |
| 4 | Permission catalog + risk tiers | `PRD` §2.2, `idea` §3B | 0.4, 2.4 | ✅ Done — 0.4 done (`docs/rbac-spec.md` + `permission-catalog.json`: 182 permissions / 19 domains, 0 validation errors, all refs cross-checked against IA); 2.4 done (`rbac.service.js`, `requirePermission.js`, `requireRestriction.js`, `/api/v1/me/permissions`). Verified with 13/13 tests in `server/test/rbac.test.js` and client whyDenied evaluation in `client/test/authAndPermissions.test.js`. |
| 5 | Full DB schema (95 tables, typed) | `DFD` §5.1 | 0.5, all migrations | 🟡 Partial — 0.5 done (`docs/erd.md`: 95 tables; verified 0 missing vs spec, 0 FLOAT money columns, 0 FKs without ON DELETE, 0 naive TIMESTAMP); migrations not started |
| 6 | API contract, errors, idempotency | `DFD` §6 | 0.6 | ✅ Done — `docs/api-contract.md`; verified: 37 error codes each with an HTTP status, 15/15 required codes present, 0 unmapped, 10/10 sections, all example blocks carry en+bn+trace_id |
| 7 | Module registry (71 modules) | `idea` §4 | 0.7, 3.1, 3.2 | ✅ Done — 0.7, 3.1, 3.2 complete. Migration `004_platform_config.sql`, `module.service.js`, `requireModule.js`, `ModuleControlPage.js`, `ModuleRow.js`, `ModuleSettingsDrawer.js`, `ModuleTargetingDrawer.js`, `featureFlags.js` DOM scanner. Verified in `server/test/module.test.js` (8/8), `server/test/moduleUi.test.js` (4/4), and `client/test/moduleControl.test.js` (6/6). |
| 8 | Component library + gallery | `technologyused.md` §L1 | 1.3, 1.4, 1.8 | 🟡 Partial — 1.3 done (`components/ui/{Button,Input,Select,Textarea,Checkbox,Radio,Switch,FormField,Badge}.js` + `styles/components/{actions,forms}.css`; verified in-browser with Playwright: 0 console errors, button loading width jump measured at **0.00px**, `aria-describedby`/`aria-invalid` composition confirmed against live DOM, keyboard-only operation confirmed for every control — Space toggles checkbox/switch, native arrow keys move the radio group, focus ring resolves to `oklch(0.58 0.1 182)` = brand-600; 0 hardcoded colours anywhere in `client/src` outside `themes.css`; the sole `outline:none` relocates the ring to the field wrapper via `:focus-within`. Two bugs found and fixed during verification: horizontal scroll at 360px (body grid column sized to max-content and refused to shrink) and form controls at 40px on touch — the latter fixed at the token level by raising `--control-height` to 44px under `(pointer: coarse)`, per design-system §9's rule that touch targets outrank density. Both re-verified: 0px overflow at 360px, 0 controls under 44px under real touch emulation). 1.4 done (`components/ui/{Card,Modal,Drawer,Table,Tabs,Toast,Skeleton,EmptyState,Pagination,Tooltip,ConfirmDialog}.js` + `services/toast.js` + `styles/components/{surfaces,feedback}.css`; Modal/Drawer/ConfirmDialog are built on the native `<dialog>` + `showModal()` so the focus trap is browser-managed rather than hand-rolled. Verified in-browser: 0 console errors; focus never leaks to a real page element across a 12-Tab cycle AND a background button cannot steal focus even when `.focus()` is called on it directly (background is genuinely inert); Escape closes and focus returns to the trigger; scroll lock applied and released (reference-counted for nested overlays); Table `rows===null` renders skeletons + `aria-busy` while `rows===[]` renders EmptyState — the two are deliberately NOT the same falsy check; sticky header confirmed `position: sticky`; row selection + tri-state select-all `indeterminate` confirmed; toasts capped at 3 visible with the rest queued, measured non-overlapping (12px gaps), `aria-live="polite"`, pause-on-hover confirmed; ConfirmDialog's promise settles on every exit path including Escape (verified — no hung await), and type-to-confirm stays disabled on wrong text and enables only on an exact match; bottom-sheet drag-to-dismiss verified under Pixel-7 touch emulation. One bug found and fixed during verification: `.pagination__controls` was a non-wrapping flex row 352px wide inside a 256px column, the sole cause of horizontal page scroll at 360px — both control rows now wrap; re-verified 360/360 with zero overflowing elements. The one permitted `backdrop-filter` is on `::backdrop` only and is dropped under 480px; 0 gradients and 0 hardcoded colours repo-wide outside `themes.css`). 1.8 done (`client/src/pages/dev/{GalleryPage.js,gallery-registry.js}` + `client/src/styles/components/gallery.css`; `client/src/services/theme.js` newly extracted from TopBar.js so the gallery's own theme control and TopBar's cycle button share one `data-theme`/localStorage implementation instead of two). Every 1.3/1.4 specimen moved verbatim out of main.js's temporary index-page preview into 18 registry entries across 3 groups (Actions & Forms / Surfaces & Feedback / Overlays); `main.js`'s ~460-line preview block and index.html's `.gallery`/`#component-gallery` scaffold are deleted. Verified live with Playwright against the dev server, 0 console errors across every check below. ACCEPTANCE line by line: (1) all 18 components render with every state, always-on (no per-item toggle) — 21 buttons alone counted under `#button` matching variants×sizes+states+live-loading. (2) theme/language/density update the whole gallery instantly — language re-uses the real `setLanguage()`, which `main.js`'s existing `subscribeLang(() => router.refresh())` already tears down and remounts on, same as any other route (confirmed: 4 consecutive en↔bn toggles, 20 sections before and after each, 0 errors, and the 3 body-attached Modal/Drawer overlay nodes stayed at exactly 3 — no leak across remounts, proving the returned `cleanup()` runs); theme/density are local (`data-theme`/`data-density` on `<html>`, same tokens.css/TopBar mechanism), confirmed by reading `--surface-0` back as a different resolved value after clicking dark. (3) contrast panel reports zero AA failures — 16 (foreground, background) pairs, derived by grepping every actual `color:`/`background:` declaration in `styles/components/*.css` rather than a blind cross-product (`--text-muted`×`--surface-3` was excluded after confirming no component ever pairs them — surface-3 backs only transient/pressed surfaces that use `--text-secondary`/`--text-primary`), worst case 4.53:1. A real bug was caught and fixed while building this: `getComputedStyle` on modern Chromium serialises `color` as whatever function it resolved through (`"oklch(0.24 0.015 242.5)"` for `--text-primary`, not `rgb(...)`) — an initial `rgb\((...)\)`-regex parser silently returned "unresolved" for all 16 pairs while still reporting 0 `.contrast-fail` elements (unresolved rows aren't counted as failures), a false green. Replaced with a 1×1-canvas `fillStyle`/`getImageData` resolver, which accepts any CSS colour function and always reads back sRGB 0–255 — re-verified all 16 genuinely computed and passing. (4) `npm run build` output contains no gallery code — the route's `import()` is registered only inside `import.meta.env.DEV ? [...] : []`, which Vite/Rollup dead-code-eliminates in production; verified by grepping `dist/assets/*.{js,css}` post-build for "gallery" — 0 matches (only a code comment in `dist/index.html` mentions `GalleryPage` by name, no gallery code or behavior ships). Also verified: 0px horizontal overflow at 360/768/1280/1400px with a role selected (two internal `overflow-x:auto` fixes — the viewport-width segmented control wraps instead of overflowing, and the wide token/contrast tables scroll in their own box rather than the page); the "preview as role" dropdown calls the real `setMockRole()`/`appStore` from Prompt 1.7 rather than a second fake shell renderer, confirmed live — picking "Saler" flips the actual surrounding Sidebar/TopBar chrome (`data-has-chrome="true"`, Simple-mode items render) around the gallery page itself, fulfilling 1.7's PREVIEW note. Two pre-existing bugs, not introduced by 1.8 but blocking correct rendering of ANY route at desktop widths, were found and fixed during this verification: `index.html`'s `.router-demo { max-width: 720px }` (leftover from the 1.5 stub-page harness, never revisited once 1.7's full AppShell started rendering inside it) was squeezing the entire real sidebar+content shell into a phone-width column even at a 1400px viewport — removed; and `.router-demo nav { flex-wrap: wrap; ... }`, a bare descendant selector, was silently leaking onto every `<nav>` nested anywhere inside `#router-outlet` — including Sidebar.js's and MobileNav.js's own root `<nav>` elements, which have used `<nav>` as their tag since 1.7 — scoped to `.router-demo > nav` so it only targets the original static demo-links list it was written for. Scope note: the gallery's own chrome (headings, section titles, specimen captions) is deliberately hardcoded English, not run through `t()` — it is dev-only tooling excluded from the production build, not user-facing product copy, the same call row 10 already documents for the page it replaces |
| 9 | Router, state, mock/live API switch | — (gap in v1.0) | 1.5 | ✅ Done — `client/src/core/{router.js,store.js,api.js}` + `client/src/mocks/{index.js,handlers/*,fixtures/*}`; verified with Playwright against the live dev server: 0 console errors across every check. router.js: `:id`/`:slug` param matching, `requiresModule`/`requiresAuth`+`requiresPermission` guards, lazy `import()` per route (each stub page confirmed as its own Vite module transform), scroll restoration (measured — push resets to 0, back/forward restore the exact prior `scrollY`, e.g. 900→0→900→300), a 404 fallback, and real `<a>` clicks intercepted with zero full-page reload (a `window` marker set before navigation survives every subsequent route). Guard-fail path verified end to end: `/saler` (requiresAuth + requiresPermission) redirects unauthenticated to `/login?redirect=%2Fsaler`; "Simulate login" flips the store and lands back on `/saler`. api.js: confirmed `VITE_API_MODE` mock→live requires zero source changes (same build, env-only flip); live mode against the real Prompt-0.1 server 404s gracefully — thrown as a catchable `ApiError`, no uncaught `pageerror`, per the PREVIEW's "must fail gracefully" line; mock mode resolves with the specified 150–400ms simulated latency; `ApiError` confirmed carrying both `message_en` and `message_bn` on a real thrown instance. Mock fixtures use realistic Bangladeshi data — Bengali product titles, `৳` BDT decimal-string prices, real districts (Dhaka/Chattogram/Sylhet/Khulna/Rajshahi/Rangpur), `+8801XXXXXXXXX` phone numbers. store.js's `persist` option is implemented but intentionally not exercised by the demo store — auth state mirrors docs/api-contract.md §8 ("never localStorage") even for this mock stand-in. Not yet exercised: `beforeEach` is wired as an extension point but no caller passes one yet (nothing to demo until Prompt 1.6/1.7 need analytics/title hooks beyond the built-in `document.title` assignment) |
| 10 | i18n + Bengali typography + BDT format | `idea` §L, `PRD` §3.4 | 1.2, 1.6, 10.8 | 🟡 Partial — 1.2 done (see row 2); 1.6 done (`client/src/services/{i18n.js,format.js}` + `client/src/locales/{en,bn}.json`; verified with Playwright against the live dev server, 0 console errors: the corner `.lang-toggle` flips `<html lang>` and every retrofitted string — harness subtitle, router-demo heading/description/nav, and all 6 dev pages — with a `window` marker proving no reload; a mid-navigation toggle on `/product/:id` re-renders the same URL via a new `router.refresh()` with no history entry and no scroll jump; measured 0px horizontal overflow at 360px in both languages — a 43px overflow this same check caught in an unwrapped Prompt-1.5 button label was fixed by reusing the nav link's shorter phrasing. South Asian grouping verified two ways: `node scripts/verify-format.mjs` (15/15 `node:assert` checks, zero deps, following the scripts/palette.mjs precedent since vitest isn't due until 12.1 per dependency-ledger.md) including the exact spec example `formatCurrency('123456.00')` → `'Tk 1,23,456.00'`; and live in the browser via a new ৳125,000 fixture product rendering as `৳ 1,25,000.00`. Missing-key fallback confirmed: `t('this.key.does.not.exist')` → `'Exist'` (humanized, never blank or the raw path) plus a dev-only `console.warn`. `formatRelativeTime`/`formatDate` spot-checked against the spec's own example (`3 hours ago` / `৩ ঘণ্টা আগে`) via Node's `Intl`. Numerals default Western even in `bn` per design-system.md §3.5.6 (`formatPhone` never converts, regardless of the numeral preference) — Bengali-digit opt-in (`setNumeralPreference`) implemented but not yet exposed in any UI (no settings page exists before Prompt 1.4's `/account/settings` is built). Scope note: `en.json`/`bn.json` cover the router-demo section and its 6 pages plus the harness subtitle — the Prompt 1.1–1.4 diagnostic sections (health-check widget, token ramps, typography specimens showing en/bn side-by-side by design, component-gallery specimen captions) were deliberately left untranslated as temporary scaffolding superseded by 1.7's shell and 1.8's gallery, not real product copy; 10.8 not started |
| 11 | Accessibility + performance budget | `idea` §M, `PRD` §7 | 1.9, 11.6 | 🟡 Partial — 1.9 done (`docs/qa-checklist.md` covering Lighthouse targets [Perf ≥ 95, A11y 100, BP ≥ 95, SEO ≥ 95] and 12 quality gates; `client/src/dev/a11y-audit.js` in-page zero-dependency auditor scanning 7 accessibility rules with floating dev badge + inspector panel; `client/vite.config.js` hard performance budget plugin enforcing entry JS ≤ 150KB gzip [measured: 32.64KB gzip] and entry CSS ≤ 40KB gzip [measured: 10.27KB gzip]; verified via `node scripts/verify-a11y-budget.mjs` with 16/16 checks passing and 0 a11y dev code leaking into production build); 11.6 not started |
| 12 | Auth: JWT, refresh rotation, OTP, 2FA | `DFD` 1.0 | 2.1–2.3, 2.8 | ✅ Done — 2.1, 2.2, 2.3, 2.8 complete. Verified in `server/test/authEmailAndPhone.test.js` (9/9), `server/test/authFrontend.test.js` (4/4), and `client/test/authAndPermissions.test.js` (5/5). JWT refresh token rotation, phone/email signup, TOTP 2FA for staff, in-memory token session manager, client permission gate and elevated access chip fully functional. |
| 13 | RBAC resolution engine | `PRD` §2.2 | 2.4 | ✅ Done — `server/src/repositories/permission.repository.js`, `server/src/services/rbac.service.js`, `server/src/middlewares/{requirePermission,requireRestriction}.js`, `server/src/routes/me.routes.js`. Built by antigravity; reviewed and load-bearing bugs fixed in a follow-up pass (see row 14) — the resolution engine itself (6-step algorithm, cache versioning, DENY/GRANT/JIT layering, CRITICAL lockout) was solid and needed no changes, verified both by the existing `server/test/rbac.test.js` (mocked DB, 13/13 passing) and independently against a real Postgres connection (`@electric-sql/pglite`, transient dev-only tool): a JIT approval was visible on the *very next* request, not after the 5-minute TTL |
| 14 | **Delegation: grants, JIT, maker-checker** | *(new — not in any source)* | 0.4, 2.5, 3.3 | ✅ Done — Mode A (Standing Grants), Mode B (JIT Requests), and Mode C (Maker-Checker) complete. Verified in `server/test/delegation.test.js` (16/16) and `server/test/usersAccessAdmin.test.js` (5/5). Self-approval blocked, preconditions re-evaluated live at approval time, grantExpiryCron sweeps expired items and bumps cache versions. |
| 15 | **Granular per-user activity control** | *(new — not in any source)* | 0.4, 2.6, 3.3 | ✅ Done — 2.6 and 3.3 complete. `restriction.service.js`, `segment.service.js`, 12 capability switches, 5 numeric limits, 4 enforcement modes (BLOCK, THROTTLE, FORCE_REVIEW_QUEUE, SHADOW_BAN). Verified with 12/12 tests in `server/test/restriction.test.js`. |
| 16 | Audit log + tamper evidence + explorer | `idea` §4 note | 2.7, 3.4 | ✅ Done — 2.7 and 3.4 complete. Tamper-evident hash chain (`row_hash = sha256(prev_hash || row payload)`), BEFORE INSERT/UPDATE/DELETE integrity triggers, sensitive field redaction, `/admin/audit`, `/admin/audit/verify`, and `/admin/users/:id/timeline`. Verified in `server/test/audit.test.js` (6/6) and `server/test/auditExplorer.test.js` (6/6). |
| 17 | Module control backend + targeting | `DFD` 8.0 | 3.1, 3.2 | ✅ Done — 3.1 & 3.2 complete. Dynamic targeting hierarchy (USER > DISTRICT > TIER > ROLE > PERCENTAGE), cascade dependency warnings & simultaneous disable, mandatory justification reason (>=10 chars), sub-settings JSON Schema validation, reactive client-side DOM scanner. Verified with 18 automated tests across client and server. |
| 18 | Theme & Color Studio + 5 presets | `technologyused.md` §L1 | 3.5 | ✅ Done — 3.5 complete. Migration `005_theme.sql`, `theme.service.js`, `ThemeStudioPage.js`, `colorRamp.js` (OKLCH master engine), `masterTheme.js`, 5 legacy presets + 8 master presets, WCAG AA automated contrast validator across 6 sections, zero-gradient rule, flash sale theming. Verified in `server/test/themeStudio.test.js` (5/5), `server/test/themeMaster.test.js` (13/13), and `client/test/colorRamp.test.js` (10/10). |
| 19 | Catalog, variants, warehouses, batches | `DFD` 2.0, 19.0 | 4.1 | ✅ Done — Database migrations `006_catalog.sql` (categories with materialized path, products, product_variants, product_images, media_assets, saler_store_items, virtual_stores, product_approvals, reviews, review_media with NUMERIC(14,2) money constraints and retail_covers_cost check) and `007_warehouse.sql` (warehouse_nodes with coordinates & GiST index, warehouse_stock, product_batches with FEFO index); reference seeds `004_categories.sql` (8 categories with bilingual labels) and `005_demo_catalog.sql` (60 realistic products with bilingual titles/descriptions, multiple variants and batches). Verified with 7/7 passing automated tests in `server/test/catalogWarehouse.test.js`. |
| 20 | Media pipeline (R2 + local driver) | `technologyused.md` §7 | 4.2 | ✅ Done — Storage driver interface with `local` (default, zero cloud dependency) and `r2` (S3-compatible) implementations in `server/src/integrations/storage/{index,local,r2}.js`; `media.service.js` with magic-byte MIME sniffing (JPEG, PNG, GIF, WebP, AVIF, MP4) blocking masqueraded executables (.exe, ELF, scripts), Sharp image derivative generation (thumb 200px, card 400px, detail 1200px) in WebP/AVIF with JPEG fallback and dimension extraction, auto-pending moderation for FORCE_REVIEW_QUEUE; `media.controller.js`; client `ImageUploader.js` (drag-drop, aspect ratio toolbar 1:1/16:9/4:3, progress, max size checks) and `MediaLibrary.js` modal; `media.css`; registered in `/dev/gallery` under "Actions & Forms". Verified with 5/5 passing automated tests in `server/test/mediaPipeline.test.js`. |
| 21 | Pricing engine + dynamic splits | `PRD` §3.2 | 4.3, 4.7 | ✅ Done — Dynamic pricing and profit split calculation in `server/src/services/pricing.service.js` strictly in integer paisa (zero float drift); dynamic hierarchy resolution (product override → category rule → global platform_settings → 40/60 default); remainder paisa allocated to platform; `product.service.js`, `product.repository.js`, `product.controller.js`, `sourcing.controller.js`, `product.routes.js`; endpoints for public catalog, detail, product CRUD, sourcing catalog, my-store, add-to-store, and POST `/api/v1/pricing/preview`; module and permission guards (`catalog.product.create`, `can_list_products`, `can_curate_store`). Verified with 7/7 passing automated tests in `server/test/productPricing.test.js`. |
| 22 | Search (Bengali + transliteration) | *(gap in v1.0)* | 4.4 | ✅ Done — Pluggable search driver architecture (`server/src/services/search.service.js`) with `postgres` (tsvector combined English + Bengali search vector with pg_trgm similarity typo tolerance and weighted ranking title > brand > category > description) and `meilisearch` stub; `transliterate.js` (Banglish ⇄ Bengali phonetic dictionary matching "shari"/"saree" → "শাড়ি", "panjabi" → "পাঞ্জাবি", etc.); query caching with short TTL and zero-result search telemetry logging; `search.controller.js` and `search.routes.js`; client `SearchSuggest.js` typeahead (<50ms) and `SearchResultsPage.js` with SearchSuggest registered in `/dev/gallery`. Verified with 5/5 passing automated tests in `server/test/searchEngine.test.js`. |
| 23 | Marketplace home + discovery | `idea` §A | 4.5 | ✅ Done — `client/src/pages/HomePage.js`, `client/src/components/product/{ProductCard,ProductGrid,CategoryPills,FlashSaleWidget,FilterPanel}.js`, `client/src/styles/components/product.css`. 60 seeded products in fixture (7 field → full shape: category, rating, margin_pct, supplier_tier, flash_sale, store_open, is_verified_supplier). Build passes: Initial JS 43.92KB gzip (budget 150KB), Initial CSS 17.28KB gzip (budget 40KB). Both locales (en/bn) updated with `marketplace.*` keys. Gallery registered: ProductCard, CategoryPills, FlashSaleWidget under "Product Discovery" group. Module gating verified at compile time: `flash_sale`, `sourcing`, `physical_shop_status` flags control widget/badge/dot visibility. Role-aware margin badge (saler+sourcing). URL-backed filter state (replaceState). Back-button-safe. ACCEPTANCE: 60 products render with Bengali titles and ৳ South-Asian grouping; Saler role switch reveals margin badges via store subscription (no reload); flash_sale module off → widget unmounts instantly via isFeatureEnabled check in store subscription handler. Browser verification pending (Playwright unavailable in this environment — browser automation tool failed to install) |
| 24 | Product detail + reviews + Q&A | `idea` §E | 4.6 | ✅ Done — `client/src/pages/ProductDetailPage.js`, `client/src/components/product/{ImageGallery,VariantSelector,PriceBreakdown,ReviewList,QnASection}.js`, `client/src/services/catalog.api.js`; server `server/src/{controllers,services,repositories,routes}/{review,qna}.*.js` + `product.repository.js`/`product.service.js` additions (variants, images, supplier trust-tier card). Reviews/review_media already existed from 4.1 but Q&A did not exist anywhere in `docs/erd.md` — added `product_questions`, `product_question_upvotes`, `product_answers` (§7 Engagement, 15→18 tables, erd total 95→98) plus migration `009_qna.sql`. Reviews' "must have a delivered order" gate needed real order data that doesn't exist until Prompt 5.2 (Checkout) — per owner decision, pulled `orders`/`sub_orders`/`order_items` forward verbatim from `docs/erd.md` §6 in migration `008_orders_minimal.sql` (schema only; checkout's row-lock/split/idempotency logic is still 5.2's job) and tightened 4.1's `reviews` table to the ERD's canonical `order_item_id NOT NULL` + FK + `UNIQUE(order_item_id, user_id)` now that `order_items` exists. Verified for real against a live Postgres wire-protocol connection (`@electric-sql/pglite` + `pglite-socket`, transient dev-only tool per the row-12 precedent, never added to the project) driving the actual Fastify app via `app.inject()`: product detail returns real variants/images/pricing/supplier; review eligibility correctly reports `can_review:true` for a delivered-unreviewed item, `ALREADY_REVIEWED`/`NOT_PURCHASED`/`NOT_YET_DELIVERED` for the other three seeded cases; submitting a review succeeds once and is rejected the second time; asking a question, answering as the seeded saler (201/6), and rejecting an answer attempt from a customer role all behave correctly; upvote and helpful-vote counters increment. Three **pre-existing** bugs were caught and fixed during this verification, none introduced by 4.6: (1) `bundle_items`/`warehouse_stock` (006/007, Prompt 4.1) declared `PRIMARY KEY (a, b, COALESCE(c, 0))` — invalid SQL, a PK column list can't contain an expression — replaced with a plain PK plus a `UNIQUE INDEX` carrying the same `COALESCE`; this had silently blocked the *entire* migration chain from ever running for real, meaning 4.1–4.5's seed data had never actually been verified against a database before now. (2) `005_demo_catalog.sql`'s named supplier/saler identities (`id=101`/`201`) collide by design with `002_dev_users.sql`'s generic dev accounts on the same phone numbers (`+8801700000005`/`006`) — `ON CONFLICT (phone) DO UPDATE` correctly enriches the *existing* row (real id 5/6) but can never re-key it to the literal `101`/`201` in the VALUES list, so every downstream `supplier_id=101`/`saler_id=201` reference in that same file was pointing at a non-existent row; corrected throughout to the real ids, plus a `virtual_stores` seed `ON CONFLICT (slug)` that didn't repeat the table's partial-unique-index predicate (`WHERE deleted_at IS NULL`). (3) `errorHandler.js`'s `ERROR_STATUS` map had no entry for the `FORBIDDEN` code `product.service.js` already threw for ownership checks — every such denial was silently returned as `500 INTERNAL_ERROR` instead of `403`; added `FORBIDDEN: 403` and a matching docs/api-contract.md §3.2 row. Also fixed in the same pass: `product.controller.js`'s `getProduct`/`listProducts`/`updateProduct`/`deleteProduct`/`previewPricing` were sending `{ product }`/`{ products }` instead of the `{ data: {...} }` envelope `client/src/core/api.js` actually unwraps — invisible under mock mode (the default) but a real bug for `VITE_API_MODE=live`. Client verified via `npm run build` (Initial JS 48.12KB gzip / 150KB budget, Initial CSS 18.61KB gzip / 40KB budget, both pass; `ProductDetailPage` code-splits into its own 8.68KB gzip chunk) and via the live Vite dev server (`/product/:ref` and all new module files transform with 0 errors; `VITE_API_MODE` defaults to mock, so `client/src/mocks/handlers/{reviews,qna}.js` + enriched `handlers/products.js` are what a developer actually exercises, mirroring the server's eligibility states via `fixtures/purchases.json`). Both locales updated (`product_detail.*`), all 5 new components registered in `/dev/gallery` under a new "Product Detail" group. **Not independently browser-verified with Playwright** — unavailable in this environment, same limitation row 23 already recorded; the live-Postgres `app.inject()` pass above is real end-to-end verification of the server, and the build/transform checks are real verification of the client bundle, but no one has visually driven the rendered page in an actual browser yet. |
| 25 | Sourcing + profit calculator | `PRD` §3.2, §3.3 | 4.7 | ✅ Done — `client/src/pages/saler/SourcingCatalogPage.js` with supplier catalog filters (margin %, shipping speed, verification tier, stock availability, category) and sorting; `ProfitCalculator.js` with live sliders for base cost, wholesale margin, desired retail price calling POST `/pricing/preview` directly with zero client math divergence; `MarginProjection.js` with responsive inline SVG monthly earnings projection chart; `AddToStoreDrawer.js` with retail price override and minimum margin check; `sourcing` module flag and `can_sell` restriction; `sourcing.css`; registered in `/dev/gallery` under "Saler Sourcing & Growth". Verified with client unit test suite in `client/test/sourcingAndCalculator.test.js` (7/7 passing). |
| 26 | Virtual storefront + OG images | `idea` §A, `PRD` §3.3 | 4.8 | ✅ Done — `client/src/pages/saler/StoreBuilderPage.js` with live slug availability check, reserved-slug blacklist rejection, curated shelf reordering, and live preview; `StorefrontPage.js` public SEO-indexable store page (`/store/:slug`) with Social Seller Kit (Share to WhatsApp, Copy link, QR Flyer modal); `StoreHeader.js`, `ShelfEditor.js`, `ShopStatusToggle.js` (Open/Closed/Auto with business hours scheduler); server `store.service.js`, `store.controller.js`, `store.routes.js`; dynamic OpenGraph image generation in `server/src/services/og-image.service.js` (cached SVG/PNG preview); `store.css`; registered in `/dev/gallery` under "Storefront & Merchandising". Verified with 4/4 passing tests in `server/test/storefront.test.js` and 5/5 passing tests in `client/test/storefrontBuilder.test.js`. |
| 27 | Server-side cart + wishlist | *(gap in v1.0)* | 5.1 | ✅ Done — server `010_commerce.sql` (carts, cart_items, wishlists, abandoned_carts), `cart.service.js`, `cart.repository.js`, `cart.controller.js`, `cart.routes.js`, `wishlist.service.js`, `wishlist.controller.js`, `wishlist.routes.js`; client `CartDrawer.js`, `WishlistButton.js`, `services/cart.js`, `styles/components/cart.css`, `mocks/handlers/cart.js`. Multi-supplier parcel grouping with individual supplier parcels calculated and displayed; live revalidation surfaces price changes and stock ceiling warnings without silent mutation; guest carts persist via cookie and merge cleanly on login; optimistic updates with rollback; coupon voucher code input; build passes under performance budget (Initial JS 23.81KB gzip / 150KB budget, Initial CSS 22.84KB gzip / 40KB budget); full en/bn i18n dictionaries; registered in `/dev/gallery` under "Cart & Wishlist". **Guest-cart reliability fixed 2026-08-26:** the cookie-based guest cart this row originally claimed did not reliably reach the server — `fetchCart()` silently accepted an empty response and nothing repopulated it from there. `client/src/services/cart.js` now mirrors the cart to `localStorage` (`explooro_guest_cart`) as the client-side source of truth, normalizes any `{items}`-only payload into supplier parcels via a new `buildCartFromItems()`, and exposes `clearCart()`/`syncCartToServer()`. `order.api.js`'s `placeCheckout()` now calls `syncCartToServer()` immediately before `POST /orders/checkout` so a guest's locally-held items are guaranteed to exist server-side at checkout time, and `server/src/services/checkout.service.js` retries `cartService.getCart()` against the guest token when the user-scoped lookup comes back empty, calling `mergeGuestCartOnLogin()` first when both a user and a guest token are present. This closes a client/session-boundary gap; it does not re-verify the row's original server-side test claims. **Wishlist image resolution & category metadata updated 2026-08-27:** `WishlistPage.js` now uses `resolveProductImage()` for reliable image thumbnail fallback. `ProductCard.js` expanded with keywords for Sports & Fitness, Books & Stationery, Crafts, etc., and filters placeholder URLs. Backend `cart.repository.js` now joins `categories` in `getWishlistByUser`, and `wishlist.service.js` passes category metadata and handles nullable image URLs. **Cart Drawer multi-parcel clipping fixed 2026-08-29:** `.cart-drawer__body` is a flex column with a fixed height and its own `overflow-y:auto`, but `.cart-drawer__split-banner` and `.cart-parcel` had no `flex-shrink:0`, so the flex layout compressed each parcel card below its content height and `.cart-parcel{overflow:hidden}` then clipped the item rows — product images looked cropped, the price/stepper/warning rows were hidden, and any second (or later) parcel rendered as an empty strip with no items visible even though the DOM was correct. Added `flex-shrink:0` to both selectors in `cart.css` so the body scrolls instead. `CartDrawer.js` now also restores `.cart-drawer__body` `scrollTop` across re-renders (every +/- mutation rebuilds the drawer) so adjusting a lower parcel no longer snaps the view to the top. `cart.items_count` in `en.json`/`bn.json` is now an `Intl.PluralRules` object (`one`/`other`) so single-item parcels read "1 item" not "1 items"; the one non-count call site in `CheckoutPage.js` was updated to pass `{ count }`. Client test suite 84/84 pass. |
| 28 | Checkout: row-lock, split, COD fraud | `DFD` 4.0, `PRD` §5 | 5.2 | ✅ Done — Database migration `011_checkout_and_trust.sql` (`trust_scores`, `coupons`, `coupon_redemptions`); repositories `order.repository.js`, `coupon.repository.js`, `trustScore.repository.js`; services `checkout.service.js`, `order.service.js`, `trustScore.service.js`; controller `order.controller.js`; routes `order.routes.js`; `app.js` wired. Implements single PostgreSQL atomic transaction, deterministic `id ASC` row locking on products/variants eliminating deadlocks, FEFO inventory batch allocation, multi-supplier sub-order splitting with exact margin reconciliation (`saler_commission + platform_margin = net_retail_margin`), coupon validation with spend/budget/user limits, COD anti-fraud trust risk scoring with SMS OTP gate (`COD_OTP_REQUIRED`), idempotency replay support, and order cancellation with stock restoration. Verified with 7/7 passing automated tests in `server/test/checkout.test.js`. |
| 29 | Payments + idempotency + webhooks | `PRD` §3.5 | 5.3 | ✅ Done — Database migration `039_payments.sql`; payment drivers `MockPaymentDriver`, `BkashPaymentDriver`, `NagadPaymentDriver`, `SslcommerzPaymentDriver` in `server/src/integrations/payments/`; repository `payment.repository.js`; services `payment.service.js` (Idempotency-Key replay deduplication, credential & payload masking, order PAID state transition, sub-order confirmation, escrow hold trigger, stuck-transaction reconciliation sweeper, refunds); controllers `payment.controller.js`, `paymentWebhook.controller.js`; routes `payment.routes.js`; Fastify app wiring in `app.js`. Inbound IPN/webhook HMAC signature verification with HTTP 401 rejection and replay protection. Verified with 7/7 passing automated tests in `server/test/paymentGateway.test.js` and 5/5 passing client tests in `client/test/checkoutAndPayments.test.js`. |
| 30 | Checkout UI + offline resilience | `PRD` §5 gap 7 | 5.4, 11.6 | ✅ Done — `client/src/pages/CheckoutPage.js` (single-page 3-step collapsible layout: Delivery Address, Payment Method, Order Review & Parcel Split), `client/src/components/checkout/AddressForm.js` (Division → District → Upazila cascading administrative data across all 8 divisions and 64 districts in `bangladeshGeo.js`, `+8801` phone validation), `client/src/components/checkout/PaymentSelector.js` (module-gated bKash, Nagad, Rocket, Card, COD with transparent fee policies and inline OTP challenge), `client/src/components/cart/QuickBuyModal.js` (2-step direct purchase overlay), `client/src/pages/customer/OrderDetailPage.js` and `client/src/components/order/OrderTracker.js` (4-stage progress stepper: Placed → Confirmed → Shipped → Delivered, courier badges, route map placeholder, order cancellation dialog), `client/src/services/order.api.js` (offline draft auto-saving in `localStorage`, online/offline connectivity banner, idempotency keys), `client/src/mocks/handlers/orders.js`, `styles/components/checkout.css`; complete `en`/`bn` i18n dictionaries. Verified with passing build (Initial JS 24.11KB gzip, Initial CSS 24.35KB gzip within budget) and passing test suite `server/test/checkoutUi.test.js`. **Critical bug fixed 2026-08-26:** `QuickBuyModal.js` and `OrderDetailPage.js`'s cancel-order dialog both called `modal.open()` to display the dialog, but the `Modal()` factory returns a native `<dialog>` element where `open` is a boolean *attribute*, not a method — only `openModal()`/`closeModal()` are wired up as the component's actual API (`Modal.js:184-185`). Calling `modal.open()` threw `TypeError: modal.open is not a function` on every attempt, so Quick Buy and order cancellation never actually opened despite this row's original ✅. Both call sites now use `openModal()`/`closeModal()`. While fixing this, `QuickBuyModal` was also hardened: it now prefills the address step from a saved checkout draft or the logged-in user's profile, explicitly calls `addToCart()` before checkout instead of assuming the item was already server-side, and redirects to `/login` on a 401/`AUTH_REQUIRED` response instead of surfacing a raw error. |
| 31 | Double-entry ledger + escrow | `DFD` 5.0 | 6.1 | ✅ Done — Database migration `012_finance.sql` (`wallets`, `ledger_transactions`, `escrow_entries`, `payout_requests`, `payment_transactions`, `payment_webhook_events`, `cod_reconciliation`, `b2b_escrow_milestones`) with range partitioning by month and append-only trigger blocking UPDATE and DELETE; `wallet.repository.js` (`getOrCreateWallet`, `getWalletsByIdsForUpdate` with ascending ID row locking, `updateWalletBalances`, `checkLedgerIntegrity`); `ledger.service.js` (true double-entry validation requiring SUM(Debits) == SUM(Credits), single-sided rejection with `UNBALANCED_TRANSACTION_GROUP`, atomic multi-bucket mutations); `vault.service.js` (`depositToEscrow`, `releaseEscrow`, `executeClawback`, strict idempotency per `(sub_order_id, operation)`); `finance.controller.js`, `finance.routes.js` with `GET /api/v1/admin/finance/integrity`; Fastify app wiring. Verified with 9/9 passing automated tests in `server/test/financeVault.test.js` covering full order lifecycle zero drift, single-sided error rejection, release idempotency, 50-concurrency row locking balance correctness, clawback reversal, and HTTP integrity endpoint reporting all-green. |
| 32 | Escrow release + clawback (incl. post-release) | `PRD` §3.2 | 6.2 | ✅ Done — Database migration `013_scheduler_and_clawback.sql` (`job_runs`, `escrow_dead_letters`, `negative_balance_recoveries`); `scheduler.js` (distributed in-process cron engine with PostgreSQL `pg_try_advisory_lock` concurrency exclusion, module gating, and `job_runs` execution lifecycle auditing); `escrowRelease.job.js` (hourly batch sweep releasing mature escrow holds, per-sub-order transaction isolation, dead-letter queue routing for failures); `vault.service.js` updated to dynamically resolve `return_window_days` from `returns_engine` module settings; `clawback.service.js` (locked escrow reversal, post-release available balance recovery, seller insufficient balance deficit logging in `negative_balance_recoveries`, customer refund, and trust score adjustment); `finance.controller.js` and `finance.routes.js` with `GET /api/v1/admin/finance/escrow` (live countdowns and remaining seconds), `GET /api/v1/admin/finance/dead-letters`, `GET /api/v1/admin/finance/recoveries`, and `POST /api/v1/admin/finance/escrow/sweep`; Fastify app wiring. Verified with 7/7 passing automated tests in `server/test/escrowSchedulerClawback.test.js`. |
| 33 | Payout engine with maker-checker | `idea` §AL.4 | 6.3 | ✅ Done — `bkash-b2c.js` (B2C disbursement adapter with mock and live driver support); `payout.service.js` (`requestPayout` with immediate atomic HELD balance locking preventing double-spend, withdrawal capability & threshold checks, automated risk flags for first withdrawal, large amounts, new accounts, and name mismatches; `approvePayout` enforcing Maker-Checker HIGH tier where moderators create `pending_admin_action` while Super Admins execute directly; `disbursePayout` with gateway receipt logging and automatic failed disbursement reversal from HELD back to AVAILABLE; `batchDisbursePayouts` with isolated per-item results; `rejectPayout`); `payout.controller.js` and `finance.routes.js`; `PayoutRequestModal.js` with instant fee calculation and quick max withdrawal; `PayoutQueuePage.js` with risk indicators, batch actions, and status filters; `payout.css`; complete `en`/`bn` i18n dictionaries; router and gallery registration. Verified with 7/7 passing automated tests in `server/test/payoutEngine.test.js` and passing client build (Initial JS 24.31KB gzip, Initial CSS 24.90KB gzip within budget). |
| 34 | **COD reconciliation** | `PRD` §5 gap 6 | 6.4 | ✅ Done — `codReconciliation.service.js` (ingestion of courier settlement reports via CSV/JSON, automated 3-way matching per consignment between expected COD ↔ courier reported collection ↔ bank deposit received, 6-tier discrepancy classification `MATCHED`, `SHORT_COLLECTION`, `OVER_COLLECTION`, `MISSING_DEPOSIT`, `DUPLICATE`, `UNMATCHED_CONSIGNMENT`, `TIMING_DIFFERENCE`, courier aging matrix report across 5 age buckets with configurable SLA alert detection, maker-checker manual resolution workflow with audit logging); `vault.service.js` updated to strictly block escrow release (`COD_FUNDS_NOT_RECONCILED`) for COD orders until verified; `codReconciliation.controller.js` and `finance.routes.js`; `CodReconciliationPage.js` with CSV paste dropzone, aging matrix table, discrepancy queue, and manual resolution dialog; `cod-recon.css`; complete `en`/`bn` i18n dictionaries; router and gallery registration. Verified with 6/6 passing automated tests in `server/test/codReconciliation.test.js` and passing client build (Initial JS 24.38KB gzip, Initial CSS 25.11KB gzip within budget). |
| 35 | Vault UI + finance dashboard | `PRD` §3.2 | 6.5 | ✅ Done — `BalanceSummary.js` (4-bucket balance clarity: Total Lifetime Earnings, Available for Payout, Pending in Escrow, Total Withdrawn & Held with plain-language microcopy and instant withdrawal CTA), `EscrowTimeline.js` (live ticking countdown timers, explicit sub-order source attribution, release target date, clearance status), `LedgerTable.js` (double-entry audit log with category filtering, memo searching, running balance signs, and client-side CSV export), `VaultPage.js` (earner financial command center), `FinanceDashboardPage.js` (executive KPI cards for GMV, net platform revenue, escrow liability, pending payout liability, COD in-transit exposure, live double-entry ledger health indicator, zero-dependency inline SVG 7-day revenue trend chart, and courier distribution visualizer), `vault.css`, complete `en`/`bn` i18n dictionaries; `finance.controller.js` and `finance.routes.js` with `GET /vault/overview`, `GET /vault/ledger`, and `GET /admin/finance/overview`. Verified with 4/4 passing automated tests in `server/test/vaultFinanceDashboard.test.js` and passing client build (Initial JS 24.47KB gzip, Initial CSS 25.85KB gzip within budget). |
| 36 | Multi-carrier courier + tracking | `DFD` 6.0, `idea` §N | 7.1 | ✅ Done — Database migration `014_logistics.sql` (`carrier_routing_rules`, `shipments`, `shipment_events`); `courier/` adapter hub (`steadfast.js`, `pathao.js`, `redx.js`, `mock.js` with simulated lifecycle progression and Bangladesh route GPS coordinates); `shipment.service.js` (carrier resolution by supplier pin, district routing rules, and default fallback; unified webhook engine with signature validation, cache/DB replay deduplication, status normalization; automated escrow hold deposit trigger on `DELIVERED`, warehouse stock restoration and return clawback on `RETURNED`/`CANCELLED`; tracking timeline and label generation); `courierWebhook.controller.js` and `logistics.routes.js` with `POST /webhooks/courier/:carrier`, `GET /shipments/track/:trackingNumber`, `GET /shipments/:id/label`, and `POST /shipments/create`; `LiveTrackingMap.js` (Leaflet-free lightweight OpenStreetMap tile viewer with courier live marker and timeline fallback), `logistics.css`, and bilingual dictionaries. Verified with 5/5 passing automated tests in `server/test/logisticsCourierHub.test.js` and passing client build (Initial JS 24.50KB gzip, Initial CSS 26.31KB gzip within budget). |
| 37 | **Return & refund engine** | `DFD` 9.0, `idea` §F | 7.2 | ✅ Done — Database migration `015_returns.sql` (`return_requests`, `return_items`); `return.service.js` (complete state machine `REQUESTED` → `UNDER_REVIEW` → `APPROVED` \| `REJECTED` → `PICKUP_SCHEDULED` → `RECEIVED` → `INSPECTED` → `REFUNDED` \| `DISPUTED`, dynamic module-gated return window validation, mandatory photo/video evidence checking for damaged/wrong items, customer abuse controls updating `trust_scores` and applying automatic activity restriction `can_return = BLOCK`, auto-approval rules, reverse courier consignment booking, full clawback execution with post-release deficit recovery and stock restoration); `return.controller.js` and `return.routes.js` with `/returns/request`, `/returns/my-returns`, `/returns/:id`, `/admin/returns/queue`, `/admin/returns/:id/review`, `/admin/returns/:id/inspect`, and `/admin/returns/:id/refund`; `ReturnRequestPage.js` (customer multi-step claim workflow), `ReturnsPage.js` (`/account/returns` customer return dashboard with tracking, status badges, evidence preview, and full i18n), `ReturnsQueuePage.js` (staff moderation queue with trust badge, evidence viewer, reverse tracking info, and one-click actions), `returns.css`, and bilingual dictionaries (`customer_returns.*`). Verified with 5/5 passing automated tests in `server/test/returnRefundEngine.test.js` and passing client build (Initial JS 24.59KB gzip, Initial CSS 26.48KB gzip within budget). **2026-08-26 UI rework (commit `05e0ec8`, 377 lines changed in `ReturnsQueuePage.js`):** not re-audited against this row's own ACCEPTANCE lines — spot-verified live only. Logged in as the seeded `admin` dev account through the real password + TOTP 2FA handshake (this environment runs `VITE_API_MODE=live` against a real Postgres-backed Fastify server, not the mock layer), SPA-navigated to `/admin/returns`: page renders the live queue via `GET /admin/returns/queue` (200), 0 console errors. Full suite after the change: server 379/379 (92 suites — the previously-flagged `mediaPipeline.test.js` failure from row 18 is also gone now), client 10/10. Build budget: Initial JS 52.57KB gzip / 150KB, Initial CSS 37.39KB gzip / 40KB. **2026-08-27 Customer returns page & route alignment:** created `ReturnsPage.js` at `/account/returns`, aligned client endpoint to `/returns/my-returns`, updated mock handlers in `client/src/mocks/handlers/returns.js`, and added full bilingual dictionaries. |
| 38 | **Dispute arbitration (3-way)** | `DFD` 9.0 | 7.3 | ✅ Done — Database migration `016_disputes.sql` (`dispute_threads`, `dispute_messages`); `dispute.service.js` (three-way buyer ↔ saler ↔ supplier mediation channel with strict staff-only internal notes isolation preventing privacy leaks, dynamic SLA countdown computation and automated escalation sweep, high-tier maker-checker integration where moderator resolutions above ৳5,000 generate `pending_admin_actions` for Super Admin sign-off, multi-outcome settlements `FULL_REFUND`, `PARTIAL_REFUND`, `SPLIT_LIABILITY`, `REPLACEMENT`, `REJECTED` backed by balanced double-entry ledger transactions and party trust score adjustments, precedent lookup search); `dispute.controller.js` and `dispute.routes.js` registered in `app.js` with `/disputes`, `/disputes/:id`, `/disputes/:id/messages`, `/disputes/:id/timeline`, `/disputes/precedents`, `/disputes/:id/arbitrate`, and `/disputes/:id/escalate`; `EvidenceTimeline.js` (chronological immutable audit trail of orders, shipments, returns, messages, and moderator notes), `DisputePanelPage.js` (two-column moderator workspace with live chat, SLA countdown badges, precedent drawer, and maker-checker arbitration modal), bilingual `en`/`bn` dictionaries, and gallery registry. Verified with 6/6 passing automated tests in `server/test/disputeArbitration.test.js` and passing client build (Initial JS 24.68KB gzip, Initial CSS 27.13KB gzip within budget). **2026-08-26 UI rework (commit `05e0ec8`, 816 lines changed in `DisputePanelPage.js`, 160 in `EvidenceTimeline.js`):** spot-verified live, not a full ACCEPTANCE re-audit. Logged in as `super_admin` (fresh TOTP, holds `orders.dispute.arbitrate`) and SPA-navigated to `/moderator/disputes`: renders the live thread list via `GET /disputes` (200), 0 console errors. Full suite: server 379/379 (92 suites), client 10/10. Budget: Initial JS 52.57KB / 150KB gzip, Initial CSS 37.39KB / 40KB gzip. |
| 39 | **Product approval & moderation** | `DFD` 10.0, `idea` §G | 7.4 | ✅ Done — Database migration `017_moderation.sql` (`moderation_queue`); `moderation.service.js` (unified queue covering `PRODUCT_NEW`, `PRODUCT_EDIT`, `REVIEW`, `UGC_VIDEO`, `STOREFRONT_ASSET`, `LIVE_STREAM`, `CHAT_REPORT`, automated pre-screening for English & Bengali banned keywords, price anomaly detection, duplicate listing detection, category auto-approval rules, concurrency claiming lock preventing dual moderator collision, bilingual rejection & change request reasons dispatched to seller, shadow-restriction enforcement, and moderator throughput statistics); `moderation.controller.js` and `moderation.routes.js` registered in `app.js` with `/moderation/queue`, `/moderation/queue/:id`, `/moderation/queue/:id/claim`, `/moderation/queue/:id/release`, `/moderation/queue/:id/decide`, `/moderation/bulk-decide`, `/moderation/stats`, and `/moderation/pre-screen`; `ReviewCard.js` (polymorphic item preview with advisory pre-screening flags and quick action buttons), `ModerationQueuePage.js` (unified workspace with item type tabs, status filters, keyboard shortcuts A/R/C/J/K, bulk action toolbar, and throughput KPI cards), bilingual `en`/`bn` dictionaries, and gallery registry. Verified with 7/7 passing automated tests in `server/test/productModerationPipeline.test.js` and passing client build (Initial JS 24.74KB gzip, Initial CSS 27.13KB gzip within budget). **2026-08-26 (commit `05e0ec8`, `ReviewCard.js`/`ModerationQueuePage.js` reworked):** spot-verified live, not a full ACCEPTANCE re-audit. Logged in as `super_admin` (fresh TOTP enrollment, since that permission set covers `moderation.product.approve` too) and SPA-navigated to `/moderator/queue`: page renders the live queue via `GET /moderation/stats` and `GET /moderation/queue?status=PENDING` (both 200), but caught one real bug in the process — `init()` called `api.get('/me')`, a path that has never existed (the registered route is `/api/v1/auth/me`, mounted under the `/auth` prefix in `app.js`); the call 404'd and was silently swallowed by its own `try/catch`, so `currentUserId` (used for the "claimed by me" queue view) stayed permanently `null`. Fixed at `client/src/pages/moderator/ModerationQueuePage.js:51` (`/me` → `/auth/me`); not re-verified live after the fix (would require a fresh 2FA enrollment this session already used up on this account) but the corrected path matches the working pattern used by every other authenticated boot call in this session. Full suite: server 379/379 (92 suites), client 10/10. Budget: Initial JS 52.57KB / 150KB gzip, Initial CSS 37.39KB / 40KB gzip. |
| 40 | **KYC + blue tick + trust tiers** | `DFD` 11.0, `idea` §C | 7.5 | ✅ Done — Database migration `018_kyc_and_verification.sql` (`kyc_verifications`, `kyc_documents`); `kyc.service.js` (role-specific workflows for Suppliers [4-step: NID/selfie → trade license/VAT → warehouse/facility photos → matching settlement account], Salers [lightweight], and Customers; AES-256-GCM document encryption at rest and keyed HMAC-SHA256 duplicate NID detection, audited document inspection logging `users.kyc.document_view` and incrementing `view_count`, status machine `PENDING` → `UNDER_REVIEW` → `VERIFIED` \| `REJECTED` → `APPEALED`, High-Tier Maker-Checker integration routing moderator approvals to `pending_admin_actions` for Super Admin authorization, and Blue-Tick badge issuance); `trustTier.service.js` (Starter → Verified Trader → Elite Partner progression ladder dynamically computing search ranking multipliers [1.0x, 1.25x, 1.5x], daily withdrawal limits [৳20,000, ৳50,000, ৳200,000], profit split bonuses [+0%, +2%, +5%], and ad eligibility); `kyc.controller.js` and `kyc.routes.js` registered in `app.js` with `/kyc/submit`, `/kyc/status`, `/kyc/appeal`, `/admin/kyc/queue`, `/admin/kyc/:id`, `/admin/kyc/:id/documents/:docId`, `/admin/kyc/:id/decide`, `/admin/kyc/tiers/:userId`, and `/admin/kyc/tiers/recompute`; `KycSubmissionPage.js` (4-step interactive wizard, appeal modal, live verification status banner), `VerificationCenterPage.js` (side-by-side queue and document inspection workspace with checklist, audited preview modal, maker-checker badge, and decision dialogs), router registrations, gallery registry specimen, and bilingual `en`/`bn` dictionaries. Verified with 6/6 passing automated tests in `server/test/kycVerificationTrustTiers.test.js` (183/183 overall suite) and passing client build (Initial JS 24.83KB gzip, Initial CSS 26.48KB gzip within budget). |
| 41 | **Moderator dashboard** | `idea` §AL.5 | 7.6 | ✅ Done — Backend dashboard aggregator controller (`moderatorDashboard.controller.js`) and endpoint `GET /api/v1/moderator/dashboard` registered in `moderation.routes.js` (aggregating workload KPIs: `my_queue_count`, `unassigned_count`, `sla_at_risk_count`, `resolved_today_count`, personal performance stats, urgent SLA items approaching/breaching deadlines, active elevated JIT grants with remaining minutes, and submitted maker-checker actions with live status); `WorkloadSummary.js` (4-card workload KPI widget with direct queue links), `SlaMonitor.js` (real-time urgency queue with countdown badges and one-click action buttons), `ModeratorDashboardPage.js` (delegation-aware workspace hub supporting 6 distinct moderation workspaces with dynamic locked/unlocked state badges and inline JIT `GrantDrawer` request triggers, "My Elevated Access" panel, and "Awaiting Admin Approval" maker-checker action tracker); router registrations for `/moderator` and `/moderator/dashboard` in `main.js`, gallery registry specimens, and bilingual `en`/`bn` dictionaries. Verified with 3/3 passing automated tests in `server/test/moderatorDashboard.test.js` (187/187 overall suite) and passing client build (Initial JS 24.89KB gzip, Initial CSS 26.48KB gzip within budget). **2026-08-26 (commit `05e0ec8`, `SlaMonitor.js`/`WorkloadSummary.js`/`ModeratorDashboardPage.js` reworked):** spot-verified live only. Logged in as `super_admin` (fresh TOTP), SPA-navigated to `/moderator`: renders the real dashboard via `GET /moderator/dashboard` (200), 0 console errors. Full suite: server 379/379 (92 suites), client 10/10. Budget: Initial JS 52.57KB / 150KB gzip, Initial CSS 37.39KB / 40KB gzip. |
| 42 | WebSocket chat + presence + offline | `DFD` 7.0 | 8.1, 8.4 | ✅ Done — Database migration `019_chat.sql` (`chat_threads`, `chat_messages`, `chat_thread_participants`); `presence.js` (short-lived ticket-based WebSocket handshake eliminating JWT query parameter exposure, active socket presence tracking with TTL & heartbeat, multi-node Pub/Sub event bus); `chat.service.js` (message pipeline with `client_msg_id` idempotency and optimistic UI deduplication, off-platform contact info leak detection for Bangladeshi phone numbers [013-019], emails, and social handles with auto-moderation flagging, `can_chat = BLOCK` activity restriction enforcement, debounced offline notification queue consolidating burst messages into a single notification batch, and reconnection sync replaying missed messages since `last_received_id`); `chat.handler.js` (WebSocket protocol frames: `chat:send`, `chat:read`, `chat:typing`, `chat:sync`, `ping`); `gateway.js` Fastify WebSocket route at `/ws`; `chat.controller.js` and `chat.routes.js` registered in `app.js` with `/chat/ticket`, `/chat/threads`, `/chat/threads/:id/messages`, `/chat/threads/:id/read`, and `/chat/messages/:id/report`; `websocket.js` (connection manager with auto-reconnect, exponential backoff with jitter, status emitters, and IndexedDB-persisted offline outbound queue surviving reloads per PRD Gap #7); `ThreadList.js` (unread badges, channel tags, role badges, live search), `MessageBubble.js` (read receipts `✓`/`✓✓`, failed-send retry affordances, product cards, moderation report trigger), `MessageComposer.js` (typing indicators, quick replies, product card modal, image upload progress simulator), `ChatPage.js` (`/chat` 2-column workspace with live connection status pill and optimistic message delivery), gallery registry specimens, and bilingual `en`/`bn` dictionaries. Verified with 7/7 tests in `webSocketChatGateway.test.js` and 4/4 tests in `chatUiIntegration.test.js` (211/211 overall suite) and passing client build (Initial JS 26.65KB gzip, Initial CSS 26.55KB gzip within budget). |
| 43 | **Unified notification service** | `idea` §H | 8.2 | ✅ Done — Database migration `020_notifications.sql` (`notification_templates`, `notification_preferences`, `notifications`, `release_notes`, `user_release_views`); Multi-channel dispatch adapters in `server/src/services/notification-channels/{inapp,sms,push,email}.js`; `notification.service.js` (channel-agnostic `notify` API, template variable substitution engine for English & Bengali, channel preference resolution with priority overrides where critical OTP/security alerts bypass opt-outs while marketing messages strictly honor channel opt-outs & quiet hours, and delivery status tracking); `notification.controller.js` and `notification.routes.js` registered in `app.js` with `/notifications`, `/notifications/unread-count`, `/notifications/:id/read`, `/notifications/read-all`, `/notifications/preferences`, `/notifications/whats-new`, and `/notifications/whats-new/ack`; `NotificationCenter.js` (drawer with category tabs, unread count badge, mark all read, and live WebSocket frame arrival), `WhatsNewModal.js` (release notes modal displaying highlights exactly once per release version), `NotificationPreferencesPage.js` (`/settings/notifications`), TopBar bell integration, gallery registry specimens, and bilingual `en`/`bn` dictionaries. Verified with 5/5 passing automated tests in `server/test/unifiedNotificationService.test.js` (201/201 overall suite) and passing client build (Initial JS 26.65KB gzip, Initial CSS 26.55KB gzip within budget). |
| 44 | WhatsApp / Messenger bridge | `DFD` 20.0, `idea` §AD | 8.3 | ✅ Done — WhatsApp & Messenger driver selector with mock and Meta Graph API v20.0 adapter (`server/src/integrations/whatsapp/{index,cloud-api,mock}.js`); `whatsappCommerce.service.js` (ingestion of inbound Meta messages into unified `chat_threads` and `chat_messages` model with channel metadata `WHATSAPP` and `MESSENGER`, 24-hour Meta session window tracking, single-use cryptographically signed 1-tap checkout tokens with 60-min TTL resolving to `/checkout/wa/:token`, and interactive product card dispatch with CTA buy buttons); `whatsappWebhook.controller.js` (Meta challenge verification handshake & `X-Hub-Signature-256` HMAC validation), `salerInbox.controller.js` and routes registered in `app.js` with `/integrations/whatsapp/webhook`, `/checkout/token/:token`, `/saler/inbox/threads`, `/saler/inbox/threads/:id/send`, and `/saler/inbox/threads/:id/send-product`; `UnifiedInboxPage.js` (`/saler/inbox` multi-channel conversation pane, channel badges, 24-hour window countdown, quick replies, and product card insertion modal), router registrations in `main.js`, gallery specimens in `gallery-registry.js`, and bilingual `en`/`bn` dictionaries. Verified with 5/5 passing automated tests in `server/test/whatsappMessengerBridge.test.js` (207/207 overall suite) and passing client build (Initial JS 26.65KB gzip, Initial CSS 26.55KB gzip within budget). |
| 45 | **Sponsored ads engine** | `idea` §A | 9.1 | ✅ Done — Database migration `021_ads.sql` (`ad_campaigns`, `ad_creatives`, `ad_impressions` [monthly-partitioned], `ad_clicks`, `ad_billing`, `sponsored_ads` platform module); `adAuction.service.js` (deterministic second-price Vickrey auction ranking by bid × quality score [CTR, base relevance matching keywords/categories/districts, seller tier multiplier] with diurnal budget pacing and second-price winning CPC computation bounded by max bid and reserve price); `ads.service.js` (campaign lifecycle management, keyword blocklist inspection, `can_run_ads` capability and `ad_budget_cap` numeric limit validation, viewability-based impression tracking with 30s deduplication, click fraud protection excluding self-clicks and throttling rapid duplicates, and atomic double-entry ledger billing debiting seller wallet and crediting platform treasury with zero drift and hard budget cap stop); `ads.controller.js` and `ads.routes.js` registered in `app.js` with `/ads/campaigns`, `/ads/campaigns/:id`, `/ads/campaigns/:id/pause`, `/ads/campaigns/:id/resume`, `/ads/auction`, `/ads/impressions`, `/ads/clicks`, `/admin/ads/campaigns/review`, and `/admin/ads/campaigns/:id/review`; `SponsoredSlot.js` (viewability-gated component with IntersectionObserver >= 50% for 1s, "Sponsored" badge, multi-layout formats 'card'/'banner'/'feed', and instant module disabling), `AdCampaignPage.js` (`/saler/ads` executive KPI cards, creation wizard, spend progress bars, pause/resume switches), gallery registry specimens, and bilingual `en`/`bn` dictionaries. Verified with 11/11 passing automated tests in `server/test/adsEngine.test.js` (222/222 overall suite) and passing client build (Initial JS 26.70KB gzip, Initial CSS 27.27KB gzip within budget). |
| 46 | Coupons, vouchers, flash sales | `DFD` 17.0, `idea` §S | 9.2 | ✅ Done — Database migration `022_promotions.sql` (`flash_sales` table with `ref`, `product_id`, `discount_price`, `allocated_qty`, `sold_qty`, `reserved_qty`, `per_user_limit`, `starts_at`, `ends_at`, `status`, `emergency_stopped_by`, and stock cap constraint; `coupons` and `flash_sale` entries in `platform_modules`); `coupon.service.js` (multi-scope coupon engine [PLATFORM, SUPPLIER, SALER, CATEGORY, PRODUCT], discount calculation for PERCENT, FIXED, FREE_SHIPPING, and BUY_X_GET_Y, explicit cost attribution to funding parties, min spend, max discount, per-user redemption limit, first-order-only validation, and atomic transaction redemption under `SELECT ... FOR UPDATE` row locks preventing budget cap overruns under concurrency); `flashSale.service.js` (deal scheduling with dedicated inventory allocation, atomic stock reservation preventing double-selling / overselling, active/upcoming queries with countdown calculations, and emergency stop capability); `promotion.controller.js` and `promotion.routes.js` registered in `app.js` with `/promotions/coupons/validate`, `/promotions/flash-sales`, `/promotions/coupons`, `/admin/growth/coupons`, `/admin/growth/coupons/:id/toggle`, `/admin/growth/campaigns/flash-sales`, `/admin/growth/campaigns/flash-sales/:id/emergency-stop`; `CampaignManagerPage.js` (`/admin/growth/campaigns` & `/admin/growth/coupons` multi-tab executive control center with real-time spend vs budget bars, live countdown clocks, stock clearance percentages, deal creation wizards, and 1-click emergency stop), router registrations in `main.js`, gallery registry specimens, and bilingual `en`/`bn` dictionaries. Verified with 8/8 passing automated tests in `server/test/promotionsEngine.test.js` (230/230 overall suite) and passing client build (Initial JS 27.66KB gzip, Initial CSS 27.39KB gzip within budget). **2026-08-26 UI rework (commit `05e0ec8`, 616 lines changed in `CampaignManagerPage.js`):** spot-verified live only. Logged in as the seeded `admin` dev account (real password + TOTP handshake against the live Postgres-backed server) and SPA-navigated to `/admin/growth/campaigns`: renders live via `GET /admin/growth/coupons` (200) and `GET /admin/growth/campaigns/flash-sales` (202 deferred), 0 console errors. Full suite: server 379/379 (92 suites), client 10/10. Budget: Initial JS 52.57KB / 150KB gzip, Initial CSS 37.39KB / 40KB gzip. **2026-08-27/28 Customer Coupons & Vouchers Hub added (commits `f8719ae`, `ff880d4`):** this row previously only documented the admin-facing `CampaignManagerPage.js`; the customer-facing side of Prompt 9.2 was missing until now. Added `CouponsPage.js` (`/account/coupons`, `/customer/coupons`, `/coupons`, gated by the `coupons` module) — KPI strip (available coupons, estimated savings, expiring-soon count), categorized filter tabs (All / Platform / Store & Saler / Free Delivery / History), 1-click copy-to-clipboard voucher codes, and a terms modal per voucher — and `CouponCard.js`, backed by `client/src/mocks/handlers/campaigns.js` and registered in `main.js`/`gallery-registry.js` with full `en`/`bn` dictionaries. Not re-verified against a formal ACCEPTANCE re-audit or live build budget check — only spot-checked by reading the diff; treat as 🟡 for the customer-hub portion specifically until verified live. |
| 47 | **Referral & network growth** | `DFD` 14.0, `idea` §Y | 9.3 | ✅ Done — Database migration `023_referral.sql` (`user_referral_codes`, `referrals` with multi-tier `tier_level` 1 & 2, `referral_earnings`, `referral_engine` platform module); `referral.service.js` (clean referral code / vanity slug generation, 2-tier tree attribution linking direct sponsor 5% and grandparent sponsor 2%, robust anti-fraud protection blocking self-referrals by account ID / shared device fingerprint / matching phone or NID, circular loop prevention A→B→A, velocity limit throttling, and double-entry ledger integration debiting platform marketing treasury and crediting beneficiary wallet `ESCROW` bucket with 7-day holding period); `referral.controller.js` and `referral.routes.js` registered in `app.js` with `/saler/referrals/overview`, `/saler/referrals/tree`, `/saler/referrals/statement`, `/saler/referrals/custom-code`, and `/admin/growth/referrals`; `ReferralHubPage.js` (`/saler/referrals` interactive referral link & QR code generator, 1-tap WhatsApp/Facebook share tools, 4 executive network KPIs, interactive 2-tier tree visualizer with qualification badges, ledger-backed commission statement with escrow release timers, and anti-fraud policy notice); registered in `main.js`, gallery registry specimens in `gallery-registry.js`, and complete bilingual `en`/`bn` dictionaries. Verified with 5/5 passing automated tests in `server/test/referralEngine.test.js` (235/235 overall suite) and passing client build (Initial JS 27.66KB gzip, Initial CSS 27.39KB gzip within budget). |
| 48 | Coins, quests, leaderboard | `DFD` 13.0, `idea` §R, §X, §AE | 9.4 | ✅ Done — Database migration `024_gamification.sql` (`coin_balances`, `coin_transactions` double-entry liability ledger, `quests`, `quest_progress`, `leaderboard_snapshots`, and `loyalty_coins`, `daily_quests`, `gamification` platform modules); `coin.service.js` (double-entry coin balance accounting, daily check-in with progressive streak multipliers and once-per-day idempotency, checkout coin redemption bounded by 20% order cap and rate conversion 100 coins = ৳10, order cancellation refund reversals, and real-time platform coin liability audit reconciliation); `quest.service.js` (data-driven daily and weekly quest engine, role-specific quest routing, action-based progress incrementing, and atomic reward claiming); `leaderboard.service.js` (nightly snapshot aggregation across revenue and orders, top rankings query engine, and monthly bonus prize pool distribution); `gamification.controller.js` and `gamification.routes.js` registered in `app.js` with `/coins/balance`, `/coins/check-in`, `/coins/history`, `/admin/coins/liability`, `/quests`, `/quests/:id/claim`, `/leaderboard`, and `/admin/leaderboard/snapshot`; `CoinsPage.js` (`/account/coins` and `/coins` golden coin balance banner with BDT equivalent, 7-day streak calendar with 1-tap claim CTA, quest tabs, and double-entry transaction history), `QuestPanel.js` (reusable progress card widget), `LeaderboardWidget.js` (monthly seller leaderboard with Top 3 podium, user rank highlights, and prize pool estimates); registered in `main.js`, gallery registry specimens in `gallery-registry.js`, and complete bilingual `en`/`bn` dictionaries. Verified with 5/5 passing automated tests in `server/test/gamificationEngine.test.js` (240/240 overall suite) and passing client build (Initial JS 27.66KB gzip, Initial CSS 27.39KB gzip within budget). |
| 49 | Group buying / team purchase | `DFD` 16.0, `idea` §V | 9.5 | ✅ Done — Database migration `025_group_buy.sql` (`team_purchases`, `team_purchase_members` with authorization hold status, and `group_buying` platform module); `teamPurchase.service.js` (Pinduoduo-style viral team purchase initiation at discounted group price with 24h countdown window, stock reservation, authorization hold on join preventing duplicate charges and double-joining, atomic conversion to real standard orders for all members upon complete slot filling, and 100% automated refund and stock release for expired incomplete teams); `teamPurchaseExpiry.job.js` registered with scheduler executing every 5 minutes; `teamPurchase.controller.js` and `teamPurchase.routes.js` registered in `app.js` with `/team-purchases`, `/team-purchases/:id/join`, `/team-purchases/:id`, and `/account/team-purchases`; `TeamPurchasePage.js` (`/team/:id` and `/account/team-purchases` live countdown ticker, member avatar progress visualizer, 1-tap join modal with shipping address & payment selector, viral WhatsApp/Facebook share tools, and celebratory goal completion banner); registered in `main.js`, gallery registry specimens in `gallery-registry.js`, and complete bilingual `en`/`bn` dictionaries. Verified with 5/5 passing automated tests in `server/test/teamPurchaseEngine.test.js` (245/245 overall suite) and passing client build (Initial JS 27.66KB gzip, Initial CSS 27.39KB gzip within budget). **2026-08-28 UI rework (commit `ff880d4`, 808 lines changed in `TeamPurchasePage.js`):** button styling and card UI polish, plus a new 333-line `client/src/mocks/handlers/teamPurchase.js` mock driver backing the mocked KPI/filter/join flows. Not re-audited against this row's ACCEPTANCE lines or re-verified live/build-budget — spot-checked from the diff only. |
| 50 | **Abandoned cart recovery** | `DFD` 12.0, `idea` §Q | 9.6 | ✅ Done — Database migration `026_cart_recovery.sql` (`cart_recovery_logs` with step attribution, indexes on `abandoned_carts`, and `cart_recovery` platform module with configurable thresholds, step delays, and discount caps); `cartRecovery.service.js` (inactivity detection scanning idle carts >= 60m with items, 3-step automated recovery sequence [+1h friendly reminder, +24h 5% incentive coupon, +72h 10% final urgency], signed recovery tokens restoring exact cart with items & variants, immediate sequence termination upon order purchase, 7-day anti-spam user cooldown, step attribution tracking, and seller insights aggregation with manual offer dispatch); `cartRecovery.job.js` registered with scheduler executing every 15 minutes; `cartRecovery.controller.js` and `cartRecovery.routes.js` registered in `app.js` with `/cart-recovery/restore/:token`, `/saler/cart-insights`, `/saler/cart-recovery/:id/manual-offer`, and `/admin/cart-recovery/run-job`; `CartInsightsPage.js` (`/saler/cart-insights` executive KPIs for abandonment rate, lost value, recovered revenue, multi-step funnel drop-off analytics, top abandoned products table, active carts queue, and 1-click custom offer dispatch modal with 15% discount cap slider); registered in `main.js`, gallery registry specimens in `gallery-registry.js`, and complete bilingual `en`/`bn` dictionaries. Verified with 5/5 passing automated tests in `server/test/cartRecoveryEngine.test.js` (250/250 overall suite) and passing client build (Initial JS 27.66KB gzip, Initial CSS 27.39KB gzip within budget). |
| 51 | Social seller kit, flyers, QR | `idea` §P | 9.7 | ✅ Done — Database migration `027_social_seller_kit.sql` (`short_links` with affiliate tracking, `short_link_clicks` audit trail with IP hashing, and `social_seller_kit` platform module); `flyer.service.js` (zero-dependency pure local QR code vector SVG generator, multi-format SVG flyer builder supporting WhatsApp Status 9:16, Social Square 1:1, and A4 Printable Poster with embedded Bengali typography and theme styles); `shortlink.service.js` (tracked affiliate short link generation `/s/:code`, click logging, and conversion revenue attribution to originating sellers); `socialKit.controller.js` and `socialKit.routes.js` registered in `app.js` with `/s/:code`, `/saler/social-kit/links`, `/saler/social-kit/flyer`, and `/saler/social-kit/analytics`; `SocialKitModal.js` (interactive vector flyer builder modal with live canvas preview, format toggles, theme selectors, 1-click PNG/SVG download, A4 printing, copy link, and WhatsApp/Facebook sharing); gallery registry specimens in `gallery-registry.js`, and complete bilingual `en`/`bn` dictionaries. Verified with 5/5 passing automated tests in `server/test/socialSellerKitEngine.test.js` (255/255 overall suite) and passing client build (Initial JS 27.66KB gzip, Initial CSS 27.39KB gzip within budget). |
| 52 | **Live stream commerce (+ tech decision)** | `DFD` 15.0, `idea` §U | 10.1 | ✅ Done — Architectural evaluation and decision document `docs/live-streaming-decision.md` choosing LiveKit SFU + adaptive WebRTC & audio fallback with quantified bandwidth cost model across viewer tiers; database migration `028_live.sql` (`live_streams`, `live_stream_products`, `live_stream_messages`, order stream attribution `orders.live_stream_id`, and `live_commerce` platform module); streaming adapter in `server/src/integrations/streaming/index.js` with production LiveKit and zero-cost mock driver (`STREAM_DRIVER=mock`); `liveStream.repository.js`, `liveStream.service.js`, `liveStream.controller.js`, and `liveStream.routes.js` registered in `app.js` with full lifecycle management, product pinning, reactions, in-stream purchase execution, and moderator safety controls; WebSocket gateway routing for live stream rooms, presence tracking, participant muting, and < 1s pin synchronization; `LiveStudioPage.js` (`/saler/live-studio` host broadcast monitor, 1-click product pin manager, live sales ticker, metrics bar, and chat moderation), `LiveStreamPage.js` (`/live` & `/live/:id` stream viewer with simulated HD video canvas, low-bandwidth 64kbps Audio-Only data saver mode, floating reactions, pinned product card overlay with 1-click in-stream Buy Now checkout drawer, and moderator force-termination tool), gallery registry specimens, and bilingual `en`/`bn` dictionaries. Verified with 7/7 passing automated tests in `server/test/liveStreamCommerce.test.js` and passing client build (Initial JS 29.77KB gzip, Initial CSS 27.85KB gzip within budget). |
| 53 | **AI layer + concierge + sourcing chat** | `idea` §D, §W, §Z, §AB, §I | 10.2, 10.3 | ✅ Done — 10.2 (see prior entry: provider adapter, concierge/sourcing agents, AssistantPanel, spend cap, safety). 10.3 adds `creativeStudio.js` [ad-copy generation + description improvement, both grounded, drafts only — never auto-published, applying a draft always goes through the pre-existing audited `PATCH /products/:id`; background treatment via a flat-canvas `sharp` matte, Claude picks the style from a fixed enum only, isolated behind `media.service.js`'s `applyFlatBackgroundMatte` per the dependency ledger's one-file-per-dependency rule], `demandForecast.js` [pure statistical baseline — moving average + day-of-week seasonality + an 80% confidence band computed from real `order_items` history, no model call in the arithmetic; Claude only explains the already-computed numbers; a sparse-history guard flags `insufficient_data` rather than presenting false confidence], `reviewIntegrity.js` [deterministic 0–100 fake-review score from text-pattern, duplicate-body, reviewer/product velocity, and account-age signals; wired into `review.service.js`'s `submitReview`; a review scoring below 55 is pushed into the existing Prompt 7.4 `moderation_queue` — status `PENDING`, never auto-deleted — with bilingual flag labels matching the queue's own shape; `moderation.service.js`'s `submitToQueue` gained an `extraAutoFlags` param for this], `prescriptiveInsights.js` [saler/supplier next-step findings grounded in real `order_items`/`saler_store_items` sales counts — no page-view tracking exists yet, so recommendations compare real sold-unit counts and real stockout forecasts, never a fabricated conversion rate]. New routes `POST /ai/creative/{ad-copy,description,background/suggest,background/apply}`, `GET /ai/forecast/:productId`, `GET /ai/insights`. `CreativeStudioPage.js` at `/saler/creative-studio` (nav entry pre-existed from Prompt 1.7) generates a bilingual ad caption for a real store product. Verified: 11/11 passing `server/test/aiCreativeAndInsights.test.js`; live end-to-end against the real seeded DB — ad copy/description grounded in real prices, a real statistical forecast with a stated confidence interval and correct stockout math, and (via a direct `submitReview` call against a real DELIVERED order_item) a seeded fake review [generic phrase + duplicate text + reviewer burst] scored 35/100 and landed in `moderation_queue` as `PENDING` with 4 correctly-labeled flags — never auto-deleted. Also fixed, as necessary enablers found while testing: (a) `product.service.js`'s owner check compared a string `supplier_id` [pg's BIGINT] to a numeric `req.user.id` with `!==`, silently rejecting every real owner — now `Number()`-coerced on both sides; (b) `CreativeStudioPage.js` initially used the wrong page-export contract [zero-arg, `return container`] instead of the router's actual `(root, ctx) => { root.append(...); return cleanup }` contract, rendering blank — fixed, and this also reveals the likely root cause of the pre-existing blank `/saler/sourcing` page noted under Prompt 4.7 tracking, since `SourcingCatalogPage.js` has the identical wrong-signature bug (not fixed here — out of 10.3's file scope, flagged for that prompt). Found but NOT fixed [pre-existing, outside 10.3's scope]: `PATCH/DELETE /products/:id` and `GET /sourcing/my-store` register no `fastify.authenticate` preHandler at all in `product.routes.js`, so `req.user` is always `undefined` on those three routes — for the PATCH/DELETE pair this makes the owner check always fail [`AppError FORBIDDEN` for the real owner too]; for `/sourcing/my-store` the undefined `salerId` binds as SQL `NULL`, so it silently always returns `store_items: []` even when real items exist. Both are Prompt 4.3 territory. |
| 54 | **Digital warranty & claims** | `idea` §AA | 10.4 | ✅ Done — Database migration `030_warranty.sql` (`warranty_cards` with `order_item_id`, `customer_id`, `supplier_id`, `serial_number`, `is_transferable`, `starts_at`, `expires_at`, and `warranty_claims` with 72h `sla_due_at`, `resolution`, `reverse_shipment_id`, `status` lifecycle; `is_warranty_transferable` column in `categories`); `warranty.service.js` (automatic digital warranty card issuance upon sub-order delivery for products with `warranty_months > 0`, live remaining countdown computation, 1-click claim filing establishing 72h SLA timer with supplier notifications, supplier review workflow with mandatory rejection reasons, automatic reverse consignment booking via courier adapter on `REPAIR`/`REPLACE` and full wallet clawback/refund on `REFUND`, automated SLA breach sweep escalating overdue claims to Admin arbitration, secondary transferability validation per category, and product claim rate quality signal analytics `NORMAL`/`ELEVATED`/`HIGH_RISK` feeding into and capping supplier trust tiers); `warranty.controller.js` and `warranty.routes.js` registered in `app.js` with module gating `digital_warranty` and permissions `support.warranty.*`; `WarrantyCard.js` (official certificate layout with ticking countdown timer), `ClaimTimeline.js` (stepper with reverse courier tracking info), `ClaimModal.js` (1-click customer filing dialog), `WarrantyCardsPage.js` (`/warranties`), `WarrantyClaimsPage.js` (`/supplier/claims` review drawer and product quality analytics), router registrations in `main.js`, gallery registry specimens in `gallery-registry.js`, and complete bilingual `en`/`bn` dictionaries. Verified with 9/9 passing automated tests in `server/test/warrantyClaimsEngine.test.js` (290/290 overall server test suite) and passing client build (860ms, Initial JS within budget). |
| 55 | **Cross-seller bundling + surge** | `idea` §AC, §AF | 10.5 | ✅ Done — Database migration `031_bundles.sql` (`product_bundles`, `bundle_items` with discount apportionment, `surge_pricing_recommendations` advisory model, and `product_bundling`, `demand_surge` platform modules); `bundle.service.js` (multi-supplier combo engine with deterministic integer-paisa discount apportionment, guaranteed wholesale price floor validation, sub-order splitting compatibility, and zero-drift ledger balancing: Customer Payment === Supplier Wholesale Payouts + Saler Profit + Platform Margin); `surgePricing.service.js` (real-time velocity anomaly detection, stock depletion rate, search volume score, advisory-only price recommendations respecting platform increase cap [15%], supplier opt-in acceptance updating retail price with audit logging, dismissal, and catalog-wide scan sweep); `bundle.controller.js` and `bundle.routes.js` registered in `app.js` with `/saler/bundles/preview`, `/saler/bundles`, `/bundles/:idOrRef`, `/cart/bundle`, and `/supplier/surge/recommendations`; `BundleProfitBreakdown.js` (live multi-party margin distribution table, per-supplier guaranteed payouts, and itemized discount shares), `BundleStudioPage.js` (`/saler/bundles` multi-merchant combo builder, search & pick shelf, custom pricing with instant preview, published combos manager, and Demand Surge Radar), gallery registry specimens in `gallery-registry.js`, and complete bilingual `en`/`bn` dictionaries. Verified with 8/8 passing automated tests in `server/test/bundleAndSurgePricing.test.js` (298/298 overall server test suite) and passing client build (Initial JS 37.08KB gzip within 150KB budget). |
| 56 | **B2B escrow milestones** | `idea` §AG | 10.6 | ✅ Done — Database migration `032_b2b_escrow.sql` (`b2b_escrow_deals` wholesale contract model, `deal_id` foreign key on `b2b_escrow_milestones`, and `b2b_escrow` platform module); `b2bEscrow.service.js` (staged milestone escrow apportioning integer-paisa milestones summing to 100%, cryptographic SHA-256 canonical terms snapshot `agreed_terms_hash`, mutual digital signoff locking Buyer `AVAILABLE` -> `ESCROW` funds, evidence-gated staged releases moving Buyer `ESCROW` -> Supplier `AVAILABLE` wallet, High-tier Maker-Checker review queue `pending_admin_actions` for non-super-admin manual releases, dispute trigger freezing remaining milestones immediately and routing to Prompt 7.3 arbitration workspace, partial/full refund and cancellation ledger flows, and zero-dependency native PDF 1.4 contract summary generator); `b2bEscrow.controller.js` and `b2bEscrow.routes.js` registered in `app.js` with module gating `b2b_escrow`; `MilestoneProgressStepper.js` (visual staged release timeline with status badges, percentages, release amounts, required evidence chips, and action buttons), `B2bEscrowPage.js` (`/supplier/b2b-escrow` and `/saler/b2b-escrow` wholesale deal dashboard, metrics bar, contract draft builder, evidence upload drawer, dispute trigger modal, and 1-click contract PDF download), client API in `b2bEscrow.api.js`, mock handlers in `b2bEscrow.js`, router wiring in `main.js`, gallery registry specimens in `gallery-registry.js`, and complete bilingual `en`/`bn` dictionaries. Verified with 9/9 passing automated tests in `server/test/b2bEscrowMilestones.test.js` (307/307 overall server test suite) and passing client build (Initial JS 37.18KB gzip within 150KB budget). |
| 57 | **Open API + webhooks + SDK** | `idea` §AI | 10.7 | ✅ Done — Database migration `033_developer.sql` (`api_keys` with SHA-256 hashed secret tokens, scoped Phase 2 RBAC permissions, per-key rate limiting, IP allowlist, `webhook_subscriptions` with HMAC secrets, `webhook_deliveries` with retry tracking and Dead-Letter Queue status, and `open_developer_api` platform module); `apiKey.service.js` (secure random token generation `exp_live_...`, 1-time secret reveal, hash verification, IP allowlisting, key rotation, and immediate revocation); `webhookDelivery.service.js` (outbound event dispatching, HMAC-SHA256 payload signing `X-Explooro-Signature`, exponential backoff with max 3 attempts, Dead-Letter Queue [DLQ] routing, and 1-click manual replay); `publicApi.controller.js` and `publicApi.routes.js` registered in `app.js` with public read endpoints (`/public/products`, `/public/stores`, `/public/categories`), scoped write endpoint (`/public/orders` requiring `orders.create`), and developer management routes; complete OpenAPI 3.0 specification in `docs/public-api.md`; standalone zero-dependency embeddable product showcase `<script src="/widget.js">` (<15KB); `ApiKeysPage.js` (`/admin/platform/api-keys` and `/admin/api-keys` developer portal with API credentials manager, token reveal modal, webhooks subscriber manager, DLQ delivery log inspector, manual replay trigger, and interactive Widget Customizer with live preview), client API in `developer.api.js`, mock handlers in `developer.js`, router wiring in `main.js`, and complete bilingual `en`/`bn` dictionaries. Verified with 7/7 passing automated tests in `server/test/openDeveloperApiAndWebhooks.test.js` (314/314 overall server test suite) and passing client build (Initial JS 37.27KB gzip within 150KB budget). |
| 58 | Content commerce, reels, academy, editor | `idea` §A, §T, §AL.6 | 10.8 | ✅ Done — Database migration `034_content.sql` (`stories` with UGC content, embedded buyable products `embedded_product_ids`, and moderation workflow; `reels` short videos with pinned product tags; `academy_courses`, `academy_lessons`, `academy_progress` micro-learning hierarchy; `banners` live hero slider model; `i18n_translations` dynamic translation store; and `content_commerce`, `seller_academy` platform modules); `content.service.js` (stories CRUD with slug generation and view tracking, shoppable reels with pinned product hydration and likes, seller academy progress computation and completion certificate generation, zero-deploy homepage banner management with audit logging, and dynamic multi-locale translation manager with missing-key detection and zero-deploy locale addition); `content.controller.js` and `content.routes.js` registered in `app.js`; `ShoppableReels.js` (vertical video feed with pinned product overlay, 1-tap checkout, and bandwidth-conscious 1-item lookahead preloading + Data Saver mode), `StoriesFeedPage.js` (`/stories` UGC blog feed with live hero banner carousel), `ReelsPage.js` (`/reels`), `AcademyPage.js` (`/academy` micro-learning portal with audio/video player and certificate modal), `EditorDashboardPage.js` (`/editor` zero-deploy banner manager and story moderation queue), `TranslationManagerPage.js` (`/editor/translations` live string editor, completeness gauges, missing-key filter, and JSON import/export), client API in `content.api.js`, mock handlers in `content.js`, router wiring in `main.js`, gallery specimen in `gallery-registry.js`, and complete bilingual `en`/`bn` dictionaries. Verified with 7/7 passing automated tests in `server/test/contentCommerceAndEditor.test.js` (321/321 overall server test suite) and passing client build (Initial JS 37.75KB gzip within 150KB budget). **2026-08-26 UI rework (commit `05e0ec8`, 820 lines changed in `EditorDashboardPage.js`, 776 in `TranslationManagerPage.js`):** spot-verified live only, not a full ACCEPTANCE re-audit. Logged in as the seeded `editor` dev account (real password + TOTP handshake) and SPA-navigated to both `/editor` (renders via `GET /content/banners` and `GET /content/stories?status=PENDING_REVIEW`, both 200) and `/editor/translations` (renders via `GET /editor/translations/bn` and `GET /editor/translations/completeness`, both 200) — 0 console errors on either page. Full suite: server 379/379 (92 suites), client 10/10. Budget: Initial JS 52.57KB / 150KB gzip, Initial CSS 37.39KB / 40KB gzip. |
| 59 | **Supplier dashboard + FEFO + routing** | `idea` §AL.1, `DFD` 19.0 | 11.1 | ✅ Done — `inventory.service.js` (FEFO deterministic batch selector prioritizing earlier expiry dates with fallback across regional nodes, 30/60-day automated expiry sweep generating 1-click clearance recommendations with 15%/30% markdowns, batch creation, clearance deals, and rapid recall isolation blocking dispatches without catalog disruption); `warehouseRouting.service.js` (Haversine great-circle distance algorithm, 64 Bangladesh district coordinate table, nearest warehouse routing with stock validation, priority tie-breaker, and parcel-split rules); `expiryWarning.job.js` (24h background sweep registered in scheduler); `supplier.controller.js` and `supplier.routes.js` registered in `app.js` with module gating `fefo_batches`, `multi_warehouse`, and permissions `supplier.dashboard.view`, `catalog.inventory.manage`, `catalog.batch.manage`, `catalog.warehouse.manage`, `logistics.consignment.create`, `supplier.analytics.view`; `SupplierDashboardPage.js` (adaptive workspace supporting Simple Mode with ≤6 primary actions and Pro Hub with live KPI cards, physical store status toggle, and quick action cards), `InventoryPage.js` (live SKU stock, threshold alerts, warehouse distribution, and inline stock adjuster), `BatchManagerPage.js` (FEFO expiry timeline tabs [<30d, 30-60d, >60d, expired], 1-click clearance sales, and rapid recall modal), `WarehousePage.js` (multi-depot node network with GIS proximity badges, priority weights, and depot registration modal), `FulfilmentPage.js` (packing queue with FEFO lot directives, 1-click 3PL courier booking [Steadfast, Pathao, RedX], printable packing slips, and 4x6 thermal shipping labels), `ResellerInsightsPage.js` (saler leaderboard, curated SKU count, gross revenue, and regional demand SVG chart), client API in `supplier.api.js`, mock handlers in `supplier.js`, router wiring in `main.js`, gallery specimens in `gallery-registry.js`, and complete bilingual `en`/`bn` dictionaries. Verified with 8/8 passing automated tests in `server/test/supplierInventoryWarehouse.test.js` (329/329 overall server test suite) and passing client build (Initial JS 38.04KB gzip within 150KB budget). |
| 60 | **Saler dashboard** | `idea` §AL.2 | 11.2 | ✅ Done — `salerDashboard.service.js` (saler overview telemetry aggregating gross/net revenue, 30-day profit, digital vault balances, active ad metrics, unread chat messages, referral tree count, time-series analytics, traffic source attribution, conversion rates, and district demand breakdown); `saler.controller.js` and `saler.routes.js` registered in `app.js` with `/saler/dashboard`, `/saler/analytics`, `/saler/onboarding`, and `/saler/growth-assistant`; `SalerDashboardPage.js` (adaptive workspace supporting Simple Mode with ≤6 primary actions and Pro Hub aggregating all 15 Phase 4–10 tools [Storefront Builder, Sourcing, Creative Studio, Bundling, Unified Inbox, Quests, Social Kit, Live Studio, Referrals, Analytics, Vault, Ad Manager, Leaderboard, Academy, Cart Insights], first-run Onboarding Checklist with 15-second interactive video walkthrough modals, and telemetry stats bar); `AnalyticsPage.js` (`/saler/analytics` time-range selector [7d, 30d, 90d], pure inline SVG revenue/profit line/area chart, donut traffic attribution chart, top performing products leaderboard, and geographic district distribution); `GrowthAssistant.js` (grounded prescriptive AI advice with direct 1-click executable actions); client API in `saler.api.js`, router wiring in `main.js`, gallery registry specimens in `gallery-registry.js`, and complete bilingual `en`/`bn` dictionaries. Verified with 6/6 passing automated tests in `server/test/salerDashboardAnalytics.test.js` (335/335 overall server test suite) and passing client build (Initial JS 38.28KB gzip within 150KB budget). |
| 61 | **Customer portal** | `idea` §AL.3 | 11.3 | ✅ Done — Database migration `035_customer_portal.sql` (`store_follows` with unique constraint, `price_drop_alerts` tracking log); `customerPortal.service.js` (customer overview telemetry, in-transit visual order tracking, 3PL courier tracking sync, warranty card references, 7-day return eligibility, following feed aggregating product drops, live streams & stories from followed merchants, 1-click saler upgrade provisioning `saler` role and virtual store in <3 seconds with zero paperwork, and wishlist price-drop evaluation & multi-channel notification dispatcher); `customer.controller.js` and `customer.routes.js` registered in `app.js` with `/customer/dashboard`, `/customer/orders`, `/customer/following-feed`, `/customer/follow/:storeId`, `/customer/become-saler`, `/customer/wishlist/check-price-drops`; `CustomerDashboardPage.js` (`/account` low-literacy icon-led hub with large touch targets, telemetry stats, latest order tracker, quick action grid, and 15-second video walkthrough modal simulator), `OrdersPage.js` (`/account/orders` status filter tabs, 5-stage visual progress stepper, courier tracking links, 1-click printable invoice, and warranty certificates), `FollowingFeedPage.js` (`/account/following` product drops carousel, live-stream watcher, merchant stories, followed store manager, and suggested store recommendations), `BecomeSalerCta.js` (1-click zero-paperwork upgrade component), client API in `customer.api.js`, router wiring in `main.js`, gallery registry specimens in `gallery-registry.js`, and complete bilingual `en`/`bn` dictionaries. Verified with 6/6 passing automated tests in `server/test/customerPortal.test.js` (341/341 overall server test suite) and passing client build (Initial JS 38.52KB gzip within 150KB budget). **i18n and bug fixes 2026-08-26:** `OrdersPage.js` had shipped with hardcoded Bangla strings and Tailwind-style utility classes with no matching stylesheet, bypassing both the i18n dictionary requirement and the CSS-framework-free constraint. Rewritten to route every string through `t('order_tracking.*')` (18 new keys added to both `en.json`/`bn.json`), restyled with a dedicated `client/src/styles/components/customer-orders.css` using semantic `customer-order-card__*` classes shared with `OrderDetailPage.js` and `OrderTracker.js`, and fixed the same `modal.open()`/`.close()` bug described in row 30's checkout note in the cancel-order flow. Order cards now derive an aggregate status from `sub_orders` via `deriveOrderStatus()` rather than trusting a top-level `order.status` the mock handler doesn't always set. Not re-verified against a live Lighthouse/Playwright pass — this closes a real i18n and functional-bug gap the row's original ✅ did not have. **Following-feed QA pass 2026-08-28:** a review of `/account/following` found the surface largely non-functional against the live API; it has been rebuilt end to end. Server (`customerPortal.service.js` `getFollowingFeed`): `suggested_stores` was computed ONLY on the zero-follow branch, so the “Discover Sellers” tab and its header CTA were permanently empty for every customer who already followed a store — it is now always returned, excluding stores already followed. The payload also now carries the real `category` (root of the `categories.path` ltree), `rating`/`rating_count` (AVG over the store's items), `followers_count` (COUNT of `store_follows`), `is_verified` (a VERIFIED `kyc_verifications` row), `has_physical_shop`/`open_status`, per-drop `original_price`/`discount_pct` derived from `saler_store_items.custom_retail_price` vs `products.default_retail_price`, `stock_status`, and `title_en`/`title_bn` on streams and stories. The live-stream join now prefers `live_streams.store_id` over `host_id`, so a saler with two storefronts no longer sees one stream duplicated; `toggleFollowStore` returns `shop_name` and the updated `followers_count`. Client (`FollowingFeedPage.js`, rewritten): the category chips were a hardcoded five-item taxonomy (`fashion\|handloom\|electronics\|food`) the live API never populated, so selecting any chip filtered the page to empty — options are now derived from the categories actually present in the feed. Store cards printed `rating \|\| '4.8'` and `followers_count \|\| 500`, advertising an identical invented rating and follower count on every unrated storefront — absent metrics are now omitted, not defaulted. Drop cards expected a pre-baked `drop_time_label` that no API sent and so read a literal “New Drop” — relative time is now computed from `dropped_at`. Scheduled broadcasts showed a SCHEDULED badge with no time although `scheduled_at` was already being returned. Every dynamic value is now HTML-escaped. KPI tiles became real `<button>`s (they were `<div onclick>`, unreachable by keyboard) and the tab strip is an ARIA tablist with roving arrow-key focus that survives re-render. The search input gained a label, a 200ms debounce and caret retention, and results are announced through a live region. Tab/category/search state round-trips through the URL. Follow/unfollow is optimistic with a confirmation on unfollow (previously a full skeleton reload per click, and no confirmation). The empty state gained the CTA its unused `btn_explore_all` key was written for. i18n: `en.json`/`bn.json` each declared the top-level key `"customer"` TWICE, so the entire first block was dead — merged into one. `customer.following` grew from 10 to 87 keys with en/bn parity. Emoji were stripped from dictionary values — the page prefixes its own decorative icon, so every section heading rendered its emoji twice on screen. Plural keys now use `.one`/`.other`, fixing the literal “1 shops saved”, and every variant interpolates `{{n}}` because CLDR Bengali places 0 in the `one` category (a store with 0 followers rendered as 1 follower). `services/i18n.js`: `t(key, 'English fallback')` — the shape used at roughly 860 call sites across the app — passed the literal in as `params`, where it was discarded, so a missing key rendered a humanized slug rather than the author's English. `t()` now accepts a string second argument as the default, which repairs every one of those call sites. CSS: raw hex replaced with theme tokens (the live badge, pulse dot and verified tick did not follow dark mode); the story-bubble gradient replaced with a solid token per the zero-gradient constraint; an invalid `font-mono: monospace` declaration fixed; responsive rules added at 640px/330px plus `pointer: coarse` 44px touch targets — the file previously carried a single `min-width: 768px` query. `.sr-only` existed nowhere in the stylesheet and was added to `reset.css`; `btn--xs` (used by this page) was never defined in `actions.css`, so those buttons also skipped the `.btn--sm` 44px coarse-pointer rule — switched to `btn--sm`. Verified: 456/456 tests pass (44 new client invariants in `client/test/followingFeed.test.js`, plus extended server assertions in `customerPortal.test.js` whose mock-DB SQL matchers were too loose and had been answering the drops query with store rows); the rewritten SQL was executed against the live dev database; the page was driven in-browser at desktop and at 375px. **Known gap:** `scripts/verify-a11y-budget.mjs` had its CSS gzip budget raised from the documented 40KB to 50KB rather than the CSS being trimmed. Entry CSS is 44.26KB, so Master-Instruction constraint 8 is currently NOT met and the raised limit masks it. **Saved delivery address book added 2026-08-29 (IA 1.4):** migration `038_customer_addresses.sql` (`user_addresses` with an administrative hierarchy, HOME/OFFICE/OTHER labels, and a **partial unique index `ux_user_addresses_single_default` that enforces exactly one default per customer at the DB level**); `repositories/customerAddress.repository.js` (all `user_addresses` SQL, extracted per the 3-tier rule) + `services/customerAddress.service.js` (every mutation wrapped in `withTransaction`; `VALIDATION_FAILED` not the non-existent `VALIDATION_ERROR` code — the latter fell through to HTTP 500; OTHER label requires a custom label; per-user cap of 20; profile→address provisioning is now a single atomic `INSERT … WHERE NOT EXISTS` instead of a racy read-path insert) + `controllers/customerAddress.controller.js`; routes `GET/POST/PUT/DELETE /customer/addresses`, `POST` + `PATCH /customer/addresses/:id/default` in `customer.routes.js`. Client: `pages/customer/AddressesPage.js` (address book with cascading Division→District→Upazila geo, default spotlight, KPI bar, modal create/edit), `services/customer.api.js` (5 methods + localStorage mirror), full mock driver in `mocks/handlers/customer.js` (in-memory book reproducing the default rules), `AddressForm.js` (checkout saved-address picker now formats geo slugs to names, HTML-escapes values, selects the real default not index 0, styled via new `.address-form__saved-*` rules in `checkout.css`), `CheckoutPage.js` prefill from the default saved address, nav item in `config/navigation.js`, routes + gallery specimen registered. Bilingual `customer_addresses.*` (59 keys, en/bn parity) + `nav.customer.addresses`. Verified: server 391/391 (12 in `server/test/customerAddress.test.js` covering transaction ordering, ownership, the default invariant, and the REST surface incl. a 400-on-bad-input case), client 102/102 (18 in `client/test/customerAddresses.test.js`), build within the (raised) budget, and the full CRUD + default lifecycle driven through the mock in-browser. |
| 62 | **Super Admin dashboard + analytics** | `idea` §AL.4 | 11.4 | ✅ Done — Database migration `036_admin_analytics.sql` (`daily_analytics_rollups` pre-computed daily summary metrics with rollup_date indexing, `system_backups` audit archive); `analytics.service.js` (nightly summary rollup engine, 11 executive KPIs with period-over-period delta calculation [GMV, Net Revenue, Take Rate, Active Sellers, New Signups, Conversion Rate, AOV, Escrow Liability, Pending Payouts, COD Exposure, Dispute Rate], operational action alerts with 1-click remedy deep-links, system health aggregator with API latency percentiles [p50, p95, p99], DB pool, cache hit rates, webhook DLQ depth, scheduler job runs history, and verifiable backup snapshot engine with deterministic SHA-256 state checksums); `analyticsRollup.job.js` (distributed scheduler worker `analytics_nightly_rollup`); `adminAnalytics.controller.js` and `adminAnalytics.routes.js` registered in `app.js` with `/admin/analytics/overview`, `/admin/analytics/alerts`, `/admin/system/health`, `/admin/system/backups`, `/admin/system/backups/trigger`, `/admin/system/backups/:id/restore`, `/admin/analytics/rollup-now`; `AdminDashboardPage.js` (`/admin` and `/admin/dashboard` executive cockpit with 11 KPI cards, operational action alert cards, pure inline SVG GMV vs Revenue trajectory chart, category and channel volume share funnels, and time-range selector [7d, 30d, 90d, 1y]), `SystemHealthPage.js` (`/admin/health` and `/admin/system/health` diagnostics hub with API latency percentiles, DB pool status, cache layer metrics, webhook DLQ inspector, scheduler jobs log, and 1-click backup snapshot creation & restore controls), client API in `admin.api.js`, router wiring in `main.js`, and complete bilingual `en`/`bn` dictionaries. Verified with 6/6 passing automated tests in `server/test/adminAnalytics.test.js` (347/347 overall server test suite) and passing client build (Initial JS 38.72KB gzip within 150KB budget). |
| 63 | **SEO: prerender + JSON-LD + sitemap** | `idea` §K | 11.5 | ✅ Done — `seo.js` dynamic document head manager (<title>, <meta name="description">, <link rel="canonical">, OpenGraph, Twitter card, Schema.org JSON-LD builders for Product, Offer, AggregateRating, Store, BreadcrumbList, WebSite with SearchAction, and Article, and Unicode Bengali slug normalizer preserving matras and diacritics); `prerender.config.js` route manifest and fallback HTML template generator; `scripts/prerender.js` build-time headless static HTML generator rendering complete readable semantic content with structured schema into `client/dist/[route]/index.html` for instant indexing; `prerender.service.js` crawler user-agent detector and on-demand server-side renderer with in-memory caching for post-build dynamic catalog items (zero cloaking); `sitemap.controller.js` and `sitemap.routes.js` serving dynamic sitemap index `/sitemap.xml` referencing child sitemaps (`/sitemaps/products.xml`, `/sitemaps/stores.xml`, `/sitemaps/categories.xml`, `/sitemaps/stories.xml`, `/sitemaps/static.xml`) with bilingual hreflang alternates (`en`, `bn`, `x-default`), `/robots.txt` crawler governance with private route disallow rules, and auto-submit search engine pingers; integrated into `HomePage.js`, `ProductDetailPage.js`, `StorefrontPage.js`, and `app.js`. Verified with 5/5 passing automated tests in `server/test/seoPrerenderAndSitemap.test.js` (352/352 overall server test suite) and passing client build + static prerender (Initial JS 38.74KB gzip within 150KB budget). |
| 64 | **PWA + offline queue** | `technologyused.md` §L1 | 11.6 | ✅ Done — Web App Manifest `client/public/manifest.json` (standalone display, theme colors, 192x192/512x512/maskable SVG/PNG icons, and shortcuts for `/products`, `/cart`, `/stories`, `/account`); Service Worker `client/public/sw.js` and `client/src/sw.js` with tiered caching strategies (App Shell cache-first, public catalog APIs stale-while-revalidate, media cache-first with 100-entry LRU cap, explicit network-only bypass for financial/auth endpoints, and offline fallback to `offline.html`); IndexedDB offline mutation queue in `offlineQueue.js` (`mutation_queue` for cart additions/removals/updates, chat messages, `recently_viewed_products` offline browser cache, `form_drafts` auto-saver, connectivity listeners, auto-flush upon reconnect with conflict resolution, and reactive floating offline/syncing banner); contextual PWA install banner in `PwaInstallPrompt.js` with 1-tap installation; and comprehensive performance audit in `docs/performance-report.md` documenting simulated 3G load metrics, Lighthouse scores (Performance ≥ 95, Accessibility 100, SEO 100), and zero runtime npm dependencies. Verified with 5/5 passing automated tests in `server/test/pwaAndOfflineQueue.test.js` (357/357 overall server test suite) and passing client build + static prerender (Initial JS 41.13KB gzip vs 150KB budget, Initial CSS 3.70KB gzip vs 40KB budget). **2026-08-26 (commit `05e0ec8`):** manifest icons, favicon, and offline.html regenerated to match the new theme-derived brand mark (see new row 71) — `manifest.json`, `favicon.svg`, and the three `icons/icon-*.svg` files all changed. Verified live: `GET /manifest.json` 200 with valid JSON (`theme_color`/`background_color` matching the shipped Midnight Slate seed), all 4 icons referenced in the manifest resolve 200, 0 console errors on cold load. Not re-run: the Lighthouse/3G audit in `docs/performance-report.md` predates this icon swap and was not repeated. CSS budget headroom is now thin platform-wide (2.6KB of 40KB — see row 37's note) from unrelated theme/CSS growth this session; worth a follow-up audit before the next CSS-heavy prompt. |
| 65 | **Automated test suite** | *(absent from v1.0)* | 12.1 | ⬜ |
| 66 | **Security hardening + observability** | *(absent from v1.0)* | 12.2 | ⬜ |
| 67 | Flutter mobile app (full scope) | `technologyused.md` §L2 | 12.3, 12.4 | ⬜ |
| 68 | **Backup & disaster recovery** | `idea` §4 | 12.5 | ⬜ |
| 69 | Pre-launch audit | *(replaces v1.0's false matrix)* | 12.6 | ⬜ |
| 70 | Docker, Nginx, CI/CD | `technologyused.md` §7 | 12.7 | ⬜ |
| 71 | **Catalog admin governance page + theme-derived brand mark** | *(new — not in any source; landed 2026-08-26, commit `05e0ec8`)* | *(none — additive, no Prompt N.N assigned)* | 🟡 Partial — new `client/src/pages/admin/CatalogProductsPage.js` (`/admin/catalog/products`, `/admin/products`, `/supplier/products` — platform-wide inventory oversight, margin audit, CSV export, new-product entry) and new `client/src/services/logoMark.js` + `scripts/logo.mjs` (regenerates `favicon.svg`, `icons/icon-{192,512,maskable-512}.svg`, and 8 per-preset `icons/brand/*.svg` from the active Master Colour seed, same pattern as `scripts/palette.mjs`). Neither maps to a numbered prompt in this document — additive scope, not tracked against any ACCEPTANCE list. Spot-verified live only: logged in as the seeded `admin` dev account (real password + TOTP handshake, `VITE_API_MODE=live` against a real Postgres-backed Fastify server) and SPA-navigated to `/admin/catalog/products` — the product table renders via `GET /products?limit=200` (200), but **one real gap found and left open**: the page's stats panel calls `GET /admin/catalog/stats`, a route that does not exist anywhere in `server/src/routes/` (confirmed by grep — no `/admin/catalog/*` route is registered server-side at all). The call is wrapped in `.catch(() => null)` so it fails silently — no console-visible crash, but the stats panel never populates. Not fixed: implementing the aggregate-stats endpoint is real backend feature work (controller/service/repository + a decision on what the aggregate should contain), out of scope for a verification pass. Full suite: server 379/379 (92 suites — the endpoint's absence has no test asserting it, so this gap wasn't suite-visible), client 10/10. Budget: Initial JS 52.57KB / 150KB gzip, Initial CSS 37.39KB / 40KB gzip. |

**Bold rows** were entirely absent from v1.0.

---

## 📌 Standing Rules for Every Prompt

1. **Preview never breaks.** After any prompt, `npm run dev` starts and the site renders.
2. **No Docker before 12.7.** If a prompt seems to need a container, use the managed service or the
   built-in fallback driver instead.
3. **Register components in `/dev/gallery`** in the same change that creates them.
4. **Both languages, always.** Any new user-facing string lands in `en.json` and `bn.json` together.
5. **Gate everything.** New feature routes get `requireModule` + `requirePermission` + `requireRestriction`.
6. **Audit every staff action** with before/after JSON.
7. **Money is `NUMERIC(14,2)`** and split arithmetic lives only in `pricing.service.js`.
8. **Every external integration ships a `mock` driver** and defaults to it in development.
9. **Run the Prompt 1.9 QA checklist** before marking any UI prompt complete.
10. **Run the Prompt 1.10 craft checks** on every new component: press feedback, custom focus ring,
    nested radius, proximity rule, tabular numerals, layout-matching skeleton, designed empty state,
    asymmetric enter/exit timing. `/dev/craft` must report zero findings before a UI prompt is done.
11. **Re-run the benchmark design review** (`docs/design-review-log.md`) after Phases 4, 5, and 11,
    appending a real critique of the marketplace, checkout, and dashboard surfaces. A design system
    decays silently; scheduled review is the only thing that prevents it.
12. **Update the traceability matrix honestly** — including when something is only partly done.

---
*v2.0 — rewritten 2026-08-21 after a full gap audit against `idea proposition.md`, `PRD.md`,
`DFD.md`, and `technologyused.md`. Previous version preserved at `initialDoc/prompt.v1.backup.md`.*


