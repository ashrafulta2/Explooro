/**
 * scripts/macos-pages.mjs — generates client/src/styles/ui-macos-pages.css.
 *
 * Run:  node scripts/macos-pages.mjs           print what each page sheet contributes
 *       node scripts/macos-pages.mjs --write   regenerate client/src/styles/ui-macos-pages.css
 *
 * WHY generated rather than hand-written: the macOS component style (services/uiStyle.ts) reshapes
 * the shared components by hand in ui-macos.css, but ~70 page sheets draw their own buttons,
 * cards, labels and focus rings. Hand-copying ~1,300 of their rules would fork them: the day a
 * page sheet changes, its Mac twin silently stops matching. Here every page rule is read where it
 * lives and only the parts that read as "not Mac" get a twin:
 *
 *   uppercase      text-transform: uppercase → none (Mac labels are never shouted)
 *   heavy          font-weight 800/900 → 700 (SF has no UI use for black weights)
 *   button weight  a button's 600/700 → medium (Mac push buttons are not bold)
 *   capsule button a pill-shaped button → the 6px push-button corner
 *   lift           a hover translateY(-2px or more) → -1px
 *   brand stripe   a 3–9px brand-coloured leading border → the hairline every other edge has
 *   shadow         a hand-typed rgba() drop shadow → the nearest Mac elevation token
 *   focus          an outline or ring on :focus → the Mac accent halo (only while forced
 *                  colours are off, where box-shadow still paints)
 *
 * Nothing is copied from the source values, so the output can name no colour of its own.
 *
 * Specificity is the whole trick. Each twin is the original selector behind
 * `html:where([data-ui-style='macos'])` (or `html:root:where(...)` for a selector that starts at
 * :root). `:where()` adds nothing and `html` adds exactly one type selector, so a twin beats its
 * own original whatever order the stylesheets load in (route sheets load after this one), while
 * every state rule that already outranked the original (`:hover`, `--active`, `[aria-selected]`)
 * still outranks the twin. The hand-written ui-macos.css sits two classes higher still, so it wins
 * wherever both speak.
 *
 * client/test/uiStyle.test.js fails if the committed file differs from this script's output.
 * Zero dependencies.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STYLES = join(ROOT, 'client', 'src', 'styles');
const OUT = join(STYLES, 'ui-macos-pages.css');

/** Sheets that are not page UI: tokens, the generated palette, the reset, dev-only tools. */
const SKIP = new Set(['main.css', 'tokens.css', 'themes.css', 'reset.css', 'ui-macos.css', 'ui-macos-pages.css',
  'gallery.css', 'a11y-badge.css']);

const SCOPE = "html:where([data-ui-style='macos'])";
const ROOT_SCOPE = "html:root:where([data-ui-style='macos'])";

/* ── A small CSS reader: enough for the project's own sheets (no nesting, no @import). ── */

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Index of the `}` closing the block whose `{` is at `open`, honouring strings. */
function blockEnd(css, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < css.length; i++) {
    const c = css[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return css.length - 1;
}

/** Splits on `sep` at depth 0 of (), [] and quotes. */
function splitTop(text, sep) {
  const out = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      cur += c;
      if (c === '\\') { cur += text[++i] ?? ''; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (depth === 0 && sep.test(c)) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

const WRAPPING_AT_RULES = /^@(media|supports|container)\b/;

/** Flattens a sheet into { selectors, decls, wrappers } rules, keeping their @media chain. */
function parseRules(css, wrappers = []) {
  const rules = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open === -1) break;
    let prelude = css.slice(i, open);
    // A statement at-rule (`@charset …;`) ends before the block starts.
    const semi = prelude.lastIndexOf(';');
    if (semi !== -1) prelude = prelude.slice(semi + 1);
    prelude = prelude.trim();
    const close = blockEnd(css, open);
    const body = css.slice(open + 1, close);
    if (prelude.startsWith('@')) {
      if (WRAPPING_AT_RULES.test(prelude)) rules.push(...parseRules(body, [...wrappers, prelude]));
      // @keyframes, @font-face, @starting-style …: nothing to restyle.
    } else if (prelude) {
      const decls = splitTop(body, /;/)
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => {
          const colon = d.indexOf(':');
          let value = d.slice(colon + 1).trim();
          const important = /!important\s*$/i.test(value);
          value = value.replace(/\s*!important\s*$/i, '');
          return { prop: d.slice(0, colon).trim().toLowerCase(), value, important };
        });
      const selectors = splitTop(prelude, /,/).map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
      rules.push({ selectors, decls, wrappers });
    }
    i = close + 1;
  }
  return rules;
}

/* ── Reading a selector ─────────────────────────────────────────────────── */

