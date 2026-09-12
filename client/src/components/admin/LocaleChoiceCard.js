/**
 * LocaleChoiceCard.js — the locale picker used by /admin/platform/language.
 *
 * One card per locale, each carrying two independent controls:
 *   · a radio  — "this is the platform default"   (exactly one across the group)
 *   · a checkbox — "this locale is enabled at all" (any number, at least one)
 *
 * WHY both live on one card rather than in two separate lists: the two settings constrain each
 * other (the default must be enabled), and a reviewer of an admin screen should be able to see
 * that constraint without holding two lists in their head. The card renders the conflict inline —
 * unchecking the default's own "enabled" box is refused here as well as by the API.
 *
 * Accessibility notes, per docs/super-admin-audit.md §5:
 *   · invariant 6 — every control has a real `<label for>`, not a placeholder and not a bare
 *     heading sitting above it. The group itself is a `<fieldset>` with a `<legend>`.
 *   · invariant 7 — ids are namespaced with an `idPrefix` because this renders one element per
 *     record; without it, two cards would collide and clicking one label would toggle the other.
 */

import { getLanguage } from '../../services/i18n.js';

/** Endonyms: a language is always named in its own language, never translated. */
const LOCALE_NAMES = {
  en: { name: 'English', native: 'English', region: 'en-US · Latin' },
  bn: { name: 'Bengali', native: 'বাংলা', region: 'bn-BD · Bengali' },
};

/**
 * @param {object}   opts
 * @param {string}   opts.locale            locale code, e.g. 'bn'
 * @param {boolean}  opts.isDefault         is this the platform default?
 * @param {boolean}  opts.isEnabled         may the switcher offer this locale?
 * @param {boolean}  [opts.isCurrent]       is this the locale the operator is reading right now?
 * @param {string}   [opts.idPrefix]        id namespace; pass a unique value per rendered group
 * @param {function} [opts.onSetDefault]    (locale) => void
 * @param {function} [opts.onToggleEnabled] (locale, nextEnabled) => void
 * @param {boolean}  [opts.readOnly]        render without interactive controls
 */
export function LocaleChoiceCard({
  locale,
  isDefault = false,
  isEnabled = true,
  isCurrent = false,
  idPrefix = 'locale',
  onSetDefault = null,
  onToggleEnabled = null,
  readOnly = false,
} = {}) {
  const isBn = getLanguage() === 'bn';
  const meta = LOCALE_NAMES[locale] || { name: locale, native: locale, region: locale };

  const card = document.createElement('div');
  card.className = `locale-card${isDefault ? ' locale-card--default' : ''}${isEnabled ? '' : ' locale-card--off'}`;
  card.dataset.locale = locale;

  const defaultId = `${idPrefix}-default-${locale}`;
  const enabledId = `${idPrefix}-enabled-${locale}`;

  const defaultLabel = isBn ? 'ডিফল্ট ভাষা' : 'Default language';
  const enabledLabel = isBn ? 'সক্রিয়' : 'Enabled';
  const currentLabel = isBn ? 'আপনি এখন এটি দেখছেন' : 'You are reading this now';
  const lockedNote = isBn
    ? 'ডিফল্ট ভাষা বন্ধ করা যাবে না।'
    : 'The default language cannot be disabled.';

  card.innerHTML = `
    <div class="locale-card__head">
      <div class="locale-card__identity">
        <span class="locale-card__native" lang="${locale}">${meta.native}</span>
        <span class="locale-card__meta">${meta.name} · <span class="font-mono">${meta.region}</span></span>
      </div>
      ${isCurrent ? `<span class="locale-card__current">${currentLabel}</span>` : ''}
    </div>
    <div class="locale-card__controls">
      <div class="locale-card__control">
        <input
          type="radio"
          id="${defaultId}"
          name="${idPrefix}-default"
          class="locale-card__radio"
          value="${locale}"
          ${isDefault ? 'checked' : ''}
          ${readOnly || !isEnabled ? 'disabled' : ''}
        />
        <label for="${defaultId}" class="locale-card__control-label">${defaultLabel}</label>
      </div>
      <div class="locale-card__control">
        <input
          type="checkbox"
          id="${enabledId}"
          class="locale-card__checkbox"
          ${isEnabled ? 'checked' : ''}
          ${readOnly || isDefault ? 'disabled' : ''}
        />
        <label for="${enabledId}" class="locale-card__control-label">${enabledLabel}</label>
      </div>
    </div>
    ${isDefault && !readOnly ? `<p class="locale-card__note">${lockedNote}</p>` : ''}
  `;

  if (!readOnly) {
    const radio = card.querySelector('.locale-card__radio');
    radio?.addEventListener('change', () => {
      if (radio.checked && typeof onSetDefault === 'function') onSetDefault(locale);
    });

    const checkbox = card.querySelector('.locale-card__checkbox');
    checkbox?.addEventListener('change', () => {
      if (typeof onToggleEnabled === 'function') onToggleEnabled(locale, checkbox.checked);
    });
  }

  return card;
}

export default LocaleChoiceCard;
