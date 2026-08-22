# Explooro — Per-Feature Quality Assurance (QA) Checklist

> **Established in:** Prompt 1.9 (Accessibility, Performance Budget & Design QA Gate)  
> **Source Target:** `technologyused.md` §L1, `PRD.md` §7, `docs/design-system.md`  
> **Authority:** Standing Rule #9 — *Every UI feature in Phases 2–11 must pass this checklist before completion.*

---

## 1. Lighthouse Targets

The core web vitals and quality metrics are measured against production builds on critical customer and merchant surfaces (Marketplace Home `/`, Product Detail `/product/:id`, Storefront `/store/:slug`, Checkout `/checkout`, and Dashboards):

| Metric | Target | Verification Method |
| :--- | :--- | :--- |
| **Performance** | **≥ 95** | Chrome DevTools Lighthouse / Core Web Vitals (FCP < 1.0s, LCP < 1.8s, CLS < 0.05, TBT < 150ms) |
| **Accessibility (A11y)** | **100** | Lighthouse A11y 100/100 + `a11y-audit.js` in-page scanner 0 violations |
| **Best Practices** | **≥ 95** | Modern Web Standards, HTTPS, safe targets, zero console errors |
| **SEO** | **≥ 95** | Semantic HTML5, canonical metadata, OpenGraph tags, JSON-LD structured data |

---

## 2. The 12-Point Feature Quality Gate

Every component, surface, or page created must be evaluated against these 12 requirements:

### 1. ⌨️ Keyboard Reachability & Navigation
- [ ] Every interactive element (`<button>`, `<a>`, `<input>`, `<select>`, `<textarea>`, custom controls) is focusable in natural tab order.
- [ ] No keyboard traps: Focus moves freely in and out of every region, table, and list.
- [ ] Modals and Drawers trap focus while active and return focus to the trigger element on close (`Escape` or dismiss).
- [ ] Radio groups and segmented controls support standard Arrow key navigation.
- [ ] `Space` and `Enter` trigger buttons, checkboxes, and expandable toggles predictably.

### 2. 🎯 Visible Custom Focus Ring
- [ ] Custom brand-tinted focus ring (`outline: 2px solid var(--brand); outline-offset: 2px;`) is clearly visible on `:focus-visible`.
- [ ] No `outline: none` without an immediate, accessible replacement (e.g. `:focus-within` on parent control wrappers).
- [ ] Focus ring has high contrast against all 4 surface levels (`--surface-0` through `--surface-3`).

### 3. 👁️ Contrast AA Compliance
- [ ] Body copy, table data, input text, and headings achieve **≥ 4.5:1** contrast ratio against their immediate background surface.
- [ ] Large text (≥ 18pt / 24px regular, or ≥ 14pt / 18.66px bold) achieves **≥ 3.0:1** contrast ratio.
- [ ] UI components and graphical objects (borders, icons, status dots) maintain **≥ 3.0:1** contrast against adjacent surfaces.
- [ ] Contrast compliance is verified under **both** `:root` (light) and `data-theme="dark"` (dark) modes.
- [ ] Verified via `a11y-audit.js` and `/dev/gallery` contrast inspector panel.

### 4. 📱 44px Minimum Touch Targets
- [ ] Every tappable element (buttons, icon triggers, tabs, pagination links, checkboxes, switches) has a touch bounding box of at least **44×44px** under coarse pointer / mobile viewports.
- [ ] Spacing between adjacent touch targets prevents accidental taps (minimum 8px gap).

### 5. 🏷️ ARIA Labelling & Semantics
- [ ] All `<img>` tags provide a descriptive `alt` attribute (or explicit `alt=""` for purely decorative images).
- [ ] Icon-only buttons provide an accessible name via `aria-label`, `aria-labelledby`, or `<span class="sr-only">`.
- [ ] Form controls are wired to explicit labels via `<label for="id">`, wrapping `<label>`, or `aria-label`.
- [ ] Form validation errors and hints are wired to the control via `aria-describedby` and `aria-invalid="true"`.
- [ ] Dynamic loading regions declare `aria-busy="true"` and live status announcements use `aria-live="polite"`.

