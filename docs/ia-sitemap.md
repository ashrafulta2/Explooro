# Explooro — Information Architecture & Navigation Specification

> **Produced by:** Prompt 0.3
> **Implemented by:** Prompt 1.7 (App Shell, Sidebar, Command Palette, Mobile Nav), Prompt 1.5 (router guards)
> **Depends on:** `docs/design-system.md` (Prompt 0.2)
> **Feeds:** `docs/permission-catalog.json` (Prompt 0.4) — every permission key referenced here must exist there
>
> **The problem this document solves:** Explooro has 68 toggleable modules and 6 distinct roles.
> Presented as a flat list, that is unusable by anyone. Presented as a grouped, role-filtered,
> searchable structure, it is navigable by a first-time user. Grouping *is* the feature.

---

## 0. Governing Principles

1. **Group by user intent, never by database table.** A seller thinks "I want to get paid", not
   "I want to query the `payout_requests` table". Groups are named for jobs, not entities.
2. **Maximum 9 top-level groups per role, maximum 8 items per group.** Beyond that, humans stop
   scanning and start hunting. Where a group would exceed 8, it splits or moves items to a
   sub-page.
3. **Permission-locked ≠ hidden. Module-disabled = hidden.** A user who *could* be granted access
   must see that the capability exists and be able to ask for it. A module the business has turned
   off does not exist for anyone and must not be advertised. This distinction is the backbone of
   the delegation model, and §5 specifies it exactly.
4. **Every destination is reachable three ways:** the sidebar (browse), the command palette
   (search), and a deep link (share/bookmark). Nothing is reachable only by clicking through
   another page.
5. **Depth limit: 3 levels.** `Group → Page → Detail`. A fourth level means the grouping is wrong.
6. **Nav config is data, not markup.** `client/src/config/navigation.js` is an array of objects.
   Adding a feature later means adding one object, never editing a component.
7. **Preserve sidebar scroll position across chrome re-renders.** `AppShell.js` rebuilds the sidebar
   DOM on route changes, state changes, and language switches. The container's `scrollTop` must be
   captured and restored immediately so clicking items in long navigation trees never resets the
   scroll position to the top.

---

## 1. Complete Route Table

**Legend**
`perm` — required permission key (`none` = no permission required)
`module` — required module flag (`none` = always available, `core` = not toggleable)
`SEO` — ✅ indexable and prerendered (Prompt 11.5) · ❌ `noindex`

### 1.1 Public / storefront

| Path | Page | perm | module | Auth | SEO |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/` | Marketplace home | none | core | public | ✅ |
| `/c/:categorySlug` | Category listing | none | core | public | ✅ |
| `/product/:id/:slug?` | Product detail | none | core | public | ✅ |
| `/store/:slug` | Saler storefront | none | `virtual_storefront` | public | ✅ |
| `/store/:slug/c/:collection` | Store collection | none | `virtual_storefront` | public | ✅ |
| `/search` | Search results | none | core | public | ❌ |
| `/stories` | Storytelling feed | none | `content_commerce` | public | ✅ |
| `/stories/:slug` | Story detail | none | `content_commerce` | public | ✅ |
| `/reels` | Shoppable reels | none | `ugc_video_wall` | public | ❌ |
| `/live` | Live stream listing | none | `live_commerce` | public | ❌ |
| `/live/:id` | Live stream viewer | none | `live_commerce` | public | ❌ |
| `/team/:id` | Team purchase invite | none | `group_buying` | public | ❌ |
| `/s/:code` | Shortlink redirect | none | `social_seller_kit` | public | ❌ |
| `/academy` | Seller Academy (preview) | none | `seller_academy` | public | ✅ |
| `/academy/:courseSlug` | Course detail | none | `seller_academy` | public | ✅ |
| `/help`, `/help/:slug` | Help centre / FAQ | none | core | public | ✅ |
| `/legal/:doc` | Terms, privacy, refund, seller agreement | none | core | public | ✅ |
| `/sitemap.xml`, `/robots.txt` | SEO endpoints | none | core | public | — |

### 1.2 Authentication

| Path | Page | perm | module | Auth | SEO |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/login` | Sign in (password or OTP) | none | core | public | ❌ |
| `/register` | Create account | none | core | public | ❌ |
| `/otp` | OTP verification | none | core | public | ❌ |
| `/2fa` | Staff TOTP challenge | none | core | public | ❌ |
| `/forgot-password`, `/reset-password` | Password recovery | none | core | public | ❌ |

