# Explooro — Design System Specification

> **Produced by:** Prompt 0.2
> **Implemented by:** Prompt 1.1 (`tokens.css`, `themes.css`), Prompt 1.2 (typography), Prompt 1.10 (craft layer)
> **Status:** Authoritative. Where this document and any implementation disagree, this document wins.
>
> Every colour value below was generated and verified by an OKLCH→sRGB converter, and every
> contrast figure is a **measured** WCAG 2.1 ratio, not an estimate. Values marked ✅ have been
> confirmed in gamut and above threshold.

---

## 0. Decision Record — Solid, not Glass

**Explooro uses a SOLID, HIGH-CONTRAST, ZERO-GRADIENT COMMERCE AESTHETIC.**

This resolves a direct contradiction in the source documents: `prompt.md` v1.0 specified
glassmorphism with a dark blurred palette, while `technologyused.md` §Layer 1 and `PRD.md` §3.1.10
specified *"100% solid surfaces, zero gradients, crisp 1px borders, Alibaba/Amazon aesthetic."*
The solid direction wins, for three reasons that are about outcomes rather than taste:

1. **Device reality.** The target user is on an entry-level Android phone on a mobile network in
   Bangladesh. `backdrop-filter: blur()` forces a GPU compositing pass on every scroll frame. On a
   ৳12,000 phone this is the difference between a 60fps feed and a stuttering one.
2. **Contrast over product photography.** Product images are user-supplied and unpredictable —
   white backgrounds, busy backgrounds, low-quality phone photos. Translucent surfaces layered over
   them destroy text legibility exactly where the purchase decision happens.
3. **Trust is built by clarity.** Amazon, Alibaba, and Daraz are all solid, dense, and high-contrast.
   None of them use glass. In a marketplace, visual effects read as decoration; legibility reads as
   competence.

### Where glass is permitted

| Surface | Treatment |
| :--- | :--- |
| Modal scrim (the dimmed backdrop) | ✅ Subtle blur permitted |
| Command palette backdrop | ✅ Subtle blur permitted |
| **Everything else** | ❌ Solid only |

Cards, navbars, sidebars, tables, drawers, sheets, dashboards, product surfaces, and every panel
containing data are **solid**. Note that even for a modal, the *panel* is solid — only the scrim
behind it is blurred. This is the inverse of the v1.0 intent.

The permitted scrim, and its mandatory low-end escape hatch:

```css
.scrim {
  background: var(--scrim);          /* carries most of the dimming on its own */
  backdrop-filter: blur(4px);        /* 4px is a depth hint, not a frosted panel */
}
@media (prefers-reduced-motion: reduce), (max-width: 480px) {
  .scrim { backdrop-filter: none; }  /* small screens are the cheap devices */
}
```

**Gradients are forbidden everywhere**, including the Theme Studio (Prompt 3.5 must reject them in
validation). Depth comes from three tokens working together — surface lightness, a 1px border, and
a restrained shadow — never from a colour transition.

---

## 1. Colour

### 1.1 Why OKLCH

All ramps are authored in **OKLCH**, not HSL and not hand-picked hex.

In HSL, `hsl(60 100% 50%)` (yellow) and `hsl(240 100% 50%)` (blue) claim the same 50% lightness but
are wildly different to the eye. A ramp built that way has uneven steps — the 400 and 500 look
identical in one hue and jump violently in another. OKLCH lightness is perceptually uniform, so
**one step is one step in every hue.** This single choice is most of the difference between a
palette that looks designed and one that looks picked.

Two consequences that the implementation must respect:

- **Chroma peaks in the middle of every ramp and falls off at both ends.** The sRGB gamut narrows
  at very light and very dark lightnesses; holding chroma constant pushes colours out of gamut and
  the browser silently clips them. Every value below was gamut-checked. ✅ 0 out of gamut.
- **Lightness steps compress at the light end.** The perceptual distance between 97% and 94% is
  larger than the numbers suggest, so the top of each ramp uses smaller increments.

Authoring format, with an sRGB fallback for older engines:

```css
:root { --brand-700: #6c4ab3; }
@supports (color: oklch(0 0 0)) {
  :root { --brand-700: oklch(50% 0.160 295); }
}
```

### 1.2 Brand ramp — pink, hue 344

