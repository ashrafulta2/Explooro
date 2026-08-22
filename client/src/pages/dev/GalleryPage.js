/**
 * GalleryPage — `/dev/gallery`, the permanent visual workbench (Prompt 1.8).
 *
 * DEV-only: main.js only registers this route's dynamic `import()` inside an
 * `import.meta.env.DEV` branch, which Vite replaces with the literal `false` in a production
 * build — Rollup then dead-code-eliminates the whole branch, including the `import()` call, so
 * this module (and gallery-registry.js, and gallery.css below) never ends up in a production
 * chunk. ACCEPTANCE: "`npm run build` output contains no gallery code."
 *
 * Three moving parts:
 *  1. A global controls bar (theme / language / density / simulated viewport width / role
 *     impersonation) that drives the REAL surrounding app shell rather than a second fake one —
 *     theme and density are the same `data-theme`/`data-density` attributes TopBar and tokens.css
 *     already read, and the role dropdown calls the same `setMockRole()` Prompt 1.7's DevShellSwitcher
 *     uses, so the live Sidebar/TopBar/MobileNav wrapping this very page updates in place. This is
 *     what fulfils 1.7's PREVIEW note ("a role switcher in /dev/gallery lets the developer preview
 *     all six role shells live") without building a second, throwaway shell renderer.
 *  2. A left nav + main content area walking `gallery-registry.js`'s explicit list — every
 *     component from 1.3/1.4 renders every state, always, no per-item toggle needed.
 *  3. Two live panels — a design-token inspector and a WCAG AA contrast checker — that read
 *     resolved values via `getComputedStyle` rather than a hardcoded snapshot, and re-render
 *     whenever theme/density changes (color/spacing values are otherwise just cached strings).
 *
 * Language changes are NOT handled locally: main.js's `subscribeLang(() => router.refresh())`
 * already tears down and rebuilds whatever page is mounted — including this one — on every
 * `setLanguage()` call, the same as any other route. The cleanup this module returns exists for
 * exactly that teardown: Modal/Drawer specimens attach nodes to `document.body` (outside this
 * page's own subtree), so they have to be removed explicitly or they'd pile up across remounts.
 */
import '../../styles/components/gallery.css';
import { buildGalleryEntries } from './gallery-registry.js';
import { appStore, setMockRole, logOutMock } from '../../state/appStore.js';
import { NAV_ROLES } from '../../config/navigation.js';
import { getRoleMeta } from '../../config/permissions.mock.js';
import { getLanguage, setLanguage } from '../../services/i18n.js';
import { getTheme, applyTheme, THEME_OPTIONS } from '../../services/theme.js';

const DENSITY_KEY = 'explooro:density';
const DENSITY_OPTIONS = ['comfortable', 'compact'];
const VIEWPORT_PRESETS = [
  { label: 'Full', value: null },
  { label: '360px', value: 360 },
  { label: '768px', value: 768 },
  { label: '1280px', value: 1280 },
];

function getDensity() {
  try {
    return localStorage.getItem(DENSITY_KEY) ?? 'comfortable';
  } catch {
    return 'comfortable';
  }
}

function applyDensity(density) {
  if (density === 'compact') document.documentElement.dataset.density = 'compact';
  else delete document.documentElement.dataset.density;
  try {
    localStorage.setItem(DENSITY_KEY, density);
  } catch {
    // Private browsing — not persisted, still applies for the session.
  }
}

/* -------------------------------------------------------------------------
 * Token inspector — reads CURRENT computed values, not a hardcoded snapshot,
 * so it stays true across theme/density changes (REQUIREMENT 5).
 * ---------------------------------------------------------------------- */

