/**
 * genie.js — macOS-style "genie" open/close for overlays (the popup pours out of the control that
 * opened it and is sucked back into it on close).
 *
 * WHY slices instead of a CSS transform: scale()/translate() can only shrink a box uniformly. The
 * genie's curved funnel needs every row of the panel to move and narrow by a different amount,
 * which CSS cannot express on one element. So the panel is cut into thin strips along the axis
 * that points at the target; each strip is a clipped VISUAL COPY of the panel, and each frame we
 * only set one transform per strip. The real panel is never touched (it is just made transparent
 * for the duration), so focus, listeners and form state stay intact.
 *
 * Strips nearest the target start moving first and get narrow first; the far end follows. That
 * stagger is the whole effect — see `neck`. Open is the exact reverse of close, so the popup
 * leaves and re-enters the target along the same curve.
 *
 * Zero dependencies. Every helper degrades to `null` (caller falls back to a plain fade) instead
 * of throwing when the environment can't do it.
 */

import { prefersReducedMotion } from './motion.js';

/** Used only when the `--dur-genie` token cannot be read (SSR, detached document). */
const FALLBACK_DURATION_MS = 650;

/**
 * The knobs a Super Admin may turn (/admin/platform/genie → platform_settings, group `genie`).
 * `server/src/services/genie.service.js` declares the same bounds; `server/test/genieEffect.test.js`
 * fails if the two drift, because a value the API accepts but the engine clamps is a setting that
 * silently does not do what its page says.
 */
export const GENIE_LIMITS = Object.freeze({ minDurationMs: 250, maxDurationMs: 1500 });
export const GENIE_DEFAULTS = Object.freeze({ enabled: true, duration_ms: 650, quality: 'balanced' });

/**
 * Slices per panel, by quality preset. More = a finer curve (and a costlier first frame: every
 * slice is a full copy of the panel's DOM). `heavy` applies to panels above HEAVY_NODE_COUNT so a
 * table-filled modal does not clone 40 × its DOM.
 */
const QUALITY_STRIPS = Object.freeze({
  light: { full: 24, heavy: 14 },
  balanced: { full: 40, heavy: 20 },
  smooth: { full: 64, heavy: 32 },
});
export const GENIE_QUALITIES = Object.freeze(Object.keys(QUALITY_STRIPS));
const HEAVY_NODE_COUNT = 600;
/** Above this, cloning even 20 copies costs more than the effect is worth — caller fades instead. */
const MAX_NODE_COUNT = 3000;
/** Never slice thinner than this many px: sub-4px strips add cost without adding smoothness. */
const MIN_STRIP_PX = 4;
/** Share of the timeline over which the far end of the panel lags the near end. Higher = longer tail. */
const NECK = 0.50;
/** Width of the opening the panel narrows into, as a share of the target's across-size (slender magic lamp spout). */
const MOUTH_RATIO = 0.35;
const MOUTH_MIN_PX = 8;
/** Fraction of the timeline (from the target end) over which the strips fade out/in. */
const FADE_START = 0.88;
/**
 * One frame never advances the clock by more than this. The first painted frame (all the strips
 * rasterising at once) can take 100 ms+; without a cap the animation would jump a fifth of its
 * length in one step instead of carrying on from where it was.
 */
const MAX_FRAME_DT_MS = 40;
/** Barely-there opacity for the opening warm-up frame; fully transparent layers may not be rastered at all. */
const WARM_UP_OPACITY = 0.02;
/**
 * rAF is paused in background tabs and hidden windows; a timer (throttled but never stopped)
 * guarantees the animation settles, so a modal can never be stranded half-closed.
 */
const SETTLE_GRACE_MS = 250;
/**
 * Each strip carries this many extra px of the panel's REAL content past its own boundary, and
 * those px are drawn underneath the next strip. Strips are anti-aliased quads, so two that merely
 * touch leave a translucent hairline where their edges blend; overlapping them with true content
 * (rather than stretching a strip to cover the gap) closes the seam without shifting any pixel.
 */
const OVERLAP_PX = 4;
/** Target used when nothing sensible triggered the overlay (programmatic open): a dock point. */
const DOCK_WIDTH_PX = 48;
const DOCK_HEIGHT_PX = 24;
const DOCK_BOTTOM_GAP_PX = 40;
/** A "trigger" covering more than this share of the viewport is the body/page, not a control. */
const MAX_TARGET_VIEWPORT_SHARE = 0.5;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const lerp = (a, b, t) => a + (b - a) * t;
const easeSine = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);
const fmt = (n) => n.toFixed(4);
const fmtSmall = (n) => n.toFixed(9);

