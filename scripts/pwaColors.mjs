/**
 * scripts/pwaColors.mjs — keeps the literal colours a browser needs BEFORE any CSS loads in step with
 * the shipped default theme.
 *
 * Imported by scripts/logo.mjs (which writes them) and by client/test/pwaColors.test.js. Importing
 * this module writes nothing.
 *
 * WHY these are literals at all: the install splash, the browser toolbar, the first paint before
 * stylesheets land and the offline page cannot read a CSS custom property. They were hand-copied and
 * stayed Midnight Slate after the default preset became Explooro Gold. Every value here is read from
 * the Master Colour engine, the same source as themes.css, so a re-seed is `node scripts/logo.mjs --write`.
 *
 * Each rule finds ONE known place (anchored on its selector, not on the old colour) and replaces only
 * the hex values in it. A rule that no longer matches exactly once throws, so restructuring one of
 * these files fails loudly instead of leaving a stale colour behind.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HEX = '#[0-9a-fA-F]{6}';

/** The tokens the rules draw from, named as the CSS names them. */
export function pwaTokens(palette) {
  const { brand, neutral } = palette;
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ');
  return {
    brand: brand[palette.meta.anchorStep], // --brand
    textBrand: brand[900], // --text-brand
    canvas: neutral[50], // --surface-0 (light)
    text: neutral[900], // --text-primary (light)
    darkCanvas: neutral[950], // --surface-0 (dark)
    darkText: neutral[100], // --text-primary (dark)
    border: neutral[200], // --border-subtle (light)
    darkBorder: neutral[800],
    muted: neutral[600],
    subtle: neutral[100], // icon disc, light
    cardDark: rgb(neutral[900]), // translucent card, dark
  };
}

/**
 * [file relative to client/, pattern, replacement]. Patterns capture the text around each hex, so the
 * replacement only swaps colours; `$1`-style groups are rebuilt in `build`.
 */
function rules(t) {
  const pair = (selector, first, second) => ({
    pattern: new RegExp(`(${selector}\\s*\\{[^}]*?background:\\s*)${HEX}(;[^}]*?\\bcolor:\\s*)${HEX}`),
    build: (m) => `${m[1]}${first}${m[2]}${second}`,
  });
  return [
    ['public/manifest.json', {
      pattern: new RegExp(`("theme_color":\\s*")${HEX}(")`),
      build: (m) => `${m[1]}${t.brand}${m[2]}`,
    }],
    ['public/manifest.json', {
      pattern: new RegExp(`("background_color":\\s*")${HEX}(")`),
      build: (m) => `${m[1]}${t.canvas}${m[2]}`,
    }],

    ['index.html', {
      pattern: new RegExp(`(<meta name="theme-color" content=")${HEX}(")`),
      build: (m) => `${m[1]}${t.brand}${m[2]}`,
    }],
    // The multi-line `body {` block: `html, body {` has no background and the dark one is a single line.
    ['index.html', {
      pattern: new RegExp(`(\\n\\s*body \\{\\r?\\n\\s*background:\\s*)${HEX}(;[^}]*?\\bcolor:\\s*)${HEX}`),
      build: (m) => `${m[1]}${t.canvas}${m[2]}${t.text}`,
    }],
    ['index.html', {
      pattern: new RegExp(`(body \\{ background: )${HEX}(; color: )${HEX}(; \\})`),
      build: (m) => `${m[1]}${t.darkCanvas}${m[2]}${t.darkText}${m[3]}`,
    }],

    ['public/offline.html', {
      pattern: new RegExp(`(min-height: 100vh;[^}]*?background: )${HEX}(;\\s*color: )${HEX}`),
      build: (m) => `${m[1]}${t.canvas}${m[2]}${t.text}`,
    }],
    ['public/offline.html', {
      pattern: new RegExp(`(body \\{ background: )${HEX}(; color: )${HEX}(; \\})`),
      build: (m) => `${m[1]}${t.darkCanvas}${m[2]}${t.darkText}${m[3]}`,
    }],
    ['public/offline.html', {
      pattern: new RegExp(`(border: 1px solid )${HEX}(;)`),
      build: (m) => `${m[1]}${t.border}${m[2]}`,
    }],
    ['public/offline.html', {
      pattern: new RegExp(`(\\.card \\{ background: rgba\\()[\\d, ]+(, 0\\.8\\); border-color: )${HEX}(;)`),
      build: (m) => `${m[1]}${t.cardDark}${m[2]}${t.darkBorder}${m[3]}`,
    }],
    ['public/offline.html', { ...pair('\\.icon', t.subtle, t.textBrand) }],
    ['public/offline.html', {
      pattern: new RegExp(`(\\n    p \\{[^}]*?\\bcolor: )${HEX}`),
      build: (m) => `${m[1]}${t.muted}`,
    }],
    // The brand colour is too light for white text, so a button on it carries the dark text.
    ['public/offline.html', { ...pair('\\.btn-primary', t.brand, t.text) }],
    ['public/offline.html', { ...pair('\\.btn-secondary', t.border, t.text) }],
  ];
}

/**
 * Applies every rule under `clientDir`. Returns the files whose contents changed (relative paths);
 * with `write: false` nothing is written, which is how the test proves the committed files are current.
 */
export function syncPwaColors(palette, clientDir, { write = true } = {}) {
  const tokens = pwaTokens(palette);
  const texts = new Map();
  for (const [file, rule] of rules(tokens)) {
    const path = join(clientDir, file);
    const original = texts.get(file)?.original ?? readFileSync(path, 'utf8');
    const current = texts.get(file)?.current ?? original;
    const found = [...current.matchAll(new RegExp(rule.pattern.source, 'g'))];
    if (found.length !== 1) {
      throw new Error(`pwaColors: expected exactly one match in ${file} for ${rule.pattern}, found ${found.length}`);
    }
    texts.set(file, { original, current: current.replace(rule.pattern, (...args) => rule.build(args)) });
  }
  const changed = [];
  for (const [file, { original, current }] of texts) {
    if (current === original) continue;
    changed.push(file);
    if (write) writeFileSync(join(clientDir, file), current);
  }
  return changed;
}
