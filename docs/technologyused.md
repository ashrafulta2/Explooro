# 🚀 Explooro — Final Technology Stack & Architecture Guide (`technologyused.md`)

> **Executive Summary:** This document finalizes the complete, production-ready technology stack for **Explooro**. Built specifically for **maximum speed, minimal framework overhead (zero bloat), long-term stability, and seamless AI pair-programming with Antigravity & Claude Code**.

---

## 📊 1. Master Technology Matrix (Final Decision)

| Layer / Domain | Final Technology Choice | Why It Is Best for You | Key Advantage |
| :--- | :--- | :--- | :--- |
| **⚡ Build Tool & Dev Server** | **Vite (Native ESM)** | Ultra-fast instant dev server (<300ms) with Hot Module Replacement (HMR). | Zero bundling delay, instant live preview. |
| **🎨 Styling & Design Engine** | **Vanilla Modern CSS + CSS Variables** | Zero framework bloat (No Tailwind, No Bootstrap). Full control over animations & glassmorphism. | 100% immune to version breaks, 0kb library overhead. |
| **🌐 Web Frontend UI** | **Vanilla / Modular JS (or Lightweight TS)** | Minimal abstraction, lightning-fast DOM updates, instant SEO indexing. | Sub-second load times (Google Lighthouse 98-100). |
| **📱 Mobile App (iOS/Android)** | **Flutter (Dart Native)** | Compiles to native ARM64 machine code for 60/120 FPS mobile performance. | Single unified codebase for Google Play & App Store. |
| **⚙️ Backend API Server** | **Node.js (Fastify)** *(Alternative: Go)* | 4x–5x faster throughput than Express with minimal memory footprint. | Low latency, clean schema validation, easy for AI tools. |
| **🗄️ Primary Database** | **PostgreSQL** | Strict ACID compliance for financial integrity (Digital Vault & Wallets). | Reliable transactional safety, zero money calculation errors. |
| **⚡ In-Memory Cache & Queue** | **Redis** | Sub-millisecond data retrieval for flash sales, session tokens, and rate limits. | Prevents database overload during high-traffic spikes. |
| **🔌 Real-Time Communications** | **WebSockets (`ws`)** | Bi-directional, low-latency live communication. | Instant Saler-Customer live chat & order notifications. |
| **🇧🇩 Bangladesh Services** | **bKash, Nagad, Rocket, Steadfast/Pathao** | Direct MFS payment gateway integration + Courier logistics webhook sync. | Seamless automated cash-out, COD & tracking. |
| **🤖 AI Pair-Programming Tools** | **Google Antigravity + Claude Code** | Clean, modular codebase structure allows AI agents to write, test & debug fast. | Maximum developer productivity & zero hallucination errors. |

---

## 💡 2. Why This "Minimal-Framework" Strategy Is Perfect

### A. Zero Framework Churn & No Breaking Changes
* Traditional frameworks (e.g., Next.js, heavyweight UI libraries) frequently release breaking updates every 6–12 months, causing broken styles, dependency mismatches, and maintenance headaches.
* **Our Solution:** Vite + Vanilla Modern CSS ensures your project stays **100% stable for years** with zero unexpected breaking changes.

### B. Blazing Fast Page Load (< 1 Second)
* Most modern e-commerce sites suffer from 2MB–5MB JavaScript bundles.
* **Our Solution:** Vanilla CSS + minimal client JS keeps the initial bundle size under **150 KB**, achieving instant page rendering even on 3G/4G mobile networks in Bangladesh.

### C. Maximum Efficiency with Antigravity & Claude Code
* Complex meta-frameworks add hundreds of hidden abstractions that confuse AI coding tools.
* Clean, modular, standards-based code (standard HTML5, native CSS variables, standard REST APIs) allows **Antigravity** and **Claude Code** to:
  1. Generate accurate, error-free code on the first attempt.
  2. Perform live browser previews with instant hot-reload.
  3. Easily write automated tests and debug edge cases.

---

## 🏗️ 3. Layer-by-Layer Technical Specification

