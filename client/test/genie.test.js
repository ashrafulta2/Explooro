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
 *  7. Smoothness: strips are sheared so the funnel edge is continuous, the clock survives a heavy
 *     first frame, and peak speed/acceleration stay bounded.
 *  8. Admin settings: on/off, duration and quality change what the engine does, and are clamped.
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

const FRAME_MS = 1000 / 60;

function installDom({ reduced = false } = {}) {
  const root = new FakeElement('HTML');
  root.isRoot = true;
  root.style.setProperty = (k, v) => {
    root.style[k] = v;
  };
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

  /** Runs the queued frame at time t (ms on the frame clock). */
  const tick = (t) => {
    const fn = rafQueue.shift();
    fn?.(t);
  };
  /** Plays 60 fps frames until `ms` of frame-clock time has passed since the last call. */
  let clock = 0;
  const advance = (ms) => {
    const end = clock + ms;
    while (clock < end) {
      clock += FRAME_MS;
      tick(clock);
    }
  };
  return { panel, host, trigger, body, tick, advance };
}

const {
  genieRun,
  canGenie,
  canAnimate,
  configureGenie,
  getGenieConfig,
  genieDuration,
  sanitiseGenieConfig,
  GENIE_DEFAULTS,
  GENIE_LIMITS,
  GENIE_QUALITIES,
} = await import('../src/lib/genie.js');

/** Mirrors OVERLAP_PX in genie.js: real content each strip carries past its own boundary. */
const OVERLAP_PX = 4;

/** Applies a strip's matrix3d() to a point given in the strip's own (local) coordinates. */
function project(strip, x, y) {
  const m = /matrix3d\(([^)]+)\)/.exec(strip.style.transform ?? '');
  if (!m) return null;
  const v = m[1].split(',').map(Number);
  const w = v[3] * x + v[7] * y + 1;
  return [(v[0] * x + v[4] * y + v[12]) / w, (v[1] * x + v[5] * y + v[13]) / w];
}

/**
 * The four screen corners of a strip's VISIBLE box (top-left, top-right, bottom-right,
 * bottom-left), i.e. excluding the overlap that is tucked under the next strip.
 */
function corners(strip, vertical = true) {
  const w = parseFloat(strip.style.width);
  const h = parseFloat(strip.style.height);
  const sw = vertical ? w : w - OVERLAP_PX;
  const sh = vertical ? h - OVERLAP_PX : h;
  return [project(strip, 0, 0), project(strip, sw, 0), project(strip, sw, sh), project(strip, 0, sh)];
}
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

/** Distance from point p to the infinite line through a and b, plus where along a→b it falls (0..1). */
function offLine(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return {
    off: Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len,
    at: ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (len * len),
  };
}

/**
 * Where strip i+1's leading corners sit relative to strip i's own side edges (which run on, under
 * the next strip, for the overlap). Continuity means each leading corner lies ON that edge, between
 * the strip's start and its overlap end — i.e. the two strips share one continuous outline.
 */
function edgeGaps(strip, next, vertical) {
  const w = parseFloat(strip.style.width);
  const h = parseFloat(strip.style.height);
  const sides = vertical
    ? [[[0, 0], [0, h]], [[w, 0], [w, h]]]
    : [[[0, 0], [w, 0]], [[0, h], [w, h]]];
  const lead = vertical ? [[0, 0], [w, 0]] : [[0, 0], [0, h]];
  return sides.map(([from, to], k) =>
    offLine(project(next, ...lead[k]), project(strip, ...from), project(strip, ...to))
  );
}
const layerOf = (host) => host.children.find((c) => c.className === 'genie-layer');

/* ------------------------------ behaviour ------------------------------ */

test('1. strips stay contiguous and never cross, at every point of the close', () => {
  for (const [name, at] of [
    ['below', { left: 560, top: 740, width: 80, height: 40 }],
    ['above', { left: 560, top: 10, width: 80, height: 40 }],
  ]) {
    const { panel, host, trigger, advance } = installDom();
    trigger.rect = at;
    const run = genieRun({ panel, host, trigger, direction: 'close', duration: 650 });
    assert.ok(run, `${name}: genie should run`);
    for (let frame = 0; frame < 40; frame += 1) {
      advance(FRAME_MS);
      const layer = layerOf(host);
      if (!layer) break;
      let prevTop = -Infinity;
      for (const s of layer.children) {
        if (s.style.visibility === 'hidden') continue; // collapsed strips keep a stale transform
        const top = corners(s)[0][1];
        assert.ok(top >= prevTop - 1e-6, `${name} frame ${frame}: strip top ${top} < previous ${prevTop}`);
        prevTop = top;
      }
    }
    run.cancel();
  }
});

