/**
 * masterPalette.js — the ONE server module allowed to reach into the client's colour engine.
 *
 * WHY import across the workspace instead of porting the maths: the Theme Studio stores a master
 * seed and the LIVE SITE regenerates all 45 ramp steps from it at boot. If the server carried its
 * own copy of the OKLCH ladder, a divergence of one rounding rule would mean the server certifies
 * a palette that the browser then renders differently — i.e. the contrast gate would be checking a
 * theme nobody ever sees. Colour arithmetic therefore exists in exactly one file, the same rule
 * §Master Instructions applies to split/commission arithmetic.
 *
 * `colorRamp.js` is safe to import here: it is pure, dependency-free ESM and touches no DOM API
 * (its sibling `masterTheme.js` does the mounting, and is deliberately NOT imported).
 * `server/test/themeStudio.test.js` already imports client config the same way.
 *
 * Every other server module must import from here, never from `client/` directly.
 */

export {
  generatePalette,
  paletteToSectionTokens,
  normaliseMasterConfig,
  contrastRatio,
  hexToOklch,
  DEFAULT_MASTER,
  MASTER_NEUTRAL_MODES,
  MASTER_ACCENT_HARMONIES,
  MASTER_RANGES,
  BRAND_STEPS,
} from '../../../client/src/services/colorRamp.js';

/** The 6 UI sections the flattened token shape (and every pre-master consumer) speaks. */
export const TOKEN_SECTIONS = ['navbar', 'surfaces', 'brand', 'typography', 'badges', 'footer'];
