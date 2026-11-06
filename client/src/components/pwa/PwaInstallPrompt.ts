/**
 * PwaInstallPrompt.ts — Contextual Progressive Web App Install Banner (Prompt 11.6).
 *
 * Implements:
 * 1. Captures `beforeinstallprompt` event (Chrome, Edge, Samsung Internet).
 * 2. Defers display until an appropriate moment (after engagement / 2 page views, never on first load).
 * 3. 1-Tap native installation prompt trigger.
 * 4. Dismissal cooldown handling (7 days) via localStorage.
 * 5. On iPhone and iPad, a hint that explains Share → Add to Home Screen instead.
 */

import { t } from '../../services/i18n.ts';

let deferredPrompt: any = null;
const DISMISS_KEY = 'explooro_pwa_dismissed_at';
const ENGAGEMENT_COUNT_KEY = 'explooro_pwa_page_views';
const BANNER_ID = 'pwa-install-banner';
const DISMISS_COOLDOWN_DAYS = 7;
const MIN_PAGE_VIEWS = 2;
const SHOW_DELAY_MS = 2000;

/** The iOS share glyph (a box with an arrow out of the top), so the hint shows the button to tap. */
const IOS_SHARE_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align: -3px;"><path d="M12 3v12"></path><path d="M8 7l4-4 4 4"></path><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"></path></svg>';

export interface InstallEnvironment {
  userAgent: string;
  maxTouchPoints: number;
  /** True when already running as an installed app. */
  standalone: boolean;
}

/**
 * WHY a separate hint for iOS: Safari never fires `beforeinstallprompt`, so the normal banner can
 * never appear there. The only way to install is Share → Add to Home Screen, which people rarely
 * find on their own.
 *
 * In-app browsers (Facebook, Instagram, Messenger, LINE) are left out: their share menu has no
 * Add to Home Screen, so the hint would ask for something that cannot be done.
 */
export function needsIosInstallHint({ userAgent, maxTouchPoints, standalone }: InstallEnvironment): boolean {
  if (standalone) return false;
  const iPhoneOrIPad = /iPhone|iPad|iPod/.test(userAgent);
  // iPadOS 13+ says it is a Mac; only the touch screen gives it away.
  const iPadAsMac = /Macintosh/.test(userAgent) && maxTouchPoints > 1;
  if (!iPhoneOrIPad && !iPadAsMac) return false;
  return !/FBAN|FBAV|FB_IAB|Instagram|Messenger|Line\//.test(userAgent);
}

function currentEnvironment(): InstallEnvironment {
  const standalone = (navigator as any).standalone === true
    || window.matchMedia?.('(display-mode: standalone)').matches === true;
  return { userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints || 0, standalone };
}

// WHY try/catch: storage can throw (blocked site data, some private modes). The banner is a nicety,
// so a storage failure must never stop the app from booting.
function readStorage(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* see readStorage */ }
}

function recentlyDismissed(): boolean {
  const dismissedAt = readStorage(DISMISS_KEY);
  if (!dismissedAt) return false;
  const daysSince = (Date.now() - parseInt(dismissedAt, 10)) / (1000 * 3600 * 24);
  return daysSince < DISMISS_COOLDOWN_DAYS;
}

export function initPwaInstallPrompt() {
  if (typeof window === 'undefined') return;

  // Increment engagement page view count
  const views = parseInt(readStorage(ENGAGEMENT_COUNT_KEY) || '0', 10) + 1;
  writeStorage(ENGAGEMENT_COUNT_KEY, String(views));
  const engaged = views >= MIN_PAGE_VIEWS;

  if (engaged && !recentlyDismissed() && needsIosInstallHint(currentEnvironment())) {
    setTimeout(showIosInstallHint, SHOW_DELAY_MS);
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (engaged && !recentlyDismissed()) setTimeout(showInstallBanner, SHOW_DELAY_MS);
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hideInstallBanner();
    console.log('[PWA] Explooro app was successfully installed!');
  });
}

/**
 * Builds the banner shell shared by both variants and returns the slots to fill. Text is set with
 * textContent, never interpolated into HTML.
 */
function createBanner({ title, body, actionLabel }: { title: string; body: string; actionLabel?: string }) {
  const banner = document.createElement('div');
  banner.id = BANNER_ID;
  banner.setAttribute('role', 'region');
  banner.setAttribute('aria-label', title);
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
    flex-wrap: nowrap;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  `;

  // WHY every flex here says flex-wrap: nowrap: shell.css makes any inline `display: flex` without
  // its own flex-wrap wrap on phones, which put the icon above the text and the ✕ on a third row.
  banner.innerHTML = `
    <div style="display: flex; flex-wrap: nowrap; align-items: center; gap: 12px; min-width: 0;">
      <img src="/icons/icon-192.svg" alt="" style="width: 42px; height: 42px; border-radius: 10px; flex-shrink: 0;" />
      <div style="min-width: 0;">
        <div data-slot="title" style="font-weight: 700; font-size: 14px; color: var(--neutral-0);"></div>
        <div data-slot="body" style="font-size: 12px; line-height: 1.5; color: var(--neutral-400);"></div>
      </div>
    </div>
    <div style="display: flex; flex-wrap: nowrap; align-items: center; gap: 8px; flex-shrink: 0;">
      ${actionLabel ? `<button type="button" id="pwa-install-btn" style="
        background: var(--brand-900);
        color: var(--neutral-0);
        border: none;
        padding: 8px 16px;
        border-radius: 9999px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      "></button>` : ''}
      <button type="button" id="pwa-dismiss-btn" style="
        background: transparent;
        color: var(--neutral-400);
        border: none;
        font-size: 18px;
        padding: 4px 8px;
        cursor: pointer;
      ">✕</button>
    </div>
  `;

  (banner.querySelector('[data-slot="title"]') as HTMLElement).textContent = title;
  const bodyEl = banner.querySelector('[data-slot="body"]') as HTMLElement;
  bodyEl.textContent = body;
  const installBtn = banner.querySelector('#pwa-install-btn') as HTMLButtonElement | null;
  if (installBtn && actionLabel) installBtn.textContent = actionLabel;
  const dismissBtn = banner.querySelector('#pwa-dismiss-btn') as HTMLButtonElement;
  dismissBtn.setAttribute('aria-label', t('pwa.dismiss'));
  dismissBtn.addEventListener('click', () => {
    banner.remove();
    writeStorage(DISMISS_KEY, String(Date.now()));
  });

  return { banner, bodyEl, installBtn };
}

export function showInstallBanner() {
  if (!deferredPrompt || document.getElementById(BANNER_ID)) return;

  const { banner, installBtn } = createBanner({
    title: t('pwa.install.title'),
    body: t('pwa.install.body'),
    actionLabel: t('pwa.install.action'),
  });
  document.body.appendChild(banner);

  installBtn?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    banner.remove();
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`[PWA] Install prompt outcome: ${outcome}`);
    deferredPrompt = null;
  });
}

/** iPhone / iPad: no install button exists, so the banner shows where to tap instead. */
export function showIosInstallHint() {
  if (document.getElementById(BANNER_ID)) return;

  const { banner, bodyEl } = createBanner({
    title: t('pwa.ios.title'),
    body: t('pwa.ios.body'),
  });
  // The share glyph goes in front of the text, so people can match it to the button on screen.
  bodyEl.insertAdjacentHTML('afterbegin', `${IOS_SHARE_SVG} `);
  document.body.appendChild(banner);
}

function hideInstallBanner() {
  document.getElementById(BANNER_ID)?.remove();
}
