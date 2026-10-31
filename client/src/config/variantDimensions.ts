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

/**
 * Which options a category offers: its own entry, else its nearest parent's, else every option.
 * The same rule as server/src/services/variantOptions.service.ts resolveFor (a server test runs both).
 */
export interface VariantOptionRules {
  categories: Record<string, string[]>;
}

export function resolveFor(
  rules: VariantOptionRules,
  categoryId: number | string | null,
  parentOf: Map<string, string | null>
): VariantDimension[] {
  const seen = new Set<string>();
  let id = categoryId == null ? null : String(categoryId);
  while (id && !seen.has(id)) {
    seen.add(id);
    const own = rules.categories[id];
    if (own) return VARIANT_DIMENSIONS.filter((d) => own.includes(d));
    id = parentOf.get(id) ?? null;
  }
  return [...VARIANT_DIMENSIONS];
}

