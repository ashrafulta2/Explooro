/**
 * PlatformSubnav.js — Reusable Navigation Tab Strip for the Super Admin Platform suite.
 *
 * Connects all 5 core platform governance surfaces:
 * 1. Module Toggles (/admin/platform/modules)
 * 2. Theme Studio (/admin/platform/theme)
 * 3. Integrations (/admin/platform/integrations)
 * 4. API Keys & Developer Portal (/admin/platform/api-keys)
 * 5. Platform Settings (/admin/platform/settings)
 */

import { getLanguage } from '../../services/i18n.js';

export function PlatformSubnav({ activeKey = 'integrations', navigate = null } = {}) {
  const isBn = getLanguage() === 'bn';
  const normalizedActiveKey = String(activeKey || '').replace(/-/g, '_').toLowerCase();

  const tabs = [
    { key: 'modules', label: isBn ? 'মডিউল টগল' : 'Module Toggles', href: '/admin/platform/modules', icon: '🎛️' },
    { key: 'theme', label: isBn ? 'থিম স্টুডিও' : 'Theme Studio', href: '/admin/platform/theme', icon: '🎨' },
    { key: 'integrations', label: isBn ? 'ইন্টিগ্রেশন' : 'Integrations', href: '/admin/platform/integrations', icon: '🔌' },
    { key: 'apikeys', label: isBn ? 'এপিআই কী' : 'API Keys', href: '/admin/platform/api-keys', icon: '⚡' },
    { key: 'settings', label: isBn ? 'প্ল্যাটফর্ম সেটিংস' : 'Settings', href: '/admin/platform/settings', icon: '⚙️' },
  ];

  const nav = document.createElement('nav');
  nav.className = 'platform-subnav';
  nav.setAttribute('aria-label', isBn ? 'প্ল্যাটফর্ম নেভিগেশন' : 'Platform Navigation');

  nav.innerHTML = `
    <div class="platform-subnav__track">
      ${tabs
        .map((tab) => {
          const isActive =
            tab.key === normalizedActiveKey ||
            tab.key === activeKey ||
            (tab.key === 'apikeys' && (normalizedActiveKey === 'api_keys' || activeKey === 'api-keys'));

          return `
            <a
              href="${tab.href}"
              class="platform-subnav__tab ${isActive ? 'platform-subnav__tab--active' : ''}"
              aria-current="${isActive ? 'page' : 'false'}"
            >
              <span class="platform-subnav__tab-icon" aria-hidden="true">${tab.icon}</span>
              <span class="platform-subnav__tab-label">${tab.label}</span>
            </a>
          `;
        })
        .join('')}
    </div>
  `;

  if (typeof navigate === 'function' && typeof nav.querySelectorAll === 'function') {
    nav.querySelectorAll('.platform-subnav__tab').forEach((tabEl) => {
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

export default PlatformSubnav;
