/**
 * uiStyle.ts — the component style layer that sits beside the master colour.
 *
 * The master colour (services/colorRamp.ts) decides WHAT colour things are. A UI style decides
 * what the controls are SHAPED like: font stack, type size, corner radius, control height, focus
 * halo, menus, sidebar selection, segmented tabs. The two are independent on purpose, so an admin
 * can run the macOS shapes on the Gold seed, or the standard shapes on the macOS blue.
 *
 * A theme carries the choice as `tokens.ui_style`. 'standard' is the shipped look and needs no
 * stylesheet; every other style is an `[data-ui-style]` attribute on <html> plus a stylesheet
 * scoped under it.
 *
 * WHY the stylesheet is a dynamic import and not in main.css: entry CSS is on a 70KB gzipped
 * budget with almost no headroom, and most deployments never switch style. Vite emits the sheet as
 * its own chunk; only a browser showing the macOS style downloads it.
 *
 * The list of styles is mirrored in server/src/services/theme.service.ts (`UI_STYLES`), which
 * refuses anything else on save. client/test/uiStyle.test.js fails if the two drift.
 */

export const UI_STYLES = ['standard', 'macos'] as const;
export type UiStyle = (typeof UI_STYLES)[number];
export const DEFAULT_UI_STYLE: UiStyle = 'standard';

export function normaliseUiStyle(value: unknown): UiStyle {
  return (UI_STYLES as readonly string[]).includes(value as string) ? (value as UiStyle) : DEFAULT_UI_STYLE;
}

let macosSheet: Promise<unknown> | null = null;
let current: UiStyle = DEFAULT_UI_STYLE;

function loadMacosSheet(): Promise<unknown> {
  if (!macosSheet) {
    macosSheet = import('../styles/ui-macos.css').catch(() => {
      // A failed sheet must never break the page: the attribute stays, the standard look shows,
      // and the next apply retries.
      macosSheet = null;
    });
  }
  return macosSheet;
}

/** Puts `style` on the live document. Safe to call repeatedly with the same value. */
export function applyUiStyle(style: unknown): UiStyle {
  const next = normaliseUiStyle(style);
  current = next;
  if (typeof document === 'undefined') return next;
  const root = document.documentElement;
  if (next === 'standard') {
    delete root.dataset.uiStyle;
    return next;
  }
  // Every rule lives in the lazy sheet, so setting the attribute before it lands paints nothing
  // early; the look switches in one step when the chunk arrives.
  root.dataset.uiStyle = next;
  loadMacosSheet();
  return next;
}

export function getUiStyle(): UiStyle {
  return current;
}
