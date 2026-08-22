# Explooro — Module Registry

> **Produced by:** Prompt 0.7
> **Data:** [`server/src/config/modules.seed.json`](../server/src/config/modules.seed.json) — **71 modules**, validated
> **Implemented by:** Prompt 3.1 (backend, `requireModule`, targeting), Prompt 3.2 (Module Control Panel UI)
>
> `idea proposition.md` §4 states the governing rule: *"Every feature and module listed in this
> section is individually toggleable (ON/OFF) from the Super Admin Dashboard. No module is
> permanently hardwired."* This document is that list made machine-readable.
>
> v1.0 referred to "50+ features" but never enumerated them in any form a program could read.

---

## 1. Summary

| | |
| :--- | :--- |
| Modules | **71** |
| Groups | 9 |
| Default **ON** | 66 |
| Default **OFF** | 5 |
| With sub-settings | 50 |
| With dependents | 14 |
| Validation errors | **0** |

### By group

| Group | Modules | Purpose |
| :--- | ---: | :--- |
| `trust` — Trust & Safety | 15 | Verification, moderation, fraud, policy |
| `commerce` — Commerce | 12 | Storefronts, sourcing, inventory, buying mechanics |
| `finance` — Payments & Money | 7 | Payment methods, escrow, reconciliation |
| `logistics` — Delivery & After-sales | 4 | Courier, returns, disputes, warranty |
| `communication` — Communication | 6 | Chat, notifications, WhatsApp |
| `growth` — Growth & Rewards | 9 | Ads, coupons, referrals, coins, gamification |
| `content` — Content & Presentation | 10 | Stories, reels, live, academy, i18n, theme, SEO |
| `advanced` — AI & Advanced | 5 | The five AI-dependent features |
| `system` — System | 3 | API, backups |

### By risk of disabling

| Risk | Count | Meaning |
| :--- | ---: | :--- |
| `CRITICAL` | 18 | Turning this off breaks core commerce or removes a legal/financial control |
| `HIGH` | 7 | Significant capability loss; real business consequence |
| `MEDIUM` | 18 | Noticeable feature loss, no structural damage |
| `LOW` | 28 | Safe to disable — the platform still functions normally |

`risk_of_disabling` drives the confirmation copy in Prompt 3.2. Turning off a `CRITICAL` module
shows a stronger warning and names exactly what will stop working, rather than a generic
"are you sure?".

### The five modules that ship OFF

| Module | Why it starts off |
| :--- | :--- |
| `customer_verification` | Signup friction kills conversion. `idea proposition.md` §C.3 calls this out explicitly — built in, off by default |
| `age_verification` | Only meaningful once age-restricted categories exist |
| `auto_approval` | Human review first. Auto-approval is earned, per category, after the queue is understood |
| `card_payment` | The SSLCommerz gateway is not live yet |
| `subscription_fees` | *"100% Free at launch"* — the fee engine exists so it can be turned on later without a deploy |

---

## 2. Entry Shape

```json
{
  "key": "returns_engine",
  "group": "logistics",
  "label_en": "Returns & refunds",
  "label_bn": "রিটার্ন ও রিফান্ড",
  "description_en": "Customer-initiated returns with evidence, inspection and refund.",
  "description_bn": "ক্রেতার শুরু করা রিটার্ন — প্রমাণ, পরীক্ষা ও রিফান্ডসহ।",
  "default_enabled": true,
  "risk_of_disabling": "CRITICAL",
  "depends_on": [],
  "affected_routes": ["/account/returns", "/moderator/returns", "/admin/returns"],
  "affected_permissions": ["orders.return.review", "orders.return.approve", "orders.refund.execute"],
  "targeting": ["by_district"],
  "sub_settings_schema": { "type": "object", "properties": { "...": "..." } }
}
```

### Validation rules — enforced at seed time (Prompt 3.1)

1. `key` matches `^[a-z][a-z0-9_]*$` and is unique.
2. `group` exists in the `groups` array.
3. `label_en`, `label_bn`, `description_en`, `description_bn` are all non-empty.
4. `risk_of_disabling` ∈ `LOW | MEDIUM | HIGH | CRITICAL`.
5. Every `depends_on` entry is a known module key.
6. **The dependency graph is acyclic.** Verified.
7. Every `targeting` value is a known targeting type.
8. **Every `affected_permissions` entry exists in `permission-catalog.json`.** Verified — 0 unknown.
9. `sub_settings_schema` is either `null` or a JSON Schema object.

Current state: **0 violations**, and all 36 module keys referenced in `ia-sitemap.md` resolve.