> **Revised.** The previous Coral theme was replaced with a soft Pink, derived from 5 client-supplied
> reference swatches, and deliberately capped lighter than Coral ever was at every step (the deepest
> step, brand-1000, sits at L36% vs Coral's L27%).

| Step | OKLCH | Hex | Typical use |
| :--- | :--- | :--- | :--- |
| 50 | `oklch(98% 0.006 344)` | `#fcf7f9` | **Page background (`surface-0`, light theme)** |
| 100 | `oklch(96% 0.014 344)` | `#f9eef4` | **Card background (`surface-1`, light theme)**, selected row |
| 200 | `oklch(94% 0.033 344)` | `#fce3f1` | Badge background |
| 300 | `oklch(89.5% 0.058 344)` | `#f9cee6` | Dark-theme link, solid-fill buttons |
| 400 | `oklch(84.7% 0.082 344)` | `#f4b8da` | Dark-theme focus ring, solid-fill buttons (hover) |
| 500 | `oklch(79.7% 0.106 344)` | `#eea1ce` | **Primary button, checkbox, focus ring** |
| 600 | `oklch(74.7% 0.127 344)` | `#e58bc1` | **Button hover, brand-alt fill (pills, active nav)** |
| 700 | `oklch(68% 0.140 344)` | `#d372ad` | Button active |
| 800 | `oklch(61% 0.145 344)` | `#bd5b98` | Topbar icon colour (needs more presence at small size than the base fill) |
| 900 | `oklch(52% 0.130 344)` | `#9b467b` | **Link / active-tab text (`text-brand`)** |
| 950 | `oklch(44% 0.105 344)` | `#793861` | Reserved |
| 1000 | `oklch(36% 0.080 344)` | `#592a47` | Reserved |

> **brand-500 is the primary action colour** (buttons, checkboxes, focus rings) — it requires a dark
> text colour (`neutral-900`) to pass contrast (8.30:1 ✅). Fills that need light text instead
> (`brand-alt`, e.g. solid pills/badges) step to brand-600, still paired with dark text — no step
> this light clears 4.5:1 with *white* text, so text colour adapts rather than the fill going
> deeper. **Known tradeoff:** because brand-500 is this light, the primary fill and the focus ring
> outline only measure ~1.9:1 against `surface-0` — below the 3:1 WCAG 1.4.11 guideline for
> non-text UI boundaries. This was an explicit choice (favouring a lighter palette over that
> guideline); the *text* inside every fill still clears AA.

### 1.2.1 Why Pink — the brand direction

The brand direction was shifted to a soft Pink (hue 344) at the client's request, explicitly
favouring lighter, less saturated steps over Coral's punchier mid-ramp. Danger stays a separate Red
(hue 29) — 45° from the brand hue, comfortably clear of any collision — so the semantic meaning of
"danger" is undisturbed by the brand change.

### 1.3 Neutral ramp — cool charcoal, hue 242.5

**The neutral ramp carries chroma 0.002 – 0.016 at hue 242.5. It is never pure grey.**

Pure `#888` grey is the single most reliable signal that an interface was assembled rather than
designed. The tint is small enough that no user could name it and large enough that its absence
is felt.

> **This ramp is NOT tinted toward the brand hue for surfaces or text** — a deliberate exception to
> the usual rule. The greys are a cool charcoal (242) while the brand is pink (344). Two reasons:
> the charcoal was chosen as a ground in its own right, and the wide separation keeps the greys
> reading as crisp neutral grounds rather than as a washed-out tint of the brand.
>
> **Borders are the one deliberate exception to that exception.** In *light* theme, `border-subtle`,
> `border-strong`, and `border-interactive` were moved off this ramp onto the brand ramp
> (brand-300/400/800 — see §1.2) at explicit client request: every border on the site should read
> pink, cards included. The page (`surface-0`) and card (`surface-1`) backgrounds followed the same
> request onto brand-50/100 — a light pink wash on the two backgrounds that cover most of the
> screen. `surface-2`/`surface-3` (raised/sunken — input fills, hover states) stay neutral
> deliberately: tinting those too would leave nothing to separate a sunken well from the pink
> borders sitting on top of it. Dark theme keeps both borders and surfaces on the neutral ramp
> (unchanged) since that direction was never requested or previewed. Text stays neutral in both
> themes throughout — only `text-brand` (§2) is ever brand-coloured.

| Step | OKLCH | Hex | Light theme | Dark theme |
| :--- | :--- | :--- | :--- | :--- |
| 0 | `oklch(99.2% 0.002 242.5)` | `#fbfdfe` | — | — |
| 50 | `oklch(98% 0.003 242.5)` | `#f7f9fa` | — | — |
| 100 | `oklch(96% 0.005 242.5)` | `#eff2f5` | **surface-2** (raised) | **text-primary** |
| 200 | `oklch(92% 0.006 242.5)` | `#e1e5e8` | **surface-3** (sunken) | — |
| 300 | `oklch(86% 0.008 242.5)` | `#cdd2d6` | — | **text-secondary** |
| 400 | `oklch(74% 0.010 242.5)` | `#a6acb1` | — | **text-muted** |
| 500 | `oklch(62% 0.012 242.5)` | `#80878d` | — | — |
| 600 | `oklch(52% 0.014 242.5)` | `#626a70` | **text-muted** | **border-interactive** |
| 700 | `oklch(42% 0.016 242.5)` | `#464e55` | **text-secondary** | border-strong / **surface-3** |
| 800 | `oklch(32% 0.016 242.5)` | `#2c343a` | — | **border-subtle** / **surface-2** |
| 900 | `oklch(24% 0.015 242.5)` | `#192026` | **text-primary** | **surface-1** |
| 950 | `oklch(18% 0.014 242.5)` | `#0c1217` | — | **surface-0** (page) |
| 1000 | `oklch(13% 0.012 242.5)` | `#04080c` | — | Reserved (deepest well) |

> **Light-theme borders**: `border-subtle` = brand-300, `border-strong` = brand-400,
> `border-interactive` = brand-800, `border-default` (a general-purpose alias used by ~18 component
> rules — card hover, scrollbars, cart/store borders) = `border-strong`. **Light-theme base
> surfaces**: `surface-0` (page) = brand-50, `surface-1` (card) = brand-100; `surface-2`/`surface-3`
> stay on this ramp (100/200, unchanged). Full rationale and contrast numbers in §1.2 and §2.

### 1.4 Semantic ramps

| Role | Hue | 50 | 100 | 300 | 500 | 700 | 800 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **success** | 150 | `#e7f7e9` | `#bce3c3` | `#73bf84` | `#3e9c58` | `#2d7b44` | `#205b31` |
| **warning** | 75 | `#feefdc` | `#f6d19e` | `#e3a340` | `#c28412` | `#936412` | `#6e4b0e` |
| **danger** | 29 | `#fceeec` | `#fbd4cd` | `#ef9688` | `#fd1913` | `#c9120d` | `#8b1f17` |
| **info** | 250 | `#eaf3fc` | `#c8e1fb` | `#82b6ec` | `#3f90dd` | `#1b71bc` | `#16558c` |

**Accent (hue 75, amber)** — reserved for commercial urgency only: flash-sale countdowns, profit
margin badges, coin balances. It must never be used for general UI, or it stops signalling anything.

| 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `#fdf0de` | `#f8d9af` | `#eeba70` | `#de9c31` | `#c28412` | `#a26f17` | `#835a18` | `#664613` |

### 1.5 Shadows are tinted, never black

```css
/* WRONG — muddy over a tinted surface */
--shadow-1: 0 1px 2px rgb(0 0 0 / 0.08);
/* RIGHT — shadow inherits the surface hue at low lightness, high-ish chroma */
--shadow-color: 242deg 14% 14%;
--shadow-1: 0 1px 2px hsl(var(--shadow-color) / 0.08);
```

A pure-black shadow desaturates whatever it falls on. A hue-matched shadow reads as the surface
being lit rather than smudged.

### 1.6 Dark theme is designed, not inverted

Three rules that a naive inversion violates:

1. **Surfaces get LIGHTER as elevation increases** (950 → 900 → 800 → 700). In the physical model
   dark mode borrows from, a raised surface catches more light. Inverting the light-theme ladder
   makes raised cards *darker*, which reads as holes rather than cards.
2. **Chroma is reduced ~15%** on all semantic colours. Saturated colour on a dark field vibrates.
3. **`#000` and `#fff` are forbidden** as surface or text values. Pure black crushes shadow detail
   and causes OLED smearing on scroll; pure white on near-black causes halation. Use
   `neutral-950` and `neutral-100`.

### 1.7 Token naming

Components reference **semantic** tokens only. A component that names `--brand-700` directly cannot
be re-themed by the Theme Studio (Prompt 3.5).

```
--surface-0/1/2/3          --text-primary/secondary/muted/inverse
--border-subtle/strong/interactive
--brand / --brand-hover / --brand-active / --brand-contrast
--success / --success-bg / --success-border   (and the same triad for warning, danger, info)
--scrim  --focus-ring  --shadow-color
```

---

## 2. Contrast — Measured

All figures below are computed WCAG 2.1 ratios. APCA `Lc` is reported alongside because WCAG 2 is
known to misjudge mid-tone pairs; where the two disagree, investigate rather than trusting either
blindly. Target: **AA minimum (4.5:1 body, 3:1 large text and non-text UI).**

### Light theme

| Pairing | Ratio | AA | APCA Lc |
| :--- | :--- | :--- | :--- |
| text-primary (n-900) on surface-0 (brand-50) | **15.47:1** | ✅ | 99.2 |
| text-primary on surface-2 (n-100) | **14.63:1** | ✅ | 95.5 |
| text-secondary (n-700) on surface-0 | **7.95:1** | ✅ | 84.9 |
| text-muted (n-600) on surface-0 | **5.17:1** | ✅ | 73.3 |
| text-brand (brand-900) on surface-0 | **5.58:1** | ✅ | 75.0 |
| n-900 on brand-500 (primary button) | **8.30:1** | ✅ | 63.2 |
| n-900 on brand-600 (brand-alt fill) | **6.88:1** | ✅ | 54.5 |
| n-900 on brand-700 (button active) | **5.32:1** | ✅ | 43.9 |
| danger-700 on surface-0 | **5.54:1** | ✅ | 72.9 |
| success-700 on surface-0 | **4.92:1** | ✅ | 71.5 |
| input border (brand-800) on surface-0 | **3.86:1** | ✅ 1.4.11 | — |
| focus ring (brand-500) on surface-0 | 1.86:1 | ❌ 1.4.11 (accepted, see below) | — |
| border-subtle (brand-300) on surface-0 | 1.32:1 | decorative only | 15.2 |
| border-strong (brand-400) on surface-0 | 1.56:1 | decorative only | 24.6 |

### Dark theme

| Pairing | Ratio | AA | APCA Lc |
| :--- | :--- | :--- | :--- |
| text-primary (n-100) on surface-0 | **16.74:1** | ✅ | −98.6 |
| text-primary on surface-2 (n-800) | **11.27:1** | ✅ | −93.3 |
| text-secondary (n-300) on surface-0 | **12.29:1** | ✅ | −78.1 |
| text-muted (n-400) on surface-0 | **8.16:1** | ✅ | −56.1 |
| brand-300 link on surface-0 | **13.41:1** | ✅ | −83.5 |
| neutral-950 on brand-300 (button) | **13.41:1** | ✅ | 83.5 |
| danger-300 on surface-0 | **8.38:1** | ✅ | −57.6 |
| input border (n-600) on surface-0 | **3.42:1** | ✅ 1.4.11 | — |
| focus ring (brand-400) on surface-0 | **11.37:1** | ✅ | — |
| border-subtle (n-800) on surface-0 | 1.48:1 | decorative only | −3.7 |

### Two rules this table implies

1. **`border-subtle` and `border-strong` are decorative separators only.** They may never be the
   sole indicator of an interactive boundary. Inputs, selects, and textareas use
   `--border-interactive` (3.55:1 / 3.42:1 ✅).
2. **A switch's off-state track measures 2.25:1 and therefore fails 1.4.11 on its own.** The switch
   must carry a `--border-interactive` outline so its boundary is perceivable regardless of track
   fill. Do not solve this by darkening the track — that makes off look like on.
3. **In light theme, brand-500's own boundary against `surface-0` (1.86:1) fails 1.4.11** — the
   primary button fill and the focus ring outline are both this light. This is an accepted tradeoff
   of the pink brand direction (§1.2.1), not an oversight: every *text* pairing that sits on top of
   a brand fill still clears AA (see the table above), which was judged the higher priority. If this
   becomes a real usability complaint, the fix is a `--border-interactive`-style outline on
   `--brand`-filled controls (the same pattern used for the switch track), not a deeper fill.

---

## 3. Typography

### 3.1 Families

| Script | Family | Delivery |
| :--- | :--- | :--- |
| Latin | **Inter** | Self-hosted woff2, subset `latin` + `latin-ext` |
| Bengali | **Noto Sans Bengali** | Self-hosted variable woff2, subset `bengali` |
| Numerals | Inter with `tnum` | Tabular everywhere digits change |
| Mono | `ui-monospace, "Cascadia Code", Consolas, monospace` | System — no webfont |

**Never load fonts from a third-party CDN.** Self-hosting is not ideology here: it removes a
third-party DNS lookup, TLS handshake, and single point of failure from the critical render path on
a mobile network where each of those costs real milliseconds. Total font payload budget: **< 120KB**.

`unicode-range` must be declared per face so the Bengali file is **not downloaded on an
English-only page**. This is a verifiable acceptance criterion in Prompt 1.2.

### 3.2 Scale, with per-size optical tracking

**A single global `letter-spacing` is not acceptable.** Large text needs to be pulled tighter and
small text needs to be opened up; this is the difference between text that is typeset and text
that is merely typed.

| Token | Size | Line-height | Tracking | Weight | Use |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--text-2xs` | 10px | 15px | **+0.06em** | 600 | All-caps micro labels |
| `--text-xs` | 11px | 17px | **+0.02em** | 500 | Badges, captions, table meta |
| `--text-sm` | 13px | 19px | **+0.005em** | 400 | Secondary body, dense tables |
| `--text-base` | 15px | 22px | **0** | 400 | Body — the reference size |
| `--text-lg` | 17px | 24px | **−0.005em** | 500 | Lead paragraph, card title |
| `--text-xl` | 18px | 26px | **−0.01em** | 600 | Section heading |
| `--text-2xl` | 22px | 30px | **−0.015em** | 600 | Page heading |
| `--text-3xl` | 27px | 35px | **−0.02em** | 700 | Display |
| `--text-4xl` | 33px | 40px | **−0.025em** | 700 | Hero |
| `--text-5xl` | 44px | 52px | **−0.03em** | 700 | Marketing hero only |

### 3.3 OpenType features

```css
body {
  font-feature-settings: "cv05" 1, "cv11" 1, "ss03" 1;
  /* cv05: single-storey l with tail — disambiguates l/I/1, which matters in prices and codes
     cv11: single-storey a           — calmer at small sizes
     ss03: curved r                  — softens dense body text            */
}
.numeric, td, .price, .countdown { font-variant-numeric: tabular-nums; }
```

### 3.4 Hierarchy and measure

- **Hierarchy is built from weight and space, not size.** No more than **three distinct type sizes**
  on any single screen. A screen with six sizes has no hierarchy, only noise.
- **Line length: `max-width: 65ch`** for body copy (60–75 characters). Longer lines cause the eye
  to lose its place on return.
- Headings use `text-wrap: balance`; body copy uses `text-wrap: pretty`.

### 3.5 Bengali typography — dedicated rules

Bengali is not "English with different glyphs." It renders differently and needs its own treatment.
Getting this wrong is immediately obvious to a Bangladeshi user and invisible to everyone else.

1. **Taller line-height.** Bengali has both ascenders and descenders around the *matra* (the
   horizontal headline stroke), so Latin line-heights clip. Add **+2px at every size**:

   ```css
   :lang(bn) {
     --lh-xs: 20px;  --lh-sm: 22px;  --lh-base: 26px;
     --lh-lg: 28px;  --lh-xl: 30px;  --lh-2xl: 34px;
   }
   ```

2. **Tracking is reset to 0 at every size.** The negative tracking that improves large Latin display
   text collides conjunct clusters (যুক্তাক্ষর) in Bengali.

   ```css
   :lang(bn) { letter-spacing: 0 !important; }
   ```

3. **Bengali reads optically smaller than Latin at the same px.** Apply a **1.05× size multiplier**
   at body sizes and below so mixed-language screens feel balanced.
4. **No faux bold.** Only weights actually declared for the Noto Sans Bengali face may be used. A
   synthesised bold destroys the matra.
   > **Implementation note (Prompt 1.2, revised):** originally shipped as Hind Siliguri, static
   > 400/700 only — that face has no variable-weight axis, and a real, correctly-shaped static
   > weight (every Indic GSUB feature retained — an earlier trimmed feature list silently dropped
   > conjunct glyphs, caught by screenshot QA) cost ~35KB each, so only two of the four weights
   > fit this document's <120KB total font budget (§3.1) before Inter was even added. Replaced
   > with **Noto Sans Bengali**: one genuinely variable file (wght 100–900, GSUB/GPOS-complete),
   > ~105KB, still inside budget. `font-weight: 400 700` is declared — matching the range Inter
   > declares below, and everything the type scale actually requests — but because the underlying
   > file is variable, 500/600 now render as real instances rather than resolving to 400/700.
   > See `client/src/styles/typography.css`.
5. **Never uppercase Bengali.** `text-transform: uppercase` is meaningless in Bengali script and
   corrupts rendering. Any all-caps utility class must be scoped `:lang(en)`.
6. **Numerals default to Western (0–9)** even in Bengali locale, because BDT prices, phone numbers,
   and order IDs are read in Western digits in practice. Bengali numerals (০১২৩) are a per-user
   preference, not the locale default.
7. **Line-breaking:** Bengali does not break on the matra. Set `word-break: normal;
   overflow-wrap: anywhere` and test with long conjunct-heavy product titles.

---

## 4. Spacing & the Proximity Rule

### 4.1 Scale — 4px base

| Token | Value | | Token | Value |
| :--- | :--- | :--- | :--- | :--- |
| `--space-1` | 4px | | `--space-6` | 24px |
| `--space-2` | 8px | | `--space-7` | 32px |
| `--space-3` | 12px | | `--space-8` | 40px |
| `--space-4` | 16px | | `--space-9` | 48px |
| `--space-5` | 20px | | `--space-10` | 64px |

### 4.2 The Proximity Rule — mandatory

**The gap between related elements must always be visibly smaller than the gap to the next group.**
Uniform spacing everywhere is the most common reason an interface reads as unconsidered: with equal
gaps, the eye cannot tell what belongs to what, and the user has to read everything to find anything.

The relationship must be at least **2×**, not a subtle difference.

| Relationship | Comfortable | Compact |
| :--- | :--- | :--- |
| Label → its own input | `--space-2` (8px) | `--space-1` (4px) |
| Input → next field in the same group | `--space-4` (16px) | `--space-3` (12px) |
| Field group → next group | `--space-7` (32px) | `--space-5` (20px) |
| Section → next section | `--space-9` (48px) | `--space-7` (32px) |
| Card padding | `--space-5` (20px) | `--space-4` (16px) |
| Grid gutter | `--space-5` (20px) | `--space-3` (12px) |

**Worked example — a product card.**

```
image
  ↓ 12px   (space-3 — tight: image and title are one unit)
title
  ↓ 4px    (space-1 — tighter: title and supplier are the same thought)
supplier name · verified badge
  ↓ 12px   (space-3 — separates identity from commerce)
price · margin badge
  ↓ 16px   (space-4 — clearly separates content from action)
[ Add to Store ]
```

Read the numbers as a sequence — 12, 4, 12, 16 — and the grouping is legible before a single word
is read. Set every gap to 12px and the card becomes a list of unrelated facts.

---

## 5. Radius, Borders & Elevation

### 5.1 Radius scale

| Token | Value | Use |
| :--- | :--- | :--- |
| `--radius-xs` | 4px | Badge, tag, checkbox |
| `--radius-sm` | 6px | Input, button, small control |
| `--radius-md` | 10px | Card, panel, dropdown |
| `--radius-lg` | 14px | Modal, drawer, large surface |
| `--radius-xl` | 20px | Hero, feature panel |
| `--radius-full` | 9999px | Pill, avatar, switch |

### 5.2 The Nested Radius Rule — mandatory

**inner radius = outer radius − padding**

A rounded child inside a rounded parent must have a *smaller* radius, or the curves run
non-concentric and the child appears to bulge out of its container. It is a small error that looks
wrong even to people who cannot say why.

```
Card:  radius 10px, padding 8px
  └── Image inside:  10 − 8 = 2px   ✅
  └── Image at 10px:                ❌ visibly non-concentric

Modal: radius 14px, padding 4px
  └── Header strip:  14 − 4 = 10px  ✅
```

If the result is ≤ 0, the child is square. Never round a child *more* than its parent.

### 5.3 Borders — hairlines on retina

A 1px border is 2 physical pixels on a 2× display and reads noticeably heavier than intended.

```css
--border-width: 1px;
@media (-webkit-min-device-pixel-ratio: 2), (min-resolution: 192dpi) {
  :root { --border-width: 0.5px; }
}
```

### 5.4 Elevation — three properties, never shadow alone

Each level is defined by **shadow + surface lightness + border** together. A shadow on an
identically-coloured surface reads as a smudge, not a lift.

| Level | Surface (light) | Surface (dark) | Border | Shadow |
| :--- | :--- | :--- | :--- | :--- |
| **0** flush | n-0 | n-950 | — | none |
| **1** card | n-50 | n-900 | subtle | `0 1px 2px / 0.06` |
| **2** raised | n-100 | n-800 | subtle | `0 2px 4px / 0.07, 0 1px 2px / 0.05` |
| **3** overlay | n-0 | n-800 | strong | `0 8px 16px / 0.10, 0 2px 4px / 0.06` |
| **4** modal | n-0 | n-800 | strong | `0 16px 32px / 0.14, 0 4px 8px / 0.08` |

All shadow alphas use `--shadow-color` (§1.5), never black.

---

## 6. Motion

### 6.1 Duration and easing tokens

| Token | Value | Use |
| :--- | :--- | :--- |
| `--dur-instant` | 90ms | Press feedback |
| `--dur-fast` | 120ms | Hover, colour change, small state |
| `--dur-base` | 200ms | Dropdown, tooltip, tab, accordion |
| `--dur-slow` | 320ms | Modal, drawer, page transition |

| Token | Curve | Intent |
| :--- | :--- | :--- |
| `--ease-out-quart` | `cubic-bezier(0.25, 1, 0.5, 1)` | **Entrances** — fast start, gentle settle |
| `--ease-in-quad` | `cubic-bezier(0.55, 0, 1, 0.45)` | **Exits** — accelerate away |
| `--ease-spring` | `cubic-bezier(0.34, 1.4, 0.64, 1)` | Direct manipulation (switch thumb, drag release) |
| `--ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | Neutral in-place change |

**`linear` is forbidden** except on progress bars and spinners. Nothing in the physical world
starts and stops at constant velocity, and linear motion is the clearest signal of unconsidered
animation.

### 6.2 The Origin Rule — mandatory

**Every overlay animates from its trigger's position, not from the centre of the screen.**

A dropdown grows out of its button. A drawer slides from the edge it lives on. A tooltip expands
from the element it describes. When motion has the wrong origin, the user loses the causal link
between what they clicked and what appeared.

```js
// Prompt 1.10 provides originTransition(el, triggerEl)
const r = trigger.getBoundingClientRect();
const p = panel.getBoundingClientRect();
panel.style.transformOrigin =
  `${r.left + r.width / 2 - p.left}px ${r.top + r.height / 2 - p.top}px`;
```

**Worked example.** A "Sort" dropdown at the top-right of a product grid opens with
`transform-origin: 92% 0` and `scale(0.96) → scale(1)` over `--dur-base` with `--ease-out-quart`.
The same panel opening from `center center` feels like it belongs to the page rather than the
button, and the user's eye has to re-find the trigger.

### 6.3 Asymmetry, choreography, interruption

- **Exits run ~30% faster than entrances.** Entering, the user is waiting for content and a settle
  feels considered. Leaving, they have already decided, and any delay feels broken.
  `--dur-slow` in → `~220ms` out.
- **Stagger list entrances at 20–30ms per item, capped at 8 items.** Beyond the cap, everything
  remaining appears together — otherwise a 40-item grid takes over a second to finish arriving.
- **Every animation must be interruptible.** A re-triggered animation continues from its current
  computed value; it never snaps back to the start. Use the Web Animations API or CSS transitions
  (which interpolate from current value by default) rather than keyframes that reset.

### 6.4 Reduced motion

```css
@media (prefers-reduced-motion: reduce) {
  :root { --dur-instant:0ms; --dur-fast:0ms; --dur-base:0ms; --dur-slow:0ms; }
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
}
```

Opacity cross-fades may be retained at 1ms; **transforms and parallax must be removed entirely**,
not merely shortened, because they are what triggers vestibular discomfort.

---

## 7. Z-Index Ladder

Named constants only. An arbitrary `z-index: 9999` anywhere is a defect.

| Token | Value | Layer |
| :--- | :--- | :--- |
| `--z-base` | 0 | Page content |
| `--z-sticky` | 100 | Sticky table headers, sticky filters |
| `--z-header` | 200 | App bar |
| `--z-drawer` | 300 | Sidebar, mobile drawer |
| `--z-dropdown` | 400 | Menus, selects, popovers |
| `--z-scrim` | 500 | Modal backdrop |
| `--z-modal` | 600 | Modal, dialog |
| `--z-palette` | 700 | Command palette |
| `--z-toast` | 800 | Notifications |
| `--z-tooltip` | 900 | Tooltips |
| `--z-devtools` | 1000 | `/dev/gallery`, `/dev/craft`, a11y badge |

---

## 8. Breakpoints

Mobile-first. **360px is the primary design target** — it is the most common Android width in
Bangladesh, and no horizontal page scroll is permitted at that width.

| Token | Min width | Context |
| :--- | :--- | :--- |
| `--bp-xs` | 480px | Large phone |
| `--bp-sm` | 768px | Tablet portrait |
| `--bp-md` | 1024px | Tablet landscape / small laptop |
| `--bp-lg` | 1280px | Desktop |
| `--bp-xl` | 1536px | Wide desktop |

Product grid: 2 columns < 768px · 3 columns < 1024px · 4 columns < 1280px · 5 columns above.

---

## 9. Density Modes

| | Comfortable (default) | Compact |
| :--- | :--- | :--- |
| Row height | 48px | 36px |
| Control height | 40px | 32px |
| Body size | 15px | 13px |
| Card padding | 20px | 16px |
| Applies to | Storefront, customer, mobile | Admin tables, ledger, moderation queues |

Compact is **never** applied to touch-primary surfaces — the 44px touch target rule (§11) wins over
density in every conflict.

---

## 10. Component State Matrix

Every interactive component must define all eight states. A component missing `loading`, `error`,
or `empty` is incomplete and cannot pass the Prompt 1.9 QA gate.

| State | Requirement |
| :--- | :--- |
| **default** | Resting appearance |
| **hover** | Pointer devices only — must not be the sole affordance |
| **focus-visible** | 2px `--focus-ring` with 2px offset. **Mandatory.** Never `outline: none` without a replacement |
| **active** | `scale(0.97)` over `--dur-instant` |
| **disabled** | 45% opacity, `cursor: not-allowed`, `aria-disabled`. Must still be readable — disabled is not invisible |
| **loading** | Inline spinner, **width must not change** (reserve the label width), `aria-busy` |
| **error** | `--danger` border, message below, `aria-describedby`, `aria-invalid` |
| **empty** | Illustration + one sentence + exactly one primary action |

---

## 11. Touch Targets

- **Minimum 44 × 44px** for every interactive element, on every device.
- A visually smaller control (a 20px checkbox, a 16px close icon) must extend its hit area with
  padding or a pseudo-element. The *visual* size and the *target* size are independent.
- Minimum 8px between adjacent targets.
- Primary actions sit within thumb reach on mobile: bottom third of the viewport.

---

## 12. Imagery

**This is the largest single quality differentiator on a marketplace**, because Explooro does not
control the photographs its suppliers upload. Amazon looks more premium than many competitors
largely because of image discipline, not layout.

### 12.1 Presentation rules

1. **One locked aspect ratio: `1:1`** for every product image, everywhere. Consistency across a
   grid matters far more than any individual image's framing.
2. **Letterbox, never crop or stretch.** A non-square image is centred on a `--surface-2` field.
   Cropping cuts off products; stretching is unforgivable.
3. **Reserve space with `aspect-ratio`** so there is zero cumulative layout shift:
   ```css
   .product-image { aspect-ratio: 1; object-fit: contain; background: var(--surface-2); }
   ```
4. **Inner hairline** on every product image so a white-background photo does not bleed into a
   white surface: `box-shadow: inset 0 0 0 1px var(--border-subtle);` — a small detail that
   immediately reads as considered.
5. **Format:** AVIF → WebP → JPEG fallback via `<picture>`. Derivatives at 200 / 400 / 1200px
   (Prompt 4.2).
6. **Loading:** `loading="lazy"` + `decoding="async"` below the fold; the first product row is
   eager. Placeholder is a shimmer sized to the final dimensions.

### 12.2 Upload quality gate (Prompt 4.2)

| Check | Threshold | On failure |
| :--- | :--- | :--- |
| Minimum resolution | 800 × 800 | Reject with an explanation |
| Maximum file size | 8MB | Reject |
| Screenshot detection | Device-frame / UI-chrome heuristic | Flag |
| Watermark detection | Edge/corner artefact heuristic | Flag |
| Background uniformity | Score 0–100 | Below 40 → offer the AI cleanup from Prompt 10.3 |

Flagged images are **accepted, not blocked** — a rejected upload is a lost seller. They are shown
with a "improve this photo" prompt and surfaced to the seller's quality score.

---

## 13. Brand Kit

- **Logo:** wordmark + standalone mark. Minimum clear space = the height of the "E". Minimum size
  24px (mark) / 96px (wordmark). Never recoloured, rotated, outlined, or shadowed.
- **Favicon:** 16, 32, 180 (Apple touch), 192, 512 (maskable), plus a dark-mode SVG variant.
- **OG image:** 1200 × 630, generated server-side per product and store (Prompt 4.8). Must render
  Bengali correctly — the font has to be embedded in the rasteriser, not assumed present.
- **Icons:** ONE coherent set, inline SVG sprite. **1.5px stroke, 24px optical grid, round caps and
  joins.** No icon font, no icon library dependency, no mixing sources. A single mismatched icon is
  more visible than a wrong colour.
- **Empty-state illustrations:** single-weight line art in `--brand-300` on `--surface-2`, no
  gradients, no drop shadows, max 160px. One visual idea per illustration.

---

## 14. Optical Corrections

The eye, not the number, is the authority. Mathematically perfect alignment is frequently
visibly wrong.

| Rule | Correction |
| :--- | :--- |
| **Optical centering** | A triangular glyph (play, chevron) centred by bounding box looks left-heavy. Shift right by ~8% of its width |
| **Optical sizing** | A circle must be ~4% larger than a square to read as the same size. Round avatars and dot badges get the bump |
| **Icon ↔ text alignment** | Align to **cap-height**, not the line box. Line-box alignment sits icons visibly low |
| **Hanging punctuation** | Leading quotes and bullets hang outside the text block: `hanging-punctuation: first` with a negative-margin fallback |
| **Single-word buttons** | Get ~1.25× the scale's horizontal padding, or they look cramped next to multi-word siblings |
| **Optical margin** | A right-aligned number column needs ~2px more right padding than a text column to appear equally inset |

---

## 15. Micro-Interaction Inventory

| Interaction | Specification |
| :--- | :--- |
| **Press** | `scale(0.97)`, `--dur-instant`, `--ease-standard`. **Every** tappable surface. This is what makes an interface feel alive rather than static |
| **Hover intent** | 120ms delay before hover-triggered overlays appear, so dragging the cursor across a grid does not flash every card |
| **Counter change** | Cart badge, coin balance, earnings — digits **roll**, they do not swap. `countUp()` from Prompt 1.10 |
| **Skeleton → content** | 150ms opacity crossfade. Never a pop |
| **Success confirmation** | Brief and restrained: a checkmark morph or a single toast. Never confetti, never full-screen |
| **Switch toggle** | Thumb travels with `--ease-spring`, track colour with `--ease-standard` |
| **Optimistic action** | UI updates immediately, reverts with a toast on failure. Never a spinner where an optimistic update is possible |
| **Destructive confirm** | Modal shakes 2px on a rejected confirmation, rather than silently doing nothing |
| **Primary button hover** | Rest is a solid `--brand` fill (`n-900 on brand-600`, §2). Hover drops the fill to transparent — brand-colour border and `--text-brand` label — so the interaction reads as a lift, not a colour swap. Active returns to a solid fill, one step darker (`--brand-hover`), for unambiguous press feedback |
| **Icon-only circular control** | Back-to-top, sidebar/filter-panel collapse toggles, and other small circular affordances rest as an **outline** (`--brand` border, transparent fill, `--brand` icon) and fill **solid `--brand`** on hover (`--brand-contrast` icon) — the inverse of the primary button's mapping above, reserved for secondary-weight, always-visible controls rather than CTAs |

---

## 16. Empty, Loading & Error Are Designed Surfaces

These are not fallbacks. They are the states a new user sees **first**, and the states a frustrated
user sees **most**.

**Skeletons must mirror the real layout exactly** — same number of lines, same widths, same
proportions, same gaps. A generic grey rectangle communicates "broken"; a structural skeleton
communicates "arriving". Build the skeleton by copying the component's own layout, not by guessing.

| Surface | Requirement |
| :--- | :--- |
| **Empty** | Illustration + one plain sentence + exactly one primary action |
| **First-run** | Distinct from empty. A new store is an *opportunity*, not a void — "Add your first product and start earning", not "No products" |
| **Loading** | Layout-matching skeleton. Spinners only where no structure is knowable |
| **Error** | What happened · what it means · what to do next. Never a raw code, never a shrug |
| **Offline** | Persistent banner + per-item sync status. Queued actions visibly queued, not silently dropped |
| **No results** | Echo the query, suggest relaxations, and offer to clear filters |

All copy in **both** English and Bengali, written for a shopper — not translated from developer
English.

---

## 17. The Details That Read As Expensive

| Detail | Specification |
| :--- | :--- |
| `::selection` | `--brand-100` background, `--text-primary` foreground. The browser default blue belongs to no brand |
| Scrollbars | 8px, `--neutral-400` thumb, transparent track, visible on hover (desktop only) |
| Focus ring | 2px `--focus-ring` at 2px offset. Never removed, never the browser default |
| `caret-color` | `--brand` in every text input |
| Tabular numerals | Every price, counter, table cell, countdown. Without it, digits jitter as they change |
| Print stylesheet | Invoices, packing slips, flyers — Prompts 7.1 and 9.7 depend on it |
| `color-scheme` | Declared on `:root` so native form controls and scrollbars match the theme |
| `accent-color` | Set to `--brand` so native checkboxes/radios inherit the brand |
| Autofill | Restyled — the yellow Chrome autofill background breaks every dark theme |
| `::placeholder` | `--text-muted`, never the same colour as real input text |
| Text selection on tap | `-webkit-tap-highlight-color: transparent`, replaced by the press feedback in §15 |

---

## 18. Layout Rhythm

- **Vertical rhythm:** all block spacing is a multiple of 4px so headings, body, and components sit
  on a shared grid.
- **Page shell:** content `max-width: 1280px`; gutters 16px (< 768px), 24px (< 1280px), 32px above.
- **Content-driven grids.** The marketplace grid is defined by what a product card needs to be
  legible — `repeat(auto-fill, minmax(220px, 1fr))` — not by forcing content into a generic
  12-column system. The 12-column grid is used only in the admin surfaces, where forms genuinely
  need shared alignment.
- **Optical alignment beats grid alignment.** Where a strict grid produces a visibly wrong result,
  the eye wins and the exception is commented in code.

---

## 19. Benchmark Calibration

Named references, so "world-class" is measurable rather than a feeling. `docs/design-review-log.md`
(Prompt 1.10) compares real screens against these and is re-run after Phases 4, 5, and 11.

| Reference | Take | **Do NOT take** |
| :--- | :--- | :--- |
| **Stripe Dashboard** | Data density with breathing room; form and input craft; error message tone | Its restrained palette — a marketplace needs more commercial energy than a developer tool |
| **Linear** | Motion choreography; command palette; keyboard-first interaction; dark theme construction | Its dark-first identity and low-contrast greys — Explooro is light-first and higher contrast for outdoor mobile use |
| **Vercel** | Typographic restraint; spacing discipline; confident use of whitespace | Its near-monochrome minimalism — insufficient signalling for commerce (badges, urgency, margin) |
| **Shopify Polaris** | Commerce interaction patterns; empty states; seller-facing information architecture | Its component-library visual language — heavier and more generic than our budget or aesthetic allows |
| **Amazon** | Scannability at high density; information hierarchy; letting the product photo lead | Its visual clutter, competing CTAs, and inconsistent spacing — Amazon succeeds despite this, not because of it |
| **Apple Store** | Product presentation; imagery discipline; generous product-image sizing | Its luxury pacing and enormous whitespace — wrong for a high-SKU marketplace on mobile data |
| **bKash / Pathao** | Bengali typography in real use; local UI conventions; trust signalling that works in BD | Their dated gradients and heavy shadows — the exact aesthetic §0 rules out |

### The Squint Test — required

Blur the screen until text is unreadable.

- The visual hierarchy must still be obvious.
- The primary action must still be the most prominent element.
- Groups must still read as groups.

If everything looks equally important, the hierarchy has failed and no amount of colour or polish
will fix it. This test is run on the marketplace home, product detail, and checkout before any of
them is considered complete.

---

## Implementation Checklist for Prompt 1.1

- [ ] `tokens.css` — all non-colour primitives from §4, §5, §6, §7, §8, §9
- [ ] `themes.css` — semantic colours defined **four** times: `:root` (light),
      `@media (prefers-color-scheme: dark) :root:not([data-theme='light'])`,
      `:root[data-theme='dark']`, `:root[data-theme='light']`
- [ ] OKLCH values with `@supports` hex fallback
- [ ] Neutral ramp carries non-zero chroma — a chroma of 0 is a defect
- [ ] Shadow colour derived from surface hue, never black
- [ ] Zero gradients, zero `backdrop-filter` in these two files
- [ ] `prefers-reduced-motion` block present
- [ ] `:lang(bn)` line-height and tracking overrides present
- [ ] No hex value anywhere outside these two files
