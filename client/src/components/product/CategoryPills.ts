/**
 * CategoryPills — horizontally scrollable category filter (Prompt 4.5).
 *
 * @param {object}   opts
 * @param {string[]} opts.categories   — list of { id, label_en, label_bn } category objects
 * @param {string}   opts.selected     — currently selected category id ('all' for no filter)
 * @param {string}   opts.lang         — 'en' | 'bn'
 * @param {function} opts.onChange     — (categoryId: string) => void
 * @returns {HTMLElement}
 *
 * Invariants:
 *  - Keyboard accessible: arrow keys navigate between pills, Home/End jump to first/last.
 *  - No horizontal PAGE scroll — the pills are contained inside their own overflow-x:auto scroll context.
 *  - A selected pill is scrolled into view automatically on keyboard focus.
 *  - The outer element is role="listbox" with each pill as role="option".
 */

import { t } from '../../services/i18n.ts';

/** One category pill. The "All" pill (id `all`) is added in front. */
export interface PillCategory {
  id: string;
  label_en: string;
  label_bn?: string;
}

export function CategoryPills({
  categories = [],
  selected = 'all',
  lang = 'en',
  onChange = null,
}: {
  categories?: PillCategory[];
  /** The selected category id; `all` means no filter. */
  selected?: string;
  lang?: 'en' | 'bn' | string;
  onChange?: ((categoryId: string) => void) | null;
} = {}): HTMLDivElement {
  const root = document.createElement('div');
  root.className = 'category-pills';
  root.setAttribute('role', 'listbox');
  root.setAttribute('aria-label', t('marketplace.categories.label'));
  root.setAttribute('aria-orientation', 'horizontal');

  const allPills: HTMLButtonElement[] = [];

  /** Builds a single pill element. */
  function makePill(id: string, labelEn: string, labelBn?: string): HTMLButtonElement {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'category-pills__pill';
    pill.setAttribute('role', 'option');
    pill.dataset.id = id;
    pill.setAttribute('aria-selected', id === selected ? 'true' : 'false');
    pill.textContent = lang === 'bn' ? (labelBn || labelEn) : labelEn;

    pill.addEventListener('click', () => {
      select(id);
    });

    return pill;
  }

  function select(id: string): void {
    for (const p of allPills) {
      const isSelected = p.dataset.id === id;
      p.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      if (isSelected) p.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    onChange && onChange(id);
  }

  // "All" pill first
  const allPill = makePill('all', t('marketplace.categories.all'), t('marketplace.categories.all_bn'));
  root.append(allPill);
  allPills.push(allPill);

  for (const cat of categories) {
    const pill = makePill(cat.id, cat.label_en, cat.label_bn);
    root.append(pill);
    allPills.push(pill);
  }

  // Keyboard navigation — arrow keys cycle through pills
  root.addEventListener('keydown', (e) => {
    const focused = allPills.findIndex((p) => p === document.activeElement);
    if (focused === -1) return;

    let next = focused;
    if (e.key === 'ArrowRight') { e.preventDefault(); next = (focused + 1) % allPills.length; }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); next = (focused - 1 + allPills.length) % allPills.length; }
    else if (e.key === 'Home') { e.preventDefault(); next = 0; }
    else if (e.key === 'End') { e.preventDefault(); next = allPills.length - 1; }
    else return;

    allPills[next].focus();
    allPills[next].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  return root;
}
