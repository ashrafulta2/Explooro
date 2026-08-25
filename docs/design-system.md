# Explooro — Design System Specification

> **Produced by:** Prompt 0.2
> **Implemented by:** Prompt 1.1 (`tokens.css`, `themes.css`), Prompt 1.2 (typography), Prompt 1.10 (craft layer)
> **Status:** Authoritative. Where this document and any implementation disagree, this document wins.
>
> Every colour value in §1 and every contrast figure in §2 is emitted by
> `node scripts/palette.mjs`, which drives the same OKLCH engine the product ships
> (`client/src/services/colorRamp.js`). They are **measured**, not estimated, and they describe
> the palette the product actually boots with — `client/src/styles/themes.css` is generated from
> the same source, and a test fails if it drifts. Re-run that command after any change to the
> master seed and paste its output back into §1.2–§2.

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

All ramps are computed in **OKLCH**, not HSL and not hand-picked hex.

In HSL, `hsl(60 100% 50%)` (yellow) and `hsl(240 100% 50%)` (blue) claim the same 50% lightness but
are wildly different to the eye. A ramp built that way has uneven steps — the 400 and 500 look
identical in one hue and jump violently in another. OKLCH lightness is perceptually uniform, so
**one step is one step in every hue.** This single choice is most of the difference between a
palette that looks designed and one that looks picked.

Two consequences that the implementation must respect:

- **Chroma peaks in the middle of every ramp and falls off at both ends.** The sRGB gamut narrows
  at very light and very dark lightnesses; holding chroma constant pushes colours out of gamut and
  the browser silently clips them. The generator gamut-maps every step into sRGB by reducing
  chroma until it fits, so an out-of-gamut value cannot reach the CSS — including for a seed an
  operator picks at runtime, which is when hand-checking would no longer be possible.
- **Lightness steps compress at the light end.** The perceptual distance between 97% and 94% is
  larger than the numbers suggest, so the top of each ramp uses smaller increments.

Emitted format, with an sRGB fallback for older engines:

```css
:root { --brand-700: #788dac; }
@supports (color: oklch(0 0 0)) {
  :root { --brand-700: oklch(63.82% 0.0527 258.01); }
}
```

Neither value is typed by hand. `scripts/palette.mjs --write` emits both, and it raises the OKLCH
precision until the triplet re-renders to *exactly* the hex above it — so the fallback and the
override are provably the same pixel rather than two roundings of the same intention.

### 1.2 Brand ramp — generated from one seed

**The brand ramp is not authored. It is a function of a single seed colour.**

`client/src/services/colorRamp.js` takes the seed, finds which rung of the lightness ladder it sits
closest to, pins it there, and derives the other eleven steps around it. The ladder itself — the
per-step lightness and chroma envelope below — is the part that was designed by hand, once, and it
is a **contrast contract**, not a look: it guarantees that some step will clear 4.5:1 for link text
and some step will clear 3:1 for an input boundary no matter which seed an operator picks.

> **What changed and why.** The ramp was Coral, then Pink (five client-supplied swatches at hue
> 344), and each of those was ~200 hex values typed into `themes.css` by hand. That made re-theming
> impossible in practice — components reference raw ramp steps in ~199 places, so a Theme Studio
> that repainted 33 semantic roles left almost everything the old colour. Since the Master Colour
> engine landed, the ramp is generated; `themes.css` is its **output**, regenerated by
> `node scripts/palette.mjs --write`, and hand-editing a step there is a test failure
> (`client/test/colorRamp.test.js`).

The shipped default seed is **`#334155` — Midnight Slate**, a near-monochrome cool slate. It
anchors at step **950**, so the ladder above it is a long, quiet run of tints and the brand fill
sits near the ramp floor rather than in its middle — the opposite shape to a mid-tone seed.

