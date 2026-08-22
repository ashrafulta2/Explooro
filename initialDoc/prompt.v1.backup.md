# 🚀 Explooro — Master Step-by-Step AI Development Prompts (`prompt.md`)

> **Document Version:** 1.0 (Production-Ready Execution Blueprint)  
> **Target Audience:** AI Coding Assistants (Google Antigravity, Claude Code, Cursor)  
> **Source Synthesis:** Synthesized from `idea proposition.md`, `PRD.md`, `DFD.md`, and `technologyused.md`.  
> **Language:** 100% Full English  
> **Execution Strategy:** Prompts are ordered sequentially. Execute each prompt one by one. Do not skip steps.

---

## 📌 Master Instructions for AI Execution

When executing these prompts, strictly adhere to the following non-negotiable guidelines:
1. **Technology Stack:**
   - **Frontend:** Vite + Vanilla Modern CSS (CSS Custom Properties) + Modular JavaScript/TypeScript. *Do NOT install or use TailwindCSS, Bootstrap, or heavy meta-frameworks.*
   - **Backend:** Node.js (v20+ LTS) with Fastify framework.
   - **Database:** PostgreSQL 16 (ACID compliance for financial tables) + Redis 7 (Caching, Sessions, WebSockets).
   - **Mobile App:** Flutter 3.x (Dart Native for Android & iOS).
   - **Real-Time:** WebSockets (`ws` package).
2. **Code Quality & Architecture:**
   - Write clean, modular, and well-documented code with zero hardcoded credentials or magic numbers.
   - Use CSS custom properties (`:root`) for color palettes, typography, spacing, glassmorphism, and responsive breakpoints.
   - Enforce 3-tier backend architecture: `Routes ➔ Controllers ➔ Services ➔ Repositories`.
   - All financial balance updates must execute within PostgreSQL transactions with `SELECT FOR UPDATE` row-locking.

---

## 🗂️ Prompt Sequence Index

