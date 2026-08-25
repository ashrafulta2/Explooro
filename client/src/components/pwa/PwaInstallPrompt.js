/**
 * PwaInstallPrompt.js — Contextual Progressive Web App Install Banner (Prompt 11.6).
 *
 * Implements:
 * 1. Captures `beforeinstallprompt` event.
 * 2. Defers display until an appropriate moment (after engagement / 2 page views, never on first load).
 * 3. 1-Tap native installation prompt trigger.
 * 4. Dismissal cooldown handling (7 days) via localStorage.
 */

let deferredPrompt = null;
const DISMISS_KEY = 'explooro_pwa_dismissed_at';
const ENGAGEMENT_COUNT_KEY = 'explooro_pwa_page_views';

export function initPwaInstallPrompt() {
  if (typeof window === 'undefined') return;

  // Increment engagement page view count
  const views = parseInt(localStorage.getItem(ENGAGEMENT_COUNT_KEY) || '0', 10) + 1;
  localStorage.setItem(ENGAGEMENT_COUNT_KEY, String(views));

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;

    // Check dismissal cooldown (7 days)
    const dismissedAt = localStorage.getItem(DISMISS_KEY);
    if (dismissedAt) {
      const daysSince = (Date.now() - parseInt(dismissedAt, 10)) / (1000 * 3600 * 24);
      if (daysSince < 7) return;
    }

    // Only show after user has engaged (at least 2 views or after 3 seconds)
    if (views >= 2) {
      setTimeout(showInstallBanner, 2000);
    }
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hideInstallBanner();
    console.log('[PWA] Explooro app was successfully installed!');
  });
}

export function showInstallBanner() {
  if (!deferredPrompt || document.getElementById('pwa-install-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'pwa-install-banner';
  // WHY tokens and not hexes: the three colours below were a hand-pasted copy of neutral-900/0/700
  // from the pink era, so the banner kept wearing the old palette once themes.css was regenerated
  // from the master seed. Anything that names a hex here is invisible to a re-theme.
  banner.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 20px;
    right: 20px;
    max-width: 440px;
    margin: 0 auto;
    z-index: 9998;
    background: var(--neutral-900);
    color: var(--neutral-0);
    border: 1px solid var(--neutral-700);
    border-radius: 16px;
    padding: 16px 20px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  `;

  banner.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px;">
      <img src="/icons/icon-192.svg" alt="Explooro" style="width: 42px; height: 42px; border-radius: 10px;" />
      <div>
        <div style="font-weight: 700; font-size: 14px; color: #ffffff;">Install Explooro App</div>
        <div style="font-size: 12px; color: #94a3b8;">Fast, offline-ready & instant access</div>
      </div>
    </div>
    <div style="display: flex; align-items: center; gap: 8px;">
      <button id="pwa-install-btn" style="
        background: #a6337e;
        color: #ffffff;
        border: none;
        padding: 8px 16px;
        border-radius: 9999px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      ">Install</button>
      <button id="pwa-dismiss-btn" style="
        background: transparent;
        color: #94a3b8;
        border: none;
        font-size: 18px;
        padding: 4px 8px;
        cursor: pointer;
      ">✕</button>
    </div>
  `;

  document.body.appendChild(banner);

  document.getElementById('pwa-install-btn')?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    banner.remove();
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`[PWA] Install prompt outcome: ${outcome}`);
    deferredPrompt = null;
  });

  document.getElementById('pwa-dismiss-btn')?.addEventListener('click', () => {
    banner.remove();
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  });
}

function hideInstallBanner() {
  document.getElementById('pwa-install-banner')?.remove();
}
