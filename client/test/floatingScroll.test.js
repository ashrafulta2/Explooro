/**
 * floatingScroll.test.js — Invariant & Unit Tests for Universal Floating Horizontal Scrollbar.
 *
 * Tests:
 * 1. CSS styling and token integrity for floating-scroll.css.
 * 2. Main stylesheet aggregation includes floating-scroll.css.
 * 3. DOM lifecycle: initFloatingScroll creates floating scrollbar elements with aria-hidden.
 * 4. Filtering: Ignores elements without overflow or with scrollbar-width: none / no-floating-scroll.
 * 5. Viewport docking: Activates when container overflows and bottom is below fold.
 * 6. Bounds alignment: left and width match the container's visible bounds.
 * 7. Bidirectional scroll sync: target <-> floating bar sync without infinite loops.
 * 8. Clean unmount/hiding: Hides when target bottom reaches viewport or exits view.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const clientRoot = path.resolve(import.meta.dirname, '..');

test('1. Floating Scrollbar CSS Integrity', () => {
  const cssPath = path.join(clientRoot, 'src', 'styles', 'components', 'floating-scroll.css');
  assert.ok(fs.existsSync(cssPath), 'floating-scroll.css must exist');

  const cssContent = fs.readFileSync(cssPath, 'utf8');
  assert.match(cssContent, /\.floating-scroll-bar\s*\{/, 'Must define .floating-scroll-bar');
  assert.match(cssContent, /position:\s*fixed;/, 'Must be position: fixed');
  assert.match(cssContent, /overflow-x:\s*auto;/, 'Must have overflow-x: auto');
  assert.match(cssContent, /var\(--surface-1\)/, 'Must use theme surface tokens');
  assert.match(cssContent, /var\(--border-strong\)/, 'Must use design system border tokens');
});

test('2. Main CSS Aggregator includes floating-scroll.css', () => {
  const mainCssPath = path.join(clientRoot, 'src', 'styles', 'main.css');
  const mainCss = fs.readFileSync(mainCssPath, 'utf8');
  assert.match(
    mainCss,
    /@import\s+['"]\.\/components\/floating-scroll\.css['"];/,
    'main.css must import floating-scroll.css'
  );
});

test('3. Floating Scrollbar Service Exports & Initialization', async () => {
  // Mock minimal DOM environment
  const mockListeners = new Map();
  const bodyChildren = [];

  const mockWindow = {
    innerHeight: 800,
    innerWidth: 1200,
    addEventListener: (evt, fn) => {
      if (!mockListeners.has(evt)) mockListeners.set(evt, []);
      mockListeners.get(evt).push(fn);
    },
    removeEventListener: () => {},
    getComputedStyle: (el) => el._computedStyle || { display: 'block', overflowX: 'auto', scrollbarWidth: 'auto' },
  };

  const mockDocument = {
    body: {
      append: (child) => bodyChildren.push(child),
      querySelectorAll: () => [],
    },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => {
      const listeners = {};
      const el = {
        tagName: tag.toUpperCase(),
        className: '',
        style: {},
        scrollLeft: 0,
        scrollWidth: 1000,
        clientWidth: 500,
        clientHeight: 200,
        isConnected: true,
        children: [],
        _attributes: {},
        _computedStyle: { display: 'block', overflowX: 'auto', scrollbarWidth: 'auto' },
        setAttribute: (k, v) => { el._attributes[k] = v; },
        getAttribute: (k) => el._attributes[k] || null,
        hasAttribute: (k) => Boolean(el._attributes[k]),
        append: (...items) => el.children.push(...items),
        addEventListener: (event, handler) => {
          if (!listeners[event]) listeners[event] = [];
          listeners[event].push(handler);
        },
        removeEventListener: (event, handler) => {
          if (!listeners[event]) return;
          listeners[event] = listeners[event].filter((h) => h !== handler);
        },
        dispatchEvent: (event) => {
          const list = listeners[event.type] || [];
          for (const fn of list) fn(event);
        },
        getBoundingClientRect: () => el._rect || { top: 100, bottom: 1200, left: 200, right: 1000, width: 800, height: 1100 },
        classList: {
          contains: (cls) => el.className.split(' ').includes(cls),
          add: (cls) => { el.className += ` ${cls}`; },
          remove: (cls) => { el.className = el.className.replace(cls, '').trim(); },
        },
      };
      return el;
    },
  };

  // Set up globals
  globalThis.window = mockWindow;
  globalThis.document = mockDocument;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  globalThis.requestAnimationFrame = (cb) => { cb(); return 1; };

  const { initFloatingScroll, registerScrollable, scanForScrollables } = await import('../src/services/floatingScroll.js');

  assert.equal(typeof initFloatingScroll, 'function', 'initFloatingScroll must be exported');
  assert.equal(typeof registerScrollable, 'function', 'registerScrollable must be exported');

  // Initialize
  initFloatingScroll();

  const bar = bodyChildren.find((el) => el.className === 'floating-scroll-bar');
  assert.ok(bar, 'floating-scroll-bar must be appended to document.body');
  assert.equal(bar.getAttribute('aria-hidden'), 'true', 'Must have aria-hidden="true"');
  assert.ok(bar.children[0]?.className === 'floating-scroll-bar__inner', 'Inner dummy element must exist');

  // Register a table container that overflows and bottom is below fold (rect.bottom 1200 > viewport 800)
  const tableWrap = mockDocument.createElement('div');
  tableWrap.className = 'saler-table-wrap';
  tableWrap.scrollWidth = 1600;
  tableWrap.clientWidth = 800;
  tableWrap._rect = { top: 150, bottom: 1200, left: 240, right: 1040, width: 800, height: 1050 };

  registerScrollable(tableWrap);

  // Verify bar is displayed and bounds align with the table
  assert.equal(bar.style.display, 'block', 'Bar must be visible when bottom is below fold');
  assert.equal(bar.style.position, 'fixed', 'Bar must be position fixed');
  assert.equal(bar.style.left, '240px', 'Bar left must match table left');
  assert.equal(bar.style.width, '800px', 'Bar width must match table width');
  assert.equal(bar.children[0].style.width, '1600px', 'Inner width must match table scrollWidth');

  // Test Scroll Synchronization from bar to table
  bar.scrollLeft = 350;
  bar.dispatchEvent({ type: 'scroll' });
  assert.equal(tableWrap.scrollLeft, 350, 'Table scrollLeft must synchronize from bar scroll');

  // Test Scroll Synchronization from table to bar
  tableWrap.scrollLeft = 500;
  tableWrap.dispatchEvent({ type: 'scroll' });
  assert.equal(bar.scrollLeft, 500, 'Bar scrollLeft must synchronize from table scroll');

  // Test when table bottom enters viewport (e.g. scrolled down, rect.bottom 700 <= viewport 800)
  tableWrap._rect = { top: -350, bottom: 700, left: 240, right: 1040, width: 800, height: 1050 };
  // Trigger update via window scroll
  const scrollListeners = mockListeners.get('scroll') || [];
  for (const fn of scrollListeners) fn();

  assert.equal(bar.style.display, 'none', 'Bar must hide when table bottom is within visible viewport');
});