| Step | OKLCH | Hex | Role for THIS seed |
| :--- | :--- | :--- | :--- |
| 50 | `oklch(97.89% 0.0029 264.54)` | `#f7f8fa` | Lightest wash |
| 100 | `oklch(95.45% 0.0046 258.32)` | `#eef0f3` | Selected row |
| 200 | `oklch(92.88% 0.0126 255.51)` | `#e2e8f0` | Badge background |
| 300 | `oklch(87.65% 0.0216 259.19)` | `#ced7e5` | Reserved |
| 400 | `oklch(82.25% 0.0303 257.77)` | `#b9c6d9` | Reserved |
| 500 | `oklch(76.79% 0.0393 256.99)` | `#a4b5cd` | Reserved |
| 600 | `oklch(71% 0.0482 257.61)` | `#8fa3c0` | **Dark theme: `--brand`, `--text-brand`, `--brand-alt`** |
| 700 | `oklch(63.82% 0.0527 258.01)` | `#788dac` | **Dark theme: `--brand-hover`, `--focus-ring`** |
| 800 | `oklch(56.1% 0.0544 258)` | `#617695` | **Light theme: `--brand-active`.** Dark theme: `--brand-active` |
| 900 | `oklch(46.61% 0.0486 256.34)` | `#485b75` | **Light theme: `--brand-hover`, `--text-brand`, `--brand-alt`** |
| 950 | `oklch(37.17% 0.0392 257.29)` | `#334155` | **Light theme: `--brand`, `--focus-ring`** — the seed itself |
| 1000 | `oklch(36.02% 0.0299 256.23)` | `#333e4d` | Reserved (ramp floor) |

> **Which step plays which role is decided per seed, never fixed.** Slate anchors at 950 and takes
> white ink; the Pink preset anchored at 500 and took near-black ink. `--text-brand` is always the
> *shallowest* step clearing 4.5:1 on the canvas, `--border-interactive` the shallowest clearing
> 3:1, and `--brand-contrast` is measured against the fill rather than assumed. That is why the
> "Role" column above is annotated *for this seed* — read it as output, not as specification.

### 1.2.1 Why the default is near-monochrome

Slate carries almost no chroma (0.039 at the seed), which is a deliberate commerce decision, not a
lack of one: on a marketplace page the colour that should be loudest is the product photography,
and the chrome that surrounds it competes with every thumbnail it frames. A near-neutral shell also
survives the thing a branded-storefront product does constantly — putting a seller's own colours on
the page — without two brand hues fighting.

The alternates ship in `client/src/config/master-themes.js`, `explooro_pink` (the previous identity)
among them. Switching is one seed, not a palette.

### 1.3 Neutral ramp — hue 257.3, tracking the seed

**The neutral ramp carries chroma 0.0026 – 0.0159. It is never pure grey.**

Pure `#888` grey is the single most reliable signal that an interface was assembled rather than
designed. The tint is small enough that no user could name it and large enough that its absence
is felt.

Its hue comes from `neutralMode`, one of the master settings:

| `neutralMode` | Neutral hue | When it is right |
| :--- | :--- | :--- |
| `cool` | fixed 242.5 | A vivid brand far from blue — keeps greys reading as grounds, not as a washed-out tint of the brand |
| `match` | the seed's hue | **The shipped default.** Coherent when the brand is itself near-neutral, as slate is |
| `complement` | seed + 180° | Maximum separation, for a brand that would otherwise swallow the greys |

> The shipped default uses `match`, so neutrals and brand share hue 257.3. That is safe *here*
> precisely because the seed is desaturated — the two ramps differ in chroma, not in family. A vivid
> seed on `match` would tint every surface toward the brand, which is why the setting exists rather
> than being hardcoded.

| Step | OKLCH | Hex | Light theme | Dark theme |
| :--- | :--- | :--- | :--- | :--- |
| 0 | `oklch(99.16% 0.0026 286.35)` | `#fcfcfe` | **surface-1** (card), **text-inverse**, **navbar-bg**, **brand-contrast** | — |
| 50 | `oklch(97.89% 0.0029 264.54)` | `#f7f8fa` | **surface-0** (page) | — |
| 100 | `oklch(96.05% 0.0046 258.32)` | `#f0f2f5` | **surface-2** (raised), **navbar-search-bg** | **text-primary**, **flash-text** |
| 200 | `oklch(92.08% 0.0063 255.48)` | `#e2e5e9` | **surface-3** (sunken), **border-subtle** | — |
| 300 | `oklch(85.98% 0.0076 260.73)` | `#ced1d6` | **border-strong** | **text-secondary** |
| 400 | `oklch(73.98% 0.0097 258.34)` | `#a7abb1` | **footer-muted** | **text-muted**, **footer-muted** |
| 500 | `oklch(62.15% 0.0121 256.72)` | `#82878e` | — | — |
| 600 | `oklch(51.92% 0.014 259.82)` | `#646971` | **text-muted**, **border-interactive** | **border-interactive** |
| 700 | `oklch(42.15% 0.0154 255.59)` | `#484e56` | **text-secondary** | **surface-3**, **border-strong** |
| 800 | `oklch(31.95% 0.0159 259.8)` | `#2e333b` | **footer-border** | **surface-2**, **border-subtle**, **footer-border** |
| 900 | `oklch(24.11% 0.0137 253.09)` | `#1b2026` | **text-primary**, **footer-bg** | **surface-1**, **navbar-bg**, **flash-chip-bg** |
| 950 | `oklch(18.08% 0.0139 258.36)` | `#0e1218` | — | **surface-0** (page), **brand-contrast**, **text-inverse** |
| 1000 | `oklch(12.84% 0.0129 263.62)` | `#05070c` | — | **footer-bg** |