test('2. close starts at rest; open ALSO starts at rest (1:1 raster), nearly invisible, then collapses', () => {
  const close = installDom();
  close.trigger.rect = { left: 560, top: 740, width: 80, height: 40 };
  const c = genieRun({ panel: close.panel, host: close.host, trigger: close.trigger, direction: 'close', duration: 650 });
  const strips = layerOf(close.host).children;
  assert.ok(strips.length >= 8);
  const [tl] = corners(strips[0]);
  assert.ok(Math.abs(tl[0] - 400) < 1e-3 && Math.abs(tl[1] - 200) < 1e-3, 'close begins exactly on the panel');
  assert.equal(strips[0].style.opacity, '1', 'close begins fully visible');

  // WHY open starts at rest: the browser rasterises a will-change layer once, at its first scale.
  // Starting collapsed would rasterise the popup tiny and then magnify it — the pixelated look.
  const open = installDom();
  open.trigger.rect = { left: 560, top: 740, width: 80, height: 40 };
  const o = genieRun({ panel: open.panel, host: open.host, trigger: open.trigger, direction: 'open', duration: 650 });
  const openStrips = layerOf(open.host).children;
  const [otl, otr] = corners(openStrips[0]);
  assert.ok(Math.abs(otl[0] - 400) < 1e-3 && Math.abs(otr[0] - otl[0] - 400) < 1e-3, 'opening warm-up pose is 1:1');
  assert.ok(openStrips.every((st) => Number(st.style.opacity) > 0 && Number(st.style.opacity) < 0.05), 'and almost invisible');
  open.advance(FRAME_MS * 3);
  assert.ok(openStrips.some((st) => st.style.visibility === 'hidden'), 'then it starts from inside the target');
  c.cancel();
  o.cancel();
});

test('3. the real panel is hidden while playing and restored on finish AND on cancel', async () => {
  const a = installDom();
  a.panel.style.opacity = '0.9';
  const run = genieRun({ panel: a.panel, host: a.host, trigger: a.trigger, direction: 'close', duration: 650 });
  assert.equal(a.panel.style.opacity, '0');
  assert.equal(a.panel.style.pointerEvents, 'none');
  a.advance(650 + 200);
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
  d.advance(520);
  // strips converge on the bottom-centre dock (y ≈ 760), not on the page-sized trigger's centre (400)
  const ys = strips.filter((s) => s.style.visibility !== 'hidden').map((s) => corners(s)[0][1]);
  assert.ok(ys.length > 0);
  assert.ok(ys.every((y) => y > 500), 'strips head for the dock below the panel');
});

/* ------------------------------ smoothness ------------------------------ */

test('9. neighbouring strips share their edge and each is a trapezoid, so the funnel edge is one curve', () => {
  const d = installDom();
  d.trigger.rect = { left: 700, top: 740, width: 80, height: 40 }; // off to one side → the funnel bows
  genieRun({ panel: d.panel, host: d.host, trigger: d.trigger, direction: 'close', duration: 650 });
  d.advance(390);
  const strips = layerOf(d.host).children;
  let compared = 0;
  let maxTaper = 0;
  for (let i = 0; i + 1 < strips.length; i += 1) {
    if (strips[i].style.visibility === 'hidden' || strips[i + 1].style.visibility === 'hidden') continue;
    const [tl, tr, br, bl] = corners(strips[i]);
    // The next strip starts ON this strip's side edges: one continuous outline, no stair step.
    for (const g of edgeGaps(strips[i], strips[i + 1], true)) {
      assert.ok(g.off < 0.05, `strip ${i}: neighbour's corner is ${g.off.toFixed(3)}px off the shared edge`);
      assert.ok(g.at > -0.01 && g.at < 1.01, `strip ${i}: neighbour starts outside this strip (${g.at.toFixed(2)})`);
    }
    maxTaper = Math.max(maxTaper, Math.abs(dist(tl, tr) - dist(bl, br)));
    compared += 1;
  }
  assert.ok(compared > 10, 'enough neighbouring pairs were compared');
  // A scale()/skew() strip is a parallelogram: top and bottom edges equal. These must differ.
  assert.ok(maxTaper > 0.3, `strips narrow along their length (max taper ${maxTaper.toFixed(2)}px)`);
});

