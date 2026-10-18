/**
 * EarnJourney — "start earning with zero stock" card for signed-in customers: headline + CTA on top,
 * then the three steps (pick, share, keep the commission) as small cards.
 *
 * WHY: the home page shows this idea to guests as a yellow list panel and signed-in customers never see it
 * there. This is the customer-account version, placed on a page customers revisit (My Orders), not on the
 * dashboard, which already carries the BecomeSalerCta banner. Deliberately a soft tint, not a solid brand
 * fill: it sits under a long list of order cards and a loud block there reads as an ad.
 * Styles: .earn-journey* in styles/components/customer-dashboard.css (global via main.css).
 */

import { t } from '../../services/i18n.js';
import { ICONS } from '../ui/icons.js';

const STEPS = [
  { id: 'pick', icon: 'cart' },
  { id: 'share', icon: 'share' },
  { id: 'keep', icon: 'coin' },
];

const BECOME_SALER_PATH = '/account/become-saler';

export function EarnJourney({ onNavigate }) {
  const section = document.createElement('section');
  section.className = 'earn-journey';
  section.setAttribute('aria-label', t('customer.dashboard.earn_label', 'How a Shop Partner earns'));

  const head = document.createElement('div');
  head.className = 'earn-journey__head';
  const text = document.createElement('div');
  const kicker = document.createElement('p');
  kicker.className = 'earn-journey__kicker';
  kicker.textContent = t('customer.dashboard.earn_kicker', 'Shopper today, Shop Partner tomorrow');
  const title = document.createElement('h2');
  title.className = 'earn-journey__title';
  title.textContent = t('customer.dashboard.earn_title', 'Start earning with zero stock');
  text.append(kicker, title);

  const cta = document.createElement('a');
  cta.className = 'earn-journey__cta';
  cta.href = BECOME_SALER_PATH;
  cta.textContent = t('customer.dashboard.earn_cta', 'Become a Shop Partner');
  cta.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    onNavigate(BECOME_SALER_PATH);
  });
  head.append(text, cta);

  const steps = document.createElement('ol');
  steps.className = 'earn-journey__steps';
  for (const step of STEPS) {
    const item = document.createElement('li');
    item.className = 'earn-journey__step';
    const icon = document.createElement('span');
    icon.className = 'earn-journey__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = ICONS[step.icon]; // trusted constant SVG from icons.js
    item.append(icon, document.createTextNode(t(`customer.dashboard.earn_${step.id}_title`)));
    steps.append(item);
  }

  section.append(head, steps);
  return { element: section };
}