/**
 * CSS matrix3d() that maps an sw × sh rectangle (origin top-left) onto the quad q = [x0,y0, x1,y1,
 * x2,y2, x3,y3], corners taken clockwise from the rectangle's top-left. This is the standard
 * unit-square-to-quad projective mapping (Heckbert), so the four corners land exactly on the four
 * points — including the case where the far edge is narrower than the near one, which no affine
 * matrix (scale/skew) can express. Exported for the tests.
 */
export function quadToMatrix3d(sw, sh, q) {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = q;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  let g = 0;
  let hh = 0;
  const det = dx1 * dy2 - dy1 * dx2;
  if ((Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) && Math.abs(det) > 1e-12) {
    g = (dx3 * dy2 - dy3 * dx2) / det;
    hh = (dx1 * dy3 - dy1 * dx3) / det;
  }
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + hh * x3;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + hh * y3;
  // Unit-square coordinates → source pixels: u = x / sw, v = y / sh.
  return (
    `matrix3d(${fmt(a / sw)}, ${fmt(d / sw)}, 0, ${fmtSmall(g / sw)}, ` +
    `${fmt(b / sh)}, ${fmt(e / sh)}, 0, ${fmtSmall(hh / sh)}, 0, 0, 1, 0, ${fmt(x0)}, ${fmt(y0)}, 0, 1)`
  );
}

/** Live settings. `duration_ms: null` = nobody has configured it, so the CSS token decides. */
let config = { enabled: GENIE_DEFAULTS.enabled, duration_ms: null, quality: GENIE_DEFAULTS.quality };

/**
 * Turns whatever the API / cache handed over into a complete, in-range config, or `null` when it
 * is not an object at all (caller keeps what it has). Exported so the admin page and the tests use
 * the same clamp the engine does.
 */
export function sanitiseGenieConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ms = Number(raw.duration_ms);
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : GENIE_DEFAULTS.enabled,
    duration_ms: Number.isFinite(ms)
      ? clamp(Math.round(ms), GENIE_LIMITS.minDurationMs, GENIE_LIMITS.maxDurationMs)
      : GENIE_DEFAULTS.duration_ms,
    quality: GENIE_QUALITIES.includes(raw.quality) ? raw.quality : GENIE_DEFAULTS.quality,
  };
}

export function getGenieConfig() {
  return { ...config };
}

/**
 * Adopts the platform's genie settings. The duration is mirrored into `--dur-genie` because the
 * scrim's fade (surfaces.css) is timed by that token — left alone it would keep the shipped 650 ms
 * while the panel ran at the admin's value. Skipped under reduced motion, where the token's own
 * media query (0ms) must keep winning over an inline value.
 */
export function configureGenie(raw) {
  const next = sanitiseGenieConfig(raw);
  if (!next) return getGenieConfig();
  config = next;
  if (typeof document !== 'undefined' && !prefersReducedMotion()) {
    document.documentElement?.style?.setProperty?.('--dur-genie', `${next.duration_ms}ms`);
  }
  return getGenieConfig();
}

/** Duration comes from the platform setting, else the `--dur-genie` token, so it is never a code edit. */
export function genieDuration() {
  if (config.duration_ms !== null) return config.duration_ms;
  if (typeof document === 'undefined') return FALLBACK_DURATION_MS;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--dur-genie').trim();
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return FALLBACK_DURATION_MS;
  return raw.endsWith('ms') ? n : raw.endsWith('s') ? n * 1000 : n;
}

/**
 * Can this environment animate overlays at all? False under reduced motion or without rAF — the
 * caller then shows/hides instantly rather than fading.
 */
export function canAnimate() {
  return (
    typeof window !== 'undefined' &&
    typeof requestAnimationFrame === 'function' &&
    !prefersReducedMotion()
  );
}

/**
 * Cheap pre-check the caller runs before deciding to suppress its own CSS transition. Also false
 * when a Super Admin has switched the genie off, in which case overlays keep their plain fade.
 */
export function canGenie() {
  return config.enabled && canAnimate();
}