### 6. 🎬 Reduced Motion Respect
- [ ] Animations, transitions, and micro-interactions honor `@media (prefers-reduced-motion: reduce)` by zeroing durations (`--dur-instant: 0ms`).
- [ ] No auto-playing animations, infinite looping spinners, or flashing elements (> 3 flashes/sec).

### 7. 📭 Designed Empty States
- [ ] Every list, table, cart, inbox, and search view provides a designed empty state when data is empty (`items.length === 0`).
- [ ] Empty state contains:
  1. A thematic illustration / icon.
  2. Exactly one concise descriptive sentence in plain English/Bengali explaining the situation.
  3. Exactly one primary action CTA guiding the user to the next step.
- [ ] First-run empty states are welcoming and instructional rather than void.

### 8. ⏳ Designed Loading States & Skeletons (Zero CLS)
- [ ] Async data fetching renders layout-mirroring skeletons rather than generic spinners or layout jumps.
- [ ] Skeletons reserve the exact dimensions (width, height, aspect ratio, line count) of loaded content to ensure Cumulative Layout Shift (CLS) < 0.05.
- [ ] Skeleton crossfade into loaded content is smooth (150ms crossfade).

### 9. ⚠️ Designed Error States & Graceful Degradation
- [ ] Network, validation, or permission errors display a human-readable explanation with contextual guidance (not raw HTTP codes or trace dumps).
- [ ] Dual-language error messages (`message_en` and `message_bn`) are provided.
- [ ] Clear recovery actions are offered (e.g. "Retry", "Refresh balance", "Request access").

### 10. 🌐 Dual-Language i18n (English ⇄ Bengali)
- [ ] Zero hardcoded user-facing strings in markup or component templates.
- [ ] Every string is keyed and present in **both** `client/src/locales/en.json` and `client/src/locales/bn.json`.
- [ ] Bengali typography respects `:lang(bn)` line-height and optical sizing rules without clipping ascenders/descenders.
- [ ] Currency numbers format with South Asian digit grouping (`৳ 1,23,456.00`).

### 11. 📐 Mobile 360px Responsiveness
- [ ] Tested and verified at **360px viewport width** with **zero horizontal page overflow/scroll**.
- [ ] Content reflows cleanly; tables contain horizontal scroll within their dedicated wrapper container (`overflow-x: auto`) rather than expanding the page.
- [ ] Bottom navigation and sticky footers stay clear of interactive page controls.

### 12. 📦 Performance Budget & Bundle Hygiene
- [ ] Initial entry JS bundle ≤ **150 KB gzipped** (enforced by `client/vite.config.js`).
- [ ] Initial entry CSS bundle ≤ **40 KB gzipped** (enforced by `client/vite.config.js`).
- [ ] Zero client-side runtime dependencies in `client/package.json`.
- [ ] Heavy routes and dev modules are dynamically imported (`import()`) for on-demand code splitting.

---

## 3. Pre-Commit QA Verification Procedure

Before marking any prompt complete in the traceability matrix:

1. **In-Page A11y Scanner**: Open `http://localhost:3000/dev/gallery` (and the feature's route) in browser — verify floating A11y badge reads **"0 issues"**.
2. **Build Budget Check**: Run `npm run build` — confirm all entry chunks PASS the gzipped size threshold.
3. **Dual Language Toggle**: Toggle language between EN and BN — confirm all strings update without reload or layout clipping.
4. **Theme Switch**: Toggle between Light and Dark themes — confirm seamless palette switch with zero contrast regressions.
5. **Responsiveness**: Verify at 360px, 768px, 1280px viewport widths with zero page-level horizontal overflow.