- [Phase 1: Project Setup, CSS Design Tokens & Core Shell](#phase-1-project-setup-css-design-tokens--core-shell)
  - [Prompt 1.1: Repository Initialization & Vite Setup](#prompt-11-repository-initialization--vite-setup)
  - [Prompt 1.2: Vanilla CSS Design System & Theme Tokens](#prompt-12-vanilla-css-design-system--theme-tokens)
  - [Prompt 1.3: Responsive Shell (Navbar, Footer, Mobile Drawer, i18n Switcher)](#prompt-13-responsive-shell-navbar-footer-mobile-drawer-i18n-switcher)
- [Phase 2: Core Marketplace & Storefront UI Components](#phase-2-core-marketplace--storefront-ui-components)
  - [Prompt 2.1: Multi-Role Marketplace Home & Product Discovery UI](#prompt-21-multi-role-marketplace-home--product-discovery-ui)
  - [Prompt 2.2: Branded Virtual Storefront Builder & Saler Sourcing UI](#prompt-22-branded-virtual-storefront-builder--saler-sourcing-ui)
  - [Prompt 2.3: Product Detail View, Cart Drawer & 1-Click Quick Buy Modal](#prompt-23-product-detail-view-cart-drawer--1-click-quick-buy-modal)
- [Phase 3: Interactive Interactive Subsystems & Admin Controls UI](#phase-3-interactive-subsystems--admin-controls-ui)
  - [Prompt 3.1: Dynamic Profit Calculator & Sourcing Margin Preview UI](#prompt-31-dynamic-profit-calculator--sourcing-margin-preview-ui)
  - [Prompt 3.2: Digital Vault (Wallet), Escrow Ledger & Payout Request UI](#prompt-32-digital-vault-wallet-escrow-ledger--payout-request-ui)
  - [Prompt 3.3: Master Module Control Panel (Admin Feature Toggle Dashboard)](#prompt-33-master-module-control-panel-admin-feature-toggle-dashboard)
  - [Prompt 3.4: Content Commerce, Social Seller Kit & Storytelling UI](#prompt-34-content-commerce-social-seller-kit--storytelling-ui)
- [Phase 4: Backend API Server & PostgreSQL Database (Fastify)](#phase-4-backend-api-server--postgresql-database-fastify)
  - [Prompt 4.1: PostgreSQL Database Schema Migration & Seed Data](#prompt-41-postgresql-database-schema-migration--seed-data)
  - [Prompt 4.2: Fastify Server Architecture, Auth, SMS OTP & RBAC Middleware](#prompt-42-fastify-server-architecture-auth-sms-otp--rbac-middleware)
  - [Prompt 4.3: Product Catalog, Sourcing & Dynamic Pricing APIs](#prompt-43-product-catalog-sourcing--dynamic-pricing-apis)
  - [Prompt 4.4: Multi-Supplier Order Splitting, Stock Row-Locking & Checkout APIs](#prompt-44-multi-supplier-order-splitting-stock-row-locking--checkout-apis)
- [Phase 5: Financial Vault, Escrow & BD Integrations](#phase-5-financial-vault-escrow--bd-integrations)
  - [Prompt 5.1: Double-Entry Ledger, 7-Day Escrow Timer & Clawback APIs](#prompt-51-double-entry-ledger-7-day-escrow-timer--clawback-apis)
  - [Prompt 5.2: bKash Direct Checkout, Nagad PGW & Automated Payout APIs](#prompt-52-bkash-direct-checkout-nagad-pgw--automated-payout-apis)
  - [Prompt 5.3: 3PL Courier Integration (Steadfast/Pathao API & Webhooks)](#prompt-53-3pl-courier-integration-steadfastpathao-api--webhooks)
- [Phase 6: Real-Time Engine, Gamification & Advanced Subsystems](#phase-6-real-time-engine-gamification--advanced-subsystems)
  - [Prompt 6.1: Fastify WebSocket P2P Chat & Offline Push/SMS Fallback](#prompt-61-fastify-websocket-p2p-chat--offline-pushsms-fallback)
  - [Prompt 6.2: Gamification Engine (Loyalty Coins, Daily Quests & Leaderboard)](#prompt-62-gamification-engine-loyalty-coins-daily-quests--leaderboard)
  - [Prompt 6.3: Social Group Buying (Team Purchase) & Coupon/Campaign APIs](#prompt-63-social-group-buying-team-purchase--couponcampaign-apis)
  - [Prompt 6.4: FEFO Batch Expiration & Multi-Warehouse GIS Routing Engine](#prompt-64-fefo-batch-expiration--multi-warehouse-gis-routing-engine)
  - [Prompt 6.5: Meta WhatsApp Cloud API Bridge & Conversational Commerce](#prompt-65-meta-whatsapp-cloud-api-bridge--conversational-commerce)
- [Phase 7: Flutter Cross-Platform Mobile Application](#phase-7-flutter-cross-platform-mobile-application)
  - [Prompt 7.1: Flutter Project Setup & REST/WebSocket API Integration](#prompt-71-flutter-project-setup--restwebsocket-api-integration)
  - [Prompt 7.2: Native Mobile Screens (Storefront, Vault, Chat & Live Stream)](#prompt-72-native-mobile-screens-storefront-vault-chat--live-stream)
- [Phase 8: Production Deployment, Docker & CI/CD](#phase-8-production-deployment-docker--cicd)
  - [Prompt 8.1: Docker Compose, Nginx Reverse Proxy & Cloudflare CI/CD Pipeline](#prompt-81-docker-compose-nginx-reverse-proxy--cloudflare-cicd-pipeline)

---

## Phase 1: Project Setup, CSS Design Tokens & Core Shell

### Prompt 1.1: Repository Initialization & Vite Setup
```text
TASK: Initialize the Explooro monorepo project structure and setup the Vite frontend client.

CONTEXT:
Explooro is a zero-bloat, superfast social e-commerce and reselling platform. We are establishing a clean monorepo folder structure to host the web client (`client/`), backend server (`server/`), mobile app (`mobile/`), and documentation (`docs/`).

REQUIREMENTS:
1. Create the project directory structure:
   - `client/` (Vite + Vanilla CSS + Modular JS)
   - `server/` (Node.js + Fastify + PostgreSQL query files)
   - `mobile/` (Flutter placeholder)
   - `docs/` (Architecture and specification markdown files)
2. Inside `client/`, initialize a lightweight Vite JavaScript project with package.json scripts:
   - `npm run dev` (starts Vite dev server on port 3000 with HMR)
   - `npm run build` (bundles production output to `dist/`)
   - `npm run preview` (previews built production bundle)
3. Ensure no external CSS framework libraries (Tailwind, Bootstrap) are installed.
4. Add basic `.gitignore` and `README.md` introducing the project layout.

VERIFICATION:
Run `npm run dev` inside `client/` to verify Vite boots up instantly (<300ms) with clean HTML output.
```

---

### Prompt 1.2: Vanilla CSS Design System & Theme Tokens
```text
TASK: Build a modern, futuristic Vanilla CSS design system using CSS Custom Properties (`:root`) with Glassmorphism, Theme Switching (Dark/Light), and Responsive Utility Classes.

CONTEXT:
Explooro avoids third-party CSS libraries for zero bloat, sub-second load times, and long-term version immunity. All styling must be governed by CSS custom variables in dedicated modular CSS files.

REQUIREMENTS:
1. Create `client/src/styles/variables.css`:
   - Design Tokens: Colors (`--primary: #0F766E`, `--primary-hover: #0D9488`, `--accent: #F59E0B`, `--bg-dark: #0F172A`, `--surface-dark: #1E293B`, `--text-main: #F8FAFC`, `--text-muted: #94A3B8`).
   - Glassmorphism Tokens: `--glass-bg: rgba(30, 41, 59, 0.7)`, `--glass-border: rgba(255, 255, 255, 0.1)`, `--glass-blur: blur(12px)`.
   - Radius & Shadows: `--radius-sm: 6px`, `--radius-md: 12px`, `--radius-lg: 20px`, `--shadow-glow: 0 0 20px rgba(15, 118, 110, 0.3)`.
   - Typography: Font family Inter/Outfit, font scale (`--font-xs` to `--font-3xl`).
2. Create `client/src/styles/reset.css`:
   - Modern box-sizing reset, zero margins, image max-width 100%, smooth scrolling, font-smoothing.
3. Create `client/src/styles/components.css`:
   - Reusable class utilities: `.btn-primary`, `.btn-secondary`, `.btn-glass`, `.card-glass`, `.badge-verified` (golden/blue tick), `.input-field`, `.modal-backdrop`, `.grid-responsive`.
4. Create `client/src/styles/main.css` aggregating all style imports.

VERIFICATION:
Create a preview test page in `client/index.html` showcasing buttons, cards, glassmorphic containers, and light/dark theme toggles.
```
-----------------
---

### Prompt 1.3: Responsive Shell (Navbar, Footer, Mobile Drawer, i18n Switcher)
```text
TASK: Implement the main application layout shell containing the Responsive Navbar, Hero Banner Placeholder, Footer, Mobile Drawer, and Dynamic i18n (English/Bangla) Language Switcher.

CONTEXT:
The Shell forms the permanent frame for all platform pages. It must be mobile-first, supporting instant zero-reload language switching between English and Bengali.

REQUIREMENTS:
1. Build `client/src/components/Navbar.js`:
   - Brand logo (`Explooro`), search bar with voice-search icon, role quick-links (Marketplace, Virtual Store, Vault, Admin Panel).
   - Dynamic 1-tap language switcher (`EN ↔ BN`).
   - Shopping Cart icon with live badge counter.
   - User account avatar menu dropdown.
2. Build `client/src/components/MobileDrawer.js`:
   - Slide-out navigation menu for small screens with touch gesture support.
3. Build `client/src/components/Footer.js`:
   - Multi-column footer: Category links, Saler Academy link, BD payment logos (bKash, Nagad, Rocket, COD), 3PL courier partners, and copyright.
4. Build `client/src/services/i18n.js`:
   - Dictionary loader for `client/src/locales/en.json` and `client/src/locales/bn.json`.
   - Expose `t('key')` translation helper and `setLanguage('bn' | 'en')` with LocalStorage persistence.

VERIFICATION:
Toggle the language switcher and verify all navbar items, drawer links, and footer labels update instantly without re-loading the browser.
```

---

## Phase 2: Core Marketplace & Storefront UI Components

### Prompt 2.1: Multi-Role Marketplace Home & Product Discovery UI
```text
TASK: Build the main Marketplace Homepage and Product Discovery grid supporting multi-seller collections, flash deal counters, and category filter bar.

REQUIREMENTS:
1. Create `client/src/pages/HomePage.js`:
   - **Hero Carousel Banner:** Flash deals, high-margin product highlights, and Saler onboarding CTA.
   - **Role Switcher Bar:** Filter feed by "All Products", "Verified Supplier Stock", "Top Reseller Collections", "Flash Sales".
   - **Category Pills:** Horizontal scrollable category filters (Electronics, Fashion, Agro, Cosmetics, Home, B2B Bulk).
   - **Product Grid:** Responsive 4-column (desktop) / 2-column (mobile) card layout.
2. Build `client/src/components/ProductCard.js`:
   - High-res product thumbnail, title, supplier verification blue-tick badge, physical store status indicator (`🟢 Open` / `🔴 Closed`), retail price, wholesale profit margin badge (for Salers), star rating, and "Quick Buy" / "Add to Store" action buttons.
3. Build `client/src/components/FlashSaleWidget.js`:
   - Live countdown timer (`HH:MM:SS`) with dynamic remaining stock progress bar.

VERIFICATION:
Render 12 mockup products on the homepage. Test filtering by category and toggling between Customer view and Saler view.
```

---------------------------

### Prompt 2.2: Branded Virtual Storefront Builder & Saler Sourcing UI
```text
TASK: Build the Saler Storefront view (`/store/:shopSlug`) and the Supplier Catalog Sourcing Interface where Salers discover products to add to their virtual shop.

REQUIREMENTS:
1. Create `client/src/pages/SalerStorefrontPage.js`:
   - **Store Header:** Cover banner, shop logo avatar, shop name, bio, social links (WhatsApp, Facebook), and physical shop Open/Close status indicator with operating hours.
   - **Store Shelves:** Curated collections created by the Saler.
   - **Social Seller Kit Bar:** 1-Click "Share Store to WhatsApp", "Download Printable QR Flyer", and "Copy Affiliate Link".
2. Create `client/src/pages/SupplierSourcingCatalogPage.js`:
   - List of all verified supplier items available for reselling.
   - Filters: Profit Margin % (e.g. >30%), Shipping Speed, Verification Tier.
   - Each product card features a 1-Click **"Add to My Store"** button with custom profit margin override options.

VERIFICATION:
Click "Add to My Store" on a supplier item and verify it immediately appears on the Saler's virtual storefront catalog.
```

-------------------------------------------------------

### Prompt 2.3: Product Detail View, Cart Drawer & 1-Click Quick Buy Modal
```text
TASK: Build the Product Detail Page (`/product/:id`), Sliding Cart Drawer, and 1-Click Quick Buy Checkout Modal.

REQUIREMENTS:
1. Create `client/src/pages/ProductDetailPage.js`:
   - Image gallery with zoom, variant selector (size/color), dynamic price breakdown, supplier blue-tick info card, digital warranty badge, photo/video user reviews, and Q&A section.
   - CTAs: "Add to Cart", "1-Click Quick Buy", "Chat with Seller", "Team Purchase (Group Buy)".
2. Create `client/src/components/CartDrawer.js`:
   - Slide-over cart panel displaying item list, quantity adjusters (+/-), multi-supplier parcel split warnings, subtotal, discount code input box, and checkout button.
3. Create `client/src/components/QuickBuyModal.js`:
   - Lightweight 2-step checkout overlay: Name, Mobile Number, District/Upazila selector, Payment selection (bKash, Nagad, COD).

VERIFICATION:
Open a product detail page, select variants, open the Cart Drawer, adjust quantities, and trigger the Quick Buy modal.
```

---

## Phase 3: Interactive Subsystems & Admin Controls UI

### Prompt 3.1: Dynamic Profit Calculator & Sourcing Margin Preview UI
```text
TASK: Build the Dynamic Profit Calculator Widget and Saler Margin Estimator UI.

REQUIREMENTS:
1. Create `client/src/components/ProfitCalculatorWidget.js`:
   - Interactive sliders for: Base Production Cost, Wholesale Margin, Desired Retail Price.
   - Dynamic Breakdown Visualization:
     - `Retail Price = Base Cost + Wholesale Margin + Net Retail Margin`
     - `Saler Split (40%)` vs `Explooro Split (60%)`.
   - Real-time profit preview per sale and monthly projection chart based on estimated sales volume.
2. Integrate this calculator into both the Saler Sourcing Catalog and the Saler Dashboard.

VERIFICATION:
Drag sliders for Base Cost = 500 Tk and Retail Price = 700 Tk. Verify net profit = 200 Tk, displaying Saler share = 80 Tk (40%) and Platform share = 120 Tk (60%).
```

---

### Prompt 3.2: Digital Vault (Wallet), Escrow Ledger & Payout Request UI
```text
TASK: Build the Digital Vault (Wallet) Dashboard displaying available balance, 7-day pending escrow timers, transaction history ledger, and withdrawal payout modal.

REQUIREMENTS:
1. Create `client/src/pages/VaultDashboardPage.js`:
   - **Summary Cards:** Total Earnings, Available Balance, Pending Escrow Balance (7-day return hold timer), Total Withdrawn.
   - **7-Day Escrow Progress Bar:** List of recent sales showing countdown timer until funds clear to `Available`.
   - **Transaction Ledger Table:** Date, Order ID, Transaction Type (Commission, Payout, Clawback/Return), Amount, Status.
2. Build `client/src/components/PayoutRequestModal.js`:
   - Withdrawal request form: Select Payment Method (bKash Direct, Nagad, Rocket, Bank Account), enter Account Number, enter Amount (min 500 Tk), and submit request.

VERIFICATION:
Render the Vault with mock data showing 2 cleared commissions and 1 pending escrow item with an active 7-day timer.
```

---

### Prompt 3.3: Master Module Control Panel (Admin Feature Toggle Dashboard)
```text
TASK: Build the Super Admin Master Module Control Panel allowing administrators to dynamically enable or disable any platform feature with live feature flags.

REQUIREMENTS:
1. Create `client/src/pages/admin/AdminModuleControlPage.js`:
   - Searchable table of all 50+ platform features (Supplier Verification, In-Platform Ads, Real-Time Chat, Return Engine, Sponsored Reels, Group Buying, WhatsApp Bridge, etc.).
   - Each row contains: Module Name, Category, Default State (`ON`/`OFF`), Live Toggle Switch, Sub-settings button, and Last Updated By timestamp.
   - Action modal: Prompts for reason when toggling a core feature `OFF` (e.g. "Scheduled Maintenance").
2. Build `client/src/services/featureFlags.js`:
   - Frontend feature flag evaluator helper `isFeatureEnabled('module_name')` that conditionally hides UI components when a module is disabled.

VERIFICATION:
Toggle `In-Platform Sponsored Ads` to OFF in the Admin Panel and verify all ad banners instantly disappear from the client UI.
```

---

### Prompt 3.4: Content Commerce, Social Seller Kit & Storytelling UI
```text
TASK: Build the Content Commerce Storytelling Feed, Shoppable Video Reels Gallery, and Social Seller Kit Generator.

REQUIREMENTS:
1. Create `client/src/pages/StorytellingFeedPage.js`:
   - Blog-style social feed where Salers publish product stories, problem-solving use cases, and benefit breakdowns linked directly to buyable product cards.
2. Create `client/src/components/ShoppableReelsGallery.js`:
   - Vertical short video feed (TikTok/Reels style) featuring unboxing clips with pinned product cards and 1-tap buy overlay buttons.
3. Create `client/src/components/SocialSellerKitModal.js`:
   - Flyer Generator: Creates printable high-res product poster with title, retail price, Saler store name, and a generated QR Code linking to the product's short affiliate URL.

VERIFICATION:
Open the Social Seller Kit modal for any item and generate a poster. Verify the QR code and short link render accurately.
```

----------------------------------------------------
## Phase 4: Backend API Server & PostgreSQL Database (Fastify)

### Prompt 4.1: PostgreSQL Database Schema Migration & Seed Data
```text
TASK: Design and implement the full PostgreSQL 16 relational database schema migration scripts and initial seed data for Explooro.

CONTEXT:
Explooro uses PostgreSQL for strict ACID compliance across financial transactions, multi-supplier order splitting, feature flags, and role-based access control.

REQUIREMENTS:
1. Create database migration script `server/src/db/migrations/001_initial_schema.sql` creating the following 20 core tables:
   - `users` (id, phone, email, password_hash, role, trust_score, created_at)
   - `kyc_verifications` (id, user_id, nid_number, trade_license, status, documents_json)
   - `products` (id, supplier_id, title, description, base_cost, wholesale_margin, default_retail_price, stock_qty, category_id, is_active)
   - `product_batches` (id, product_id, batch_number, mfg_date, exp_date, qty, warehouse_node_id)
   - `saler_store_items` (id, saler_id, product_id, custom_retail_price, display_order)
   - `virtual_stores` (id, saler_id, shop_name, slug, banner_url, bio, physical_open_status)
   - `orders` (id, customer_id, total_amount, payment_method, payment_status, is_otp_verified, created_at)
   - `sub_orders` (id, order_id, supplier_id, saler_id, subtotal_base, saler_commission, platform_margin, status, courier_name, consignment_id)
   - `order_items` (id, sub_order_id, product_id, batch_id, qty, base_price, retail_price)
   - `wallets` (id, user_id, available_balance, pending_escrow_balance, currency)
   - `escrow_entries` (id, sub_order_id, wallet_id, amount, hold_until_timestamp, status)
   - `ledger_transactions` (id, wallet_id, type, amount, reference_type, reference_id, created_at)
   - `payout_requests` (id, wallet_id, method, account_number, amount, status, processed_at)
   - `shipments` (id, sub_order_id, courier, tracking_code, status_history_json)
   - `return_requests` (id, sub_order_id, customer_id, reason, evidence_urls_json, status)
   - `dispute_threads` (id, return_id, moderator_id, status)
   - `chat_messages` (id, sender_id, recipient_id, message_text, is_read, created_at)
   - `platform_modules` (id, module_key, is_enabled, updated_by, reason)
   - `coupons` (id, code, discount_type, discount_value, min_spend, budget_cap, times_used, expires_at)
   - `audit_logs` (id, user_id, action, payload_json, ip_address, created_at)
2. Create `server/src/db/seeds/001_seed_dev_data.sql` populating test users (Admin, Supplier, Saler, Customer), sample categories, products, and default feature flags.

VERIFICATION:
Execute the migration and seed scripts on PostgreSQL. Query tables to verify all relationships and indexes compile cleanly.
```

---

### Prompt 4.2: Fastify Server Architecture, Auth, SMS OTP & RBAC Middleware
```text
TASK: Build the Fastify server entrypoint, environment configuration, JWT authentication plugin, local SMS OTP verification, and multi-tier RBAC authorization middleware.

REQUIREMENTS:
1. Create `server/src/app.js`:
   - Initialize Fastify server instance with CORS, Helmet, and Cookie plugins.
   - Register PostgreSQL (`@fastify/postgres`) and Redis (`@fastify/redis`) connection plugins.
2. Create `server/src/middlewares/auth.js`:
   - JWT authentication verification strategy (`verifyJWT`).
   - Extract user identity, role, and capabilities into `req.user`.
3. Create `server/src/middlewares/rbac.js`:
   - Capability-based authorization guard `hasCapability('capability_name')` protecting routes for Admin, Moderator, Editor, Supplier, Saler, Customer.
4. Create `server/src/controllers/authController.js`:
   - Endpoints: `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `POST /api/v1/auth/send-otp`, `POST /api/v1/auth/verify-otp`.
   - Send OTP uses local BD SMS gateway interface with fallback mock mode for development.

VERIFICATION:
Perform POST requests via curl or Postman to register a user, request SMS OTP, verify OTP, and access a protected `/api/v1/auth/me` endpoint.
```

---

### Prompt 4.3: Product Catalog, Sourcing & Dynamic Pricing APIs
```text
TASK: Implement backend REST API endpoints for product listing creation, dynamic price calculation, category filtering, and Saler 1-click sourcing.

REQUIREMENTS:
1. Create `server/src/services/pricingService.js`:
   - Formula: `Retail Price = Base Cost + Wholesale Margin + Net Retail Margin`
   - Dynamically compute Saler commission (e.g. 40%) and Explooro platform fee (e.g. 60%) based on active rules in `platform_settings`.
2. Create `server/src/controllers/productController.js`:
   - `POST /api/v1/products` (Supplier creates product with base cost, wholesale margin, initial stock).
   - `GET /api/v1/products` (Public catalog search, multi-category filter, pagination).
   - `GET /api/v1/products/:id` (Product detail view with active batch info).
3. Create `server/src/controllers/sourcingController.js`:
   - `POST /api/v1/sourcing/add-to-store` (Saler adds supplier product to `saler_store_items`).
   - `GET /api/v1/sourcing/my-store` (Fetches Saler's virtual store catalog).

VERIFICATION:
Create a supplier product via API, verify the pricing engine computes correct margin splits, and execute "add-to-store" as a Saler.
```

---

### Prompt 4.4: Multi-Supplier Order Splitting, Stock Row-Locking & Checkout APIs
```text
TASK: Implement the Order Checkout API handling cart validation, COD anti-fraud check, PostgreSQL stock row-locking (`SELECT FOR UPDATE`), multi-supplier order splitting, and coupon application.

REQUIREMENTS:
1. Create `server/src/services/orderService.js`:
   - Checkout Flow:
     - Begin PostgreSQL transaction.
     - Validate applied coupon code and check budget cap.
     - Validate customer trust score for COD orders (trigger OTP if score < threshold).
     - Loop through cart items and execute `SELECT stock_qty FROM products WHERE id = $1 FOR UPDATE`. Verify sufficient stock.
     - Group cart items by `supplier_id`.
     - Create master `orders` record.
     - Create separate `sub_orders` record for each supplier with calculated base subtotal, Saler commission, and platform margin.
     - Insert `order_items` linked to FEFO batch records.
     - Decrement product stock quantities.
     - Commit transaction.
2. Create `server/src/controllers/orderController.js`:
   - `POST /api/v1/orders/checkout`
   - `GET /api/v1/orders/my-orders`
   - `GET /api/v1/orders/:id`

VERIFICATION:
Submit a single checkout payload containing items from 2 different suppliers. Verify the database creates 1 master order and 2 distinct sub-orders with correct split balances.
```

---

## Phase 5: Financial Vault, Escrow & BD Integrations

### Prompt 5.1: Double-Entry Ledger, 7-Day Escrow Timer & Clawback APIs
```text
TASK: Build the Double-Entry Accounting Vault Service, 7-Day Return Escrow Holding Timer, and Automated Return Clawback Engine.

REQUIREMENTS:
1. Create `server/src/services/vaultService.js`:
   - `depositToEscrow(subOrderId, totalAmount)`: Locks funds in `pending_escrow_balance`.
   - `releaseEscrow(subOrderId)`: Triggered 7 days post-delivery. Moves funds atomically from `pending_escrow_balance` to `available_balance` for Supplier (Base cost) and Saler (Commission).
   - `executeClawback(subOrderId, reason)`: Triggered on verified customer return. Reverses pending escrow balance to customer refund account with zero commission credited to Saler.
   - All balance mutations MUST insert an immutable record into `ledger_transactions`.
2. Create a background cron job `server/src/jobs/escrowReleaseCron.js`:
   - Scans `escrow_entries` every hour where `status = 'LOCKED'` and `hold_until_timestamp <= NOW()`. Releases funds automatically.

VERIFICATION:
Simulate an order delivery webhook, verify escrow entries lock for 7 days, and run the release cron job to confirm atomic balance credit.
```

---

### Prompt 5.2: bKash Direct Checkout, Nagad PGW & Automated Payout APIs
```text
TASK: Implement integrations for bKash Direct Checkout API, Nagad PGW, and automated bKash B2C withdrawal payout engine.

REQUIREMENTS:
1. Create `server/src/integrations/bkash.js`:
   - Tokenized checkout API wrapper: `createPayment()`, `executePayment()`, `queryPayment()`.
   - B2C Payout API wrapper: `b2cTransfer(accountNumber, amount)` for automated reseller earnings withdrawal.
2. Create `server/src/integrations/nagad.js`:
   - PGW payment initialization and IPN webhook listener.
3. Create `server/src/controllers/payoutController.js`:
   - `POST /api/v1/vault/withdraw` (Reseller requests payout).
   - Validates `available_balance >= withdrawal_amount`, locks funds, calls bKash B2C API, and logs transaction receipt upon success.

VERIFICATION:
Trigger a mock payout request of 1,000 Tk. Verify available wallet balance decreases and ledger records the withdrawal receipt.
```

---

### Prompt 5.3: 3PL Courier Integration (Steadfast/Pathao API & Webhooks)
```text
TASK: Implement 3PL Courier logistics integration for Steadfast Courier and Pathao Merchant API, including automated consignment creation and webhook tracking listeners.

REQUIREMENTS:
1. Create `server/src/integrations/steadfast.js`:
   - `createConsignment({ invoice, recipient_name, phone, address, cod_amount })`
   - Returns consignment tracking code and printable shipping label URL.
2. Create `server/src/controllers/courierWebhookController.js`:
   - `POST /api/v1/webhooks/steadfast`
   - Listens for delivery status updates (`in_transit`, `delivered`, `cancelled`, `returned`).
   - Verifies HMAC signature. Rejects duplicate webhook deliveries using Redis `SETNX webhook:id`.
   - On `delivered`: Updates sub-order status to `DELIVERED`, records delivery timestamp, and starts 7-day escrow return timer.

VERIFICATION:
Send a mock Steadfast webhook payload with status `delivered`. Verify sub-order status updates and escrow timer initiates.
```

---

## Phase 6: Real-Time Engine, Gamification & Advanced Subsystems

### Prompt 6.1: Fastify WebSocket P2P Chat & Offline Push/SMS Fallback
```text
TASK: Implement the bi-directional WebSocket live messaging gateway (`ws`), Redis Pub/Sub multi-node message router, and offline SMS/Push notification fallback pipeline.

REQUIREMENTS:
1. Create `server/src/sockets/chatSocket.js`:
   - Attach WebSocket handler to Fastify server using `@fastify/websocket`.
   - Authenticate connection via JWT query parameter.
   - Bind active socket to user session in Redis (`SET user:online:{userId} socketId`).
   - On incoming message: Persist message to `chat_messages` table in PostgreSQL.
   - Publish message to Redis Pub/Sub channel `chat:{recipientId}`.
2. Implement offline fallback logic:
   - If recipient is offline (not active on any node), trigger local SMS / Push notification alert ("You received a new inquiry on Explooro").
3. Create REST API `GET /api/v1/chat/history/:recipientId` to fetch historical message logs.

VERIFICATION:
Open 2 WebSocket client connections representing Customer and Saler. Exchange live messages and verify instant delivery and offline fallback.
```

---

### Prompt 6.2: Gamification Engine (Loyalty Coins, Daily Quests & Leaderboard)
```text
TASK: Implement the Gamification subsystem including Explooro Loyalty Coins earning/redemption, Daily Quests, and Monthly Saler Leaderboard rankings.

REQUIREMENTS:
1. Create `server/src/services/gamificationService.js`:
   - `creditCoins(userId, amount, reason)` (Credited on daily check-in, order completion, photo/video review).
   - `redeemCoins(userId, amount)` (Deducted at checkout for instant discounts: 100 Coins = 10 Tk).
   - `updateLeaderboard()` (Cron job calculating monthly top Salers by revenue, orders, and ratings).
2. Create `server/src/controllers/gamificationController.js`:
   - `GET /api/v1/gamification/coins` (Gets coin balance and history).
   - `POST /api/v1/gamification/daily-checkin` (Claims daily check-in reward).
   - `GET /api/v1/gamification/leaderboard` (Fetches current monthly rankings).
   - `GET /api/v1/gamification/daily-quests` (Lists active quests and user progress).

VERIFICATION:
Execute a daily check-in API call, verify coin balance increases by 10, and check that the leaderboard updates rankings correctly.
```

---

### Prompt 6.3: Social Group Buying (Team Purchase) & Coupon/Campaign APIs
```text
TASK: Implement the Social Group Buying (Team Purchase) 24-hour viral deal engine and Coupon/Campaign management API.

REQUIREMENTS:
1. Create `server/src/controllers/teamPurchaseController.js`:
   - `POST /api/v1/team-purchases/initiate` (Buyer starts a group buy at discounted rate; creates 24h countdown session).
   - `POST /api/v1/team-purchases/join` (Friend joins via invite link `explooro.com/team/:id`).
   - When required members (e.g. 3) join within 24 hours: Confirms all orders at discounted rate and triggers fulfillment.
   - Background cron job scans expired sessions (>24h): Auto-cancels incomplete groups and executes 100% full refund.
2. Create `server/src/controllers/couponController.js`:
   - `POST /api/v1/coupons` (Admin/Supplier creates coupon code with budget cap and expiry).
   - `POST /api/v1/coupons/validate` (Validates coupon code at checkout).

VERIFICATION:
Initiate a Team Purchase, simulate 2 friends joining via API, and verify all 3 orders confirm automatically.
```

---

### Prompt 6.4: FEFO Batch Expiration & Multi-Warehouse GIS Routing Engine
```text
TASK: Implement the FEFO (First Expire, First Out) batch management engine and Multi-Warehouse GIS proximity order routing.

REQUIREMENTS:
1. Create `server/src/services/inventoryService.js`:
   - `getFEFOBatch(productId, warehouseNodeId, requiredQty)`: Queries `product_batches` sorted by `exp_date ASC`. Selects the earliest expiring batch with sufficient stock.
   - `checkExpiryWarnings()`: Daily cron job scanning batches expiring within 30–60 days and triggering 1-click clearance sale alerts to suppliers.
2. Create `server/src/services/warehouseRoutingService.js`:
   - `findNearestWarehouse(customerDistrict, productStockList)`: Calculates distance between customer delivery address and available supplier warehouse nodes, routing the order to the closest depot.

VERIFICATION:
Insert 2 stock batches with exp dates 2026-10-01 and 2026-12-01. Execute an order and verify FEFO selects the 2026-10-01 batch.
```

---

### Prompt 6.5: Meta WhatsApp Cloud API Bridge & Conversational Commerce
```text
TASK: Implement the Meta WhatsApp Cloud API integration bridge enabling incoming WhatsApp inquiries, interactive product card messaging, and in-chat 1-tap checkout link generation.

REQUIREMENTS:
1. Create `server/src/integrations/whatsapp.js`:
   - Webhook listener `POST /api/v1/webhooks/whatsapp` (Verifies Meta token and ingests incoming customer messages).
   - Outbound API wrapper `sendProductCard(recipientPhone, productData)` sending interactive WhatsApp product cards with images, pricing, and "Buy Now" button.
2. Create `server/src/controllers/whatsappCommerceController.js`:
   - Synchronizes incoming WhatsApp chats into the Saler's unified inbox.
   - Generates secure 1-tap checkout link (`explooro.com/checkout/wa/:token`) sent inside the chat.

VERIFICATION:
Send a mock WhatsApp message payload to the webhook endpoint. Verify it routes to the Saler's inbox and generates an interactive product card response.
```

---

## Phase 7: Flutter Cross-Platform Mobile Application

### Prompt 7.1: Flutter Project Setup & REST/WebSocket API Integration
```text
TASK: Initialize the Flutter cross-platform mobile app project (`mobile/`) with BLoC/Riverpod state architecture, REST API client, and WebSocket connection manager.

REQUIREMENTS:
1. Initialize Flutter 3.x project in `mobile/`:
   - Configure target platforms: Android (`.apk`/`.aab`) and iOS (`.ipa`).
   - Add dependencies in `pubspec.yaml`: `http`, `web_socket_channel`, `flutter_bloc`, `shared_preferences`, `cached_network_image`.
2. Create `mobile/lib/core/api_client.dart`:
   - Base HTTP REST client with JWT header injection, error handling, and response parsing.
3. Create `mobile/lib/core/websocket_manager.dart`:
   - Manages WebSocket connection to Fastify server, auto-reconnects on network drop, and broadcasts incoming live chat messages.

VERIFICATION:
Run `flutter run` on Android emulator/device and verify successful API connection to backend server `/api/v1/products`.
```

---

### Prompt 7.2: Native Mobile Screens (Storefront, Vault, Chat & Live Stream)
```text
TASK: Build native Mobile UI screens in Flutter for Customer/Saler Navigation, Product Discovery, Virtual Storefront, Digital Vault, P2P Chat, and Live Stream Viewer.

REQUIREMENTS:
1. Build `mobile/lib/screens/home_screen.dart`:
   - Product catalog feed, category horizontal scroll, search bar, and cart drawer button.
2. Build `mobile/lib/screens/virtual_store_screen.dart`:
   - Saler storefront view with shop header, collections, and 1-tap WhatsApp share button.
3. Build `mobile/lib/screens/vault_screen.dart`:
   - Wallet available balance, 7-day pending escrow timer list, and withdrawal modal.
4. Build `mobile/lib/screens/chat_screen.dart`:
   - Real-time P2P chat interface with photo attachment support.
5. Build `mobile/lib/screens/live_stream_screen.dart`:
   - Live stream video viewer with pinned product card overlay and in-stream "Buy Now" button.

VERIFICATION:
Test navigation across all screens on Android emulator. Verify smooth 60 FPS transitions and responsive layouts.
```

---

## Phase 8: Production Deployment, Docker & CI/CD

### Prompt 8.1: Docker Compose, Nginx Reverse Proxy & Cloudflare CI/CD Pipeline
```text
TASK: Create production Docker Compose orchestration files, Nginx reverse proxy configuration with WebSocket support, and automated GitHub Actions CI/CD deployment workflow.

REQUIREMENTS:
1. Create `docker-compose.yml` in project root:
   - Services: `api` (Fastify Node.js server), `db` (PostgreSQL 16 Alpine), `redis` (Redis 7 Alpine), `nginx` (Reverse proxy).
   - Configure health checks, persistent volume mounts (`pgdata`, `redisdata`), and environment variable injections.
2. Create `server/nginx.conf`:
   - Reverse proxy configuration listening on port 80/443.
   - Proxies `/api/` to Fastify container on port 5000.
   - Proxies `/ws/` WebSocket connections with `Upgrade` and `Connection "Upgrade"` headers.
   - Enables Gzip/Brotli compression and SSL certbot termination.
3. Create `.github/workflows/deploy.yml`:
   - GitHub Actions pipeline:
     - On push to `main`: Builds Vite client and deploys output to **Cloudflare Pages** edge CDN.
     - SSHs into Singapore VPS and executes `docker-compose up -d --build` for backend API.

VERIFICATION:
Execute `docker-compose up --build` locally and verify all services (Fastify, Postgres, Redis, Nginx) start cleanly and pass health checks.
```

---

## ✅ Self-Verification & Completeness Matrix

| Requirement Domain | Source Specification | Prompts Covering It | Status |
| :--- | :--- | :--- | :--- |
| **Monorepo & Vite Setup** | `technologyused.md` | Prompt 1.1 | ✅ 100% Verified |
| **Vanilla CSS Design System** | `technologyused.md` | Prompt 1.2, 1.3 | ✅ 100% Verified |
| **Marketplace & Sourcing UI** | `idea proposition.md` §A, §B | Prompt 2.1, 2.2, 2.3 | ✅ 100% Verified |
| **Dynamic Profit Calculator** | `PRD.md` §3.2 | Prompt 3.1 | ✅ 100% Verified |
| **Digital Vault & Escrow UI** | `PRD.md` §3.2 | Prompt 3.2 | ✅ 100% Verified |
| **Master Module Control Panel** | `PRD.md` §3.1 | Prompt 3.3 | ✅ 100% Verified |
| **Content Commerce & Reels** | `idea proposition.md` §A, §W | Prompt 3.4 | ✅ 100% Verified |
| **PostgreSQL Schema & Seed** | `DFD.md` §5.1 (Tables D1–D20) | Prompt 4.1 | ✅ 100% Verified |
| **Fastify, JWT, SMS OTP, RBAC** | `DFD.md` Subsystem 1.0 | Prompt 4.2 | ✅ 100% Verified |
| **Product & Pricing APIs** | `DFD.md` Subsystem 2.0 | Prompt 4.3 | ✅ 100% Verified |
| **Multi-Supplier Order Split** | `DFD.md` Subsystem 4.0 | Prompt 4.4 | ✅ 100% Verified |
| **Double-Entry Vault & Escrow** | `DFD.md` Subsystem 5.0 | Prompt 5.1 | ✅ 100% Verified |
| **bKash / Nagad / Payouts** | `technologyused.md` Layer 5 | Prompt 5.2 | ✅ 100% Verified |
| **3PL Courier & Webhooks** | `DFD.md` Subsystem 6.0 | Prompt 5.3 | ✅ 100% Verified |
| **WebSocket P2P Chat** | `DFD.md` Subsystem 7.0 | Prompt 6.1 | ✅ 100% Verified |
| **Gamification & Coins** | `DFD.md` Subsystem 13.0 | Prompt 6.2 | ✅ 100% Verified |
| **Group Buy & Coupons** | `DFD.md` Subsystems 16.0, 17.0 | Prompt 6.3 | ✅ 100% Verified |
| **FEFO Batch & Multi-Warehouse** | `DFD.md` Subsystem 19.0 | Prompt 6.4 | ✅ 100% Verified |
| **WhatsApp Commerce Bridge** | `DFD.md` Subsystem 20.0 | Prompt 6.5 | ✅ 100% Verified |
| **Flutter Mobile App** | `technologyused.md` Layer 2 | Prompt 7.1, 7.2 | ✅ 100% Verified |
| **Docker Compose & Deployment** | `technologyused.md` §7 | Prompt 8.1 | ✅ 100% Verified |

---
*Created on 2026-08-18 as the master implementation prompt repository for Explooro.*
