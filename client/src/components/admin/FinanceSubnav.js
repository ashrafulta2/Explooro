/**
 * FinanceSubnav.js — Reusable Navigation Tab Strip for the Super Admin Finance suite.
 *
 * Connects all 7 core platform financial surfaces:
 * Overview, Ledger, Escrow Holdings, Payout Queue, Profit Splits, B2B Escrow, and Subscriptions.
 */

import { t, getLanguage } from '../../services/i18n.js';

export function FinanceSubnav({ activeKey = 'splits', navigate = null } = {}) {
  const isBn = getLanguage() === 'bn';
  const normalizedActiveKey = String(activeKey || '').replace(/-/g, '_');

  const tabs = [
    { key: 'overview', label: isBn ? 'ওভারভিউ' : 'Overview', href: '/admin/finance', icon: '📊' },
    { key: 'ledger', label: isBn ? 'লেজার' : 'Ledger', href: '/admin/finance/ledger', icon: '📑' },
    { key: 'escrow', label: isBn ? 'এসক্রো' : 'Escrow', href: '/admin/finance/escrow', icon: '⏳' },
    { key: 'payouts', label: isBn ? 'পেআউট' : 'Payouts', href: '/admin/finance/payouts', icon: '💸' },
    { key: 'splits', label: isBn ? 'প্রফিট স্প্লিট' : 'Profit Splits', href: '/admin/finance/splits', icon: '🍰' },
    { key: 'b2b_escrow', label: isBn ? 'বি২বি এসক্রো' : 'B2B Escrow', href: '/admin/finance/b2b-escrow', icon: '🤝' },
    { key: 'subscriptions', label: isBn ? 'সাবস্ক্রিপশন' : 'Subscriptions', href: '/admin/finance/subscriptions', icon: '🔁' },
  ];

  const nav = document.createElement('nav');
  nav.className = 'finance-subnav';
  nav.setAttribute('aria-label', isBn ? 'ফাইন্যান্স নেভিগেশন' : 'Finance Navigation');

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
