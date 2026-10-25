/**
 * districtMatch.ts — comparing district names that were typed or chosen in different spellings.
 *
 * A district reaches the database as free text (an address form, a profile) and reaches an ad
 * campaign as the name the shop partner picked from the client's list, and Bangladesh has official
 * respellings in common use: "Barishal"/"Barisal", "Chattogram"/"Chittagong". Comparing the raw strings
 * would silently drop a shopper whose address says "Chittagong" from a campaign aimed at "Chattogram".
 *
 * Both sides are reduced to letters only, lower-cased, and every spelling in an alias group maps to
 * the same key. The groups mirror the `aliases` in client/src/data/bangladeshGeo.ts.
 */

const ALIAS_GROUPS: string[][] = [
  ['barishal', 'barisal'],
  ['bogura', 'bogra'],
  ['chattogram', 'chittagong'],
  ['cumilla', 'comilla'],
  ['jashore', 'jessore'],
];

/** Letters only, lower-case, so "Cox's Bazar" and "coxs bazar" compare equal. Bangla is left as is. */
export function normalizeDistrict(name: unknown): string {
  return String(name ?? '').toLowerCase().replace(/[^\p{L}]/gu, '');
}

/**
 * Every normalised spelling that counts as one of the given districts, for use in
 * `... = ANY($keys)` against a normalised column. Empty input gives an empty list.
 */
export function districtMatchKeys(names: unknown[] = []): string[] {
  const keys = new Set<string>();
  for (const name of names) {
    const key = normalizeDistrict(name);
    if (!key) continue;
    keys.add(key);
    const group = ALIAS_GROUPS.find((g) => g.includes(key));
    if (group) group.forEach((k) => keys.add(k));
  }
  return [...keys];
}
