/**
 * FinanceSubnav.js — Reusable Navigation Tab Strip for the Super Admin Finance suite.
 *
 * Connects all 7 core platform financial surfaces:
 * Overview, Ledger, Escrow Holdings, Payout Queue, Profit Splits, B2B Escrow, and Subscriptions.
 */

import { t } from '../../services/i18n.js';

export function FinanceSubnav({ activeKey = 'splits', navigate = null } = {}) {
  const normalizedActiveKey = String(activeKey || '').replace(/-/g, '_');

  const tabs = [
    { key: 'overview', label: t('finance_subnav.overview'), href: '/admin/finance', icon: '📊' },
    { key: 'ledger', label: t('finance_subnav.ledger'), href: '/admin/finance/ledger', icon: '📑' },
    { key: 'escrow', label: t('finance_subnav.escrow'), href: '/admin/finance/escrow', icon: '⏳' },
    { key: 'payouts', label: t('finance_subnav.payouts'), href: '/admin/finance/payouts', icon: '💸' },
    { key: 'splits', label: t('finance_subnav.splits'), href: '/admin/finance/splits', icon: '🍰' },
    { key: 'b2b_escrow', label: t('finance_subnav.b2b_escrow'), href: '/admin/finance/b2b-escrow', icon: '🤝' },
    { key: 'subscriptions', label: t('finance_subnav.subscriptions'), href: '/admin/finance/subscriptions', icon: '🔁' },
  ];

  const nav = document.createElement('nav');
  nav.className = 'finance-subnav';
  nav.setAttribute('aria-label', t('finance_subnav.aria_label'));

  nav.innerHTML = `
    <div class="finance-subnav__track">
      ${tabs
        .map((tab) => {
          const isActive = tab.key === normalizedActiveKey || tab.key === activeKey;
          return `
            <a
              href="${tab.href}"
              class="finance-subnav__tab ${isActive ? 'finance-subnav__tab--active' : ''}"
              aria-current="${isActive ? 'page' : 'false'}"
            >
              <span class="finance-subnav__tab-icon" aria-hidden="true">${tab.icon}</span>
              <span class="finance-subnav__tab-label">${tab.label}</span>
            </a>
          `;
        })
        .join('')}
    </div>
  `;

  if (typeof navigate === 'function' && typeof nav.querySelectorAll === 'function') {
    nav.querySelectorAll('.finance-subnav__tab').forEach((tabEl) => {
      tabEl.addEventListener('click', (e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        const href = tabEl.getAttribute('href');
        if (href) {
          navigate(href);
        }
      });
    });
  }

  return nav;
}