---

## 3. Dependency Graph

Disabling a module warns about its dependents. `cascade: true` disables them too, audited as one
change (Prompt 3.1).

```
chat ──────────────┬── whatsapp_bridge
                   └── live_commerce

escrow_engine ─────┬── b2b_escrow
                   └── cod_reconciliation ── (also needs cod_payment)

cod_payment ───────┬── cod_protection
                   └── cod_reconciliation

returns_engine ──────── dispute_panel

virtual_storefront ─┬── sourcing ─┬── product_bundling
                    │             └── ai_sourcing_chat
                    └── social_seller_kit

product_moderation ──── auto_approval
supplier_verification ── blue_tick_badge
customer_verification ── age_verification
onboarding_agreements ── terms_reacceptance
loyalty_coins ────────── daily_quests
coupons ──────────────── flash_sale
seo_public_pages ─────── xml_sitemap
auto_backup ──────────── manual_backup
```

**14 modules have dependents.** The relationships are real, not decorative — turning off `chat`
genuinely breaks the WhatsApp inbox and live-stream chat, and the admin must be told that before
they confirm rather than after support tickets arrive.

---

## 4. Sub-Settings

50 of 71 modules expose configuration beyond ON/OFF. **The admin UI generates the form from
`sub_settings_schema`** — Prompt 3.2 must not hand-write a form per module, or adding a module
later means writing UI code.

Representative examples:

```jsonc
// returns_engine — the return window is configuration, never a hardcoded 7
{
  "return_window_days":     { "type": "integer", "minimum": 0, "maximum": 60, "default": 7 },
  "allowed_reasons":        { "type": "array",   "items": { "type": "string" } },
  "require_evidence_for":   { "type": "array",   "default": ["DAMAGED", "WRONG_ITEM"] },
  "auto_approve_below_amount": { "type": "number", "default": 0 },
  "abuse_return_rate_pct":  { "type": "number",  "default": 40 }
}

// cod_protection — the anti-fraud thresholds from PRD §5 gap 1
{
  "otp_threshold_amount":      { "type": "number",  "default": 2000 },
  "max_cod_value":             { "type": "number",  "default": 25000 },
  "min_trust_score":           { "type": "integer", "default": 30 },
  "advance_charge_below_score":{ "type": "integer", "default": 20 }
}

// group_buying — the Pinduoduo mechanic's parameters
{
  "default_team_size": { "type": "integer", "minimum": 2, "default": 3 },
  "window_hours":      { "type": "integer", "default": 24 },
  "min_discount_pct":  { "type": "number",  "default": 10 }
}

// loyalty_coins — coins are a liability, so every rate is admin-controlled
{
  "checkin_reward":    { "type": "integer", "default": 10 },
  "streak_multiplier": { "type": "number",  "default": 1.5 },
  "redemption_rate":   { "type": "number",  "default": 0.1 },   // 100 coins = ৳10
  "max_redeem_pct":    { "type": "number",  "default": 20 },
  "expiry_days":       { "type": "integer", "default": 365 }
}

// escrow_engine — the hold period, and a shorter one for trusted sellers
{
  "hold_days":       { "type": "integer", "minimum": 0, "maximum": 60, "default": 7 },
  "elite_hold_days": { "type": "integer", "default": 3 }
}
```

> **Rule for every later prompt:** if a number appears in a requirement — 7-day escrow, 24-hour
> group buy, 100 coins = ৳10, 40/60 split — it is read from module settings or
> `platform_settings`, never written into code. `prompt.md` Master Instructions §5 forbids magic
> numbers, and this registry is where those numbers actually live.

---

## 5. Targeting

Beyond global ON/OFF, a module may be scoped. Evaluation order (Prompt 3.1):

```
global off  →  scheduled window  →  by_user  →  by_district  →  by_tier  →  by_role
            →  percentage_rollout  →  default
```

More specific always wins. `by_user` beats `by_district` beats `by_tier` beats `by_role`.

| Targeting | Used by | Example |
| :--- | :--- | :--- |
| `by_role` | 5 modules | `daily_quests` differs for saler vs customer |
| `by_tier` | 12 modules | `live_commerce` requires Verified Trader to host |
| `by_district` | 11 modules | `cod_payment` only where couriers actually collect cash |
| `by_user` | all | Per-user override for support and testing |
| `percentage_rollout` | 14 modules | Ship `quick_buy` to 10% first and watch conversion |
| `scheduled_window` | 3 modules | `flash_sale` and campaign windows |

