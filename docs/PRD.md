# 📋 Product Requirements Document (PRD) — Explooro Ecosystem (`prd.md`)

> **Document Version:** 1.0 (Final Architecture & Product Blueprint)  
> **Status:** Approved for Implementation  
> **Authoring AI Pair:** Google Antigravity + Claude Code  
> **Core Objective:** Build a superfast, zero-bloat, high-concurrency Social Commerce and Reseller Partnership platform with native real-time capabilities and flexible admin governance.

---

## 1. Executive Product Overview

### 1.1 Product Mission
**Explooro** is an industry-scale social e-commerce and reselling platform operating on a **collaborative profit-sharing partnership model**. It establishes a circular, self-sustaining marketplace that connects:
1. **Physical Manufacturers / Suppliers** (Inventory owners without direct marketing overhead).
2. **Salers / Resellers** (Digital micro-entrepreneurs who sell without physical inventory).
3. **End Customers** (Shoppers looking for curated products, transparent reviews, and social shopping).

### 1.2 Core Product Principles
* **Zero-Bloat Speed:** Sub-second page load times on 3G/4G networks; lightweight UI assets (<150KB client bundle).
* **Fluid User Roles:** Any user can upgrade to a Saler with one click; any supplier can purchase from other members.
* **Dynamic Profit Margins:** No hardcoded commission rates; all financial splits and platform fees are dynamically manageable by the Super Admin.
* **Modular Feature Toggles:** Every platform module has an administrative ON/OFF switch with zero code redeployments needed.
* **High Financial Integrity:** Strict ACID compliance for wallet transactions, escrow holding, and automated clawbacks.

---

## 2. User Personas & Role-Based Ecosystem (RBAC)

```
                            ┌─────────────────────────────────────────┐
                            │              Super Admin                │
                            │ (Full Control, Feature Toggles, Vaults) │
                            └────────────────────┬────────────────────┘
                                                 │
                        ┌────────────────────────┴────────────────────────┐
                        ▼                                                 ▼
          ┌───────────────────────────┐                     ┌───────────────────────────┐
          │      Moderator Role       │                     │        Editor Role        │
          │ (Compliance, KYC, Returns)│                     │ (Content, Banners, i18n)  │
          └───────────────────────────┘                     └───────────────────────────┘

───────────────────────────────────── MARKETPLACE USERS ─────────────────────────────────────

     ┌────────────────────────┐      ┌────────────────────────┐      ┌────────────────────────┐
     │  Supplier/Manufacturer │ ◄──► │ Saler (Reseller Shop)  │ ◄──► │   Customer / Shopper   │
     │  • Holds Stock & Base  │      │ • Sells via Story/Ads  │      │ • Browses, Chats, Buys │
     │  • Fulfillment Hub     │      │ • Earns Dynamic Split  │      │ • 1-Click Saler Upgrade│
     └────────────────────────┘      └────────────────────────┘      └────────────────────────┘
```

### 2.1 Marketplace Personas

#### A. 🏭 Supplier / Manufacturer
* **Goal:** Liquidate inventory in bulk without hiring a dedicated retail sales team.
* **Key Capabilities:**
  * Bulk product listing with Base Cost, Wholesale Margin, and live inventory count.
  * Fulfillment dashboard (print packing slips, trigger courier pick-up).
  * Dual Mode: Can activate Saler mode to resell products from other suppliers.
  * Real-time stock depletion alerts.

#### B. 🛍️ Saler (Virtual Reseller)
* **Goal:** Run a profitable online business with zero capital, zero warehouse, and zero logistics hassle.
* **Key Capabilities:**
  * 1-Click "Add to My Store" from verified supplier catalogs.
  * Personalized branded virtual storefront (`explooro.com/store/shop-name`).
  * Storytelling & Content Commerce tools (create problem-solving posts & unboxing video feeds).
  * Launch in-platform sponsored advertisements with micro-budgets.
  * Real-time **Digital Vault (Wallet)** tracking commissions and payouts.

#### C. 🛒 Customer / Visitor
* **Goal:** Discover unique, verified products with fast delivery and transparent pricing.
* **Key Capabilities:**
  * Personalized feed with multi-seller discovery.
  * Real-time chat with Salers and Suppliers before checkout.
  * Flexible checkout: bKash, Nagad, Rocket, or Cash on Delivery (COD).
  * 1-Click upgrade to become a Saler.

### 2.2 Administrative Hierarchy
* **Super Admin:** Master financial controls, dynamic margin engine, feature toggles, system backups, and staff creation.
* **Moderator:** Dispute arbitration between Buyer ↔ Saler ↔ Supplier, KYC/NID verification, flagged review moderation.
* **Editor:** Homepage banners, "What's New" release notes, storytelling curation, and Bengali/English translation strings.

---

