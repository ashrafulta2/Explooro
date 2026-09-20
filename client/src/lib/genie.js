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
/** Slices per panel. More = smoother curve, more DOM copies painted while animating. */
const STRIPS_DEFAULT = 40;
/** Fewer slices for heavy panels, so a table-filled modal does not clone 40 × its DOM. */
const STRIPS_HEAVY = 20;
const HEAVY_NODE_COUNT = 600;
/** Above this, cloning even 20 copies costs more than the effect is worth — caller fades instead. */
const MAX_NODE_COUNT = 3000;
/** Never slice thinner than this many px: sub-4px strips add cost without adding smoothness. */
const MIN_STRIP_PX = 4;
/** Share of the timeline over which the far end of the panel lags the near end. Higher = longer tail. */
const NECK = 0.5;
/** Side-to-side bow of the funnel, as a fraction of the panel's across-size. */
const SWAY = 0.35;
const SWAY_SCALE = 0.14;
/** Width of the opening the panel narrows into, as a share of the target's across-size. */
const MOUTH_RATIO = 0.7;
const MOUTH_MIN_PX = 8;
/** Fraction of the timeline (from the target end) over which the whole layer fades out/in. */
const FADE_START = 0.88;
/**
 * rAF is paused in background tabs and hidden windows; a timer (throttled but never stopped)
 * guarantees the animation settles, so a modal can never be stranded half-closed.
 */
const SETTLE_GRACE_MS = 250;
/** Strips overlap by this much so sub-pixel rounding never opens a hairline seam between them. */
const SEAM_PX = 0.6;
/** Target used when nothing sensible triggered the overlay (programmatic open): a dock point. */
const DOCK_WIDTH_PX = 48;
const DOCK_HEIGHT_PX = 24;
const DOCK_BOTTOM_GAP_PX = 40;
/** A "trigger" covering more than this share of the viewport is the body/page, not a control. */
const MAX_TARGET_VIEWPORT_SHARE = 0.5;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const lerp = (a, b, t) => a + (b - a) * t;
const easeSine = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);

/** Duration comes from the `--dur-genie` token so it is tuned in CSS, not code. */
export function genieDuration() {
  if (typeof document === 'undefined') return FALLBACK_DURATION_MS;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--dur-genie').trim();
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return FALLBACK_DURATION_MS;
  return raw.endsWith('ms') ? n : raw.endsWith('s') ? n * 1000 : n;
}

/** Cheap pre-check the caller runs before deciding to suppress its own CSS transition. */
export function canGenie() {
  return (
    typeof window !== 'undefined' &&
    typeof requestAnimationFrame === 'function' &&
    !prefersReducedMotion()
  );
}

/** The control the popup should fly to/from; falls back to a dock point at bottom-centre. */
export function resolveTarget(el) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (
    el instanceof HTMLElement &&
    el.isConnected &&
    el !== document.body &&
    el !== document.documentElement
  ) {
    const r = el.getBoundingClientRect();
    if ((r.width || r.height) && r.width * r.height < vw * vh * MAX_TARGET_VIEWPORT_SHARE) {
      return { rect: r, element: el };
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
  const swayDir = tu >= uC ? 1 : -1;

  const maxStrips = nodeCount > HEAVY_NODE_COUNT ? STRIPS_HEAVY : STRIPS_DEFAULT;
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
      strip.style.height = `${h}px`;
      copy.style.left = '0';
      copy.style.top = `${-i * h}px`;
    } else {
      strip.style.width = `${h}px`;
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
  const lb = new Array(N + 1);
  const rb = new Array(N + 1);

  /** p = 0: panel at rest. p = 1: fully swallowed by the target. */
  function place(p) {
    for (let k = 0; k <= N; k += 1) {
      const near = toward > 0 ? k / N : 1 - k / N; // 1 = the end closest to the target
      const q = clamp((p - (1 - near) * NECK) / (1 - NECK), 0, 1);
      const e = easeSine(q);
      const centre = lerp(uC, tu, e) + swayDir * SWAY * A * SWAY_SCALE * Math.sin(Math.PI * q);
      const width = lerp(A, mouth, e);
      vb[k] = lerp(v0 + k * h, tv, e);
      if (k && vb[k] < vb[k - 1]) vb[k] = vb[k - 1]; // slices must never cross
      lb[k] = centre - width / 2;
      rb[k] = centre + width / 2;
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
      const ul = (lb[i] + lb[i + 1]) / 2;
      const ur = (rb[i] + rb[i + 1]) / 2;
      const along = (thick + SEAM_PX) / h;
      const across = (ur - ul) / A;
      el.style.transform = vertical
        ? `translate(${ul}px, ${a}px) scale(${across}, ${along})`
        : `translate(${a}px, ${ul}px) scale(${along}, ${across})`;
    }
    layer.style.opacity =
      p > FADE_START ? String(clamp(1 - (p - FADE_START) / (1 - FADE_START), 0, 1)) : '1';
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
  const start = performance.now();
  place(opening ? 1 : 0);
  if (opening) pulseTarget(targetEl);

  function frame(now) {
    if (!host.isConnected) {
      settle(false);
      return;
    }
    const t = clamp((now - start) / duration, 0, 1);
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
