/**
 * navIcons.test.js — every sidebar item has its own icon.
 *
 * Invariants, per role (the list navItemsForRole returns is exactly what that role's sidebar draws):
 *  - every item names its icon in ITEM_ICON_NAMES, and that name exists in ICONS — no item falls
 *    back to its group's icon, which is how three admin pages once all showed the same gear;
 *  - no two items draw the same glyph. Compared by SVG markup, not by name, because several names
 *    share one drawing (catalog/inventory, vault/finance, growth/marketing, my_shop/my_store).
 *
 * Adding a nav item therefore means picking an icon nobody else in that role uses, or adding one.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NAV_ROLES, navItemsForRole } from '../src/config/navigation.ts';
import { ICONS, ITEM_ICON_NAMES, getItemIcon } from '../src/components/ui/icons.ts';

describe('sidebar item icons', () => {
  for (const role of NAV_ROLES) {
    const items = navItemsForRole(role);

    it(`${role}: every item names an icon that exists`, () => {
      const missing = items
        .filter((item) => !(typeof item.icon === 'string' && item.icon.trim().startsWith('<svg')))
        .filter((item) => !ICONS[ITEM_ICON_NAMES[item.key]])
        .map((item) => `${item.key} → ${ITEM_ICON_NAMES[item.key] ?? '(none)'}`);
      assert.deepEqual(missing, [], `add these to ITEM_ICON_NAMES in components/ui/icons.ts`);
    });

    it(`${role}: no two items share a glyph`, () => {
      const bySvg = new Map();
      for (const item of items) {
        const svg = getItemIcon(item);
        bySvg.set(svg, [...(bySvg.get(svg) ?? []), item.key]);
      }
      const shared = [...bySvg.values()].filter((keys) => keys.length > 1).map((keys) => keys.join(' = '));
      assert.deepEqual(shared, [], 'give each of these its own icon');
    });
  }
});
