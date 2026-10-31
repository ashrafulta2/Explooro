/**
 * variantOptions.ts — which variant options (size, colour, weight, ...) a category offers.
 *
 * The rule lives on the server (server/src/services/variantOptions.service.ts resolveFor): a
 * category's own entry, else its nearest parent's, else every option. `resolveFor` (config/variantDimensions.ts,
 * pure so a server test can import it) is the same rule for the admin page's "follows the parent" preview; server/test/variantOptions.test.js runs
 * both on the same cases so they cannot drift. The product form never resolves locally — it asks
 * GET /catalog/variant-options, the list the save itself will check against.
 */
import { api } from '../core/api.ts';
import { VARIANT_DIMENSIONS, type VariantDimension } from '../config/variantDimensions.ts';

export { resolveFor, type VariantOptionRules } from '../config/variantDimensions.ts';

const cache = new Map<string, Promise<VariantDimension[]>>();

/**
 * The options the product form may offer for one category. Cached per page view, so flipping the
 * category select back and forth does not refetch; on a failed request every option is offered and
 * the server's own check on save stays the last word.
 */
export function optionsForCategory(categoryId: number | string | null | undefined): Promise<VariantDimension[]> {
  if (categoryId == null || categoryId === '' || !/^\d+$/.test(String(categoryId))) return Promise.resolve([...VARIANT_DIMENSIONS]);
  const key = String(categoryId);
  if (!cache.has(key)) {
    cache.set(
      key,
      api
        .get(`/catalog/variant-options?category_id=${encodeURIComponent(key)}`)
        .then((res) => {
          const list = res?.data?.options;
          return Array.isArray(list) ? VARIANT_DIMENSIONS.filter((d) => list.includes(d)) : [...VARIANT_DIMENSIONS];
        })
        .catch(() => {
          cache.delete(key);
          return [...VARIANT_DIMENSIONS];
        })
    );
  }
  return cache.get(key);
}

/** After an admin save, so the next product form in this tab sees the new lists. */
export function clearVariantOptionsCache(): void {
  cache.clear();
}
