/**
 * optical.ts — Optical Correction Helpers (Prompt 1.10, docs/design-system.md §14).
 *
 * Provides functions for optical compensation where mathematical alignment looks visually wrong.
 * Zero dependencies.
 */

/**
 * Optical centering factor for directional triangular glyphs (play, chevron, arrow).
 * Mathematical center of bounding box looks left-heavy; shifts right by ~8%.
 */
export function opticalCenterGlyph(
  el: ElementCSSInlineStyle | null | undefined,
  direction: 'right' | 'left' | 'none' | string = 'right',
): void {
  if (!el || !el.style) return;
  const shiftPct = direction === 'right' ? '8%' : direction === 'left' ? '-8%' : '0%';
  el.style.transform = `translateX(${shiftPct})`;
}

/**
 * Optical sizing factor for circles vs squares.
 * A circle must be ~4% larger than a square to read as the same visual weight.
 */
export function opticalCircleCompensation(sizePx: number | string): number {
  const base = Number(sizePx) || 0;
  return Math.round(base * 1.04);
}

/**
 * Aligns icon vector to font cap-height rather than baseline or line-box.
 */
export function alignCapHeight(iconEl: ElementCSSInlineStyle | null | undefined): void {
  if (!iconEl || !iconEl.style) return;
  iconEl.style.verticalAlign = 'middle';
  iconEl.style.position = 'relative';
  iconEl.style.top = '-0.06em';
}

/**
 * Checks if a string is a single word (no spaces/hyphens) for optical padding adjustments.
 */
export function isSingleWord(text: unknown): boolean {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  return trimmed.length > 0 && !/\s/.test(trimmed);
}