### 1.3 Cart & checkout

| Path | Page | perm | module | Auth | SEO |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/cart` | Cart | none | core | guest ok | ❌ |
| `/checkout` | Checkout | none | core | guest ok | ❌ |
| `/checkout/wa/:token` | WhatsApp 1-tap checkout | none | `whatsapp_bridge` | guest ok | ❌ |
| `/order/:id/confirmation` | Order confirmation | none | core | private | ❌ |

> Checkout is gated by the `can_buy` restriction, not by a permission. Restrictions are enforced
> at the API layer (Prompt 2.6); the UI reflects them but is never the only guard.

### 1.4 Customer portal — `/account/*`

| Path | Page | perm | module |
| :--- | :--- | :--- | :--- |
| `/account` | Portal home | none | core |
| `/account/orders`, `/account/orders/:id` | Orders + tracking | none | core |
| `/account/returns`, `/account/returns/:id` | Returns & refunds | none | `returns_engine` |
| `/account/wishlist` | Saved items | none | `wishlist` |
| `/account/coins` | Coins & check-in streak | none | `loyalty_coins` |
| `/account/warranties`, `/account/warranties/:id` | Digital warranty cards | none | `digital_warranty` |
| `/account/team-purchases` | My group buys | none | `group_buying` |
| `/account/coupons` | My coupons | none | `coupons` |
| `/account/referrals` | Invite & earn | none | `referral_engine` |
| `/account/following` | Followed stores feed | none | `follow_feed` |
| `/account/reviews` | My reviews & UGC | none | `ugc_video_wall` |
| `/account/concierge` | AI shopping assistant history | none | `ai_concierge` |
| `/account/addresses` | Saved addresses | none | core |
| `/account/settings` | Profile & security | none | core |
| `/account/settings/notifications` | Notification preferences | none | core |
| `/account/become-saler` | 1-click Saler upgrade | none | `virtual_storefront` |

### 1.5 Saler — `/saler/*`

| Path | Page | perm | module |
| :--- | :--- | :--- | :--- |
| `/saler` | Dashboard | `saler.dashboard.view` | core |
| `/saler/store-builder` | Storefront builder | `saler.store.manage` | `virtual_storefront` |
| `/saler/sourcing` | Supplier sourcing catalog | `saler.sourcing.view` | `sourcing` |
| `/saler/products` | My store items | `saler.store.manage` | `virtual_storefront` |
| `/saler/orders`, `/saler/orders/:id` | Orders | `saler.order.view` | core |
| `/saler/vault` | Digital vault | `finance.wallet.view_own` | core |
| `/saler/vault/payouts` | Withdrawals | `finance.payout.request` | core |
| `/saler/analytics` | Sales & profit analytics | `saler.analytics.view` | core |
| `/saler/creative-studio` | AI creative studio | `ai.creative.use` | `ai_creative_studio` |
| `/saler/bundles` | Bundle & combo studio | `saler.bundle.manage` | `product_bundling` |
| `/saler/inbox` | Unified WhatsApp/Messenger inbox | `chat.thread.view_own` | `whatsapp_bridge` |
| `/saler/ads`, `/saler/ads/:id` | Ad campaign manager | `growth.ad.manage_own` | `sponsored_ads` |
| `/saler/live-studio` | Live streaming studio | `live.stream.host` | `live_commerce` |
| `/saler/referrals` | Referral network hub | `growth.referral.view_own` | `referral_engine` |
| `/saler/quests` | Daily missions | none | `daily_quests` |
| `/saler/leaderboard` | Leaderboard & badges | none | `gamification` |
| `/saler/cart-insights` | Abandoned cart insights | `saler.analytics.view` | `cart_recovery` |
| `/saler/social-kit` | Flyer & QR generator | none | `social_seller_kit` |
| `/saler/academy` | Seller Academy | none | `seller_academy` |

### 1.6 Supplier — `/supplier/*`

| Path | Page | perm | module |
| :--- | :--- | :--- | :--- |
| `/supplier` | Dashboard | `supplier.dashboard.view` | core |
| `/supplier/products`, `/supplier/products/:id` | Product catalog | `catalog.product.manage_own` | core |
| `/supplier/products/new` | Create listing | `catalog.product.create` | core |
| `/supplier/inventory` | Live stock & low-stock alerts | `catalog.inventory.manage` | core |
| `/supplier/batches` | Batch & expiry (FEFO) | `catalog.batch.manage` | `fefo_batches` |
| `/supplier/warehouses` | Multi-location hubs | `catalog.warehouse.manage` | `multi_warehouse` |
| `/supplier/orders` | Incoming orders | `supplier.order.view` | core |
| `/supplier/fulfilment` | Pack, label, dispatch | `logistics.consignment.create` | `courier_hub` |
| `/supplier/shipments` | Shipment tracking | `logistics.shipment.view` | `courier_hub` |
| `/supplier/warranty-claims` | Warranty claims | `support.warranty.manage` | `digital_warranty` |
| `/supplier/b2b-escrow` | B2B wholesale escrow | `finance.b2b_escrow.view_own` | `b2b_escrow` |
| `/supplier/resellers` | Reseller network insights | `supplier.analytics.view` | core |
| `/supplier/forecasting` | AI demand forecasting | `supplier.analytics.view` | `ai_forecasting` |
| `/supplier/vault` | Earnings vault | `finance.wallet.view_own` | core |
| `/supplier/inquiries` | Wholesale inquiries | `chat.thread.view_own` | `chat` |
| `/supplier/live-studio` | Live host panel | `live.stream.host` | `live_commerce` |
| `/supplier/store-status` | Physical shop open/close | `supplier.store.manage` | `physical_shop_status` |
| `/supplier/help` | Supplier operations & help centre | none | core |

### 1.7 Moderator — `/moderator/*`

| Path | Page | perm | module |
| :--- | :--- | :--- | :--- |
| `/moderator` | Dashboard | `moderation.dashboard.view` | core |
| `/moderator/queue` | Product & content moderation | `moderation.product.approve` | `product_moderation` |
| `/moderator/reports` | User reports & flags | `moderation.report.handle` | `user_reports` |
| `/moderator/disputes`, `/moderator/disputes/:id` | Dispute arbitration | `orders.dispute.arbitrate` | `dispute_panel` |
| `/moderator/returns` | Return review queue | `orders.return.review` | `returns_engine` |
| `/moderator/reviews` | Review integrity queue | `moderation.review.handle` | `review_integrity` |
| `/moderator/ugc` | UGC video moderation | `moderation.ugc.approve` | `ugc_video_wall` |
| `/moderator/live` | Live stream moderation | `moderation.live.handle` | `live_commerce` |
| `/moderator/penalties` | Warnings & suspensions | `users.account.penalise` | core |
| `/moderator/my-access` | My grants & pending actions | none | core |

> `/moderator/my-access` requires **no permission** on purpose. Every staff member must always be
> able to see what access they hold, what has expired, and what they have submitted for approval.
> Hiding that behind a permission creates exactly the confusion the delegation model exists to remove.

### 1.8 Editor — `/editor/*`

| Path | Page | perm | module |
| :--- | :--- | :--- | :--- |
| `/editor` | Dashboard | `content.dashboard.view` | core |
| `/editor/banners` | Homepage banners & sliders | `content.banner.publish` | core |
| `/editor/stories` | Story curation | `content.story.curate` | `content_commerce` |
| `/editor/academy` | Academy content manager | `content.academy.manage` | `seller_academy` |
| `/editor/whats-new` | Release notes publisher | `content.announcement.publish` | `whats_new` |
| `/editor/translations` | i18n string manager | `content.i18n.update` | `i18n` |
| `/editor/help-center` | FAQ & guides | `content.help.manage` | core |

### 1.9 Super Admin — `/admin/*`

| Group | Path | Page | perm |
| :--- | :--- | :--- | :--- |
| Overview | `/admin` | Executive dashboard | `admin.dashboard.view` |
| | `/admin/health` | System health | `system.health.view` |
| **Users & Access** | `/admin/users`, `/admin/users/:id` | All users | `users.account.view` |
| | `/admin/staff` | Staff accounts | `staff.account.view` |
| | `/admin/roles` | Roles & permission matrix | `staff.role.assign` |
| | `/admin/grants` | Standing access grants | `users.permission.grant` |
| | `/admin/approvals` | **Approval inbox** (JIT + maker-checker) | `admin.approval.decide` |
| | `/admin/restrictions` | User & segment restrictions | `users.restriction.manage` |
| | `/admin/verification` | KYC verification centre | `users.kyc.approve` |
| **Catalog** | `/admin/catalog/products` | All products | `catalog.product.view_all` |
| | `/admin/catalog/categories` | Category tree | `catalog.category.manage` |
| | `/admin/catalog/moderation` | Moderation queue | `moderation.product.approve` |
| | `/admin/catalog/batches` | Batch & expiry governance | `catalog.batch.govern` |
| | `/admin/catalog/warehouses` | Warehouse & routing policy | `catalog.warehouse.govern` |
| **Orders** | `/admin/orders`, `/admin/orders/:id` | All orders | `orders.order.view_all` |
| | `/admin/returns` | Returns oversight | `orders.return.view_all` |
| | `/admin/disputes` | Dispute oversight | `orders.dispute.view_all` |
| | `/admin/courier` | 3PL courier hub | `logistics.carrier.manage` |
| | `/admin/cod-reconciliation` | COD reconciliation | `orders.cod.reconcile` |
| **Finance** | `/admin/finance` | Finance overview | `finance.overview.view` |
| | `/admin/finance/ledger` | Ledger & integrity | `finance.ledger.view` |
| | `/admin/finance/escrow` | Escrow holdings | `finance.escrow.view` |
| | `/admin/finance/payouts` | Payout disbursal queue | `finance.payout.approve` |
| | `/admin/finance/splits` | Profit split manager | `finance.split.update` |
| | `/admin/finance/b2b-escrow` | B2B milestone escrow | `finance.b2b_escrow.manage` |
| | `/admin/finance/subscriptions` | Merchant fee engine | `finance.subscription.manage` |
| **Growth** | `/admin/growth/ads` | Ad governance | `growth.ad.govern` |
| | `/admin/growth/coupons` | Coupons & vouchers | `growth.coupon.manage` |
| | `/admin/growth/campaigns` | Flash sales & campaigns | `growth.campaign.manage` |
| | `/admin/growth/referrals` | Referral rules | `growth.referral.govern` |
| | `/admin/growth/coins` | Coin & loyalty policy | `growth.coins.govern` |
| | `/admin/growth/quests` | Quests & leaderboard | `growth.quest.govern` |
| | `/admin/growth/group-buy` | Team purchase policy | `growth.groupbuy.govern` |
| **Content** | `/admin/content/*` | Mirrors the Editor surfaces | `content.*` |
| | `/admin/live` | Live commerce governance | `live.stream.govern` |
| **Platform** | `/admin/platform/modules` | **Module control panel** | `platform.module.toggle` |
| | `/admin/platform/theme` | Theme & colour studio | `platform.theme.view` |
| | `/admin/platform/integrations` | Gateway & courier credentials | `platform.integration.manage` |
| | `/admin/platform/api-keys` | Developer API keys | `platform.apikey.manage` |
| | `/admin/platform/settings` | Global platform settings | `platform.settings.update` |
| **Security** | `/admin/security/audit` | Audit explorer | `security.audit.view` |
| | `/admin/security/sessions` | Active sessions | `security.session.revoke` |
| | `/admin/security/2fa` | Staff 2FA enforcement | `security.2fa.manage` |
| | `/admin/security/ip-allowlist` | Admin IP allowlist | `security.ip.manage` |
| | `/admin/security/backups` | Backup & restore | `system.backup.manage` |

### 1.10 Development only

| Path | Page | Availability |
| :--- | :--- | :--- |
| `/dev/gallery` | Component gallery | `import.meta.env.DEV` only — excluded from production build |
| `/dev/craft` | Craft audit | `import.meta.env.DEV` only |

**Total: ~120 routes.** Every one has an explicit `perm` and `module` value. A route added later
without both is a defect that Prompt 1.5's router guard must reject at registration time.

---

## 2. Navigation Groups Per Role

Rendered from `client/src/config/navigation.js`. Each entry:

```js
{ key, labelKey, icon, path, group, permission, module, roles: [], order, simpleMode: bool }
```

### 2.1 👑 Super Admin — 9 groups

```
📊  Overview          Dashboard · System Health
👥  Users & Access    Users · Staff · Roles & Permissions · Access Grants ·
                      Approval Inbox ⁽ᵇᵃᵈᵍᵉ⁾ · Restrictions · KYC Verification
📦  Catalog           Products · Categories · Moderation Queue ⁽ᵇᵃᵈᵍᵉ⁾ ·
                      Batches & FEFO · Warehouses
🛒  Orders            Orders · Returns · Disputes ⁽ᵇᵃᵈᵍᵉ⁾ · Courier Hub · COD Reconciliation
💰  Finance           Overview · Ledger · Escrow · Payouts ⁽ᵇᵃᵈᵍᵉ⁾ ·
                      Profit Splits · B2B Escrow · Subscriptions
📣  Growth            Ads · Coupons · Campaigns · Referrals · Coins · Quests · Group Buy
✍️  Content           Banners · Stories · Academy · What's New · Translations · Live
⚙️  Platform          Module Toggles · Theme Studio · Integrations · API Keys · Settings
🔒  Security          Audit Log · Sessions · 2FA · IP Allowlist · Backups
```

⁽ᵇᵃᵈᵍᵉ⁾ carries a live count of items awaiting action. **Approval Inbox is the most important
badge in the product** — it is where delegated work waits for the Admin, and an unnoticed badge
there means a Moderator is blocked.

### 2.2 🛡️ Moderator — 4 groups + personal

```
📊  Overview          Dashboard (workload, SLA at risk, my throughput)
📦  Review Queues     Product Moderation ⁽ᵇᵃᵈᵍᵉ⁾ · Review Integrity · UGC Video · Live Streams
🛒  Cases             Disputes ⁽ᵇᵃᵈᵍᵉ⁾ · Returns · User Reports ⁽ᵇᵃᵈᵍᵉ⁾
⚠️  Enforcement       Warnings & Penalties
🔑  My Access         Active grants · Pending requests · My submitted actions
```

Anything the Moderator has not been granted appears **locked with a Request Access affordance**
(§5), not hidden. Groups unlocked by an active grant appear immediately, without a reload.

### 2.3 ✍️ Editor — 2 groups

```
📰  Content           Banners · Stories · Academy · What's New · Help Centre
🌐  Localization      Translations (per-locale completeness %)
```

### 2.4 🏭 Supplier — 7 groups

```
📊  Overview          Dashboard · Reseller Insights · Demand Forecasting
📦  Inventory         Products · Stock · Batches & Expiry · Warehouses
🛒  Orders            Incoming Orders · Fulfilment · Shipments
🛡️  Aftercare         Warranty Claims
💰  Finance           Earnings Vault · B2B Escrow
💬  Engage            Wholesale Inquiries · Live Host Panel
🏪  My Shop           Physical Shop Status
```

### 2.5 🛍️ Saler — 7 groups

```
📊  Overview          Dashboard · Analytics · Cart Insights
🏪  My Store          Storefront Builder · My Products · Physical Shop Status
🔍  Sourcing          Supplier Catalog · Profit Calculator · Bundles
📣  Marketing         Creative Studio · Social Kit · Ad Campaigns · Live Studio
🛒  Orders            Orders
💰  Vault             Balance & Escrow · Withdrawals
🚀  Growth            Referrals · Quests · Leaderboard · Academy · Inbox
```

### 2.6 🛒 Customer — 4 groups

The customer portal is **flat and icon-led by design**. Shoppers do not learn an information
architecture; they scan for the thing they recognise.

```
🛒  Shopping          Orders · Returns · Wishlist · Coupons · Team Purchases
🎁  Rewards           Coins & Streak · Referrals
🛡️  Protection        Warranties
👤  Me                Following · My Reviews · Addresses · Settings · Become a Saler ⭐
```

---

## 3. Command Palette (Ctrl / Cmd + K)

**Mandatory.** With 68 modules and ~120 routes, tree navigation alone is not discoverable. The
palette is how power users actually move, and how new users find something they cannot name a
path to.

### Behaviour

| Aspect | Specification |
| :--- | :--- |
| Trigger | `Ctrl+K` / `Cmd+K` anywhere except inside a text input. Also a visible ⌘K affordance in the TopBar so it is discoverable |
| Scope | Routes · modules · quick actions · recent items · **entity search** (order ID, phone number, product SKU, store slug) |
| Filtering | Results are filtered by the current user's **resolved permissions** before ranking. A user never sees a result they cannot open |
| Ranking | Exact match → recent → frequent → fuzzy. Recency is per-user, stored in `localStorage` |
| Grouping | Results grouped by section with a header, max 5 per group |
| Keyboard | `↑`/`↓` navigate · `Enter` open · `Cmd+Enter` open in new tab · `Esc` close · `Tab` cycle groups |
| Empty state | Shows the 5 most recent destinations plus 3 suggested actions for the current role |
| No results | "Nothing matches **{query}**" + a "Search products for {query}" fallback action |
| Performance | First paint < 50ms; results update within one frame of each keystroke. Index built once at login and cached |
| Motion | Grows from the TopBar trigger per the Origin Rule (`design-system.md` §6.2) |

### Quick actions (verbs, not destinations)

Palette entries that *do* something rather than navigate. Each is permission- and module-gated:

```
Create product · Add to my store · Request payout · Approve pending actions
Toggle a module · Switch language · Switch theme · Switch density
Start live stream · Generate flyer · Create coupon · Invite a friend
Request access to…  ← opens the JIT request modal directly
```

---

## 4. Progressive Disclosure — Simple vs Advanced Mode

Applies to the **Saler** and **Supplier** shells. Many Explooro sellers are first-time digital
entrepreneurs; a 7-group sidebar with 30 items on day one causes abandonment.

| | Simple Mode (default for new accounts) | Advanced Mode |
| :--- | :--- | :--- |
| Sidebar | Max **6** items, no groups | Full grouped tree |
| Dashboard | 4 cards: today's orders, earnings, messages, one next action | Full analytics |
| Forms | Required fields only; optional fields behind "More options" | All fields |
| Terminology | Plain language — "Money you can withdraw" | Precise — "Available balance" |

**Saler Simple Mode:** Add Product · Share My Store · My Orders · My Earnings · Messages · Help
**Supplier Simple Mode:** Add Product · Stock · Orders to Pack · Print Labels · My Earnings · Help

Rules:
- Persisted per user (`user_profiles.ui_mode`), not per device.
- Switch available in the avatar menu **and** the command palette — never buried in settings.
- Auto-prompt (never auto-switch) to Advanced after the seller completes 10 orders:
  *"Ready for more tools?"* — the user always decides.
- Simple Mode **never hides money, orders, or messages.** It hides configuration and analytics.

---

## 5. Locked-State UX — the delegation surface

This is where the Admin/Moderator authorization model becomes visible. Getting the copy right
matters as much as getting the logic right.

### 5.1 The three states

| Cause | Treatment | Why |
| :--- | :--- | :--- |
| **Module disabled** | **Hidden entirely** | The business turned this off. Nobody can have it. Advertising it creates support tickets for a feature that does not exist |
| **Permission missing, MEDIUM tier** | **Visible, greyed, 🔒, "Request access"** | The user could legitimately have this. Hiding it means they never know to ask |
| **Permission missing, CRITICAL tier** | **Visible, greyed, 🔒, no request affordance** | Never delegable. Show it exists so the org chart is legible, but offer no path |
| **Restricted (`user_restrictions`)** | **Visible, greyed, reason shown** | The user must know *why* and until when. A silent failure feels like a bug |

### 5.2 Copy — English and Bengali

Every string below must exist in `en.json` and `bn.json` (Prompt 1.6).

| Key | English | Bengali |
| :--- | :--- | :--- |
| `access.locked.title` | Access needed | অ্যাক্সেস প্রয়োজন |
| `access.locked.body` | You don't have access to **{feature}** yet. | **{feature}**-এ আপনার এখনো অ্যাক্সেস নেই। |
| `access.locked.cta` | Request access | অ্যাক্সেসের জন্য আবেদন করুন |
| `access.locked.critical` | Only a Super Admin can use this. | এটি শুধুমাত্র সুপার অ্যাডমিন ব্যবহার করতে পারেন। |
| `access.request.title` | Request access to {feature} | {feature}-এর অ্যাক্সেস চান |
| `access.request.explain` | This lets you {plainLanguage}. | এটি দিয়ে আপনি {plainLanguage} পারবেন। |
| `access.request.reason` | Why do you need this? | আপনার এটি কেন প্রয়োজন? |
| `access.request.reason_hint` | Your Admin will see this. | আপনার অ্যাডমিন এটি দেখতে পাবেন। |
| `access.request.submit` | Send request | আবেদন পাঠান |
| `access.pending.title` | Waiting for approval | অনুমোদনের অপেক্ষায় |
| `access.pending.body` | Sent to your Admin {timeAgo}. | {timeAgo} আপনার অ্যাডমিনের কাছে পাঠানো হয়েছে। |
| `access.granted.toast` | Access granted — {feature} is now available for {duration}. | অ্যাক্সেস দেওয়া হয়েছে — {feature} এখন {duration} এর জন্য ব্যবহার করতে পারবেন। |
| `access.rejected.toast` | Request declined. {note} | আবেদন গৃহীত হয়নি। {note} |
| `access.elevated.chip` | Elevated access · {remaining} left | বাড়তি অ্যাক্সেস · {remaining} বাকি |
| `access.elevated.release` | Give up access now | এখনই অ্যাক্সেস ছেড়ে দিন |
| `access.expiring.warn` | Your access to {feature} expires in {remaining}. | {feature}-এ আপনার অ্যাক্সেস {remaining} পরে শেষ হবে। |
| `access.restricted.title` | Not available on your account | আপনার অ্যাকাউন্টে এটি বন্ধ আছে |
| `access.restricted.body` | Reason: {reason} | কারণ: {reason} |
| `access.restricted.until` | Until {date} | {date} পর্যন্ত |
| `approval.submitted.title` | Sent for approval | অনুমোদনের জন্য পাঠানো হয়েছে |
| `approval.submitted.body` | Your Admin must approve this before it takes effect. | কার্যকর হওয়ার আগে আপনার অ্যাডমিনকে এটি অনুমোদন করতে হবে। |

### 5.3 Copy rules

- **`{plainLanguage}` is mandatory and human.** "approve refunds up to ৳5,000" — never
  "hold `orders.refund.execute`". The person requesting and the person approving must both
  understand what is being asked without reading a permission catalog.
- **Never say "Permission denied" or "Forbidden"** in user-facing copy. It reads as an accusation.
  Say what is needed and how to get it.
- **Always state duration.** "for 2 hours" / "until 12 September". Access with no visible expiry
  is access nobody remembers to revoke.
- Bengali is written for a Bangladeshi user, not translated word-for-word from English.

### 5.4 The elevated-access chip

While a JIT window is active, a **persistent chip sits in the TopBar** with a live countdown and a
"give up access now" button. It is not dismissible.

Temporary elevation that the user forgets about is the same security problem as permanent
elevation. Making it continuously visible — and trivially releasable — is what keeps it temporary
in practice, not just on paper. A warning toast fires at 10 minutes remaining.

---

## 6. Mobile Navigation

Bangladesh is mobile-first, so this is the primary experience, not a fallback. **360px is the
design target.**

### Structure
- **Bottom tab bar: maximum 5 items**, role-specific, always visible, 44px targets, safe-area inset.
- **5th slot is always "More"** → bottom sheet with the full grouped tree.
- Sidebar becomes a swipe-in drawer on tablet (768–1024px); bottom bar below 768px.
- The active tab is indicated by **icon fill + label weight + colour** — never colour alone.

### Per role

| Role | Tab 1 | Tab 2 | Tab 3 | Tab 4 | Tab 5 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Customer** | Home | Search | Cart ⁽ᵇᵃᵈᵍᵉ⁾ | Orders | More |
| **Saler** | Dashboard | My Store | Orders ⁽ᵇᵃᵈᵍᵉ⁾ | Vault | More |
| **Supplier** | Dashboard | Stock | Orders ⁽ᵇᵃᵈᵍᵉ⁾ | Vault | More |
| **Moderator** | Dashboard | Queues ⁽ᵇᵃᵈᵍᵉ⁾ | Cases ⁽ᵇᵃᵈᵍᵉ⁾ | My Access | More |
| **Editor** | Content | Translations | — | — | More |
| **Super Admin** | Overview | Approvals ⁽ᵇᵃᵈᵍᵉ⁾ | Orders | Finance | More |

Primary actions sit in the bottom third of the viewport, within thumb reach.

---

## 7. Breadcrumbs, Titles & Empty-State Copy

### Breadcrumbs
- Shown on **level-3 (detail) pages only**. Levels 1 and 2 are already located by the sidebar.
- Format: `Group / Page / Entity` — e.g. `Finance / Payouts / #PR-4821`.
- The last crumb is the current page and is not a link.
- On mobile, collapse to a single back affordance labelled with the parent page name.

### Page titles
- Browser: `{Page} · {Section} · Explooro` — e.g. `Payouts · Finance · Explooro`.
- Public pages lead with content for SEO: `{Product} — {Store} | Explooro`.
- The `<h1>` matches the sidebar label exactly. A page whose heading disagrees with the nav item
  that led there feels like a wrong turn.
- Pending counts appear in the title when the tab is backgrounded: `(3) Approvals · Explooro`.

### Empty-state copy guidelines

Every empty state: **illustration + one sentence + exactly one primary action.**

| Context | Say | Never say |
| :--- | :--- | :--- |
| New store, no products | "Add your first product and start earning." | "No products found." |
| No orders yet | "Your orders will appear here once someone buys." | "Empty." |
| Empty vault | "You'll see your earnings here after your first sale clears." | "Balance: 0" |
| Search, no results | "Nothing matches **{query}**. Try fewer words?" | "0 results." |
| Cleared moderation queue | "Queue clear. Nice work." | "No items." |
| Filtered to nothing | "No results with these filters." + **Clear filters** | "No data." |

Rules: address the user as "you"; name the next action; **first-run copy is opportunity-framed,
returning-empty copy is status-framed**; both languages, written natively.

---

## 8. Implementation Checklist for Prompt 1.7

- [ ] `navigation.js` is pure data — no markup, no conditionals in the component
- [ ] All 6 role trees render correctly when the mocked role changes
- [ ] `Ctrl+K` palette: fuzzy search, permission-filtered, keyboard-complete, < 50ms first paint
- [ ] Locked items **visible with lock + Request Access**; module-disabled items **hidden**
- [ ] Elevated-access chip with live countdown and release button
- [ ] Simple / Advanced toggle for Saler and Supplier, persisted per user
- [ ] Bottom tab bar, 5 items max, correct per role, no horizontal scroll at 360px
- [ ] Every string in both `en.json` and `bn.json`
- [ ] Router rejects registration of any route lacking an explicit `permission` and `module`