> **`surfaceWash` and `borderTint` are off by default**, so surfaces and borders sit on the neutral
> ramp. With both on (the Pink era, and any preset that enables them) `surface-0`/`surface-1` move
> to brand-50/100 and the three border tokens move onto the brand ramp. `surface-2`/`surface-3`
> stay neutral in either case: tinting those too would leave nothing to separate a sunken well from
> the borders sitting on it.

### 1.4 Semantic ramps

Status ramps keep their own meaning-bearing hue — green is success, red is danger, in every theme —
but inherit the master's **chroma energy**, and optionally lean their hue toward the seed by
`statusPull` (0 by default: hues below are untouched). WHY inherit anything at all: six ramps at
full authored saturation beside a desaturated brand read as six unrelated palettes stapled together.

Scaling chroma moves luminance, so the two pairings that actually render — `700`-on-`50` in light
and `300`-on-`800` in dark — are re-measured and **repaired** after scaling rather than trusted.
Every figure in §2 is the result of that repair, not of the authored source values.

#### success — hue 150

| Step | OKLCH | Hex |
| :--- | :--- | :--- |
| 50 | `oklch(96.04% 0.02 150.1)` | `#e9f6eb` |
| 100 | `oklch(87.79% 0.0465 150.07)` | `#c2e0c7` |
| 300 | `oklch(81.08% 0.0896 150.3)` | `#97d2a3` |
| 500 | `oklch(62.03% 0.1059 149.58)` | `#549863` |
| 700 | `oklch(51.89% 0.0892 150.39)` | `#3f774d` |
| 800 | `oklch(42.02% 0.0712 150.11)` | `#2e5838` |

#### warning — hue 75

| Step | OKLCH | Hex |
| :--- | :--- | :--- |
| 50 | `oklch(95.97% 0.0231 75.86)` | `#fbf0e1` |
| 100 | `oklch(88.04% 0.0612 76.6)` | `#efd3ab` |
| 300 | `oklch(83.23% 0.1054 74.28)` | `#f1be78` |
| 500 | `oklch(65.96% 0.1058 74.74)` | `#b88841` |
| 700 | `oklch(52.79% 0.084 75.92)` | `#87642e` |
| 800 | `oklch(44.01% 0.0668 75.26)` | `#684d25` |

#### danger — hue 29

| Step | OKLCH | Hex |
| :--- | :--- | :--- |
| 50 | `oklch(96.02% 0.0122 29.87)` | `#faefed` |
| 100 | `oklch(90.05% 0.0354 28.67)` | `#f5d6d1` |
| 300 | `oklch(79.64% 0.0863 29.79)` | `#efa89c` |
| 500 | `oklch(62.97% 0.1947 28.89)` | `#e74b3d` |
| 700 | `oklch(53.11% 0.1643 29.13)` | `#b83a2e` |
| 800 | `oklch(41.89% 0.113 29.14)` | `#7f2f26` |

> `danger-300` and `danger-800` do double duty as the **flash-sale strip** (`--flash-bg`,
> `--flash-tag-bg`): urgency reads red across both locales we ship. The ink on them is *measured*,
> not fixed — see §2 — because `statusPull` can move that ramp's luminance.

#### info — hue 250