**Percentage rollout is deterministic per user** — the same user always gets the same answer, so
the experience never flickers between page loads.

---

## 6. Cross-Check Against `idea proposition.md` §4

The source table has **65 rows**. Every one maps to a registry key. Six extra modules were added
because other source documents require them.

| # | Source row | Registry key |
| ---: | :--- | :--- |
| 1 | Supplier / Manufacturer Verification | `supplier_verification` |
| 2 | Saler (Reseller) Verification | `saler_verification` |
| 3 | Customer Identity Verification | `customer_verification` |
| 4 | Customer Age Verification | `age_verification` |
| 5 | Product Approval & Moderation Queue | `product_moderation` |
| 6 | Auto-Approval for Products | `auto_approval` |
| 7 | In-Platform Sponsored Ads Engine | `sponsored_ads` |
| 8 | Customer Shopping Concierge Chat (AI) | `ai_concierge` |
| 9 | Saler Sourcing Intelligence Chat (AI) | `ai_sourcing_chat` |
| 10 | Real-Time Peer-to-Peer Messaging | `chat` |
| 11 | Return & Refund Engine | `returns_engine` |
| 12 | Dispute Panel | `dispute_panel` |
| 13 | Social Follow & Follower Feed | `follow_feed` |
| 14 | Content Commerce (Storytelling Posts) | `content_commerce` |
| 15 | Physical Shop Open/Close Toggle | `physical_shop_status` |
| 16 | Blue-Tick Verification Badge | `blue_tick_badge` |
| 17 | Qualification Tier System | `trust_tiers` |
| 18 | Voice Search | `voice_search` |
| 19 | Wishlist / Favorites | `wishlist` |
| 20 | 1-Click Quick Buy | `quick_buy` |
| 21 | SMS Order Notifications | `sms_notifications` |
| 22 | Push Notifications | `push_notifications` |
| 23 | Email Notifications | `email_notifications` |
| 24 | Fraud Detection & Velocity Limits | `fraud_velocity_limits` |
| 25 | Review Integrity System (AI Flagging) | `review_integrity` |
| 26 | Duplicate Account Detection | `duplicate_account_detection` |
| 27 | User Report & Flag System | `user_reports` |
| 28 | Onboarding Agreements & Policy Acceptance | `onboarding_agreements` |
| 29 | Versioned Terms Re-acceptance Prompts | `terms_reacceptance` |
| 30 | SEO-Optimized Public Product Pages | `seo_public_pages` |
| 31 | Social Sharing OG Cards | `og_share_cards` |
| 32 | Dynamic XML Sitemap | `xml_sitemap` |
| 33 | Multi-Language Engine (i18n) | `i18n` |
| 34 | In-App "What's New" Notifications | `whats_new` |
| 35 | Automated Database Backup | `auto_backup` |
| 36 | Manual Backup Trigger | `manual_backup` |
| 37 | 15-Second Video/Audio Walkthroughs | `video_walkthroughs` |
| 38 | COD Payment | `cod_payment` |
| 39 | bKash / Nagad / Rocket Payment | `mfs_payment` |
| 40 | Debit/Credit Card Payment | `card_payment` |
| 41 | Seller & Supplier Subscription / Fee Engine | `subscription_fees` |
| 42 | 3PL Courier Aggregator & Live GPS Hub | `courier_hub` |
| 43 | Anti-Fraud Fake Order & COD Protection | `cod_protection` |
| 44 | Interactive Live Stream Commerce | `live_commerce` |
| 45 | Social Group Buying / Team Purchase | `group_buying` |
| 46 | AI Creative Marketing Studio | `ai_creative_studio` |
| 47 | Customer Loyalty Points & Explooro Coins | `loyalty_coins` |
| 48 | Multi-Tier Referral & Network Growth | `referral_engine` |
| 49 | Social Seller Kit & Auto-Flyer Generator | `social_seller_kit` |
| 50 | Abandoned Cart Recovery Engine | `cart_recovery` |
| 51 | Gamification, Leaderboard & Seller Rewards | `gamification` |
| 52 | Coupons, Vouchers & Flash Sale Campaign | `coupons` + `flash_sale` ⁽ˢᵖˡᶦᵗ⁾ |
| 53 | Explooro Seller Academy | `seller_academy` |
| 54 | Prescriptive Analytics & Next-Action Insights | `prescriptive_insights` |
| 55 | Digital Warranty & Product Protection | `digital_warranty` |
| 56 | AI Smart Inventory & Demand Forecasting | `ai_forecasting` |
| 57 | Cross-Seller Dynamic Product Bundling | `product_bundling` |
| 58 | WhatsApp & Messenger Conversational Commerce | `whatsapp_bridge` |
| 59 | Daily Challenges & Seller Achievement Quests | `daily_quests` |
| 60 | Dynamic Demand Surge & Yield Optimization | `demand_surge` |
| 61 | B2B Wholesale Escrow & Milestone Settlement | `b2b_escrow` |
| 62 | UGC Video Reviews & Social Proof Wall | `ugc_video_wall` |
| 63 | Open Marketplace REST API & Developer SDK | `open_api` |
| 64 | Batch & Expiration Management (FEFO) | `fefo_batches` |
| 65 | Multi-Location Warehouse & Proximity Routing | `multi_warehouse` |

