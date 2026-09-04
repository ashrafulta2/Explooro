/**
 * a11y-audit.js — In-Page Accessibility Auditor & Floating Dev Badge (Prompt 1.9).
 *
 * Scans the live DOM for 7 core accessibility rules without any external dependencies:
 *  1. Images without alt attribute.
 *  2. Buttons without accessible names.
 *  3. Form controls without labels.
 *  4. Contrast AA failures (computed text vs surface luminance).
 *  5. Positive tabindex values (> 0).
 *  6. Duplicate DOM IDs.
 *  7. Missing or empty lang attributes.
 *
 * DEV-only: Dead-code eliminated in production builds.
 */

import '../styles/components/a11y-badge.css';

let observer = null;
let debounceTimer = null;
let badgeRoot = null;
let panelOpen = false;
let currentViolations = [];
let highlightedEl = null;

// Reusable 1x1 canvas for resolving modern CSS color functions (OKLCH, hex, rgb, lab, etc.) to RGBA
let canvasCtx = null;
function getColorRgba(colorStr) {
  if (!colorStr || colorStr === 'transparent' || colorStr === 'inherit') {
    return [0, 0, 0, 0];
  }
  if (!canvasCtx) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    canvasCtx = canvas.getContext('2d', { willReadFrequently: true });
  }
  canvasCtx.clearRect(0, 0, 1, 1);
  canvasCtx.fillStyle = '#00000000';
  canvasCtx.fillStyle = colorStr;
  canvasCtx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = canvasCtx.getImageData(0, 0, 1, 1).data;
  return [r, g, b, a / 255];
}

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function getRelativeLuminance([r, g, b]) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function calculateContrastRatio(fgRgba, bgRgba) {
  // If foreground has alpha, blend onto background
  let [fr, fg, fb, fa] = fgRgba;
  const [br, bg, bb] = bgRgba;
  if (fa < 1) {
    fr = Math.round(fr * fa + br * (1 - fa));
    fg = Math.round(fg * fa + bg * (1 - fa));
    fb = Math.round(fb * fa + bb * (1 - fa));
  }
  const l1 = getRelativeLuminance([fr, fg, fb]);
  const l2 = getRelativeLuminance([br, bg, bb]);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Paints `src` over `dst` the way the browser does (straight-alpha "over" compositing). */
function compositeOver(src, dst) {
  const a = src[3];
  if (a <= 0) return dst;
  if (a >= 1) return src;
  return [
    Math.round(src[0] * a + dst[0] * (1 - a)),
    Math.round(src[1] * a + dst[1] * (1 - a)),
    Math.round(src[2] * a + dst[2] * (1 - a)),
    1,
  ];
}

/**
 * The colour actually painted behind `el`, compositing every translucent layer between it and the
 * first opaque ancestor.
 *
 * WHY not "first ancestor with alpha > 0.8": that was the previous rule, and it DISCARDED a
 * translucent layer instead of blending through it. A perfectly ordinary 75%-opaque scrim — the
 * view-count badge sitting on a story thumbnail, every `rgba(…, 0.12)` status tint — was skipped,
 * and its white text got compared against the near-white page canvas far behind it. That reported
 * 1.06:1 for text the browser renders at about 13:1, so the auditor manufactured failures on
 * correct markup and, worse, taught anyone reading its output to distrust it. Blending down the
 * stack is both what the browser does and what WCAG's contrast definition assumes.
 */
function getEffectiveBackgroundColor(el) {
  const layers = [];
  let current = el;

  while (current && current !== document.documentElement) {
    const rgba = getColorRgba(window.getComputedStyle(current).backgroundColor);
    if (rgba[3] > 0) {
      layers.push(rgba);
      if (rgba[3] >= 1) break; // opaque — nothing below it can show through
    }
    current = current.parentElement;
  }

  const rootStyle = window.getComputedStyle(document.body || document.documentElement);
  const rootRgba = getColorRgba(rootStyle.backgroundColor);
  let result = rootRgba[3] >= 1 ? rootRgba : [255, 255, 255, 1];

  // Bottom-up: the nearest ancestor was pushed first, so paint the list in reverse.
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    result = compositeOver(layers[i], result);
  }
  return result;
}