const NON_COLOR_TOKEN_GROUPS = [
  { title: 'Spacing', names: Array.from({ length: 10 }, (_, i) => `--space-${i + 1}`) },
  { title: 'Radius', names: ['--radius-xs', '--radius-sm', '--radius-md', '--radius-lg', '--radius-xl', '--radius-full'] },
  { title: 'Border & elevation', names: ['--border-width', '--elevation-0', '--elevation-1', '--elevation-2', '--elevation-3', '--elevation-4'] },
  {
    title: 'Type scale',
    names: ['2xs', 'xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl'].flatMap((size) => [
      `--text-${size}`,
      `--leading-${size}`,
      `--tracking-${size}`,
      `--weight-${size}`,
    ]),
  },
  { title: 'Fonts', names: ['--font-latin', '--font-bengali', '--font-mono'] },
  { title: 'Motion', names: ['--dur-instant', '--dur-fast', '--dur-base', '--dur-slow', '--ease-out-quart', '--ease-in-quad', '--ease-spring', '--ease-standard'] },
  {
    title: 'Z-index',
    names: ['--z-base', '--z-sticky', '--z-header', '--z-drawer', '--z-dropdown', '--z-scrim', '--z-modal', '--z-palette', '--z-toast', '--z-tooltip', '--z-devtools'],
  },
  { title: 'Breakpoints', names: ['--bp-xs', '--bp-sm', '--bp-md', '--bp-lg', '--bp-xl'] },
  { title: 'Density', names: ['--row-height', '--control-height', '--density-body-size', '--card-padding'] },
];

const SEMANTIC_COLOR_TOKENS = [
  '--surface-0', '--surface-1', '--surface-2', '--surface-3',
  '--border-subtle', '--border-strong', '--border-interactive',
  '--text-primary', '--text-secondary', '--text-muted', '--text-inverse',
  '--brand', '--brand-hover', '--brand-active', '--brand-contrast',
  '--success', '--success-bg', '--success-border',
  '--warning', '--warning-bg', '--warning-border',
  '--danger', '--danger-bg', '--danger-border',
  '--info', '--info-bg', '--info-border',
  '--focus-ring', '--shadow-color', '--scrim',
];

const RAW_RAMPS = [
  { title: 'Brand', prefix: '--brand-', steps: [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950, 1000] },
  { title: 'Neutral', prefix: '--neutral-', steps: [0, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950, 1000] },
  { title: 'Success', prefix: '--success-', steps: [50, 100, 300, 500, 700, 800] },
  { title: 'Warning', prefix: '--warning-', steps: [50, 100, 300, 500, 700, 800] },
  { title: 'Danger', prefix: '--danger-', steps: [50, 100, 300, 500, 700, 800] },
  { title: 'Info', prefix: '--info-', steps: [50, 100, 300, 500, 700, 800] },
  { title: 'Accent', prefix: '--accent-', steps: [50, 100, 200, 300, 400, 500, 600, 700] },
];

/* Contrast pairs actually used together in the product (checked against every `color:`/
 * `background:` declaration in styles/components/*.css) — text roles on the surfaces they sit on,
 * plus the filled-background pairs (brand/status) components render text directly on top of.
 * `--surface-3` is deliberately excluded from the `--text-muted` cross product: it backs only
 * transient/pressed surfaces (button active state, skeleton sheen, tooltip, badge pills) that pair
 * with `--text-primary`/`--text-secondary` — no component ever puts muted caption text on it, so
 * testing that combination would report a token pairing the UI never renders. */
const CONTRAST_PAIRS = [
  ...['--text-primary', '--text-secondary'].flatMap((fg) =>
    ['--surface-0', '--surface-1', '--surface-2', '--surface-3'].map((bg) => ({ fg, bg }))
  ),
  ...['--surface-0', '--surface-1', '--surface-2'].map((bg) => ({ fg: '--text-muted', bg })),
  { fg: '--brand-contrast', bg: '--brand' },
  { fg: '--success', bg: '--success-bg' },
  { fg: '--warning', bg: '--warning-bg' },
  { fg: '--danger', bg: '--danger-bg' },
  { fg: '--info', bg: '--info-bg' },
];

function computedVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

let rgbCanvasCtx = null;

/** Resolves a custom property to its 0–255 sRGB triplet. `getComputedStyle` does NOT reliably
 * serialise to `rgb()` — modern Chromium preserves whatever colour function the value resolved
 * through, e.g. `oklch(...)` for tokens.css's `@supports (color: oklch(...))` ramp (verified live:
 * `getComputedStyle` on `--text-primary` returned the literal string `"oklch(0.24 0.015 242.5)"`,
 * which silently broke an earlier `rgb\((...)\)`-regex version of this function — every pairing
 * came back "unresolved" with zero contrast-checker errors, since unresolved pairs are excluded
 * from the failure count rather than counted as one). A 1×1 canvas sidesteps the format entirely:
 * `fillStyle` accepts any CSS color the browser can parse, and `getImageData` always reads back
 * sRGB 0–255 integers — the same space WCAG's relative-luminance formula is defined in. */