| Step | OKLCH | Hex |
| :--- | :--- | :--- |
| 50 | `oklch(96.09% 0.012 247.95)` | `#ecf3fa` |
| 100 | `oklch(89.9% 0.0354 250.87)` | `#cde0f5` |
| 300 | `oklch(83.08% 0.0747 249.95)` | `#a3ccf7` |
| 500 | `oklch(63.89% 0.1099 250.28)` | `#5590cc` |
| 700 | `oklch(52.63% 0.1092 249.98)` | `#336ea7` |
| 800 | `oklch(43.98% 0.086 250.39)` | `#2a5580` |

#### accent — hue 77.3 (`complement` of the seed)

Reserved for commercial urgency only: flash-sale countdowns, profit margin badges, coin balances.
It must never be used for general UI, or it stops signalling anything. Its hue follows
`accentHarmony` (`complement` / `analogous` / `triad` / `mono`), so it stays in relation to the
brand rather than being a fixed amber.

| Step | OKLCH | Hex |
| :--- | :--- | :--- |
| 50 | `oklch(96.03% 0.0136 78.26)` | `#f7f1e8` |
| 100 | `oklch(90.1% 0.0326 76.43)` | `#ebdcc7` |
| 200 | `oklch(82.01% 0.0549 76.11)` | `#d9c09d` |
| 300 | `oklch(74.08% 0.0709 77.98)` | `#c4a678` |
| 400 | `oklch(66% 0.0674 76.38)` | `#aa8d63` |
| 500 | `oklch(57.98% 0.058 76.61)` | `#8e7653` |
| 600 | `oklch(50.03% 0.0481 76.96)` | `#736044` |
| 700 | `oklch(42.1% 0.0389 78.65)` | `#594b35` |

### 1.5 Shadows are tinted, never black

```css
/* WRONG — muddy over a tinted surface */
--shadow-1: 0 1px 2px rgb(0 0 0 / 0.08);
/* RIGHT — shadow inherits the surface hue at low lightness, high-ish chroma */
--shadow-color: 213deg 14% 14%;
--shadow-1: 0 1px 2px hsl(var(--shadow-color) / 0.08);
```

A pure-black shadow desaturates whatever it falls on. A hue-matched shadow reads as the surface
being lit rather than smudged. Only the **hue** is taken from the generated neutral ramp; the
saturation and lightness stay at the values tuned here, so a re-theme can never turn a shadow into
a coloured smear.

### 1.6 Dark theme is designed, not inverted

Three rules that a naive inversion violates:

1. **Surfaces get LIGHTER as elevation increases** (950 → 900 → 800 → 700). In the physical model
   dark mode borrows from, a raised surface catches more light. Inverting the light-theme ladder
   makes raised cards *darker*, which reads as holes rather than cards.
2. **Chroma is reduced** on semantic colours. Saturated colour on a dark field vibrates.
3. **`#000` and `#fff` are forbidden** as surface or text values. Pure black crushes shadow detail
   and causes OLED smearing on scroll; pure white on near-black causes halation. Use
   `neutral-950` and `neutral-100`.

A fourth, which the generator enforces rather than documents: `--brand` in dark takes the **deepest**
ramp step still clearing 6:1 on the dark canvas, not the shallowest that passes. Searching from the
light end always stops early and leaves every dark-mode button washed out.

### 1.7 Token naming

Components reference **semantic** tokens only. A component that names `--brand-700` directly cannot
be re-themed by the Theme Studio — and that is not a style rule, it is the defect the Master Colour
engine had to be built to work around.

```
--surface-0/1/2/3                --text-primary/secondary/muted/inverse
--border-subtle/strong/interactive/default
--brand / --brand-hover / --brand-active / --brand-contrast
--text-brand / --brand-alt / --brand-alt-contrast
--success / --success-bg / --success-border    (and the same triad for warning, danger, info)
--flash-bg / --flash-text / --flash-chip-bg / --flash-tag-bg / --flash-tag-text
--navbar-bg/text/border/search-bg              --footer-bg/text/muted/border
--scrim  --focus-ring  --shadow-color
```

---

## 2. Contrast — Measured

All figures below are computed WCAG 2.1 ratios, emitted by `node scripts/palette.mjs` against the
**shipped default palette**. APCA `Lc` is reported alongside because WCAG 2 is known to misjudge
mid-tone pairs; where the two disagree, investigate rather than trusting either blindly. Target:
**AA minimum (4.5:1 body, 3:1 large text and non-text UI).**