/** The last compound selector: the element the declarations land on. */
function subjectOf(selector) {
  const parts = splitTop(selector, /[\s>+~]/).filter(Boolean);
  return parts[parts.length - 1] || '';
}

/** Class names on the subject, ignoring those inside :not()/:is()/:has()/:where(). */
function subjectClasses(selector) {
  const subject = subjectOf(selector).replace(/:(not|is|has|where)\((?:[^()]|\([^()]*\))*\)/g, '');
  return [...subject.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((m) => m[1]);
}

const BUTTON = /(^|[-_])(btn|button|cta)($|[-_])/;
// A "button" that is really an icon, a chip, a toggle or a swatch keeps its own shape.
const NOT_A_PUSH_BUTTON = /icon|close|fab|avatar|dot|round|circle|toggle|nav|arrow|chip|pill|tag|play|dismiss|remove|swatch|colou?r|thumb|star|heart|like|share|scroll|back-top|bubble|float|emoji|mic|camera|send/;

function isPushButton(selector) {
  const classes = subjectClasses(selector);
  return classes.some((c) => BUTTON.test(c)) && !classes.some((c) => NOT_A_PUSH_BUTTON.test(c));
}

const isFocusSelector = (s) => /:focus(-visible|-within)?\b/.test(s.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, ''));
const isHoverSelector = (s) => /:hover\b/.test(s);

/** Scopes one selector to the macOS style with exactly one extra type selector of weight. */
function scope(selector) {
  if (selector.startsWith(':root')) return ROOT_SCOPE + selector.slice(':root'.length);
  if (/^html\b/.test(selector)) return null; // none today; refuse rather than guess its weight
  return `${SCOPE} ${selector}`;
}

/* ── The transforms ─────────────────────────────────────────────────────── */

const PILL = /^(9{3,}px|var\(--radius-full\)|[1-9]\d{2,}px)$/;