function isElementVisible(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
  if (el.closest('.a11y-badge-root') || el.closest('[data-a11y-ignore]')) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getElementSelector(el) {
  if (!el) return 'unknown';
  let desc = el.tagName.toLowerCase();
  if (el.id) desc += `#${el.id}`;
  else if (el.className && typeof el.className === 'string') {
    const firstClass = el.className.trim().split(/\s+/)[0];
    if (firstClass) desc += `.${firstClass}`;
  }
  return desc;
}

/* -------------------------------------------------------------------------
 * Audit Rules
 * ---------------------------------------------------------------------- */

export function runA11yAudit(root = document.body) {
  if (!root) return [];
  const violations = [];

  // 1. Missing or empty Lang attribute
  const htmlLang = document.documentElement.getAttribute('lang');
  if (!htmlLang || !htmlLang.trim()) {
    violations.push({
      rule: 'MISSING_LANG',
      category: 'Language',
      message: '<html> element is missing a valid lang attribute.',
      target: 'html',
      element: document.documentElement,
    });
  }

  // 2. Duplicate IDs
  const idMap = new Map();
  const elementsWithId = root.querySelectorAll('[id]');
  elementsWithId.forEach((el) => {
    if (el.closest('.a11y-badge-root')) return;
    const id = el.id.trim();
    if (!id) return;
    if (idMap.has(id)) {
      idMap.set(id, idMap.get(id) + 1);
    } else {
      idMap.set(id, 1);
    }
  });

  idMap.forEach((count, id) => {
    if (count > 1) {
      const firstEl = root.querySelector(`[id="${CSS.escape(id)}"]`);
      violations.push({
        rule: 'DUPLICATE_ID',
        category: 'Markup',
        message: `ID "${id}" is duplicated across ${count} elements.`,
        target: `#${id}`,
        element: firstEl,
      });
    }
  });

  // 3. Positive Tabindex
  const positiveTabs = root.querySelectorAll('[tabindex]');
  positiveTabs.forEach((el) => {
    if (el.closest('.a11y-badge-root')) return;
    const tabIndex = parseInt(el.getAttribute('tabindex'), 10);
    if (tabIndex > 0) {
      violations.push({
        rule: 'POSITIVE_TABINDEX',
        category: 'Keyboard',
        message: `Positive tabindex (${tabIndex}) disrupts natural keyboard navigation. Use 0 or -1.`,
        target: getElementSelector(el),
        element: el,
      });
    }
  });

  // 4. Images without alt attribute
  const images = root.querySelectorAll('img');
  images.forEach((img) => {
    if (img.closest('.a11y-badge-root')) return;
    if (!img.hasAttribute('alt')) {
      violations.push({
        rule: 'IMAGE_MISSING_ALT',
        category: 'Images',
        message: 'Image is missing an alt attribute. Provide descriptive alt text or alt="" for decorative images.',
        target: getElementSelector(img),
        element: img,
      });
    }
  });

  // 5. Buttons without accessible names
  const buttons = root.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]');
  buttons.forEach((btn) => {
    if (btn.closest('.a11y-badge-root') || !isElementVisible(btn)) return;
    const hasText = (btn.innerText || btn.textContent || '').trim().length > 0;
    const hasAriaLabel = (btn.getAttribute('aria-label') || '').trim().length > 0;
    const hasAriaLabelledBy = !!btn.getAttribute('aria-labelledby');
    const hasTitle = (btn.getAttribute('title') || '').trim().length > 0;
    const hasValue = (btn.value || '').trim().length > 0;

    if (!hasText && !hasAriaLabel && !hasAriaLabelledBy && !hasTitle && !hasValue) {
      violations.push({
        rule: 'BUTTON_NAMELESS',
        category: 'Buttons',
        message: 'Button has no accessible name. Add visible text, aria-label, or title.',
        target: getElementSelector(btn),
        element: btn,
      });
    }
  });

  // 6. Form controls without labels
  const formControls = root.querySelectorAll('input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]), select, textarea');
  formControls.forEach((ctrl) => {
    if (ctrl.closest('.a11y-badge-root') || !isElementVisible(ctrl)) return;
    const hasAriaLabel = (ctrl.getAttribute('aria-label') || '').trim().length > 0;
    const hasAriaLabelledBy = !!ctrl.getAttribute('aria-labelledby');
    const hasWrappingLabel = !!ctrl.closest('label');
    const id = ctrl.id;
    const hasForLabel = id ? !!document.querySelector(`label[for="${CSS.escape(id)}"]`) : false;

    if (!hasAriaLabel && !hasAriaLabelledBy && !hasWrappingLabel && !hasForLabel) {
      violations.push({
        rule: 'INPUT_UNLABELLED',
        category: 'Forms',
        message: 'Form control is missing an associated label or aria-label.',
        target: getElementSelector(ctrl),
        element: ctrl,
      });
    }
  });

  // 7. Contrast AA Compliance (Normal text ≥ 4.5:1, Large text ≥ 3.0:1)
  const textElements = root.querySelectorAll('p, h1, h2, h3, h4, h5, h6, span, a, label, li, td, th, dt, dd, button, input');
  textElements.forEach((el) => {
    if (el.closest('.a11y-badge-root') || !isElementVisible(el)) return;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return; // WCAG exempts disabled controls
    if (el.children.length > 0 && !Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim())) {
      return; // Skip container elements without direct text
    }
    const directText = (el.textContent || '').trim();
    if (!directText) return;

    const style = window.getComputedStyle(el);
    const fgColor = getColorRgba(style.color);
    if (fgColor[3] === 0) return; // Transparent text

    const bgColor = getEffectiveBackgroundColor(el);
    const ratio = calculateContrastRatio(fgColor, bgColor);

    const fontSize = parseFloat(style.fontSize);
    const fontWeight = parseInt(style.fontWeight, 10) || 400;
    const isLargeText = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
    const requiredRatio = isLargeText ? 3.0 : 4.5;

    if (ratio < requiredRatio - 0.05) {
      violations.push({
        rule: 'CONTRAST_FAIL',
        category: 'Contrast',
        message: `Contrast ratio is ${ratio.toFixed(2)}:1 (minimum ${requiredRatio}:1 required). Text: "${directText.slice(0, 30)}"`,
        target: getElementSelector(el),
        element: el,
      });
    }
  });

  return violations;
}