Every gated pairing below passes. The pink palette this replaced shipped with three accepted
failures (the primary fill and focus ring at 1.86:1 against the canvas, plus the switch track);
only the switch track remains, and it is a component decision rather than a palette one — see below.

### Light theme

| Pairing | Colours | Ratio | AA | APCA Lc |
| :--- | :--- | :--- | :--- | :--- |
| text-primary on surface-0 | `#1b2026` on `#f7f8fa` | **15.42:1** | ✅ | 99.1 |
| text-primary on surface-2 | `#1b2026` on `#f0f2f5` | **14.61:1** | ✅ | 95.5 |
| text-secondary on surface-0 | `#484e56` on `#f7f8fa` | **7.91:1** | ✅ | 84.8 |
| text-muted on surface-0 | `#646971` on `#f7f8fa` | **5.20:1** | ✅ | 73.4 |
| text-brand on surface-0 | `#485b75` on `#f7f8fa` | **6.52:1** | ✅ | 79.7 |
| brand-contrast on brand (button) | `#fcfcfe` on `#334155` | **10.11:1** | ✅ | -96.1 |
| brand-contrast on brand-hover | `#fcfcfe` on `#485b75` | **6.77:1** | ✅ | -87.0 |
| brand-alt-contrast on brand-alt | `#fcfcfe` on `#485b75` | **6.77:1** | ✅ | -87.0 |
| navbar-text on navbar-bg | `#1b2026` on `#fcfcfe` | **16.00:1** | ✅ | 101.6 |
| footer-text on footer-bg | `#fcfcfe` on `#1b2026` | **16.00:1** | ✅ | -103.9 |
| footer-muted on footer-bg | `#a7abb1` on `#1b2026` | **7.11:1** | ✅ | -54.5 |
| success text on success-bg | `#3f774d` on `#e9f6eb` | **4.76:1** | ✅ | 68.8 |
| warning text on warning-bg | `#87642e` on `#fbf0e1` | **4.79:1** | ✅ | 68.7 |
| danger text on danger-bg | `#b83a2e` on `#faefed` | **5.06:1** | ✅ | 69.3 |
| info text on info-bg | `#336ea7` on `#ecf3fa` | **4.78:1** | ✅ | 68.6 |
| danger text on surface-0 | `#b83a2e` on `#f7f8fa` | **5.37:1** | ✅ | 73.2 |
| success text on surface-0 | `#3f774d` on `#f7f8fa` | **4.99:1** | ✅ | 72.0 |
| flash-text on flash-bg | `#1b2026` on `#efa89c` | **8.39:1** | ✅ | 63.8 |
| flash-text on flash-chip-bg | `#1b2026` on `#fcfcfe` | **16.00:1** | ✅ | 101.6 |
| flash-tag-text on flash-tag-bg | `#fcfcfe` on `#7f2f26` | **8.77:1** | ✅ | -92.5 |
| border-interactive on surface-0 | `#646971` on `#f7f8fa` | **5.20:1** | ✅ | 73.4 |
| focus-ring on surface-0 | `#334155` on `#f7f8fa` | **9.74:1** | ✅ | 89.8 |
| brand fill on surface-0 | `#334155` on `#f7f8fa` | **9.74:1** | ✅ | 89.8 |
| border-subtle on surface-0 | `#e2e5e9` on `#f7f8fa` | 1.19:1 | decorative only | 8.9 |
| border-strong on surface-0 | `#ced1d6` on `#f7f8fa` | 1.44:1 | decorative only | 20.4 |
| switch track off on surface-0 | `#e2e5e9` on `#f7f8fa` | 1.19:1 | decorative only | 8.9 |

### Dark theme

