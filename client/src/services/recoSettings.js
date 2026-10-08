/**
 * recoSettings.js — pure helpers behind /admin/platform/recommendations (Phase G).
 *
 * The page draws its form from the section descriptions the API returns (`fields`, with min / max /
 * type / default), so the bounds live on the server in exactly one place: services/homeRails,
 * recommendation, diversity, covisit and recoCache own them, and recommendationAdmin.service.js
 * hands them over. Nothing here hard-codes a limit. These checks only exist so the operator hears
 * "too high" while typing; the API remains the authority and re-checks everything.
 *
 * No DOM and no imports: runs under plain Node for the tests.
 */

/** A typed string into a number. Empty and non-numeric input is NaN, never 0. */
export function parseNumber(text) {
  if (typeof text === 'number') return text;
  const s = String(text ?? '').trim();
  if (s === '') return NaN;
  return Number(s);
}

/**
 * Why a value is not acceptable for a field, or null when it is.
 * @returns {null | 'number' | 'whole' | 'range'}
 */
export function fieldProblem(spec, value) {
  if (spec.type === 'bool') return typeof value === 'boolean' ? null : 'number';
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'number';
  if (spec.type === 'int' && !Number.isInteger(value)) return 'whole';
  if (spec.allow_zero && value === 0) return null;
  if (value < spec.min || value > spec.max) return 'range';
  return null;
}

/** Penalties subtract; every other weight lifts a product. Mirrors the server's `_penalty` naming. */
export const isPenalty = (key) => key.endsWith('_penalty');

/**
 * Every reason the draft cannot be saved, as `{ path, code }`. Empty = fine. `code` is a stable
 * word the page maps to a translated sentence.
 */
export function sectionProblems(section, draft) {
  const out = [];
  if (!draft || typeof draft !== 'object') return [{ path: 'value', code: 'number' }];

  if (section.key === 'rails') {
    const limits = section.limits || {};
    const check = (path, spec, v) => {
      const code = fieldProblem(spec, v);
      if (code) out.push({ path, code });
    };
    if (limits.min_items) check('min_items', { type: 'int', ...limits.min_items }, draft.min_items);
    (draft.rails || []).forEach((rail) => {
      check(`rails.${rail.key}.limit`, { type: 'int', ...limits.limit }, rail.limit);
      if (Object.hasOwn(rail, 'window_days')) {
        check(`rails.${rail.key}.window_days`, { type: 'int', ...limits.window_days }, rail.window_days);
      }
    });
    return out;
  }

  for (const spec of section.fields || []) {
    const code = fieldProblem(spec, draft[spec.key]);
    if (code) out.push({ path: spec.key, code });
  }
  if (section.key === 'weights' && !out.length) {
    const anyPositive = (section.fields || []).some((f) => !isPenalty(f.key) && draft[f.key] > 0);
    if (!anyPositive) out.push({ path: 'value', code: 'no_positive' });
  }
  return out;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export const isDirty = (saved, draft) => !same(saved, draft);

/** Fields whose draft differs from the saved value: `[{ key, from, to }]`, in form order. */
export function diffFlat(section, saved, draft) {
  return (section.fields || [])
    .filter((f) => !same(saved?.[f.key], draft?.[f.key]))
    .map((f) => ({ key: f.key, from: saved?.[f.key], to: draft?.[f.key] }));
}

/**
 * What changed in a rail layout, one line per fact: min_items, a rail added / removed / moved, and a
 * changed field. `from` / `to` are display strings (the page translates the rail name).
 */
export function diffRails(saved, draft) {
  const out = [];
  if (saved.min_items !== draft.min_items) {
    out.push({ kind: 'min_items', from: saved.min_items, to: draft.min_items });
  }
  const savedByKey = new Map(saved.rails.map((r, i) => [r.key, { ...r, index: i }]));
  const draftByKey = new Map(draft.rails.map((r, i) => [r.key, { ...r, index: i }]));
  for (const [key, r] of draftByKey) {
    const was = savedByKey.get(key);
    if (!was) {
      out.push({ kind: 'added', key });
      continue;
    }
    if (was.enabled !== r.enabled) out.push({ kind: 'enabled', key, from: was.enabled, to: r.enabled });
    if (was.limit !== r.limit) out.push({ kind: 'limit', key, from: was.limit, to: r.limit });
    if (was.window_days !== r.window_days) out.push({ kind: 'window_days', key, from: was.window_days, to: r.window_days });
  }
  for (const key of savedByKey.keys()) if (!draftByKey.has(key)) out.push({ kind: 'removed', key });

  // Order: compare the sequence of the rails both layouts share, so adding one at the end is not "moved".
  const shared = (list, other) => list.rails.map((r) => r.key).filter((k) => other.rails.some((o) => o.key === k));
  if (!same(shared(saved, draft), shared(draft, saved))) out.push({ kind: 'order' });
  return out;
}

// ── Rail list edits (pure: they return a new value) ─────────────────────────────────────────────

export function moveRail(value, index, delta) {
  const target = index + delta;
  if (index < 0 || target < 0 || index >= value.rails.length || target >= value.rails.length) return value;
  const rails = value.rails.slice();
  [rails[index], rails[target]] = [rails[target], rails[index]];
  return { ...value, rails };
}

export function removeRail(value, key) {
  return { ...value, rails: value.rails.filter((r) => r.key !== key) };
}

/** Adds a rail at the end with that rail's shipped defaults (the `defaults` the API sent). */
export function addRail(value, key, defaults) {
  if (value.rails.some((r) => r.key === key)) return value;
  const base = defaults.rails.find((r) => r.key === key);
  if (!base) return value;
  return { ...value, rails: [...value.rails, { ...base }] };
}

/** Rails the catalogue knows that the layout does not include. */
export function missingRails(value, catalogue) {
  const have = new Set(value.rails.map((r) => r.key));
  return catalogue.filter((c) => !have.has(c.key));
}

// ── Results ─────────────────────────────────────────────────────────────────────────────────────

/** A fraction as a percentage string, or null when there was nothing to divide by. */
export function toPercent(fraction, digits = 1) {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return null;
  return `${(fraction * 100).toFixed(digits)}%`;
}
