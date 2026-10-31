/**
 * variantDimensions.ts — what a supplier's variants may differ by. The server's copy of
 * client/src/config/variantDimensions.ts; server/test/productVariant.test.js fails if they drift.
 *
 * WHY its own file: productVariant.service.ts (the save) and variantOptions.service.ts (which of
 * these each category offers) both need it and import each other's functions, so a constant living
 * in either would be read before it exists.
 */
export const VARIANT_ATTRIBUTE_KEYS = ['size', 'color', 'material', 'style', 'weight', 'volume', 'capacity', 'pack_size'] as const;

/** WHY 3: every dimension is one more button row the shopper must answer before buying. */
export const MAX_VARIANT_DIMENSIONS = 3;
