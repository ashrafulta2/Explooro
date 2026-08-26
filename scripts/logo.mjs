/**
 * scripts/logo.mjs — bakes the Explooro sparkle-badge mark to static SVG files.
 *
 * Run: node scripts/logo.mjs --write
 *
 * WHY this exists: favicons and PWA icons load as standalone documents with no access to the host
 * page's CSS custom properties, so they can't stay theme-reactive the way the live in-app mark
 * (services/logoMark.js, painted with var(--brand-900) etc.) does. Every colour here is instead
 * DERIVED from the same Master Colour engine (client/src/services/colorRamp.js) that generates
 * themes.css — never hand-picked — so a shipped-default rebrand only means re-running this script.
 *
 * Writes:
 *   client/public/favicon.svg                        — default theme (DEFAULT_MASTER_PRESET)
 *   client/public/icons/icon-192.svg                  — default theme
 *   client/public/icons/icon-512.svg                  — default theme
 *   client/public/icons/icon-maskable-512.svg         — default theme, safe-zone scaled
 *   client/public/icons/brand/{preset-key}.svg        — one per Master Colour preset, prepared for
 *                                                        any context that needs a themed mark outside
 *                                                        the running app (share images, docs, a future
 *                                                        per-store manifest swap)
 *
 * Zero dependencies, by the Dependency Policy in docs/prompt.md.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { generatePalette } from '../client/src/services/colorRamp.js';
import { MASTER_PRESETS, DEFAULT_MASTER_PRESET } from '../client/src/config/master-themes.js';
import { buildLogoMarkSvg, buildLogoMaskableSvg } from '../client/src/services/logoMark.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = join(ROOT, 'client', 'public');
const ICONS_DIR = join(PUBLIC_DIR, 'icons');
const BRAND_DIR = join(ICONS_DIR, 'brand');

/** { bg, star, hole } for a preset key — aligns with the present site logo brand mark */
function colorsFor(presetKey) {
  const preset = MASTER_PRESETS[presetKey];
  const palette = generatePalette(preset.master);
  const darkInk = palette.neutral[900] || '#192026';
  return { bg: darkInk, star: '#ffbc00', hole: darkInk };
}

const args = new Set(process.argv.slice(2));

if (!args.has('--write')) {
  console.log('Usage: node scripts/logo.mjs --write');
  process.exit(1);
}

mkdirSync(ICONS_DIR, { recursive: true });
mkdirSync(BRAND_DIR, { recursive: true });

const defaultColors = colorsFor(DEFAULT_MASTER_PRESET);

writeFileSync(join(PUBLIC_DIR, 'favicon.svg'), buildLogoMarkSvg({ size: 32, ...defaultColors }) + '\n');
writeFileSync(join(ICONS_DIR, 'icon-192.svg'), buildLogoMarkSvg({ size: 192, ...defaultColors }) + '\n');
writeFileSync(join(ICONS_DIR, 'icon-512.svg'), buildLogoMarkSvg({ size: 512, ...defaultColors }) + '\n');
writeFileSync(join(ICONS_DIR, 'icon-maskable-512.svg'), buildLogoMaskableSvg({ size: 512, ...defaultColors }) + '\n');

console.log(`wrote favicon.svg, icons/icon-192.svg, icons/icon-512.svg, icons/icon-maskable-512.svg (${DEFAULT_MASTER_PRESET})`);

for (const key of Object.keys(MASTER_PRESETS)) {
  const colors = colorsFor(key);
  writeFileSync(join(BRAND_DIR, `${key}.svg`), buildLogoMarkSvg({ size: 128, ...colors }) + '\n');
}

console.log(`wrote icons/brand/{${Object.keys(MASTER_PRESETS).join(',')}}.svg`);