/** The control the popup should fly to/from; falls back to a dock point at bottom-centre. */
export function resolveTarget(el) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;

  // Unwrap Event objects if passed directly
  let targetNode = el;
  if (targetNode && typeof targetNode === 'object' && ('target' in targetNode || 'currentTarget' in targetNode)) {
    targetNode = targetNode.currentTarget || targetNode.target;
  }

  // Fallback to activeElement if element is missing or is the body
  if (
    (!targetNode || targetNode === document.body || targetNode === document.documentElement) &&
    typeof document !== 'undefined' &&
    document.activeElement &&
    document.activeElement !== document.body &&
    document.activeElement !== document.documentElement
  ) {
    targetNode = document.activeElement;
  }

  if (
    targetNode instanceof HTMLElement &&
    targetNode.isConnected &&
    targetNode !== document.body &&
    targetNode !== document.documentElement
  ) {
    const r = targetNode.getBoundingClientRect();
    if ((r.width || r.height) && r.width * r.height < vw * vh * MAX_TARGET_VIEWPORT_SHARE) {
      return { rect: r, element: targetNode };
    }
  }
  return {
    rect: {
      left: vw / 2 - DOCK_WIDTH_PX / 2,
      top: vh - DOCK_BOTTOM_GAP_PX,
      width: DOCK_WIDTH_PX,
      height: DOCK_HEIGHT_PX,
    },
    element: null,
  };
}

/** Soft ring + squeeze on the control, so the popup feels like it came from / returned to it. */
export function pulseTarget(el) {
  if (!(el instanceof HTMLElement) || typeof el.animate !== 'function') return;
  el.animate(
    [
      { boxShadow: '0 0 0 0 color-mix(in srgb, var(--brand) 55%, transparent)', scale: '1' },
      { scale: '0.94', offset: 0.35 },
      { boxShadow: '0 0 0 14px color-mix(in srgb, var(--brand) 0%, transparent)', scale: '1' },
    ],
    { duration: 520, easing: 'ease-out' }
  );
}

/** cloneNode drops live state (typed values, scroll offsets, canvas pixels); put it back. */
function syncLiveState(srcRoot, cloneRoot) {
  const src = srcRoot.querySelectorAll('*');
  const dst = cloneRoot.querySelectorAll('*');
  for (let i = 0; i < src.length; i += 1) {
    const s = src[i];
    const d = dst[i];
    if (!d) break;
    const tag = s.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (s.type === 'checkbox' || s.type === 'radio') d.checked = s.checked;
      else d.value = s.value;
    } else if (tag === 'CANVAS') {
      d.getContext('2d')?.drawImage(s, 0, 0);
    }
    if (s.scrollTop) d.scrollTop = s.scrollTop;
    if (s.scrollLeft) d.scrollLeft = s.scrollLeft;
  }
}

/**
 * Plays the genie on `panel`, drawing the animation into `host` (must be the element whose
 * top-layer the panel lives in — for a <dialog>, the dialog itself — and must not be transformed,
 * or `position: fixed` inside it stops meaning "the viewport").
 *
 * @param {object} o
 * @param {HTMLElement} o.panel      element to animate (measured now, hidden while it plays)
 * @param {HTMLElement} o.host       receives the strips layer
 * @param {Element|null} o.trigger   the control to fly to/from
 * @param {'open'|'close'} o.direction
 * @param {number} [o.duration]      ms; defaults to the --dur-genie token
 * @returns {{ finished: Promise<boolean>, cancel: () => void } | null}
 *   `finished` resolves true when played to the end, false when cancelled. `null` = unsupported
 *   here; the caller should fall back to its plain fade.
 */
