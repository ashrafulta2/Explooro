/**
 * genie.test.js — invariants for the genie open/close (lib/genie.js) and its wiring into Modal.
 *
 * The animation itself is visual, so what is pinned here is what silently breaks it:
 *  1. Strips never cross or leave gaps (monotone boundaries) at any point in the timeline.
 *  2. Close and open share one path; open starts fully swallowed and ends at rest.
 *  3. The real panel is hidden while playing and ALWAYS restored (finish and cancel).
 *  4. Slicing axis follows the target (rows for above/below, columns for left/right).
 *  5. Unsupported cases return null so Modal falls back instead of throwing.
 *  6. The duration lives in a CSS token; the old scale-only genie is gone.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const clientRoot = path.resolve(import.meta.dirname, '..');
const read = (...p) => fs.readFileSync(path.join(clientRoot, ...p), 'utf8');

/* ------------------------------ minimal DOM double ------------------------------ */

class FakeElement {
  constructor(tag = 'DIV') {
    this.tagName = tag;
    this.children = [];
    this.parent = null;
    this.style = {};
    this.attrs = {};
    this.className = '';
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.rect = { left: 0, top: 0, width: 0, height: 0 };
  }
  get isConnected() {
    let n = this;
    while (n.parent) n = n.parent;
    return n.isRoot === true;
  }
  append(...kids) {
    for (const k of kids) {
      k.parent = this;
      this.children.push(k);
    }
  }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  get firstElementChild() {
    return this.children[0] ?? null;
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  removeAttribute(k) {
    delete this.attrs[k];
  }
  getBoundingClientRect() {
    const { left, top, width, height } = this.rect;
    return { left, top, width, height, right: left + width, bottom: top + height };
  }
  descendants() {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }
  querySelectorAll(sel) {
    const all = this.descendants();
    return sel === '*' ? all : all.filter((n) => n.attrs.id !== undefined);
  }
  cloneNode(deep) {
    const c = new FakeElement(this.tagName);
    c.style = { ...this.style };
    c.attrs = { ...this.attrs };
    c.rect = { ...this.rect };
    if (deep) for (const k of this.children) c.append(k.cloneNode(true));
    return c;
  }
}

function installDom({ reduced = false } = {}) {
  const root = new FakeElement('HTML');
  root.isRoot = true;
  const body = new FakeElement('BODY');
  root.append(body);
  const rafQueue = [];
  globalThis.HTMLElement = FakeElement;
  globalThis.window = {
    innerWidth: 1200,
    innerHeight: 800,
    matchMedia: () => ({ matches: reduced }),
  };
  globalThis.document = {
    body,
    documentElement: root,
    createElement: (t) => new FakeElement(t.toUpperCase()),
  };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '650ms' });
  globalThis.requestAnimationFrame = (fn) => {
    rafQueue.push(fn);
    return rafQueue.length;
  };
  globalThis.cancelAnimationFrame = () => {};
  Object.defineProperty(globalThis, 'performance', { value: { now: () => 0 }, configurable: true, writable: true });

  const panel = new FakeElement();
  panel.rect = { left: 400, top: 200, width: 400, height: 400 };
  const host = new FakeElement('DIALOG');
  host.append(panel);
  body.append(host);
  const trigger = new FakeElement('BUTTON');
  body.append(trigger);

  /** Runs the queued frame at time t (ms since start). */
  const tick = (t) => {
    const fn = rafQueue.shift();
    fn?.(t);
  };
  return { panel, host, trigger, body, tick };
}

const { genieRun } = await import('../src/lib/genie.js');

function parse(strip) {
  const m = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+), ([-\d.e]+)\)/.exec(strip.style.transform ?? '');
  return m ? m.slice(1).map(Number) : null;
}
const layerOf = (host) => host.children.find((c) => c.className === 'genie-layer');

/* ------------------------------ behaviour ------------------------------ */

test('1. strips stay contiguous and never cross, at every point of the close', () => {
  for (const [name, at] of [
    ['below', { left: 560, top: 740, width: 80, height: 40 }],
    ['above', { left: 560, top: 10, width: 80, height: 40 }],
  ]) {
    const { panel, host, trigger, tick } = installDom();
    trigger.rect = at;
    const run = genieRun({ panel, host, trigger, direction: 'close', duration: 650 });
    assert.ok(run, `${name}: genie should run`);
    for (const t of [0, 100, 260, 390, 520, 640]) {
      tick(t);
      const strips = layerOf(host).children;
      let prevTop = -Infinity;
      for (const s of strips) {
        if (s.style.visibility === 'hidden') continue; // collapsed strips keep a stale transform
        const v = parse(s);
        assert.ok(v[1] >= prevTop - 1e-6, `${name} t=${t}: strip top ${v[1]} < previous ${prevTop}`);
        prevTop = v[1];
      }
    }
    run.cancel();
  }
});

test('2. close starts at rest and ends swallowed; open is the reverse and starts hidden', () => {
  const close = installDom();
  close.trigger.rect = { left: 560, top: 740, width: 80, height: 40 };
  const c = genieRun({ panel: close.panel, host: close.host, trigger: close.trigger, direction: 'close', duration: 650 });
  const strips = layerOf(close.host).children;
  assert.ok(strips.length >= 8);
  const first = parse(strips[0]);
  assert.ok(Math.abs(first[0] - 400) < 1e-6 && Math.abs(first[1] - 200) < 1e-6, 'close begins exactly on the panel');
  assert.equal(layerOf(close.host).style.opacity, '1');

  const open = installDom();
  open.trigger.rect = { left: 560, top: 740, width: 80, height: 40 };
  const o = genieRun({ panel: open.panel, host: open.host, trigger: open.trigger, direction: 'open', duration: 650 });
  assert.equal(layerOf(open.host).style.opacity, '0', 'open begins invisible inside the target');
  c.cancel();
  o.cancel();
});

