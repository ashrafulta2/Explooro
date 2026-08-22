# 🛠️ Explooro — Technology Stack & Architecture Specification (`technologyneed.md`)

> **Architectural Goal:** Maximum runtime speed, zero-bloat dependency management, long-term version stability, instant developer live preview (HMR), and high-throughput scalability for a dynamic social commerce ecosystem.

---

## 1. Executive Technical Philosophy

Explooro is designed with a **"High Performance, Low Dependency Bloat, Future-Proof"** engineering philosophy:

1. **Avoid Framework Churn & Dependency Hell:** Avoid heavy all-in-one frameworks with brittle breaking updates. Use modular, industry-standard LTS (Long Term Support) runtimes and clean design tokens.
2. **Sub-Second Response Times:** Light client bundles, native browser standards (ES modules), indexed relational databases, and memory caching.
3. **Instant Live Preview & Rapid Iteration:** Zero-delay Hot Module Replacement (HMR) during development to preview changes in real time.
4. **Decoupled Client-Server Ecosystem:** The backend exposes pure RESTful & WebSocket APIs, allowing the Web Client (Vite) and Mobile Apps (Flutter) to share the exact same business logic and database.

---

## 2. Comprehensive Technology Stack

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 EXPLOORO TECH ECOSYSTEM                                 │
├────────────────────────────────┬───────────────────────────────────────────────────────┤
│ 🌐 Web Platform (PWA)          │ Vite + Modular TypeScript/React + Vanilla Modern CSS   │
│ 📱 Mobile App (Android/iOS)    │ Flutter (Dart Native Compilation)                      │
│ ⚙️ Backend API & Services      │ Node.js (Fastify / Express) or Go (Golang)             │
│ 🗄️ Database                    │ PostgreSQL (ACID Financial Transactions)               │
│ ⚡ In-Memory Cache & Queue      │ Redis (Live Sessions, Chat Caching, Rate Limiting)     │
│ 🔌 Real-Time Communications    │ WebSockets (ws / Socket.io)                            │
│ 💳 Payments & Logistics (BD)   │ bKash, Nagad, Rocket + Steadfast / Pathao Couriers     │
│ ☁️ Storage & Media Hosting     │ AWS S3 / Cloudinary / MinIO (Optimized Media Assets)   │
└────────────────────────────────┴───────────────────────────────────────────────────────┘
```

---

## 3. Frontend Architecture (Web & PWA)

### Why Vite?
* **Instant Server Start & Lightning HMR:** Vite serves source code over native ESM, providing near-instantaneous live preview during development without costly re-bundling.
* **Minimal Overhead:** Extremely lean build output compared to monolithic fullstack meta-frameworks.
* **Long-Term Stability:** Vite acts as a build orchestrator rather than a heavy opinionated runtime, preventing lock-in.

### Component & Styling Architecture
* **UI Structure:** Modular Components (React / Lightweight TypeScript components).
* **Styling Engine:** **Vanilla Modern CSS & CSS Custom Properties (Variables)**:
  * Zero reliance on third-party CSS bloat libraries.
  * Direct control over design tokens (Colors, Spacing, Typography, Shadows, Glassmorphism, Micro-animations).
  * 100% immune to CSS framework breaking updates.
* **State Management:** Lightweight stores (Zustand / Nano Stores) for cart, user session, and dynamic margin calculation.
* **Internationalization (i18n):** JSON-based locale dictionary engine supporting dynamic runtime switching (English, Bengali, and future languages).

---

## 4. Mobile Architecture (Android & iOS)

### Why Flutter for Mobile?
* **Native Compilation:** Compiles directly to ARM64 native machine code, ensuring smooth 60 FPS / 120 FPS UI transitions.
* **Unified Codebase:** Single codebase for both Google Play Store (Android) and Apple App Store (iOS).
* **Instant Hot Reload:** Real-time stateful preview during mobile app feature development.
* **Hardware Integration:** Native access to camera (for video unboxing / product scanner), push notifications, and local storage.

### Why Separate Web (Vite) from Mobile (Flutter)?
* **SEO & Web Performance:** Web search engines, social media crawlers (Facebook/WhatsApp OG cards), and low-bandwidth web users require lightweight semantic HTML/CSS, which Vite delivers best.
* **Mobile Experience:** Native mobile users benefit from Flutter's native gesture handling and fluid animations.

---

## 5. Backend & Database Architecture

### Backend Engine: Node.js (Fastify) or Go (Golang)
* **High Concurrency & Low Latency:** Fastify provides 4x-5x the throughput of traditional Express while retaining standard Node.js ecosystem simplicity.
* **Structured RESTful Endpoints:** Clear separation of concerns (Controllers, Services, Repositories).
* **Real-time WebSockets:** Low-latency bi-directional channels for:
  * Customer ↔ Saler ↔ Supplier live chats.
  * Live broadcast comments and pinned product interactions.
  * Instant order status & wallet credit notifications.

### Database Layer: PostgreSQL + Redis
1. **PostgreSQL (Primary Relational Store):**
   * Multi-role RBAC schema (Admin, Moderator, Editor, Supplier, Saler, Customer).
   * Strict ACID transactions for the **Digital Vault (Wallet)**, escrow, and profit-sharing payouts.
   * Product catalogs, dynamic pricing formulas, and order audit logs.
2. **Redis (Cache & Fast Storage):**
   * Active user sessions and authentication tokens.
   * High-speed catalog caching for viral flash sale traffic.
   * Rate limiting and anti-bot velocity protection.

---

## 6. Core Subsystem Specifications

### A. Dynamic Profit-Sharing & Margin Engine
* **Formula:** `Retail Price = Base Production Cost + Wholesale Margin + Explooro Platform Margin + Saler Commission`.
* Dynamic configuration via Admin Dashboard with zero hardcoded financial splits.
* Automated clawback engine on verified product returns.

### B. Master Feature Toggle Panel (Admin Control)
* Database-driven feature flags for every platform module.
* Allows administrators to enable or disable features (e.g., Sponsored Ads, Age Verification, Live Streams) on the fly without deploying code.

### C. Bangladesh Ecosystem Integrations
* **MFS Gateways:** bKash Direct Checkout API, Nagad PGW, Rocket, SSLCommerz.
* **Logistics & Courier Hub:** Webhook synchronization with Steadfast Courier, Pathao Merchant API, RedX.
* **SMS Gateway:** Local SMS API integration for OTP confirmation and delivery milestone updates.

---

## 7. Development & Deployment Roadmap

| Phase | Milestone | Deliverables |
| :--- | :--- | :--- |
| **Phase 1** | **Frontend Core & Design System (Vite)** | • Vite setup with Vanilla CSS design tokens.<br>• Responsive Navigation, Theme System & Live Preview.<br>• Core UI: Marketplace, Saler Storefront, Product Cards. |
| **Phase 2** | **Interactive Prototypes & State Engine** | • Dynamic Profit Calculator & Vault Dashboard.<br>• Sliding Cart Drawer, Multi-Language Switcher (EN/BN).<br>• Admin Module Control Panel Mockup. |
| **Phase 3** | **Backend API & Database Schema** | • PostgreSQL schema for Users, Products, Orders, Wallets.<br>• Authentication (JWT + OTP) & RBAC middleware.<br>• REST APIs for Product Management and Dynamic Pricing. |
| **Phase 4** | **Real-time Engine & Chat** | • WebSocket implementation for P2P Chat and Notifications.<br>• Live Order Tracking milestone updates. |
| **Phase 5** | **Mobile App (Flutter)** | • Flutter mobile client connecting to the existing Backend API. |
| **Phase 6** | **Security, Logistics & Go-Live** | • 3PL Courier API webhooks, Payment Gateway integration.<br>• Performance audit, security hardening, and production deployment. |

---

*Document created for technical reference and architecture governance.*