test('9b. a horizontal (column) genie shares edges the same way', () => {
  const d = installDom();
  d.trigger.rect = { left: 20, top: 700, width: 80, height: 40 };
  genieRun({ panel: d.panel, host: d.host, trigger: d.trigger, direction: 'close', duration: 650 });
  d.advance(390);
  const strips = layerOf(d.host).children;
  assert.equal(strips[0].style.height, '400px', 'this run slices into columns');
  let compared = 0;
  for (let i = 0; i + 1 < strips.length; i += 1) {
    if (strips[i].style.visibility === 'hidden' || strips[i + 1].style.visibility === 'hidden') continue;
    for (const g of edgeGaps(strips[i], strips[i + 1], false)) {
      assert.ok(g.off < 0.05, `column ${i}: neighbour's corner is ${g.off.toFixed(3)}px off the shared edge`);
      assert.ok(g.at > -0.01 && g.at < 1.01, `column ${i}: neighbour starts outside this column`);
    }
    compared += 1;
  }
  assert.ok(compared > 10);
});

test('9c. every strip carries overlap so anti-aliased edges leave no hairline seam', () => {
  const d = installDom();
  genieRun({ panel: d.panel, host: d.host, trigger: d.trigger, direction: 'close', duration: 650 });
  const strips = layerOf(d.host).children;
  const h = 400 / strips.length;
  assert.ok(strips.every((st) => Math.abs(parseFloat(st.style.height) - (h + OVERLAP_PX)) < 1e-6));
  d.advance(200);
  // The overlap continues the strip's own edges: the extended bottom lies past the visible bottom.
  const vis = strips.filter((st) => st.style.visibility !== 'hidden')[3];
  const big = project(vis, 0, parseFloat(vis.style.height))[1];
  assert.ok(big > corners(vis)[3][1], 'extended edge sits beneath the next strip');
});

test('10. a heavy first frame cannot skip the timeline: warm-up frame, then a capped step', () => {
  const d = installDom();
  genieRun({ panel: d.panel, host: d.host, trigger: d.trigger, direction: 'close', duration: 650 });
  const strips = layerOf(d.host).children;
  const rest = strips.map((s) => s.style.transform);

  d.tick(5000); // the frame that rasterises every strip: the opening pose must be held
  assert.deepEqual(strips.map((s) => s.style.transform), rest, 'warm-up frame does not move anything');

  d.tick(5000 + FRAME_MS);
  d.tick(5000 + FRAME_MS + 400); // a 400 ms stall
  const last = corners(strips[strips.length - 1])[0][1];
  const restLast = 200 + 400 - (parseFloat(strips[0].style.height) - OVERLAP_PX);
  const moved = (last - restLast) / (760 - restLast);
  assert.ok(moved < 0.15, `after a 400 ms stall the near strip has covered ${(moved * 100).toFixed(0)}% of its way`);
});

test('11. a strip is never drawn wider than the panel, so the across-axis raster is never magnified', () => {
  for (const [name, at, direction] of [
    ['below/close', { left: 560, top: 740, width: 80, height: 40 }, 'close'],
    ['below/open', { left: 560, top: 740, width: 80, height: 40 }, 'open'],
    ['left/open', { left: 20, top: 380, width: 80, height: 40 }, 'open'],
  ]) {
    const d = installDom();
    d.trigger.rect = at;
    genieRun({ panel: d.panel, host: d.host, trigger: d.trigger, direction, duration: 650 });
    const strips = layerOf(d.host).children;
    const vertical = strips[0].style.width === '400px';
    let widest = 0;
    for (let f = 0; f < 45; f += 1) {
      d.advance(FRAME_MS);
      for (const st of strips) {
        if (st.style.visibility === 'hidden' || !st.style.transform) continue;
        const [tl, tr, br, bl] = corners(st, vertical);
        widest = Math.max(widest, vertical ? Math.max(dist(tl, tr), dist(bl, br)) : Math.max(dist(tl, bl), dist(tr, br)));
      }
    }
    // The along-axis CAN stretch (far strips are dragged behind the near ones — that is the shape of
    // a genie); the across-axis only ever narrows.
    assert.ok(widest <= 400 * 1.001, `${name}: a strip was ${widest.toFixed(1)}px across a 400px panel`);
  }
});