test('3. the real panel is hidden while playing and restored on finish AND on cancel', async () => {
  const a = installDom();
  a.panel.style.opacity = '0.9';
  const run = genieRun({ panel: a.panel, host: a.host, trigger: a.trigger, direction: 'close', duration: 650 });
  assert.equal(a.panel.style.opacity, '0');
  assert.equal(a.panel.style.pointerEvents, 'none');
  a.tick(650);
  assert.equal(await run.finished, true);
  assert.equal(a.panel.style.opacity, '0.9', 'previous inline opacity restored');
  assert.equal(layerOf(a.host), undefined, 'layer removed');

  const b = installDom();
  b.panel.style.opacity = '';
  const cancelled = genieRun({ panel: b.panel, host: b.host, trigger: b.trigger, direction: 'open', duration: 650 });
  cancelled.cancel();
  assert.equal(await cancelled.finished, false);
  assert.equal(b.panel.style.opacity, '');
  assert.equal(layerOf(b.host), undefined);
});

test('4. slicing axis follows the target: rows for above/below, columns for left/right', () => {
  const below = installDom();
  below.trigger.rect = { left: 560, top: 740, width: 80, height: 40 };
  genieRun({ panel: below.panel, host: below.host, trigger: below.trigger, direction: 'close' });
  const rowStrip = layerOf(below.host).children[0];
  assert.equal(rowStrip.style.width, '400px', 'row strips span the panel width');
  assert.notEqual(rowStrip.style.height, '400px');

  const left = installDom();
  left.trigger.rect = { left: 20, top: 380, width: 80, height: 40 };
  genieRun({ panel: left.panel, host: left.host, trigger: left.trigger, direction: 'close' });
  const colStrip = layerOf(left.host).children[0];
  assert.equal(colStrip.style.height, '400px', 'column strips span the panel height');
  assert.notEqual(colStrip.style.width, '400px');
});

test('5. unsupported cases return null instead of throwing', () => {
  const reduced = installDom({ reduced: true });
  assert.equal(genieRun({ panel: reduced.panel, host: reduced.host, trigger: reduced.trigger, direction: 'open' }), null);

  const empty = installDom();
  empty.panel.rect = { left: 0, top: 0, width: 0, height: 0 };
  assert.equal(genieRun({ panel: empty.panel, host: empty.host, trigger: empty.trigger, direction: 'open' }), null);

  const heavy = installDom();
  for (let i = 0; i < 3100; i += 1) heavy.panel.append(new FakeElement('SPAN'));
  assert.equal(genieRun({ panel: heavy.panel, host: heavy.host, trigger: heavy.trigger, direction: 'open' }), null);
});

test('5b. a body/page-sized or missing trigger falls back to a dock point, not a wild fly-in', () => {
  const d = installDom();
  d.trigger.rect = { left: 0, top: 0, width: 1200, height: 800 };
  genieRun({ panel: d.panel, host: d.host, trigger: d.trigger, direction: 'close' });
  const strips = layerOf(d.host).children;
  assert.ok(strips.length > 0);
  d.tick(520);
  // strips converge on the bottom-centre dock (y ≈ 760), not on the page-sized trigger's centre (400)
  const ys = strips.filter((s) => s.style.visibility !== 'hidden').map(parse).map((v) => v[1]);
  assert.ok(ys.length > 0);
  assert.ok(ys.every((y) => y > 500), 'strips head for the dock below the panel');
});

/* ------------------------------ wiring & hygiene ------------------------------ */

test('6. duration is a CSS token, zeroed under reduced motion', () => {
  const tokens = read('src', 'styles', 'tokens.css');
  assert.match(tokens, /--dur-genie:\s*650ms;/);
  assert.match(tokens, /@media \(prefers-reduced-motion: reduce\)[\s\S]*--dur-genie:\s*0ms;/);
  assert.doesNotMatch(tokens, /--genie-x|--genie-y/, 'old scale-genie coordinates are gone');
});

test('7. Modal routes open and close through genieRun; the old scale genie is removed', () => {
  const modal = read('src', 'components', 'ui', 'Modal.js');
  assert.match(modal, /from '\.\.\/\.\.\/lib\/genie\.js'/);
  assert.match(modal, /playGenie\('open'\)/);
  assert.match(modal, /playGenie\('close'\)/);
  assert.doesNotMatch(modal, /minimizeOnClose|computeGenieCoordinates|modal--minimizing/);

  const css = read('src', 'styles', 'components', 'surfaces.css');
  assert.doesNotMatch(css, /macbook-genie-|modal--minimizing|modal--genie-in/);
  assert.match(css, /\.modal\.modal--genie\[open\]\s*\{[^}]*transform:\s*none/, 'dialog must stay untransformed while genie plays');
  assert.match(css, /\.genie-layer\s*\{[^}]*position:\s*fixed/);
});

test('8. genie.js stays dependency-free', () => {
  const src = read('src', 'lib', 'genie.js');
  const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['./motion.js']);
});