export function genieRun({ panel, host, trigger = null, direction, duration = genieDuration() }) {
  if (!canGenie() || !panel || !host) return null;

  const nodeCount = panel.querySelectorAll('*').length;
  if (nodeCount > MAX_NODE_COUNT) return null;

  const r = panel.getBoundingClientRect();
  const W = r.width;
  const H = r.height;
  if (!W || !H) return null;

  const { rect: tr, element: targetEl } = resolveTarget(trigger);
  const pcx = r.left + W / 2;
  const pcy = r.top + H / 2;
  const tcx = tr.left + tr.width / 2;
  const tcy = tr.top + tr.height / 2;

  // Slice along whichever axis the target is further away on (relative to the panel's size);
  // v = along the travel axis, u = across it.
  const vertical = Math.abs(tcy - pcy) / H >= Math.abs(tcx - pcx) / W;
  const L = vertical ? H : W;
  const A = vertical ? W : H;
  const v0 = vertical ? r.top : r.left;
  const uC = vertical ? pcx : pcy;
  const tv = vertical ? tcy : tcx;
  const tu = vertical ? tcx : tcy;
  const mouth = Math.max(MOUTH_MIN_PX, (vertical ? tr.width : tr.height) * MOUTH_RATIO);
  const toward = tv > v0 + L / 2 ? 1 : -1;
  const deltaU = tu - uC;

  const preset = QUALITY_STRIPS[config.quality] ?? QUALITY_STRIPS[GENIE_DEFAULTS.quality];
  const maxStrips = nodeCount > HEAVY_NODE_COUNT ? preset.heavy : preset.full;
  const N = Math.max(8, Math.min(maxStrips, Math.floor(L / MIN_STRIP_PX)));
  const h = L / N;

  const layer = document.createElement('div');
  layer.className = 'genie-layer';
  layer.setAttribute('aria-hidden', 'true');

  const template = panel.cloneNode(true);
  template.removeAttribute('id');
  template.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
  template.inert = true;
  template.style.opacity = '';
  template.style.pointerEvents = '';

  const strips = [];
  for (let i = 0; i < N; i += 1) {
    const strip = document.createElement('div');
    strip.className = 'genie-strip';
    const copy = i === 0 ? template : template.cloneNode(true);
    copy.style.width = `${W}px`;
    copy.style.height = `${H}px`;
    if (vertical) {
      strip.style.width = `${W}px`;
      strip.style.height = `${h + OVERLAP_PX}px`;
      copy.style.left = '0';
      copy.style.top = `${-i * h}px`;
    } else {
      strip.style.width = `${h + OVERLAP_PX}px`;
      strip.style.height = `${H}px`;
      copy.style.top = '0';
      copy.style.left = `${-i * h}px`;
    }
    strip.append(copy);
    layer.append(strip);
    strips.push(strip);
  }

  host.append(layer);
  // Scroll offsets only stick once the copies are laid out.
  strips.forEach((strip) => syncLiveState(panel, strip.firstElementChild));

  const prevOpacity = panel.style.opacity;
  const prevPointer = panel.style.pointerEvents;
  // opacity, not visibility: a transparent element keeps focus and its place in the tab order,
  // so the focus the dialog already took survives the animation.
  panel.style.opacity = '0';
  panel.style.pointerEvents = 'none';

  const vb = new Array(N + 1);
  const cx = new Array(N + 1);
  const wd = new Array(N + 1);
  let shownFade = -1;

  /** p = 0: panel at rest. p = 1: fully swallowed by the target (inside the magic lamp). */
  function place(p) {
    for (let k = 0; k <= N; k += 1) {
      const near = toward > 0 ? k / N : 1 - k / N; // 1 = the end closest to the target (the lamp spout)
      const q = clamp((p - (1 - near) * NECK) / (1 - NECK), 0, 1);
      const e = easeSine(q);

      // Smooth Hermite trajectory towards the lamp target
      const baseCenter = lerp(uC, tu, e);

      // Aladdin's magic lamp smoke plume dynamics:
      // 1. Natural directional arc curving smoothly toward the target control
      const arch = deltaU !== 0 ? deltaU * 0.20 * Math.sin(Math.PI * e) * (1 - 0.5 * e) : 0;
      // 2. Harmonic swirling plume wave: undulates like silky genie smoke ribbon escaping the lamp spout
      const swirlSign = deltaU >= 0 ? -1 : 1;
      const swirlWave = Math.sin(Math.PI * e) * Math.sin(Math.PI * 1.2 * near) * (A * 0.065) * swirlSign;

      cx[k] = baseCenter + arch + swirlWave;

      // Aladdin's magic lamp flare profile: slender plume at spout (e -> 1), billowing cloud higher up (e -> 0)
      const flute = Math.pow(e, 1.4) * (1.5 - 0.5 * e);
      wd[k] = lerp(A, mouth, clamp(flute, 0, 1));

      vb[k] = lerp(v0 + k * h, tv, e);
      if (k && vb[k] < vb[k - 1]) vb[k] = vb[k - 1]; // slices must never cross
    }
    for (let i = 0; i < N; i += 1) {
      const a = vb[i];
      const thick = vb[i + 1] - a;
      const el = strips[i];
      if (thick < 0.02) {
        el.style.visibility = 'hidden';
        continue;
      }
      el.style.visibility = 'visible';
      // WHY a projective quad, not scale()/skew(): with a rectangle per strip the funnel's edge is a
      // staircase (every strip a slab of constant width), and that staircase is what reads as
      // "pixelated" edges. Each strip is instead mapped onto the exact trapezoid between its two
      // boundaries — top edge as wide as the boundary above it, bottom edge as wide as the one below
      // — so neighbouring strips share every corner and the edge is one continuous curve.
      // Extend both side edges past the boundary by the overlap, in proportion to how far this
      // strip has been squeezed, so the extra content lands where the next strip's content will.
      const grow = OVERLAP_PX / h;
      const a2 = vb[i + 1] + thick * grow;
      const l0 = cx[i] - wd[i] / 2;
      const r0 = cx[i] + wd[i] / 2;
      const l1 = cx[i + 1] - wd[i + 1] / 2;
      const r1 = cx[i + 1] + wd[i + 1] / 2;
      const l2 = l1 + (l1 - l0) * grow;
      const r2 = r1 + (r1 - r0) * grow;
      el.style.transform = vertical
        ? quadToMatrix3d(A, h + OVERLAP_PX, [l0, a, r0, a, r2, a2, l2, a2])
        : quadToMatrix3d(h + OVERLAP_PX, A, [a, l0, a2, l2, a2, r2, a, r0]);
    }
    // Fade the strips themselves, not their container: an opacity on the container makes the
    // browser flatten all of them into one offscreen surface for exactly the frames the eye is on.
    const fade = p > FADE_START ? clamp(1 - (p - FADE_START) / (1 - FADE_START), 0, 1) : 1;
    if (fade !== shownFade) {
      shownFade = fade;
      const value = String(fade);
      for (let i = 0; i < N; i += 1) strips[i].style.opacity = value;
    }
  }

  let raf = 0;
  let safety = 0;
  let settled = false;
  let resolveFinished;
  const finished = new Promise((resolve) => {
    resolveFinished = resolve;
  });

  function settle(completed) {
    if (settled) return;
    settled = true;
    cancelAnimationFrame(raf);
    clearTimeout(safety);
    layer.remove();
    panel.style.opacity = prevOpacity;
    panel.style.pointerEvents = prevPointer;
    resolveFinished(completed);
  }

  const opening = direction === 'open';
  // WHY the first pose is always the panel at REST, even when opening: strips are compositor layers
  // (will-change: transform) and the browser rasterises each one once, at the scale it has when it
  // first appears, then only stretches that bitmap. Opening from the collapsed pose would rasterise
  // the popup at a few percent of its size and blow it up as it grows — blurry, blocky text and
  // borders. At rest the scale is 1:1, and every later pose only shrinks it (never magnifies).
  // For an opening genie that rest pose is held nearly invisible for the one warm-up frame.
  place(0);
  if (opening) {
    shownFade = WARM_UP_OPACITY;
    for (let i = 0; i < N; i += 1) strips[i].style.opacity = String(WARM_UP_OPACITY);
    pulseTarget(targetEl);
  }

  // The clock is advanced by the (capped) time between frames, not read off the wall clock.
  let last = null;
  let elapsed = 0;

  function frame(now) {
    if (!host.isConnected) {
      settle(false);
      return;
    }
    if (last === null) {
      // WHY a warm-up frame: this is the frame that rasterises every strip for the first time and
      // is by far the most expensive of the run. Holding the rest pose through it means the
      // animation starts on the next frame instead of arriving already a fifth of the way in.
      last = now;
      raf = requestAnimationFrame(frame);
      return;
    }
    elapsed += Math.min(now - last, MAX_FRAME_DT_MS);
    last = now;
    const t = clamp(elapsed / duration, 0, 1);
    // WHY the timeline is eased here as well as per strip: this is the pacing the owner approved in
    // the preview ("the speed you first set was right"). A linear timeline measured smoother on
    // paper but read as rushed, so the speed is deliberately left as it was.
    const s = easeSine(t);
    place(opening ? 1 - s : s);
    if (t < 1) raf = requestAnimationFrame(frame);
    else {
      if (!opening) pulseTarget(targetEl);
      settle(true);
    }
  }
  raf = requestAnimationFrame(frame);
  safety = setTimeout(() => {
    if (!opening) pulseTarget(targetEl);
    settle(true);
  }, duration + SETTLE_GRACE_MS);

  return { finished, cancel: () => settle(false) };
}