test('12. the fade is applied per strip, never as one opacity on the container', () => {
  const d = installDom();
  genieRun({ panel: d.panel, host: d.host, trigger: d.trigger, direction: 'close', duration: 650 });
  d.advance(620);
  const layer = layerOf(d.host);
  assert.equal(layer.style.opacity, undefined, 'a container opacity flattens every strip offscreen');
  assert.ok(layer.children.every((s) => Number(s.style.opacity) < 1), 'the strips themselves are fading');
});

/* ------------------------------ admin settings ------------------------------ */

test('13. on/off: a switched-off genie yields no run but the environment can still animate', () => {
  const d = installDom();
  try {
    assert.equal(canGenie(), true);
    configureGenie({ ...GENIE_DEFAULTS, enabled: false });
    assert.equal(canGenie(), false);
    assert.equal(canAnimate(), true, 'Modal still fades instead of snapping shut');
    assert.equal(genieRun({ panel: d.panel, host: d.host, trigger: d.trigger, direction: 'open' }), null);
  } finally {
    configureGenie(GENIE_DEFAULTS);
  }
});

test('14. duration is applied, mirrored into --dur-genie for the scrim, and clamped', () => {
  installDom();
  try {
    configureGenie({ ...GENIE_DEFAULTS, duration_ms: 900 });
    assert.equal(genieDuration(), 900);
    assert.equal(document.documentElement.style['--dur-genie'], '900ms', 'the scrim fade follows the panel');

    assert.equal(configureGenie({ ...GENIE_DEFAULTS, duration_ms: 5 }).duration_ms, GENIE_LIMITS.minDurationMs);
    assert.equal(configureGenie({ ...GENIE_DEFAULTS, duration_ms: 99999 }).duration_ms, GENIE_LIMITS.maxDurationMs);
    assert.equal(configureGenie({ ...GENIE_DEFAULTS, duration_ms: 'fast' }).duration_ms, GENIE_DEFAULTS.duration_ms);
    assert.equal(configureGenie(null).duration_ms, GENIE_DEFAULTS.duration_ms, 'a non-object leaves the config alone');
  } finally {
    configureGenie(GENIE_DEFAULTS);
  }
});

test('14b. under reduced motion the token is left alone so its 0ms media query keeps winning', () => {
  installDom({ reduced: true });
  try {
    configureGenie({ ...GENIE_DEFAULTS, duration_ms: 900 });
    assert.equal(document.documentElement.style['--dur-genie'], undefined);
    assert.equal(canAnimate(), false);
  } finally {
    configureGenie(GENIE_DEFAULTS);
  }
});

test('15. quality presets change how many strips are drawn; heavy panels get fewer', () => {
  const count = (quality, heavy = false) => {
    const d = installDom();
    if (heavy) for (let i = 0; i < 700; i += 1) d.panel.append(new FakeElement('SPAN'));
    configureGenie({ ...GENIE_DEFAULTS, quality });
    genieRun({ panel: d.panel, host: d.host, trigger: d.trigger, direction: 'close' });
    return layerOf(d.host).children.length;
  };
  try {
    const [light, balanced, smooth] = GENIE_QUALITIES.map((q) => count(q));
    assert.ok(light < balanced && balanced < smooth, `${light} < ${balanced} < ${smooth}`);
    assert.ok(count('smooth', true) < smooth, 'a heavy panel is sliced more coarsely');
  } finally {
    configureGenie(GENIE_DEFAULTS);
  }
});

test('16. sanitiseGenieConfig fills defaults and rejects non-objects', () => {
  assert.equal(sanitiseGenieConfig('nope'), null);
  assert.equal(sanitiseGenieConfig(null), null);
  assert.deepEqual(sanitiseGenieConfig({}), { ...GENIE_DEFAULTS });
  assert.equal(sanitiseGenieConfig({ enabled: 'yes' }).enabled, true, 'a truthy string is not a boolean');
  assert.equal(sanitiseGenieConfig({ quality: 'ultra' }).quality, GENIE_DEFAULTS.quality);
  assert.deepEqual([...GENIE_QUALITIES], ['light', 'balanced', 'smooth']);
  assert.ok(getGenieConfig().duration_ms === null || Number.isFinite(getGenieConfig().duration_ms));
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
  assert.match(modal, /!canAnimate\(\)/, 'only "motion unavailable" closes instantly');
  assert.match(modal, /if \(canGenie\(\)\)/, 'a switched-off genie skips the strips and fades instead');

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