## 3. Core Functional Requirements & Subsystems

### 3.1 🎛️ Master Module Control Panel (Admin Feature Toggles)
Every feature within Explooro must be governed by a database-driven feature flag.
* **Requirement:** Turning a toggle `OFF` hides its UI elements, disables API routes gracefully, and pauses background jobs without requiring a server reboot.
* **Key Toggleable Modules:**
  1. Supplier / Saler / Customer Verification.
  2. In-Platform Sponsored Ads Engine.
  3. Real-Time Peer-to-Peer Live Chat.
  4. Return & Dispute Arbitration Panel.
  5. Content Commerce & Storytelling Feed.
  6. Physical Shop Open/Closed Status Indicator.
  7. Blue-Tick Verified Badges.
  8. Courier Webhook Synchronizations (Steadfast, Pathao).
  9. Future Subscription / Platform Fee Engine.
  10. **Granular Theme & Color Studio:** Live administrative control over every distinct UI section (Navbar, Canvas/Surfaces, Brand/Buttons, Text, Badges, Footer) with zero gradients, solid Alibaba/Amazon aesthetic standards, and 1-click marketplace presets.

---

### 3.2 💰 Dynamic Pricing & Digital Vault Subsystem

#### Financial Formula:
$$\text{Customer Retail Price} = \text{Base Cost} + \text{Wholesale Margin} + \text{Net Retail Margin}$$
$$\text{Saler Earning} = \text{Net Retail Margin} \times \text{Saler Split \% (e.g. 40\%)}$$
$$\text{Explooro Platform Earning} = \text{Net Retail Margin} \times \text{Explooro Split \% (e.g. 60\%)}$$

#### Vault Capabilities:
* **Escrow Holding Period:** Commissions remain in `Pending` status until the order return window (e.g., 7 days) expires and delivery is verified by courier webhooks.
* **Clawback Engine:** Automated deduction from pending balance if a customer return or dispute is approved.
* **Payout Gateways:** Automated and manual withdrawal requests to bKash, Nagad, Rocket, and Local Bank Accounts.

---

### 3.3 🛍️ Virtual Storefront & Sourcing Engine
* **Supplier Catalog:** Salers can filter suppliers by verification tier, shipping speed, and profit margin.
* **Store Customization:** Custom logo, banner, social links, announcement bar, and physical shop Open/Close toggle with business hour timestamps.
* **Shareable Dynamic Cards:** High-speed OpenGraph (OG) image generation for WhatsApp and Facebook sharing.

---

### 3.4 💬 Real-Time Communication & Notifications
* **WebSocket Engine (`ws`):** Bi-directional messaging for Customer ↔ Saler ↔ Supplier.
* **Smart Notification Hub:**
  * SMS notifications for OTP login, order dispatch, and delivery milestones.
  * Push and in-app notifications for wallet credits and customer inquiries.
  * One-time "What's New" popup shown to users upon new platform feature releases.

---

### 3.5 🇧🇩 Localized Bangladesh Integrations
* **Mobile Financial Services (MFS):**
  * bKash Direct Checkout (Tokenized API).
  * Nagad PGW.
  * Rocket / SSLCommerz fallback.
  * Cash on Delivery (COD) with automated fraud verification (OTP verification).
* **3PL Courier Logistics:**
  * Steadfast Courier API (automatic consignment creation, live webhook tracking).
  * Pathao Merchant API & RedX integration.
* **SMS Gateway:** Local BD SMS gateway integration (Greenweb/BulkSMSBD/Alpha Net).

---

## 4. Technical Architecture & Technology Stack Alignment

Aligned with the finalized specifications in `technologyused.md`:

| Component | Technology | Rationale & Performance Target |
| :--- | :--- | :--- |
| **Web Frontend** | **Vite + Vanilla Modern CSS + Modular JS** | Instant HMR live preview during development; <150KB bundle; sub-second FCP (First Contentful Paint). |
| **Mobile Client** | **Flutter 3.x (Dart Native)** | High performance 60/120 FPS native Android & iOS apps sharing the same backend API. |
| **Backend Runtime** | **Node.js (Fastify)** | 30,000+ req/sec throughput, low memory footprint, strict schema validation. |
| **Primary Database** | **PostgreSQL 16** | Relational integrity, strict ACID compliance for financial Vault transactions. |
| **Cache & Real-Time** | **Redis 7 + WebSockets** | In-memory session management, rate limiting, and sub-millisecond chat delivery. |
| **Media Hosting** | **Cloudflare R2** | Zero egress fees for high-resolution product photos and video clips. |
| **Deployment Setup** | **Cloudflare Pages + Singapore VPS (Docker)** | Global edge CDN for web + 25-40ms ping from Singapore to Bangladesh ISPs. |

---

## 5. Strategic Gap Analysis & Recommendations 🔍