| Pairing | Colours | Ratio | AA | APCA Lc |
| :--- | :--- | :--- | :--- | :--- |
| text-primary on surface-0 | `#f0f2f5` on `#0e1218` | **16.74:1** | ✅ | -98.6 |
| text-primary on surface-2 | `#f0f2f5` on `#2e333b` | **11.33:1** | ✅ | -93.4 |
| text-secondary on surface-0 | `#ced1d6` on `#0e1218` | **12.26:1** | ✅ | -78.0 |
| text-muted on surface-0 | `#a7abb1` on `#0e1218` | **8.14:1** | ✅ | -56.0 |
| text-brand on surface-0 | `#8fa3c0` on `#0e1218` | **7.30:1** | ✅ | -51.1 |
| brand-contrast on brand (button) | `#0e1218` on `#8fa3c0` | **7.30:1** | ✅ | 53.0 |
| brand-contrast on brand-hover | `#0e1218` on `#788dac` | **5.55:1** | ✅ | 42.0 |
| brand-alt-contrast on brand-alt | `#0e1218` on `#8fa3c0` | **7.30:1** | ✅ | 53.0 |
| navbar-text on navbar-bg | `#f0f2f5` on `#1b2026` | **14.61:1** | ✅ | -97.2 |
| footer-text on footer-bg | `#f0f2f5` on `#05070c` | **17.97:1** | ✅ | -99.1 |
| footer-muted on footer-bg | `#a7abb1` on `#05070c` | **8.73:1** | ✅ | -56.5 |
| success text on success-bg | `#97d2a3` on `#2e5838` | **4.70:1** | ✅ | -56.0 |
| warning text on warning-bg | `#f1be78` on `#684d25` | **4.62:1** | ✅ | -56.6 |
| danger text on danger-bg | `#efa89c` on `#7f2f26` | **4.60:1** | ✅ | -51.5 |
| info text on info-bg | `#a3ccf7` on `#2a5580` | **4.63:1** | ✅ | -56.9 |
| danger text on surface-0 | `#efa89c` on `#0e1218` | **9.61:1** | ✅ | -64.4 |
| success text on surface-0 | `#97d2a3` on `#0e1218` | **10.79:1** | ✅ | -70.6 |
| flash-text on flash-bg | `#f0f2f5` on `#7f2f26` | **8.01:1** | ✅ | -85.7 |
| flash-text on flash-chip-bg | `#f0f2f5` on `#1b2026` | **14.61:1** | ✅ | -97.2 |
| flash-tag-text on flash-tag-bg | `#f0f2f5` on `#7f2f26` | **8.01:1** | ✅ | -85.7 |
| border-interactive on surface-0 | `#646971` on `#0e1218` | **3.40:1** | ✅ | -23.6 |
| focus-ring on surface-0 | `#788dac` on `#0e1218` | **5.55:1** | ✅ | -39.8 |
| brand fill on surface-0 | `#8fa3c0` on `#0e1218` | **7.30:1** | ✅ | -51.1 |
| border-subtle on surface-0 | `#2e333b` on `#0e1218` | 1.48:1 | decorative only | -3.6 |
| border-strong on surface-0 | `#484e56` on `#0e1218` | 2.24:1 | decorative only | -12.7 |
| switch track off on surface-0 | `#484e56` on `#0e1218` | 2.24:1 | decorative only | -12.7 |

### Two rules this table implies

1. **`border-subtle` and `border-strong` are decorative separators only.** They may never be the
   sole indicator of an interactive boundary. Inputs, selects, and textareas use
   `--border-interactive` (5.20:1 light / 3.40:1 dark ✅).
2. **A switch's off-state track is `surface-3` and therefore fails 1.4.11 on its own** (1.19:1
   light, 2.24:1 dark). The switch must carry a `--border-interactive` outline so its boundary is
   perceivable regardless of track fill — `components/forms.css` does. Do not solve this by
   darkening the track; that makes off look like on.

> **These numbers describe one palette, and an operator can publish another.** They are not the
> guarantee — the guarantee is that `validatePaletteContrast()` (client) and `runContrastChecks()`
> (server) re-measure every pairing on write and reject a palette that fails, and that
> `client/test/colorRamp.test.js` runs the same gate across 44 seed×variant combinations so the
> generator cannot produce a failing palette in the first place.

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
- [ ] `themes.css` — **generated**, never hand-written: `node scripts/palette.mjs --write`.
      Semantic colours defined **four** times: `:root` (light),
      `@media (prefers-color-scheme: dark) :root:not([data-theme='light'])`,
      `:root[data-theme='dark']`, `:root[data-theme='light']`
- [ ] OKLCH values with `@supports` hex fallback
- [ ] Neutral ramp carries non-zero chroma — a chroma of 0 is a defect
- [ ] Shadow colour derived from surface hue, never black
- [ ] Zero gradients, zero `backdrop-filter` in these two files
- [ ] `prefers-reduced-motion` block present
- [ ] `:lang(bn)` line-height and tracking overrides present
- [ ] No hex value anywhere outside these two files