/** Largest blur radius across a shadow list, or null when it is not a plain drop shadow. */
function dropShadowBlur(value) {
  if (/var\(|inset|^none$/i.test(value)) return null;
  let max = -1;
  for (const shadow of splitTop(value, /,/)) {
    const lengths = shadow
      .replace(/(rgba?|hsla?|color-mix|oklch|color)\((?:[^()]|\([^()]*\))*\)/gi, ' ')
      .match(/-?\d*\.?\d+(px|rem)?/g);
    if (!lengths || lengths.length < 2) return null;
    const [x, y, blur = '0', spread = '0'] = lengths.map((l) => parseFloat(l) * (l.endsWith('rem') ? 16 : 1));
    // A 0 0 0 Npx ring is a selection or focus mark, not depth.
    if (Number(x) === 0 && Number(y) === 0 && Number(blur) === 0 && Number(spread) !== 0) return null;
    max = Math.max(max, Number(blur));
  }
  return max;
}

function elevationFor(blur) {
  if (blur <= 3) return 'var(--elevation-1)';
  if (blur <= 10) return 'var(--elevation-2)';
  if (blur <= 24) return 'var(--elevation-3)';
  return 'var(--elevation-4)';
}

/**
 * Returns { normal, focus } declaration lists for one rule, or null when nothing in it reads as
 * "not Mac". Focus declarations are kept apart so they can sit behind (forced-colors: none).
 */
function twinDeclarations(rule) {
  const normal = [];
  const focus = [];
  const sel = rule.selectors;
  const allButtons = sel.every(isPushButton);
  const allFocus = sel.every(isFocusSelector);
  const allHover = sel.every(isHoverSelector);
  const has = (prop) => rule.decls.some((d) => d.prop === prop);
  const add = (list, prop, value, important) => list.push(`${prop}: ${value}${important ? ' !important' : ''}`);

  for (const { prop, value, important } of rule.decls) {
    const v = value.toLowerCase();

    if (prop === 'text-transform' && v === 'uppercase') {
      add(normal, 'text-transform', 'none', important);
      if (has('letter-spacing')) add(normal, 'letter-spacing', 'normal', important);
    }

    if (prop === 'font-weight') {
      if (/^(800|900|bolder)$/.test(v)) add(normal, 'font-weight', allButtons ? 'var(--weight-medium)' : '700', important);
      else if (allButtons && /^(600|700|bold|var\(--weight-(semibold|bold)\))$/.test(v)) {
        add(normal, 'font-weight', 'var(--weight-medium)', important);
      }
    }

    if (prop === 'border-radius' && allButtons && PILL.test(v) && !has('aspect-ratio')) {
      // Equal width and height means a round icon button, which keeps its circle.
      const w = rule.decls.find((d) => d.prop === 'width')?.value;
      const h = rule.decls.find((d) => d.prop === 'height')?.value;
      if (!(w && h && w === h)) add(normal, 'border-radius', 'var(--radius-sm)', important);
    }

    if (prop === 'transform' && allHover) {
      const m = v.match(/^translatey\(\s*-(\d*\.?\d+)px\s*\)$/);
      if (m && parseFloat(m[1]) >= 2) add(normal, 'transform', 'translateY(-1px)', important);
    }

    // A thick brand-coloured stripe down a card's leading edge is a web idiom; a Mac card has an
    // even hairline. Status stripes (danger, warning, success) carry meaning and are left alone.
    // A stripe that marks a state (`.notification-item.unread`) is information, not decoration.
    const marksState = sel.some((s) => /unread|active|selected|current|new|open|checked|\[aria-/.test(subjectOf(s)));
    if ((prop === 'border-left' || prop === 'border-inline-start') && !marksState
      && /^[3-9]px solid var\(--brand[a-z0-9-]*\)$/.test(v)) {
      add(normal, prop, 'var(--border-width) solid var(--border-subtle)', important);
    }

    if (prop === 'box-shadow' && !allFocus) {
      const blur = dropShadowBlur(v);
      if (blur !== null && blur >= 0) add(normal, 'box-shadow', elevationFor(blur), important);
    }
  }

  if (allFocus) {
    const outline = rule.decls.find((d) => d.prop === 'outline' || d.prop === 'outline-color' || d.prop === 'outline-width');
    const ring = rule.decls.find((d) => d.prop === 'box-shadow' && !/^none$/i.test(d.value));
    const drawsOutline = outline && !/^(none|0|0px)$/i.test(outline.value);
    if (drawsOutline || ring) {
      const important = Boolean(outline?.important || ring?.important);
      add(focus, 'outline', 'none', important);
      add(focus, 'box-shadow', 'var(--mac-focus)', important);
    }
  }

  return normal.length || focus.length ? { normal, focus } : null;
}

/* ── Emitting ───────────────────────────────────────────────────────────── */

function wrap(text, wrappers) {
  return wrappers.reduceRight((inner, w) => `${w} {\n${inner.replace(/^/gm, '  ')}\n}`, text);
}

function block(selectors, decls) {
  return `${selectors.join(',\n')} {\n${decls.map((d) => `  ${d};`).join('\n')}\n}`;
}

/** Every page sheet, in a stable order: the global sheets, then components/ alphabetically. */
function sheets() {
  const top = readdirSync(STYLES).filter((f) => f.endsWith('.css') && !SKIP.has(f)).sort();
  const components = readdirSync(join(STYLES, 'components')).filter((f) => f.endsWith('.css') && !SKIP.has(f)).sort();
  return [...top.map((f) => ({ name: f, path: join(STYLES, f) })),
    ...components.map((f) => ({ name: `components/${f}`, path: join(STYLES, 'components', f) }))];
}

/** The Mac twins of one sheet's text, as CSS blocks. Exported for the tests. */
export function twinSheet(cssText) {
  const out = [];
  for (const rule of parseRules(stripComments(cssText))) {
    const twin = twinDeclarations(rule);
    if (!twin) continue;
    const selectors = rule.selectors.map(scope);
    if (selectors.some((s) => s === null)) continue;
    if (twin.normal.length) out.push(wrap(block(selectors, twin.normal), rule.wrappers));
    if (twin.focus.length) out.push(wrap(block(selectors, twin.focus), [...rule.wrappers, '@media (forced-colors: none)']));
  }
  return out;
}

export function generateMacosPagesCss() {
  const sections = [];
  const report = [];
  for (const sheet of sheets()) {
    const out = twinSheet(readFileSync(sheet.path, 'utf8'));
    report.push({ sheet: sheet.name, twins: out.length });
    if (out.length) sections.push(`/* ── ${sheet.name} ── */\n${out.join('\n')}`);
  }

  const css = `/**
 * ui-macos-pages.css — GENERATED by scripts/macos-pages.mjs. Do not hand-edit: change the page
 * sheet or the script, then run \`node scripts/macos-pages.mjs --write\`.
 *
 * The 'macos' component style's twins of the page sheets' own rules (see the script's header for
 * what is rewritten and why). Loaded lazily with ui-macos.css by services/uiStyle.ts.
 */

${sections.join('\n\n')}
`;
  return { css, report };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const { css, report } = generateMacosPagesCss();
  for (const r of report.filter((x) => x.twins)) console.log(`${String(r.twins).padStart(4)}  ${r.sheet}`);
  console.log(`${report.reduce((s, r) => s + r.twins, 0)} twins from ${report.filter((r) => r.twins).length} sheets`);
  if (process.argv.includes('--write')) {
    writeFileSync(OUT, css);
    console.log(`wrote ${OUT}`);
  }
}
