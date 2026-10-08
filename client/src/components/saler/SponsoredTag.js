/**
 * SponsoredTag — the "Sponsored" label on a paid placement in the Sourcing Catalog.
 *
 * Invariant: paid placements are always labelled, in words (never colour or an icon alone). A saler
 * deciding what to stock must be able to tell a ranked result from a bought one.
 */
import { t } from '../../services/i18n.js';
// Styles: styles/components/sourcing-sponsored.css, loaded by the routes that render this (main.js).

export function SponsoredTag() {
  const tag = document.createElement('span');
  tag.className = 'sponsored-tag-chip';
  tag.textContent = t('sourcing.sponsored.tag');
  tag.title = t('sourcing.sponsored.hint');
  return tag;
}
