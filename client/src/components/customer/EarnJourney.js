/**
 * EarnJourney — "how a Shop Partner earns" as a 3-node path (pick -> share -> keep the commission).
 *
 * WHY: the home page shows this idea to guests as a yellow list panel and signed-in customers never see it
 * there. This is the customer-account version: a different shape, placed on a page customers revisit
 * (My Orders), not on the dashboard, which already carries the BecomeSalerCta banner.
 * Styles: .earn-journey* in styles/components/customer-dashboard.css (global via main.css).
 */

import { t } from '../../services/i18n.js';

const STEPS = [
  { id: 'pick', icon: '🛒' },
  { id: 'share', icon: '📲' },
  { id: 'keep', icon: '💰' },
];

const BECOME_SALER_PATH = '/account/become-saler';

export function EarnJourney({ onNavigate }) {
  const section = document.createElement('section');
  section.className = 'earn-journey';
  section.setAttribute('aria-label', t('customer.dashboard.earn_label', 'How a Shop Partner earns'));

  const head = document.createElement('div');
  head.className = 'earn-journey__head';
  const kicker = document.createElement('p');
  kicker.className = 'earn-journey__kicker';
  kicker.textContent = t('customer.dashboard.earn_kicker', 'Shopper today, Shop Partner tomorrow');
  const title = document.createElement('h2');
  title.className = 'earn-journey__title';
  title.textContent = t('customer.dashboard.earn_title', 'You already know the products. Now earn from them.');
  head.append(kicker, title);

  const path = document.createElement('ol');
  path.className = 'earn-journey__path';
  for (const step of STEPS) {
    const item = document.createElement('li');
    item.className = 'earn-journey__step';
    const node = document.createElement('span');
    node.className = 'earn-journey__node';
    node.setAttribute('aria-hidden', 'true');
    node.textContent = step.icon;
    const name = document.createElement('strong');
    name.className = 'earn-journey__step-title';
    name.textContent = t(`customer.dashboard.earn_${step.id}_title`);
    const desc = document.createElement('span');
    desc.className = 'earn-journey__step-desc';
    desc.textContent = t(`customer.dashboard.earn_${step.id}_desc`);
    item.append(node, name, desc);
    path.append(item);
  }

  const cta = document.createElement('a');
  cta.className = 'earn-journey__cta';
  cta.href = BECOME_SALER_PATH;
  cta.textContent = `${t('customer.dashboard.earn_cta', 'See how it works')} ›`;
  cta.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    onNavigate(BECOME_SALER_PATH);
  });

  section.append(head, path, cta);
  return { element: section };
}