function resolvedRgb(name) {
  const probe = document.createElement('div');
  probe.style.color = `var(${name})`;
  probe.style.display = 'none';
  document.body.append(probe);
  const raw = getComputedStyle(probe).color;
  probe.remove();

  if (!rgbCanvasCtx) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    rgbCanvasCtx = canvas.getContext('2d', { willReadFrequently: true });
  }
  rgbCanvasCtx.clearRect(0, 0, 1, 1);
  rgbCanvasCtx.fillStyle = '#000';
  rgbCanvasCtx.fillStyle = raw;
  rgbCanvasCtx.fillRect(0, 0, 1, 1);
  const [r, g, b] = rgbCanvasCtx.getImageData(0, 0, 1, 1).data;
  return { r, g, b };
}

function relativeLuminance({ r, g, b }) {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(rgb1, rgb2) {
  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

/** Wraps wide content (tables of token names/values) so it scrolls within its own box instead of
 * pushing the whole page into horizontal overflow at narrow widths — token names don't truncate
 * gracefully, so scroll is the right tradeoff here, not shrink-to-fit. */
function scrollWrap(node) {
  const wrap = document.createElement('div');
  wrap.className = 'table-scroll';
  wrap.append(node);
  return wrap;
}

function swatch(name, resolvedText) {
  const el = document.createElement('div');
  el.className = 'token-swatch';
  const box = document.createElement('div');
  box.className = 'token-swatch__box';
  box.style.background = `var(${name})`;
  const caption = document.createElement('p');
  caption.className = 'token-swatch__caption';
  caption.innerHTML = `<code>${name}</code><span>${resolvedText}</span>`;
  el.append(box, caption);
  return el;
}

function renderTokenInspector() {
  const section = document.createElement('div');
  section.className = 'token-inspector';

  const colorHeading = document.createElement('h3');
  colorHeading.className = 'spec__subgroup';
  colorHeading.textContent = 'Semantic colour tokens';
  section.append(colorHeading);

  const semanticGrid = document.createElement('div');
  semanticGrid.className = 'token-swatch-grid';
  for (const name of SEMANTIC_COLOR_TOKENS) {
    semanticGrid.append(swatch(name, computedVar(name)));
  }
  section.append(semanticGrid);

  for (const ramp of RAW_RAMPS) {
    const heading = document.createElement('h3');
    heading.className = 'spec__subgroup';
    heading.textContent = `${ramp.title} ramp`;
    section.append(heading);
    const grid = document.createElement('div');
    grid.className = 'token-swatch-grid';
    for (const step of ramp.steps) {
      const name = `${ramp.prefix}${step}`;
      grid.append(swatch(name, computedVar(name)));
    }
    section.append(grid);
  }

  for (const group of NON_COLOR_TOKEN_GROUPS) {
    const heading = document.createElement('h3');
    heading.className = 'spec__subgroup';
    heading.textContent = group.title;
    section.append(heading);

    const table = document.createElement('table');
    table.className = 'token-table';
    const body = document.createElement('tbody');
    for (const name of group.names) {
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      tdName.innerHTML = `<code>${name}</code>`;
      const tdValue = document.createElement('td');
      tdValue.textContent = computedVar(name) || '—';
      tr.append(tdName, tdValue);
      body.append(tr);
    }
    table.append(body);
    section.append(scrollWrap(table));
  }

  return section;
}

function renderContrastChecker() {
  const section = document.createElement('div');
  section.className = 'contrast-checker';

  const intro = document.createElement('p');
  intro.className = 'text-sm text-muted';
  intro.textContent =
    'WCAG AA for normal text requires 4.5:1. Every pairing below is one this UI actually renders text on.';
  section.append(intro);

  const table = document.createElement('table');
  table.className = 'token-table contrast-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Foreground</th><th>Background</th><th>Ratio</th><th>AA</th></tr>';
  const body = document.createElement('tbody');

  let failures = 0;
  for (const { fg, bg } of CONTRAST_PAIRS) {
    const fgRgb = resolvedRgb(fg);
    const bgRgb = resolvedRgb(bg);
    const tr = document.createElement('tr');
    if (!fgRgb || !bgRgb) {
      tr.innerHTML = `<td><code>${fg}</code></td><td><code>${bg}</code></td><td colspan="2">unresolved</td>`;
      body.append(tr);
      continue;
    }
    const ratio = contrastRatio(fgRgb, bgRgb);
    const pass = ratio >= 4.5;
    if (!pass) failures += 1;
    const tdFg = document.createElement('td');
    tdFg.innerHTML = `<code>${fg}</code>`;
    const tdBg = document.createElement('td');
    tdBg.innerHTML = `<code>${bg}</code>`;
    const tdRatio = document.createElement('td');
    tdRatio.textContent = `${ratio.toFixed(2)}:1`;
    const tdPass = document.createElement('td');
    tdPass.textContent = pass ? 'PASS' : 'FAIL';
    tdPass.className = pass ? 'contrast-pass' : 'contrast-fail';
    tr.append(tdFg, tdBg, tdRatio, tdPass);
    body.append(tr);
  }
  table.append(thead, body);
  section.append(scrollWrap(table));

  const summary = document.createElement('p');
  summary.className = failures ? 'contrast-fail' : 'contrast-pass';
  summary.textContent = failures ? `${failures} pairing(s) below AA` : 'All pairings meet WCAG AA.';
  section.prepend(summary);

  return section;
}

/* -------------------------------------------------------------------------
 * Page assembly
 * ---------------------------------------------------------------------- */

export default function GalleryPage(root) {
  const detachedNodes = [];
  const unsubscribers = [];

  const page = document.createElement('div');
  page.className = 'gallery-page';

  const heading = document.createElement('div');
  heading.className = 'gallery-page__heading';
  heading.innerHTML =
    '<h1>Component Gallery</h1><p class="text-sm text-muted">The living visual reference for every component built from Prompt 1.3 onward. Dev-only — excluded from the production build.</p>';
  page.append(heading);

  /* ---- Layout shell created up front so control callbacks below can close over `main` ---- */
  const layout = document.createElement('div');
  layout.className = 'gallery-page__layout';

  const nav = document.createElement('nav');
  nav.className = 'gallery-page__nav';
  nav.setAttribute('aria-label', 'Gallery sections');

  const main = document.createElement('div');
  main.className = 'gallery-page__main';

  /* ---- Global controls bar (REQUIREMENT 3) ---- */
  const controls = document.createElement('div');
  controls.className = 'gallery-controls';

  function controlGroup(labelText, ...children) {
    const group = document.createElement('div');
    group.className = 'gallery-controls__group';
    const label = document.createElement('span');
    label.className = 'gallery-controls__label';
    label.textContent = labelText;
    group.append(label, ...children);
    return group;
  }

  /** A button row where exactly one option is active. Manages its own active-class state locally
   * — no need to reconstruct the surrounding controls bar on every click. */
  function segmented(options, initial, onPick, formatLabel = (o) => o) {
    const wrap = document.createElement('div');
    wrap.className = 'segmented';
    let active = initial;
    const buttons = options.map((option) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = formatLabel(option);
      btn.addEventListener('click', () => {
        active = option;
        buttons.forEach((b, i) => b.classList.toggle('is-active', options[i] === active));
        onPick(option);
      });
      return btn;
    });
    buttons.forEach((b, i) => b.classList.toggle('is-active', options[i] === active));
    wrap.append(...buttons);
    return wrap;
  }

  const themeSegmented = segmented(THEME_OPTIONS, getTheme(), (theme) => {
    applyTheme(theme);
    refreshLivePanels();
  });

  // Language — reuses the real setLanguage(); main.js's subscribeLang(() => router.refresh())
  // then remounts this whole page, so no local re-render is needed here.
  const langSegmented = segmented(
    ['en', 'bn'],
    getLanguage(),
    (lang) => setLanguage(lang),
    (o) => (o === 'en' ? 'EN' : 'বাংলা')
  );

  const densitySegmented = segmented(DENSITY_OPTIONS, getDensity(), (density) => {
    applyDensity(density);
    refreshLivePanels();
  });

  const viewportSegmented = segmented(VIEWPORT_PRESETS.map((p) => p.label), 'Full', (label) => {
    const preset = VIEWPORT_PRESETS.find((p) => p.label === label)?.value ?? null;
    main.style.maxWidth = preset ? `${preset}px` : '';
    main.classList.toggle('gallery-page__main--framed', Boolean(preset));
  });

  // Role impersonation — drives the REAL surrounding AppShell (see file header).
  const roleSelect = document.createElement('select');
  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = 'Logged out';
  roleSelect.append(noneOpt);
  for (const role of NAV_ROLES) {
    const meta = getRoleMeta(role);
    const opt = document.createElement('option');
    opt.value = role;
    opt.textContent = meta ? (getLanguage() === 'bn' ? meta.label_bn ?? role : meta.label_en ?? role) : role;
    roleSelect.append(opt);
  }
  roleSelect.value = appStore.get().auth.role ?? '';
  roleSelect.addEventListener('change', () => {
    if (roleSelect.value) setMockRole(roleSelect.value);
    else logOutMock();
  });

  controls.append(
    controlGroup('Theme', themeSegmented),
    controlGroup('Language', langSegmented),
    controlGroup('Density', densitySegmented),
    controlGroup('Viewport', viewportSegmented),
    controlGroup('Preview as role', roleSelect)
  );
  page.append(controls);

  function navLink(id, label) {
    const a = document.createElement('a');
    a.href = `#${id}`;
    a.textContent = label;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return a;
  }

  function navGroupHeading(text) {
    const h = document.createElement('p');
    h.className = 'gallery-page__nav-heading';
    h.textContent = text;
    return h;
  }

  function section(id, title, node) {
    const el = document.createElement('section');
    el.id = id;
    el.className = 'gallery-page__section';
    const h2 = document.createElement('h2');
    h2.textContent = title;
    el.append(h2, node);
    return el;
  }

  // Tools panels first.
  nav.append(navGroupHeading('Design QA'));
  nav.append(navLink('design-tokens', 'Design Tokens'));
  nav.append(navLink('contrast-checker', 'Contrast Checker'));
  const craftLink = document.createElement('a');
  craftLink.href = '/dev/craft';
  craftLink.textContent = 'Craft Audit ↗';
  nav.append(craftLink);
  main.append(
    section('design-tokens', 'Design Tokens', renderTokenInspector()),
    section('contrast-checker', 'Contrast Checker', renderContrastChecker())
  );

  // Component categories, grouped exactly as gallery-registry.js declares.
  const entries = buildGalleryEntries(detachedNodes);
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.group)) groups.set(entry.group, []);
    groups.get(entry.group).push(entry);
  }
  for (const [groupName, groupEntries] of groups) {
    nav.append(navGroupHeading(groupName));
    for (const entry of groupEntries) {
      nav.append(navLink(entry.id, entry.label));
      main.append(section(entry.id, entry.label, entry.render()));
    }
  }

  layout.append(nav, main);
  page.append(layout);
  root.append(page);

  /** The real AppShell TopBar (shown once a role is picked) is ALSO `position: sticky; top: 0`
   * (shell.css) — measuring its live height, rather than guessing a constant, is what keeps this
   * page's own sticky nav from sliding under it or leaving a gap above it. Re-runs on every
   * appStore change (a role toggle mounts/unmounts the topbar) and on resize (its height is
   * partly font/content-driven). */
  function syncStickyOffset() {
    const topbar = document.querySelector('.app-shell__topbar-slot');
    const height = topbar ? topbar.getBoundingClientRect().height : 0;
    page.style.setProperty('--gallery-sticky-offset', `calc(${height}px + var(--space-3))`);
  }
  syncStickyOffset();
  const offStoreForOffset = appStore.subscribe(syncStickyOffset);
  window.addEventListener('resize', syncStickyOffset);
  unsubscribers.push(offStoreForOffset, () => window.removeEventListener('resize', syncStickyOffset));

  /** Re-renders the two panels whose content is a point-in-time computed-style snapshot — theme
   * and density changes don't otherwise touch them (unlike the rest of the gallery, which is pure
   * CSS and updates for free). */
  function refreshLivePanels() {
    document.getElementById('design-tokens')?.replaceWith(section('design-tokens', 'Design Tokens', renderTokenInspector()));
    document.getElementById('contrast-checker')?.replaceWith(section('contrast-checker', 'Contrast Checker', renderContrastChecker()));
  }

  // A "system" theme selection tracks the OS live — refresh the panels when it flips so their
  // computed values never go stale while the developer is looking at them.
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onMediaChange = () => {
    if (getTheme() === 'system') refreshLivePanels();
  };
  media.addEventListener('change', onMediaChange);
  unsubscribers.push(() => media.removeEventListener('change', onMediaChange));

  return function cleanup() {
    unsubscribers.forEach((u) => u());
    detachedNodes.forEach((n) => n.remove());
  };
}