/* -------------------------------------------------------------------------
 * UI Renderer & Badge Management
 * ---------------------------------------------------------------------- */

function renderBadge() {
  if (!badgeRoot) {
    badgeRoot = document.createElement('div');
    badgeRoot.className = 'a11y-badge-root';
    badgeRoot.setAttribute('data-a11y-ignore', 'true');
    document.body.appendChild(badgeRoot);
  }

  const issueCount = currentViolations.length;
  const status = issueCount === 0 ? 'pass' : 'fail';

  badgeRoot.innerHTML = `
    ${panelOpen ? renderPanelHtml(currentViolations) : ''}
    <button type="button" class="a11y-badge-trigger" data-status="${status}" aria-label="A11y Audit: ${issueCount} issues">
      <span class="a11y-badge-dot"></span>
      <span>A11y</span>
      <span class="a11y-badge-count">${issueCount} ${issueCount === 1 ? 'issue' : 'issues'}</span>
    </button>
  `;

  // Attach event listeners
  const trigger = badgeRoot.querySelector('.a11y-badge-trigger');
  if (trigger) {
    trigger.addEventListener('click', () => {
      panelOpen = !panelOpen;
      renderBadge();
    });
  }

  if (panelOpen) {
    const closeBtn = badgeRoot.querySelector('#a11y-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        panelOpen = false;
        renderBadge();
      });
    }

    const rescanBtn = badgeRoot.querySelector('#a11y-rescan-btn');
    if (rescanBtn) {
      rescanBtn.addEventListener('click', () => {
        auditAndRender();
      });
    }

    const inspectBtns = badgeRoot.querySelectorAll('.a11y-issue-inspect-btn');
    inspectBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.currentTarget.getAttribute('data-index'), 10);
        const violation = currentViolations[index];
        if (violation && violation.element) {
          highlightElement(violation.element);
        }
      });
    });
  }
}