**Coverage: 65 / 65. No omissions.**

### One deliberate split

Source row 52 bundles *"Coupons, Vouchers & Flash Sale Campaign Engine"* into a single toggle.
The registry splits it into `coupons` and `flash_sale`, with `flash_sale` depending on `coupons`.

Reason: they fail differently. A flash sale reserves stock and runs on a countdown; a coupon is a
discount rule. An operator whose flash sale is oversubscribed needs to stop **that** without
disabling every discount code on the platform. One toggle would force an all-or-nothing choice at
exactly the wrong moment.

### Six modules added beyond the source table

| Key | Why it was added |
| :--- | :--- |
| `virtual_storefront` | The core Saler feature. `idea proposition.md` §A describes it in prose but omits it from the toggle table — an oversight, since every `/store/:slug` route depends on it |
| `sourcing` | Same: §A's 1-click "Add to My Store" is a distinct capability from the storefront itself |
| `escrow_engine` | `PRD.md` §3.2 makes the 7-day hold a hard requirement. The hold period must be configurable, so it needs a module |
| `cod_reconciliation` | `PRD.md` §5 gap 6. Absent from the source toggle table and from v1.0 entirely |
| `theme_studio` | `PRD.md` §3.1.10 and `technologyused.md` §Layer 1 both require it |
| `flash_sale` | The split described above |

Every addition traces to a requirement in `PRD.md` or `technologyused.md`. None is invented.

---

## 7. Behaviour When a Module Is OFF

From `idea proposition.md` §4: *"its UI elements are hidden from all users, API endpoints return
graceful 'feature not available' responses, and no background processes run for that module."*

Concretely (Prompt 3.1 / 3.2):

| Layer | Behaviour |
| :--- | :--- |
| **API** | `requireModule('key')` → `403 MODULE_DISABLED` with a bilingual message (`api-contract.md` §3.2) |
| **Client nav** | The item is **hidden entirely** — not locked. A disabled module is not something a user can request (`ia-sitemap.md` §5.1) |
| **Client DOM** | Elements marked `data-module="key"` are removed by `featureFlags.js` |
| **Background jobs** | Every job checks `isEnabled` before running and no-ops if off |
| **Existing data** | **Preserved, never deleted.** Turning a module back on restores it exactly |
| **Audit** | Every toggle writes an `audit_logs` row with actor, before/after, and a **mandatory reason** |

**Data preservation is the rule that makes toggles safe.** If disabling `loyalty_coins` deleted
coin balances, no operator would ever dare use the switch — and a control nobody dares use is not
a control.

### Who can toggle

`platform.module.toggle` is **CRITICAL** tier (`rbac-spec.md` §2): **Super Admin only, never
delegable**, by any path. Sub-settings and targeting are equally CRITICAL. A Moderator or Admin
sees the panel read-only.

---

## 8. Implementation Checklist

**Prompt 3.1 — backend**
- [ ] Seed loader validates all 9 rules in §2 and fails the migration on any violation
- [ ] `isEnabled(key, context)` evaluates targeting in the §5 order
- [ ] Percentage rollout is deterministic per user
- [ ] `requireModule` returns `403 MODULE_DISABLED` with both languages
- [ ] Disabling a module with dependents returns `409` listing them; `cascade: true` proceeds
- [ ] Reason is mandatory on disable and stored
- [ ] Cache invalidates within one request of a change
- [ ] Background jobs consult `isEnabled` before running

**Prompt 3.2 — UI**
- [ ] Grouped accordion using the 9 groups — never one flat 71-row table
- [ ] Settings forms **generated** from `sub_settings_schema`, not hand-written
- [ ] `risk_of_disabling` drives the confirmation copy; `CRITICAL` names what will break
- [ ] Dependency warning modal with a cascade option
- [ ] Non-super-admin sees the entire page read-only
