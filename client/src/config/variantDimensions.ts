/**
 * variantDimensions.ts — what a supplier's variants may differ by (size, colour, material, ...).
 *
 * The server keeps the same list in server/src/services/productVariant.service.ts and refuses any
 * other key; server/test/productVariant.test.js fails if the two drift.
 *
 * WHY a fixed list and not free text: each dimension needs a label in both locales
 * (product_detail.variant.attribute.<key>) and the shopper's picker groups buttons by key, so a
 * typo like "colour" next to "color" would split one choice into two button rows.
 * Adding one is three edits: this list, the server's, and the label + example in both locales.
 */
export const VARIANT_DIMENSIONS = ['size', 'color', 'material', 'style', 'weight', 'volume', 'capacity', 'pack_size'] as const;

export type VariantDimension = (typeof VARIANT_DIMENSIONS)[number];

/** WHY 3: every dimension is one more button row the shopper must answer before buying. */
export const MAX_VARIANT_DIMENSIONS = 3;

/** What a new product's editor starts with: the two clothing shops use most. */
export const DEFAULT_VARIANT_DIMENSIONS: VariantDimension[] = ['size', 'color'];