To ensure a seamless launch and avoid real-world operational bottlenecks, the following **7 gaps** have been identified along with their concrete architectural solutions:

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    IDENTIFIED GAPS & SOLUTIONS                                   │
├────┬─────────────────────────────┬─────────────────────────────────┬─────────────────────────────┤
│ #  │ Area                        │ Identified Risk / Gap           │ Architectural Solution      │
├────┼─────────────────────────────┼─────────────────────────────────┼─────────────────────────────┤
│ 1  │ COD Fake Order Abuse        │ High delivery return rates in BD│ OTP verification + Customer │
│    │                             │ causing courier losses.         │ Trust Score calculation.    │
├────┼─────────────────────────────┼─────────────────────────────────┼─────────────────────────────┤
│ 2  │ Escrow vs Return Window     │ Saler withdrawing funds before  │ 7-day mandatory escrow lock │
│    │                             │ customer initiates a return.    │ before wallet funds unlock. │
├────┼─────────────────────────────┼─────────────────────────────────┼─────────────────────────────┤
│ 3  │ Multi-Supplier Single Order │ Order with items from 2 distinct│ Order split into sub-orders │
│    │                             │ suppliers creates parcel chaos. │ with independent parcels.   │
├────┼─────────────────────────────┼─────────────────────────────────┼─────────────────────────────┤
│ 4  │ Product Quality & Counterfeit│ Fake items damaging platform    │ Mandatory Trade License/NID │
│    │                             │ brand reputation.               │ + Supplier Quality Tiering. │
├────┼─────────────────────────────┼─────────────────────────────────┼─────────────────────────────┤
│ 5  │ Inventory Concurrency Race  │ 2 Salers selling the last stock │ Database row-locking        │
│    │                             │ item simultaneously.            │ (`SELECT FOR UPDATE`).      │
├────┼─────────────────────────────┼─────────────────────────────────┼─────────────────────────────┤
│ 6  │ Courier COD Reconciliation  │ Discrepancy between courier cash│ Automated webhook settlement│
│    │                             │ collected and wallet credit.    │ log & dispute dashboard.    │
├────┼─────────────────────────────┼─────────────────────────────────┼─────────────────────────────┤
│ 7  │ Offline / Network Drops     │ Poor 3G mobile data during chat │ Optimistic UI updates +     │
│    │                             │ or live checkout.               │ IndexedDB local queue.      │
└────┴─────────────────────────────┴─────────────────────────────────┴─────────────────────────────┘
```

### Detailed Gap Explanations:
1. **Multi-Supplier Cart Splitting:** When a customer buys Product A (Supplier 1) and Product B (Supplier 2) in one cart, the backend must split them into two distinct sub-orders with separate courier tracking numbers to prevent logistics failure.
2. **Escrow Safeguard:** Wallets must separate `Available Balance` from `Pending Escrow Balance`. Funds move to `Available` only after the 7-day return period ends.
3. **Anti-Fraud COD Verification:** Require an instant 4-digit SMS OTP confirmation for high-value COD orders to reduce bogus delivery attempts.

---

## 6. Implementation Roadmap (Phased Development)

```
Phase 1: Design Tokens & Core Web UI (Vite + Vanilla CSS)
   │  └── Setup Vite, CSS Tokens, Responsive Layout, Marketplace, Storefronts
   ▼
Phase 2: Interactive Subsystems & State Engine
   │  └── Dynamic Profit Calculator, Vault UI, Admin Module Toggle Mockup, i18n
   ▼
Phase 3: Backend API & PostgreSQL Schema (Fastify)
   │  └── Auth (JWT/OTP), RBAC, Products, Orders, Dynamic Pricing Calculation
   ▼
Phase 4: Real-Time Engine, WebSockets & Local BD Integrations
   │  └── Live Chat, bKash/Nagad Checkout, Steadfast Courier Webhooks, SMS
   ▼
Phase 5: Flutter Cross-Platform Mobile App (Android/iOS)
   │  └── Native Mobile UI, Push Notifications, Camera Integration
   ▼
Phase 6: Production Deployment & Go-Live (Singapore VPS + Cloudflare CDN)
      └── Docker orchestration, Nginx reverse proxy, SSL, and Automated CI/CD
```

---

## 7. Success Metrics & Performance KPIs

* **Page Load Time:** < 1.0 second on 4G connections in Bangladesh (Target: 95+ Lighthouse Score).
* **API Latency:** < 50ms for core catalog endpoints.
* **Financial Accuracy:** 100.00% matching ledger balance across Escrow, Saler, Supplier, and Platform vaults.
* **Uptime Target:** 99.9% availability via Singapore VPS and Cloudflare Edge caching.

---
*Authored and validated for implementation via Google Antigravity and Claude Code.*
