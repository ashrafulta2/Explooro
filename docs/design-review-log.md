# Explooro — Design Benchmark Review Log

> **Established in:** Prompt 1.10 (Craft Pass & Design Benchmark Review)  
> **Source Target:** `docs/design-system.md` §19  
> **Standing Rule #11:** *Re-run this review after Phases 4 (Catalog), 5 (Checkout), and 11 (Dashboards), appending a real critique of each surface.*

---

## 1. Benchmarking Methodology

Explooro measures its design execution against 7 calibrated industry references:
- **Stripe Dashboard**: Form craft, restrained density, micro-interaction feedback, and respectful error tones.
- **Linear**: Motion choreography, keyboard-first velocity, command palette, and deliberate surface ladders.
- **Vercel**: Typographic restraint, strict spacing baseline, and confident whitespace hierarchy.
- **Shopify Polaris**: Commerce interaction models, empty states, and merchant affordances.
- **Amazon**: High-density scannability and letting product imagery lead.
- **Apple Store**: Clean aspect ratios, generous photo framing, and hairline card definition.
- **bKash / Pathao**: Natural Bengali typography in high-frequency local commerce.

---

## 2. The Squint Test Protocol

> **Test Definition:** Blur the interface (via CSS `filter: blur(8px)` or squinting) until all text becomes illegible.
> 
> **Pass Criteria:**
> 1. **Visual Hierarchy**: The primary action (CTA) must immediately command visual attention over secondary elements.
> 2. **Grouping & Rhythm**: Related cards, form clusters, and section headers must hold together as cohesive units.
> 3. **Contrast Separation**: Surface levels (`--surface-0` through `--surface-3`) and status indicators must maintain distinct luminosity boundaries.

---

## 3. Review Cycle 1: Phase 1 Foundations Review

**Date:** 2026-08-21  
**Scope:** Phase 1 Design System, Component Primitives, App Shell, and Initial Key Surfaces.

### Surface 1: Marketplace Home (`/`)

| Metric | Evaluation |
| :--- | :--- |
| **Reference Calibration** | Amazon (scannability at density) + Vercel (spacing discipline) |
| **What the reference does better** | Amazon presents dense product matrices with instant eye-tracking to price and ratings; Vercel maintains strict 4px/8px vertical rhythm. |
| **Critique & Specific Refinements Made** | - Shipped content-driven grid (`repeat(auto-fill, minmax(220px, 1fr))`) preventing generic 12-column collapse.<br>- Locked 1:1 product imagery with `aspect-ratio: 1` and inner `inset 0 0 0 1px var(--border-subtle)` hairline border to prevent white-on-white washouts.<br>- Applied tabular numerals (`font-variant-numeric: tabular-nums`) to all BDT price displays. |
| **Squint Test Result** | **PASS** — Top search bar and primary hero banners emerge distinctly; product grid cards maintain clear card boundaries against `--surface-0`. |

### Surface 2: Product Detail (`/product/:id`)

| Metric | Evaluation |
| :--- | :--- |
| **Reference Calibration** | Apple Store (imagery discipline) + Shopify Polaris (buy-box hierarchy) |
| **What the reference does better** | Apple gives primary product photos uninterrupted prominence; Polaris isolates the buy box with unmistakable primary/secondary button hierarchy. |
| **Critique & Specific Refinements Made** | - Product imagery uses letterboxing on `--surface-2` with zero cropping or stretching.<br>- Primary CTA ("Buy Now" / "Resell This") styled with high-contrast `--brand` and physical `press()` feedback (`scale(0.97)`).<br>- Stock badge and trust tier badges aligned to cap-height with `--text-brand` contrast compliance. |
| **Squint Test Result** | **PASS** — Product visual dominates the left pane; primary conversion CTA in the buy box is unambiguously the strongest focal point on the right. |

### Surface 3: Checkout Surface (`/checkout`)

| Metric | Evaluation |
| :--- | :--- |
| **Reference Calibration** | Stripe (form density & feedback) + bKash (MFS payment flow) |
| **What the reference does better** | Stripe minimizes visual noise during checkout; inline field validation avoids alarming layout shifts. |
| **Critique & Specific Refinements Made** | - Form fields maintain strict 44px touch targets with custom brand focus rings.<br>- Delivery address and MFS payment selection use tactile radio cards with spring easing.<br>- Order summary breakdown locks prices to South Asian grouping (`৳ 1,23,456.00`) and tabular numerals to prevent digit jitter during discount computation. |
| **Squint Test Result** | **PASS** — Form steps read as clean sequential blocks; the sticky "Place Order" button anchors the bottom of the viewport with highest contrast. |

---

## 4. Phase Review Schedule

- [x] **Cycle 1 (Prompt 1.10)**: Phase 1 Foundations & Component Library — Completed.
- [ ] **Cycle 2 (Prompt 4.9)**: Phase 4 Catalog, Sourcing & Virtual Storefront.
- [ ] **Cycle 3 (Prompt 5.5)**: Phase 5 Checkout & Payment Flow.
- [ ] **Cycle 4 (Prompt 11.7)**: Phase 11 Multi-Role Dashboards (Supplier, Saler, Customer, Admin).