### 🌐 Layer 1: Web Frontend & PWA (`/client`)
* **Tooling:** Vite
* **Markup:** Semantic HTML5 (Accessible, SEO-optimized with OpenGraph metadata).
* **Styles:** Pure Vanilla CSS using **Design Tokens** via CSS Custom Properties (`:root { --primary: ...; --navbar-bg: ...; }`).
  * **Alibaba & Amazon Clean Aesthetic:** 100% solid surfaces, zero gradients, crisp 1px borders, and ultra-clean high-contrast typography.
  * **Granular Component-Level Color Studio:** Admin panel controls individual colors for 6 distinct UI sections (Navbar, Canvas/Surfaces, Brand/Buttons, Typography, Badges, Footer) with real-time CSS variable updates in [`themePalette.js`](file:///d:/All/Others/My%20Software%20Development/Explooro/Explooro%20Website/client/src/services/themePalette.js).
  * **Marketplace Presets:** Instant 1-click presets for Alibaba Enterprise, Amazon Pro, Daraz Express, Cobalt Enterprise, and Minimalist Slate.
  * Smooth micro-interactions & GPU-accelerated CSS animations.
  * Modern Dark / Light theme toggle with zero external library.
  * Responsive grid layouts and sub-second load times.
* **State Management:** Lightweight modular state store (Pub/Sub pattern or Nano Stores).
* **i18n (Internationalization):** Native JSON dictionary engine supporting dynamic **English ↔ Bangla** switching.

### 📱 Layer 2: Mobile App (`/mobile`)
* **Framework:** Flutter 3.x (Dart)
* **Target Platforms:** Android (.apk, .aab) & iOS (.ipa).
* **Architecture:** Clean BLoC / Riverpod state architecture.
* **API Integration:** Consumes the exact same REST & WebSocket endpoints as the Web client.
* **Native Features:** Camera access for product unboxing video upload, Push Notifications (FCM), Biometric fingerprint/Face ID login.

### ⚙️ Layer 3: Backend API Server (`/server`)
* **Runtime:** Node.js (v20+ LTS) with **Fastify**
  * *Why Fastify?* Handles up to 30,000+ requests/sec with built-in JSON schema validation and zero boilerplate.
* **Authentication:** Stateless JWT + Secure HttpOnly Refresh Cookies + Local SMS OTP verification.
* **Architecture Pattern:** Clean 3-Tier Layered Architecture:
  * `Routes` ➔ `Controllers` ➔ `Services` ➔ `Repositories (Database)`
* **Security:** Helmet headers, CORS policies, Rate Limiting (via Redis), strict input validation.

### 🗄️ Layer 4: Database & Caching (`/database`)
* **Relational Database:** **PostgreSQL**
  * Tables: `users`, `roles`, `wallets`, `vault_transactions`, `products`, `orders`, `commission_rules`, `disputes`, `audit_logs`.
  * ACID transactions guarantee atomic balance transfers (e.g., Customer payment ➔ Escrow ➔ Saler Profit Split ➔ Supplier Payout).
* **Cache & Memory Store:** **Redis**
  * Live user sessions, shopping cart memory cache, high-speed product catalog indexing, and WebSocket pub/sub messaging.

### 🔌 Layer 5: Real-Time & Integrations
* **Real-time Live Chat:** WebSockets (`ws`) for low-latency peer-to-peer messaging (Customer ↔ Saler ↔ Supplier).
* **Bangladesh Payment Gateways (MFS):**
  * bKash Direct Checkout API (Tokenized).
  * Nagad Payment Gateway (PGW).
  * Rocket / SSLCommerz backup gateway.
  * Cash on Delivery (COD) verification workflow.
* **Logistics & Courier Delivery:**
  * Steadfast Courier API (Auto order creation, live parcel tracking webhook).
  * Pathao Merchant API & RedX integration.
* **SMS Gateway:**
  * Local BD SMS Gateway (Greenweb, BulkSMSBD, or Alpha Net) for login OTP and delivery milestone alerts.

---

## 📁 4. Project Directory Blueprint

A clean, modular folder structure optimized for development with **Antigravity** and **Claude Code**:

```
explooro/
├── client/                      # 🌐 Web Frontend (Vite + Vanilla CSS)
│   ├── public/                  # Static assets (logos, icons, favicon)
│   ├── src/
│   │   ├── assets/              # Images, fonts, SVG icons
│   │   ├── styles/              # 🎨 Vanilla Modern CSS Design System
│   │   │   ├── variables.css    # Colors, gradients, spacing tokens
│   │   │   ├── reset.css        # Modern CSS reset
│   │   │   ├── components.css   # Buttons, cards, modals, glassmorphism
│   │   │   └── main.css         # Layout & page styles
│   │   ├── components/          # Reusable UI modules (Navbar, Footer, Modal, Drawer)
│   │   ├── pages/               # Page controllers (Home, SalerStore, Vault, Admin)
│   │   ├── services/            # API client (Fetch / Axios wrappers)
│   │   ├── locales/             # en.json, bn.json (i18n translations)
│   │   └── main.js              # Vite app entrypoint
│   ├── index.html               # Main HTML entry with SEO tags
│   └── package.json
│
├── server/                      # ⚙️ Backend API (Fastify / Node.js)
│   ├── src/
│   │   ├── config/              # Environment config, DB connections
│   │   ├── controllers/         # Request handling & HTTP response
│   │   ├── services/            # Business logic (Profit splits, Escrow, Orders)
│   │   ├── routes/              # API Route definitions
│   │   ├── models/              # PostgreSQL schema & query builders
│   │   ├── middlewares/         # Auth (JWT), RBAC, Rate-limiters
│   │   ├── sockets/             # WebSocket handlers (Chat, Live alerts)
│   │   └── integrations/        # bKash, Nagad, Steadfast, SMS Gateways
│   ├── migrations/              # Database migration scripts
│   └── package.json
│
├── mobile/                      # 📱 Mobile App (Flutter for Android & iOS)
│   ├── lib/
│   │   ├── models/
│   │   ├── screens/
│   │   ├── services/
│   │   └── main.dart
│   └── pubspec.yaml
│
└── docs/                        # Architecture & Idea Documentation
    ├── Explooro Idea.md
    ├── idea proposition.md
    ├── technologyneed.md
    └── technologyused.md        # ⭐ This master specification
```

---

## 🤖 5. Development Workflow with Antigravity & Claude Code

To build Explooro quickly, smoothly, and without bugs, follow this execution protocol:

1. **Step 1: Frontend Design Tokens & UI (Vite + Vanilla CSS)**
   * Antigravity launches Vite live dev server for immediate visual feedback.
   * Build world-class glassmorphic, responsive UI components with pure CSS.
2. **Step 2: Dynamic Core Subsystems (Interactive Logic)**
   * Implement Dynamic Profit Margin Calculator, Virtual Vault UI, Cart Drawer, and Admin Module Toggle.
3. **Step 3: Backend API & PostgreSQL Schema**
   * Setup Fastify server, database connection, JWT authentication, and RBAC roles.
4. **Step 4: Real-Time Chat & Integrations**
   * Connect WebSockets for chat and integrate bKash/Nagad & Courier APIs.
5. **Step 5: Flutter Mobile Application**
   * Build the Android & iOS apps linking seamlessly to the ready Backend APIs.

---

---

## 🚀 7. Production Deployment & Infrastructure Strategy

A cost-effective, high-speed, and ultra-reliable deployment pipeline tailored for lowest latency (sub-50ms) in Bangladesh.

```
                    ┌─────────────────────────────────────────┐
                    │       Cloudflare DNS & Edge Proxy       │
                    │   (SSL / DDoS Shield / BD Edge Caching) │
                    └────────────────────┬────────────────────┘
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
   ┌───────────────────────────┐                   ┌───────────────────────────┐
   │     Web Client (Vite)     │                   │    Backend API (Fastify)  │
   │  Cloudflare Pages / Vercel│                   │  VPS (Docker / Nginx / PM2)│
   │    Global Edge CDN (0ms)  │                   │    Singapore Region (35ms)│
   └───────────────────────────┘                   └─────────────┬─────────────┘
                                                                 │
                                                   ┌─────────────┴─────────────┐
                                                   ▼                           ▼
                                     ┌───────────────────────────┐┌───────────────────────────┐
                                     │   PostgreSQL (ACID DB)    ││   Redis In-Memory Store   │
                                     │  Neon / Supabase / VPS DB ││   Upstash / VPS Redis     │
                                     └───────────────────────────┘└───────────────────────────┘
```

### A. Component-by-Component Hosting Recommendations

| Layer | Recommended Platform | Why This Choice? | Estimated Monthly Cost |
| :--- | :--- | :--- | :--- |
| **🌐 Web Frontend** | **Cloudflare Pages** or **Vercel** | • Zero-config automatic Git deployments.<br>• Free Global Edge CDN (serves assets closest to Dhaka/Chittagong).<br>• 100% Free SSL & custom domain binding. | **$0 / month** (Free tier) |
| **⚙️ Backend & WebSockets** | **DigitalOcean / Hetzner / Contabo VPS** (Singapore DC) | • Full control over Node.js/Fastify runtime and WebSocket connections.<br>• Singapore datacenter offers direct 25ms–45ms ping to Bangladesh ISPs.<br>• Easy deployment via Docker Compose or PM2 + Nginx. | **$4 – $10 / month** |
| **🗄️ PostgreSQL Database** | **Managed PostgreSQL** (Neon / Supabase) OR **VPS Self-Hosted** | • Automated daily backups, point-in-time recovery for financial data.<br>• Zero risk of transaction data loss. | **$0 – $15 / month** |
| **⚡ Redis Cache** | **Upstash Redis** (Serverless) OR **VPS Local Redis** | • Millisecond latency for cart sessions, rate-limiting, and chat pub/sub. | **$0 / month** (Free tier) |
| **🖼️ Media / Image Storage** | **Cloudflare R2** or **AWS S3** | • **Zero egress (bandwidth) fees** with Cloudflare R2.<br>• Resizes & serves product images via global CDN in WebP/AVIF format. | **$0 – $2 / month** |
| **📱 Mobile App Distribution** | **Google Play Console** & **Direct APK** | • Google Play Store for official release.<br>• Direct APK download link on Explooro website for zero-barrier installs. | $25 one-time (Play Store) |

---

### B. Step-by-Step Deployment Guide

#### 1. Web Frontend Deployment (Cloudflare Pages / Vercel)
1. Push your code to GitHub: `git push origin main`.
2. Connect your GitHub repository to **Cloudflare Pages** or **Vercel**.
3. Set build settings:
   * **Framework Preset:** `Vite`
   * **Build Command:** `npm run build`
   * **Output Directory:** `dist`
4. Add your custom domain (e.g., `explooro.com`). Cloudflare automatically provisions free SSL certificates.

#### 2. Backend API Deployment (VPS with Docker & Nginx)
1. Provision an Ubuntu VPS in Singapore (DigitalOcean, Hetzner, or Linode).
2. Install Docker & Docker Compose:
   ```bash
   sudo apt update && sudo apt install docker.io docker-compose -y
   ```
3. Use a standard `docker-compose.yml` to run Fastify, PostgreSQL, and Redis:
   ```yaml
   version: '3.8'
   services:
     api:
       build: ./server
       restart: always
       ports:
         - "5000:5000"
       environment:
         - DATABASE_URL=postgres://user:pass@db:5432/explooro_db
         - REDIS_URL=redis://redis:6379
         - JWT_SECRET=your_super_secret_jwt_key
     db:
       image: postgres:16-alpine
       restart: always
       volumes:
         - pgdata:/var/lib/postgresql/data
     redis:
       image: redis:7-alpine
       restart: always
   volumes:
     pgdata:
   ```
4. Point Nginx as a reverse proxy with WebSocket support:
   ```nginx
   server {
       server_name api.explooro.com;
       location / {
           proxy_pass http://localhost:5000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
       }
   }
   ```
5. Obtain SSL via Certbot: `sudo certbot --nginx -d api.explooro.com`.

#### 3. Continuous Deployment (CI/CD via GitHub Actions)
* Whenever you or Claude Code push code to GitHub:
  * **Frontend:** Auto-builds and deploys to Cloudflare Pages within 30 seconds.
  * **Backend:** GitHub Action SSHs into the VPS and executes `docker-compose up -d --build`.

---

## ✅ 8. Final Confirmation

| Requirement | Solution Applied | Status |
| :--- | :--- | :--- |
| **Superfast Load Speed** | Vite + Vanilla CSS + Native JS (<150KB bundle) | ✅ Guaranteed |
| **Zero Framework Bloat** | Pure CSS Tokens, No Tailwind, No heavy meta-frameworks | ✅ Guaranteed |
| **Live Development Preview** | Instant Vite HMR with Antigravity browser tools | ✅ Guaranteed |
| **Financial Reliability** | PostgreSQL ACID transactions for Vault & Wallets | ✅ Guaranteed |
| **Mobile Native Support** | Flutter (Dart Native) for iOS/Android | ✅ Guaranteed |
| **Lowest Latency in BD** | Singapore VPS + Cloudflare Edge CDN (<40ms ping) | ✅ Guaranteed |
| **AI Tool Compatibility** | Clean, decoupled, modular architecture for Antigravity & Claude Code | ✅ Guaranteed |

---
*Created on 2026-08-18 as the authoritative technical stack specification for Explooro.*

