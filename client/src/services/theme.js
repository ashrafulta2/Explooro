/**
 * theme.js — light/dark/system theme, persisted.
 *
 * Extracted from TopBar.js (Prompt 1.7) so Prompt 1.8's gallery can drive the exact same
 * `data-theme` toggle the real shell uses, rather than a second implementation that could drift
 * out of sync with which values are valid or which storage key holds them.
 */

const THEME_KEY = 'explooro:theme';

export const THEME_OPTIONS = ['light', 'dark', 'system'];

export function getTheme() {
  try {
    return localStorage.getItem(THEME_KEY) ?? 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private browsing — theme just won't survive a reload, not worth failing over.
  }
}

// Applied once at module load so a reload doesn't flash back to system theme before any consumer
// (TopBar, GalleryPage) mounts.
applyTheme(getTheme());