function renderPanelHtml(violations) {
  const issueCount = violations.length;

  const categories = {
    Images: 0,
    Buttons: 0,
    Forms: 0,
    Contrast: 0,
    Keyboard: 0,
    Markup: 0,
    Language: 0,
  };

  violations.forEach((v) => {
    if (categories[v.category] !== undefined) {
      categories[v.category]++;
    }
  });

  return `
    <div class="a11y-panel" role="region" aria-label="Accessibility Audit Inspector">
      <div class="a11y-panel-header">
        <div class="a11y-panel-title">
          <span>🔍 A11y Auditor</span>
          <span class="a11y-badge-count">${issueCount}</span>
        </div>
        <div class="a11y-panel-actions">
          <button type="button" id="a11y-rescan-btn" class="a11y-btn-sm">Re-scan</button>
          <button type="button" id="a11y-close-btn" class="a11y-btn-sm" aria-label="Close panel">✕</button>
        </div>
      </div>
      <div class="a11y-panel-body">
        <div class="a11y-summary-grid">
          ${Object.entries(categories)
            .map(
              ([cat, count]) => `
            <div class="a11y-summary-item">
              <span>${cat}</span>
              <span style="color: ${count > 0 ? 'var(--danger)' : 'var(--success)'}">${count}</span>
            </div>
          `
            )
            .join('')}
        </div>

        ${
          issueCount === 0
            ? `
          <div class="a11y-all-clear">
            <span class="a11y-all-clear-icon">✓</span>
            <span class="a11y-all-clear-text">All Clear</span>
            <span class="a11y-all-clear-sub">Zero accessibility violations detected on this page.</span>
          </div>
        `
            : `
          <ul class="a11y-issue-list">
            ${violations
              .map(
                (v, idx) => `
              <li class="a11y-issue-item">
                <div class="a11y-issue-meta">
                  <span class="a11y-issue-rule">${v.rule}</span>
                  <span class="a11y-issue-target">${v.target}</span>
                </div>
                <div class="a11y-issue-msg">${v.message}</div>
                <button type="button" class="a11y-issue-inspect-btn" data-index="${idx}">Highlight Element</button>
              </li>
            `
              )
              .join('')}
          </ul>
        `
        }
      </div>
    </div>
  `;
}

function highlightElement(el) {
  if (highlightedEl) {
    highlightedEl.classList.remove('a11y-element-highlight');
  }
  if (!el || !el.scrollIntoView) return;
  highlightedEl = el;
  el.classList.add('a11y-element-highlight');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });

  setTimeout(() => {
    if (highlightedEl === el) {
      el.classList.remove('a11y-element-highlight');
      highlightedEl = null;
    }
  }, 4000);
}

function auditAndRender() {
  currentViolations = runA11yAudit(document.body);
  renderBadge();
}

function scheduleAudit() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    auditAndRender();
  }, 250);
}

/* -------------------------------------------------------------------------
 * Initialization and Lifecycle
 * ---------------------------------------------------------------------- */

export function initA11yAudit() {
  if (!import.meta.env.DEV) return;
  if (badgeRoot) return; // already initialized

  auditAndRender();

  // Watch DOM mutations to auto-rescan
  observer = new MutationObserver((mutations) => {
    const isInternal = mutations.some((m) =>
      m.target.closest ? m.target.closest('.a11y-badge-root') : false
    );
    if (!isInternal) {
      scheduleAudit();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'id', 'aria-label', 'tabindex', 'alt', 'data-theme'],
  });

  // Rescan on navigation/popstate
  window.addEventListener('popstate', scheduleAudit);
}

export function destroyA11yAudit() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (badgeRoot) {
    badgeRoot.remove();
    badgeRoot = null;
  }
  window.removeEventListener('popstate', scheduleAudit);
}
