/**
 * RecommendationSettingsPage.js — governance of the personalized home feed.
 *
 * Implements /admin/platform/recommendations:
 * 1. One tab per settings section — signal weights, windows and caps, home rails, diversity,
 *    "shoppers also viewed", cache. Each is its own save with its own audit row.
 * 2. A Results tab: how the cache is behaving on this node, and which surface works (impressions,
 *    clicks, click-attributed carts and purchases per rail / grid / search / feed).
 * 3. "Who can change this" — role defaults plus live standing grants for `platform.recommendation.update`.
 * 4. Recent change history (actor, what moved, reason) straight from audit_logs.
 *
 * WHY the form is drawn from the API's field descriptions: every bound lives in the service that
 * enforces it, and the server hands it over (`fields` with min / max / type / default). This page
 * holds no copy of a limit, so a retuned bound can never leave the form offering a value the API
 * refuses. The checks here (services/recoSettings.js) only tell the operator while they type; the
 * API re-checks everything.
 *
 * WHY per-section saves: sections are independent policies with independent audit rows, and a weights
 * experiment should not be blocked by, or bundled with, an unfinished rail layout.
 *
 * WHY its own permission pair, `core` module, and a mandatory reason: same reasoning as the Genie and
 * Language pages (docs/super-admin-audit.md §5). Reading is `.view` (LOW); Save needs `.update`
 * (MEDIUM, delegable), so an Admin can see the numbers without being able to move them.
 *
 * The cards, diff, authority and history lists are language-settings.css; the controls specific to
 * this page are reco-settings.css. Both are imported here, never by main.css.
 */

import '../../styles/components/language-settings.css';
import '../../styles/components/reco-settings.css';

import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { Modal } from '../../components/ui/Modal.js';
import { Switch } from '../../components/ui/Switch.js';
import { Input } from '../../components/ui/Input.js';
import { Textarea } from '../../components/ui/Textarea.js';
import { EmptyState } from '../../components/ui/EmptyState.js';
import { PlatformSubnav } from '../../components/admin/PlatformSubnav.js';
import { adminApi } from '../../services/admin.api.js';
import { can } from '../../services/permissions.js';
import { toast } from '../../services/toast.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatDate, formatNumber, formatRelativeTime } from '../../services/format.js';
import {
  parseNumber,
  sectionProblems,
  isDirty,
  isPenalty,
  diffFlat,
  diffRails,
  moveRail,
  removeRail,
  addRail,
  missingRails,
  toPercent,
} from '../../services/recoSettings.js';

const FALLBACK_MIN_REASON = 10;
const FUNNEL_WINDOWS = [7, 30, 90];

/** Everything typed by people (reasons, names) goes through this before innerHTML. */
const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const clone = (v) => JSON.parse(JSON.stringify(v));
const humanize = (key) => key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const fieldLabel = (key) => t(`admin_reco.field.${key}`, humanize(key));
const fieldHint = (key) => t(`admin_reco.hint.${key}`, '');
const railTitle = (key) => t(`discover.rails.${key}_title`, humanize(key));

export default function RecommendationSettingsPage(root, { navigate } = {}) {
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'admin-page reco-page';

  let data = null;
  let order = [];
  let saved = {}; // section key -> value as the server has it
  let drafts = {}; // section key -> value being edited
  let meta = {}; // section key -> the full section description from the API
  let active = 'weights';
  let isLoading = true;
  let isSaving = false;
  let canUpdate = can('platform.recommendation.update');
  let funnel = null;
  let funnelDays = 7;
  let funnelState = 'idle'; // idle | loading | error
  let pendingFocus = null; // { selector } restored after a re-render (list edits)

  // Live bits that change while typing, updated in place so the field keeps focus.
  let live = { fields: [], saveBtn: null, discardBtn: null, status: null, tabDots: new Map() };

  const minReason = () => data?.min_reason_length ?? FALLBACK_MIN_REASON;
  const current = () => meta[active];
  const dirty = (key) => Boolean(meta[key]) && isDirty(saved[key], drafts[key]);
  const problems = (key) => (meta[key] ? sectionProblems(meta[key], drafts[key]) : []);

  // ── Data ──────────────────────────────────────────────────────────────────────────────────────

  async function loadData({ keepDrafts = false } = {}) {
    isLoading = !data;
    if (isLoading) render();
    try {
      const res = await adminApi.getRecommendationSettings();
      const previous = drafts;
      data = res;
      order = (res?.sections || []).map((s) => s.key);
      meta = Object.fromEntries((res?.sections || []).map((s) => [s.key, s]));
      saved = Object.fromEntries(order.map((k) => [k, clone(meta[k].value)]));
      drafts = Object.fromEntries(order.map((k) => [k, keepDrafts && previous[k] ? previous[k] : clone(meta[k].value)]));
      // The server is the authority on whether this operator may write; `can()` only knows what the
      // last permission sync told the client.
      if (typeof res?.can_update === 'boolean') canUpdate = res.can_update;
      if (!order.includes(active) && active !== 'results') active = order[0] || 'weights';
    } catch (err) {
      toast.error(err?.message_en || err?.message || 'Failed to load the personalized feed settings');
      data = null;
    } finally {
      isLoading = false;
      render();
    }
  }

  async function loadFunnel() {
    funnelState = 'loading';
    render();
    try {
      funnel = await adminApi.getRecommendationFunnel({ days: funnelDays });
      funnelState = 'idle';
    } catch (err) {
      funnelState = 'error';
      toast.error(err?.[isBn ? 'message_bn' : 'message_en'] || err?.message || 'Failed to load the funnel');
    }
    render();
  }

  function discardChanges() {
    if (!meta[active]) return;
    drafts[active] = clone(saved[active]);
    render();
  }

  function resetToDefaults() {
    drafts[active] = clone(meta[active].defaults);
    render();
  }

  // ── Save ──────────────────────────────────────────────────────────────────────────────────────

  function describeChange(line) {
    // Rails produce a `kind`; flat sections produce a `key`.
    if (!line.kind) return { label: fieldLabel(line.key), from: String(line.from), to: String(line.to) };
    const name = line.key ? railTitle(line.key) : '';
    const yes = (v) => (v ? t('admin_reco.on', 'On') : t('admin_reco.off', 'Off'));
    switch (line.kind) {
      case 'min_items':
        return { label: t('admin_reco.field.min_items', 'Fewest products for a rail to show'), from: String(line.from), to: String(line.to) };
      case 'added':
        return { label: name, from: t('admin_reco.rail_absent', 'Not shown'), to: t('admin_reco.rail_added', 'Added') };
      case 'removed':
        return { label: name, from: t('admin_reco.rail_present', 'In the layout'), to: t('admin_reco.rail_removed', 'Removed') };
      case 'enabled':
        return { label: `${name} — ${t('admin_reco.field.rail_enabled', 'Switched on')}`, from: yes(line.from), to: yes(line.to) };
      case 'limit':
        return { label: `${name} — ${t('admin_reco.field.rail_limit', 'Products')}`, from: String(line.from), to: String(line.to) };
      case 'window_days':
        return { label: `${name} — ${t('admin_reco.field.rail_window_days', 'Counts as new for (days)')}`, from: String(line.from), to: String(line.to) };
      default:
        return { label: t('admin_reco.order_changed', 'Order of the rails'), from: t('admin_reco.order_before', 'Before'), to: t('admin_reco.order_after', 'Changed') };
    }
  }

  const changesOf = (key) =>
    key === 'rails' ? diffRails(saved.rails, drafts.rails) : diffFlat(meta[key], saved[key], drafts[key]);

  function diffRow(label, from, to) {
    const changed = from !== to;
    return `
      <div class="language-diff__row${changed ? ' language-diff__row--changed' : ''}">
        <dt class="language-diff__label">${esc(label)}</dt>
        <dd class="language-diff__value">
          <span class="language-diff__from">${esc(from)}</span>
          ${changed ? `<span class="language-diff__arrow" aria-hidden="true">→</span><span class="language-diff__to">${esc(to)}</span>` : ''}
        </dd>
      </div>
    `;
  }

  /**
   * Save confirmation. Purpose-built rather than confirmDialogWithReason() because the API requires a
   * reason of at least `min_reason_length` characters and the shared dialog only enforces "not empty" —
   * a checklist that does not gate the action is worse than none (docs/super-admin-audit.md §5 inv. 9).
   */
  function openSaveModal(trigger) {
    const key = active;
    const body = document.createElement('div');
    body.className = 'language-save-modal';

    const summary = document.createElement('div');
    summary.className = 'language-save-modal__summary';
    const rows = changesOf(key).map((c) => {
      const d = describeChange(c);
      return diffRow(d.label, d.from, d.to);
    });
    summary.innerHTML = `
      <p class="text-sm text-secondary">
        ${esc(t('admin_reco.modal_desc', 'These take effect for every shopper within a few seconds.'))}
      </p>
      <dl class="language-diff">${rows.join('')}</dl>
    `;

    const reasonField = Textarea({
      label: t('admin_reco.reason_label', 'Why are you changing this?'),
      hint: t('admin_reco.reason_hint', 'Recorded in the audit log with the old and new values. At least {{n}} characters.', { n: minReason() }),
      rows: 3,
      maxLength: 500,
      showCounter: true,
      required: true,
    });

    const cancelBtn = Button({ label: t('common.cancel', 'Cancel'), variant: 'secondary', onClick: () => modal.close() });
    const confirmBtn = Button({
      label: t('admin_reco.btn_confirm_save', 'Apply to the feed'),
      variant: 'primary',
      disabled: true,
      onClick: async () => {
        const reason = reasonField.value.trim();
        modal.close();
        await executeSave(key, reason);
      },
    });

    // The gate: nothing is submittable until the reason meets the same minimum the API enforces.
    const reasonInput = reasonField.querySelector('textarea');
    reasonInput?.addEventListener('input', () => {
      confirmBtn.setDisabled(reasonInput.value.trim().length < minReason());
    });

    const footer = document.createDocumentFragment();
    footer.append(cancelBtn, confirmBtn);
    body.append(summary, reasonField);

    const modal = Modal({
      title: t('admin_reco.modal_title', 'Confirm: {{section}}', { section: sectionLabel(key) }),
      content: body,
      footer,
      size: 'sm',
    });
    modal.open(trigger);
    reasonInput?.focus();
  }

  async function executeSave(key, reason) {
    isSaving = true;
    render();
    try {
      const res = await adminApi.updateRecommendationSection(key, {
        value: drafts[key],
        reason,
        base_updated_at: meta[key].updated_at ?? null,
      });
      toast.success(res?.[isBn ? 'message_bn' : 'message_en'] || t('admin_reco.toast_saved', 'Feed settings updated.'));
      await loadData(); // also re-reads the history so the row just written shows
    } catch (err) {
      const message = err?.[isBn ? 'message_bn' : 'message_en'] || err?.message || 'Failed to save';
      toast.error(message);
      // Someone else saved first. Re-read, but keep what this operator typed so the new diff shows
      // exactly what applying it now would overwrite.
      if (err?.code === 'CONFLICT') await loadData({ keepDrafts: true });
    } finally {
      isSaving = false;
      render();
    }
  }

  // ── Live updates while typing (no re-render, so the input keeps focus) ───────────────────────────

  function refreshChrome() {
    const key = active;
    const list = meta[key] ? problems(key) : [];
    for (const f of live.fields) f.update(list);
    const changed = meta[key] ? dirty(key) : false;
    live.saveBtn?.setDisabled(!changed || list.length > 0 || isSaving);
    live.discardBtn?.setDisabled(!changed || isSaving);
    if (live.status) {
      live.status.textContent = list.length
        ? t('admin_reco.status_problems', 'Fix the highlighted values to save.')
        : changed
          ? t('admin_reco.status_unsaved', 'You have unsaved changes.')
          : '';
    }
    for (const [k, dot] of live.tabDots) dot.hidden = !dirty(k);
  }

  const problemText = (code, spec) => {
    if (code === 'whole') return t('admin_reco.err_whole', 'Use a whole number.');
    if (code === 'range') return t('admin_reco.err_range', 'Must be between {{min}} and {{max}}.', { min: spec.min, max: spec.max });
    return t('admin_reco.err_number', 'Enter a number.');
  };

  // ── Field builders ────────────────────────────────────────────────────────────────────────────

  /** A numeric field with its range, default and reset link; reports into `live.fields`. */
  function numberField({ spec, path, value, onValue, label, hint, disabled }) {
    const wrap = document.createElement('div');
    wrap.className = 'reco-field';

    const rangeText = spec.allow_zero
      ? t('admin_reco.range_zero', '0 (off) or {{min}}–{{max}}', { min: spec.min, max: spec.max })
      : t('admin_reco.range', '{{min}}–{{max}}', { min: spec.min, max: spec.max });

    const input = Input({
      label,
      hint,
      type: 'number',
      value: Number.isNaN(value) ? '' : String(value),
      inputmode: spec.type === 'int' ? 'numeric' : 'decimal',
      disabled,
      onInput: (event) => {
        onValue(parseNumber(event.target.value));
        refreshChrome();
      },
    });
    const el = input.input;
    el.min = String(spec.allow_zero ? 0 : spec.min);
    el.max = String(spec.max);
    el.step = spec.type === 'int' ? '1' : 'any';

    const metaLine = document.createElement('p');
    metaLine.className = 'reco-field__meta';
    const range = document.createElement('span');
    range.textContent = `${t('admin_reco.range_label', 'Range')}: ${rangeText}`;
    const dflt = document.createElement('span');
    dflt.textContent = `${t('admin_reco.default_label', 'Default')}: ${spec.default}`;
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'reco-link';
    reset.textContent = t('admin_reco.reset_field', 'Use default');
    reset.hidden = true;
    reset.addEventListener('click', () => {
      onValue(spec.default);
      input.value = String(spec.default);
      refreshChrome();
      el.focus();
    });
    metaLine.append(range, dflt, reset);

    const error = document.createElement('p');
    error.className = 'reco-field__error';
    error.setAttribute('role', 'alert');

    wrap.append(input, metaLine, error);

    live.fields.push({
      update(list) {
        const mine = list.find((p) => p.path === path);
        error.textContent = mine ? problemText(mine.code, spec) : '';
        el.setAttribute('aria-invalid', mine ? 'true' : 'false');
        const typed = parseNumber(el.value);
        reset.hidden = disabled || typed === spec.default;
      },
    });
    return wrap;
  }

  function switchField({ label, hint, checked, onValue, disabled }) {
    return Switch({
      label,
      hint,
      checked,
      disabled,
      onChange: (on) => {
        onValue(on);
        refreshChrome();
      },
    });
  }

  // ── Section views ─────────────────────────────────────────────────────────────────────────────

  const sectionLabel = (key) => t(`admin_reco.tab.${key}`, meta[key]?.label_en || humanize(key));

  function renderFlat(section) {
    const draft = drafts[section.key];
    const readOnly = !canUpdate || isSaving;
    const frag = document.createDocumentFragment();

    const build = (specs) => {
      const grid = document.createElement('div');
      grid.className = 'reco-grid';
      for (const spec of specs) {
        if (spec.type === 'bool') {
          grid.append(
            switchField({
              label: fieldLabel(spec.key === 'enabled' ? `${section.key}_enabled` : spec.key),
              hint: t(`admin_reco.hint.${section.key}_enabled`, ''),
              checked: draft[spec.key],
              disabled: readOnly,
              onValue: (v) => (draft[spec.key] = v),
            })
          );
          continue;
        }
        grid.append(
          numberField({
            spec,
            path: spec.key,
            value: draft[spec.key],
            onValue: (v) => (draft[spec.key] = v),
            label: fieldLabel(spec.key),
            hint: fieldHint(spec.key),
            disabled: readOnly,
          })
        );
      }
      return grid;
    };

    if (section.key === 'weights') {
      const lifts = section.fields.filter((f) => !isPenalty(f.key));
      const penalties = section.fields.filter((f) => isPenalty(f.key));
      const h1 = document.createElement('h3');
      h1.className = 'reco-group-title';
      h1.textContent = t('admin_reco.group_lifts', 'Signals that lift a product');
      const h2 = document.createElement('h3');
      h2.className = 'reco-group-title';
      h2.textContent = t('admin_reco.group_penalties', 'Penalties that push a product down');
      frag.append(h1, build(lifts), h2, build(penalties));
    } else {
      frag.append(build(section.fields));
    }
    return frag;
  }

  function renderRails(section) {
    const draft = drafts.rails;
    const readOnly = !canUpdate || isSaving;
    const frag = document.createDocumentFragment();
    const limits = section.limits;

    frag.append(
      (() => {
        const grid = document.createElement('div');
        grid.className = 'reco-grid';
        grid.append(
          numberField({
            spec: { type: 'int', ...limits.min_items, default: section.defaults.min_items },
            path: 'min_items',
            value: draft.min_items,
            onValue: (v) => (draft.min_items = v),
            label: t('admin_reco.field.min_items', 'Fewest products for a rail to show'),
            hint: t('admin_reco.hint.min_items', 'A rail that cannot find this many real matches is hidden rather than padded with filler.'),
            disabled: readOnly,
          })
        );
        return grid;
      })()
    );

    const list = document.createElement('ol');
    list.className = 'reco-rails';
    list.setAttribute('aria-label', t('admin_reco.rails_list', 'Rails, in the order shoppers see them'));
    draft.rails.forEach((rail, index) => {
      const cat = section.catalogue.find((c) => c.key === rail.key) || {};
      const li = document.createElement('li');
      li.className = `reco-rail${rail.enabled ? '' : ' reco-rail--off'}`;
      li.dataset.rail = rail.key;

      const order = document.createElement('div');
      order.className = 'reco-rail__order';
      const mk = (delta, glyph, labelKey, fallback) =>
        Button({
          label: glyph,
          ariaLabel: t(labelKey, fallback, { name: railTitle(rail.key) }),
          variant: 'secondary',
          size: 'sm',
          disabled: readOnly || index + delta < 0 || index + delta >= draft.rails.length,
          onClick: () => {
            drafts.rails = moveRail(drafts.rails, index, delta);
            pendingFocus = { rail: rail.key, dir: delta };
            render();
          },
        });
      order.append(mk(-1, '↑', 'admin_reco.move_up', 'Move {{name}} up'), mk(1, '↓', 'admin_reco.move_down', 'Move {{name}} down'));

      const info = document.createElement('div');
      const title = document.createElement('p');
      title.className = 'reco-rail__title';
      title.textContent = railTitle(rail.key);
      info.append(title);
      if (cat.needs) {
        const needs = document.createElement('p');
        needs.className = 'reco-rail__needs';
        needs.textContent = t(`admin_reco.needs.${cat.needs}`, `Needs: ${cat.needs}`);
        info.append(needs);
      }

      const controls = document.createElement('div');
      controls.className = 'reco-rail__controls';
      controls.append(
        switchField({
          label: t('admin_reco.field.rail_enabled', 'Switched on'),
          checked: rail.enabled,
          disabled: readOnly,
          onValue: (v) => {
            rail.enabled = v;
            li.classList.toggle('reco-rail--off', !v);
          },
        }),
        numberField({
          spec: { type: 'int', ...limits.limit, default: section.defaults.rails.find((r) => r.key === rail.key)?.limit ?? rail.limit },
          path: `rails.${rail.key}.limit`,
          value: rail.limit,
          onValue: (v) => (rail.limit = v),
          label: t('admin_reco.field.rail_limit', 'Products'),
          hint: '',
          disabled: readOnly,
        })
      );
      if (cat.has_window) {
        controls.append(
          numberField({
            spec: { type: 'int', ...limits.window_days, default: section.defaults.rails.find((r) => r.key === rail.key)?.window_days ?? rail.window_days },
            path: `rails.${rail.key}.window_days`,
            value: rail.window_days,
            onValue: (v) => (rail.window_days = v),
            label: t('admin_reco.field.rail_window_days', 'Counts as new for (days)'),
            hint: '',
            disabled: readOnly,
          })
        );
      }
      controls.append(
        Button({
          label: t('admin_reco.btn_remove', 'Remove'),
          ariaLabel: t('admin_reco.btn_remove_named', 'Remove {{name}}', { name: railTitle(rail.key) }),
          variant: 'secondary',
          size: 'sm',
          disabled: readOnly,
          onClick: () => {
            drafts.rails = removeRail(drafts.rails, rail.key);
            render();
          },
        })
      );

      li.append(order, info, controls);
      list.append(li);
    });

    if (!draft.rails.length) {
      frag.append(
        Object.assign(document.createElement('p'), {
          className: 'reco-notice reco-notice--warn',
          textContent: t('admin_reco.rails_empty', 'No rails: the home page will show no personalized shelves. Add one below to bring them back.'),
        })
      );
    } else {
      frag.append(list);
    }

    const absent = missingRails(draft, section.catalogue);
    if (absent.length && !readOnly) {
      const h = document.createElement('h3');
      h.className = 'reco-group-title';
      h.textContent = t('admin_reco.rails_not_shown', 'Not in the layout');
      const ul = document.createElement('ul');
      ul.className = 'reco-missing';
      absent.forEach((c) => {
        const item = document.createElement('li');
        item.append(
          Button({
            label: `+ ${railTitle(c.key)}`,
            variant: 'secondary',
            size: 'sm',
            onClick: () => {
              drafts.rails = addRail(drafts.rails, c.key, section.defaults);
              render();
            },
          })
        );
        ul.append(item);
      });
      frag.append(h, ul);
    }
    return frag;
  }

  function statCard(label, value, sub) {
    const div = document.createElement('div');
    div.className = 'reco-stat';
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    if (sub) {
      const s = document.createElement('span');
      s.className = 'reco-stat__sub';
      s.textContent = sub;
      dd.append(s);
    }
    div.append(dt, dd);
    return div;
  }

  const num = (n) => formatNumber(n, { lang: isBn ? 'bn' : 'en' });
  const pct = (fraction) => toPercent(fraction) ?? '—';

  function renderResults() {
    const frag = document.createDocumentFragment();

    // — Cache and latency on this node —
    const rt = data?.runtime?.node;
    const h1 = document.createElement('h3');
    h1.className = 'reco-group-title';
    h1.textContent = t('admin_reco.results_runtime', 'How the feed is running on this server');
    frag.append(h1);
    if (rt) {
      const dl = document.createElement('dl');
      dl.className = 'reco-stats';
      dl.append(
        statCard(t('admin_reco.stat_pool_hit', 'Candidate pool cache hits'), pct(rt.pool.hit_rate), `${num(rt.pool.hits)} / ${num(rt.pool.hits + rt.pool.misses)}`),
        statCard(t('admin_reco.stat_settings_hit', 'Settings cache hits'), pct(rt.settings.hit_rate), `${num(rt.settings.hits)} / ${num(rt.settings.hits + rt.settings.misses)}`),
        statCard(t('admin_reco.stat_errors', 'Cache errors'), num(rt.pool.errors + rt.settings.errors), t('admin_reco.stat_errors_sub', 'a failing cache never fails the page')),
        statCard(t('admin_reco.stat_coalesced', 'Identical requests shared'), num(rt.pool.coalesced))
      );
      for (const [name, l] of Object.entries(rt.latency || {})) {
        dl.append(
          statCard(
            t(`admin_reco.stat_latency_${name}`, `${humanize(name)} response`),
            `${l.mean_ms} ms`,
            `${t('admin_reco.stat_max', 'slowest')} ${l.max_ms} ms · ${num(l.count)} ${t('admin_reco.stat_requests', 'requests')}`
          )
        );
      }
      frag.append(dl);
      const note = document.createElement('p');
      note.className = 'reco-intro';
      note.textContent = t('admin_reco.runtime_note', 'Counted on this server since it started. With several servers and the in-memory cache, each has its own numbers.');
      frag.append(note);
    }

    // — Funnel per surface —
    const h2 = document.createElement('h3');
    h2.className = 'reco-group-title';
    h2.textContent = t('admin_reco.results_funnel', 'Which surface works');
    frag.append(h2);

    const controls = document.createElement('div');
    controls.className = 'reco-actions';
    FUNNEL_WINDOWS.forEach((d) => {
      controls.append(
        Button({
          label: t('admin_reco.window_days_btn', 'Last {{n}} days', { n: d }),
          variant: d === funnelDays ? 'primary' : 'secondary',
          size: 'sm',
          disabled: funnelState === 'loading',
          onClick: () => {
            funnelDays = d;
            loadFunnel();
          },
        })
      );
    });
    frag.append(controls);

    if (funnelState === 'loading') {
      const p = document.createElement('p');
      p.className = 'reco-status';
      p.textContent = `${t('common.loading', 'Loading')}…`;
      frag.append(p);
    } else if (!funnel) {
      frag.append(
        EmptyState({
          title: t('admin_reco.funnel_not_loaded', 'Pick a window to load the numbers'),
          description: t('admin_reco.funnel_not_loaded_desc', 'This reads the tagged events of the period, so it is loaded on request.'),
        })
      );
    } else if (!funnel.surfaces.length) {
      frag.append(
        EmptyState({
          title: t('admin_reco.funnel_empty', 'No tagged events in this period'),
          description: t('admin_reco.funnel_empty_desc', 'Rails, the catalog grid, search and the swipe feed tag their events. Nothing has been recorded for this window yet.'),
        })
      );
    } else {
      const scroll = document.createElement('div');
      scroll.className = 'reco-table-scroll';
      const table = document.createElement('table');
      table.className = 'reco-table';
      const rows = funnel.surfaces
        .map(
          (s) => `
        <tr>
          <th scope="row">${esc(surfaceName(s.source))}</th>
          <td>${esc(num(s.impressions))}</td>
          <td>${esc(num(s.clicks))}</td>
          <td class="${s.ctr === null ? 'reco-table__none' : ''}">${esc(pct(s.ctr))}</td>
          <td>${esc(num(s.add_carts))}</td>
          <td class="${s.cart_rate === null ? 'reco-table__none' : ''}">${esc(pct(s.cart_rate))}</td>
          <td>${esc(num(s.purchases))}</td>
          <td class="${s.purchase_rate === null ? 'reco-table__none' : ''}">${esc(pct(s.purchase_rate))}</td>
        </tr>`
        )
        .join('');
      table.innerHTML = `
        <caption>${esc(t('admin_reco.funnel_caption', 'Last {{days}} days, carts and purchases counted within {{att}} days of a click', { days: funnel.window.days, att: funnel.window.attribution_days }))}</caption>
        <thead><tr>
          <th scope="col">${esc(t('admin_reco.col_surface', 'Surface'))}</th>
          <th scope="col">${esc(t('admin_reco.col_impressions', 'Shown'))}</th>
          <th scope="col">${esc(t('admin_reco.col_clicks', 'Opened'))}</th>
          <th scope="col">${esc(t('admin_reco.col_ctr', 'Open rate'))}</th>
          <th scope="col">${esc(t('admin_reco.col_carts', 'Added to cart'))}</th>
          <th scope="col">${esc(t('admin_reco.col_cart_rate', 'Per open'))}</th>
          <th scope="col">${esc(t('admin_reco.col_purchases', 'Bought'))}</th>
          <th scope="col">${esc(t('admin_reco.col_purchase_rate', 'Per open'))}</th>
        </tr></thead>
        <tbody>${rows}</tbody>`;
      scroll.append(table);
      frag.append(scroll);
    }

    const caveat = document.createElement('p');
    caveat.className = 'reco-notice';
    caveat.textContent = t(
      'admin_reco.funnel_caveat',
      'Read this as “which surfaces led to a purchase”, not “which surface caused one”. It only sees shoppers who allowed personalization, there is no control group, and a dash means there was nothing to divide by.'
    );
    frag.append(caveat);
    return frag;
  }

  function surfaceName(source) {
    if (source.startsWith('rail:')) return `${t('admin_reco.surface_rail', 'Rail')}: ${railTitle(source.slice(5))}`;
    return t(`admin_reco.surface.${source}`, humanize(source));
  }

  // ── Cards ─────────────────────────────────────────────────────────────────────────────────────

  function renderMainCard() {
    const card = document.createElement('section');
    card.className = 'card language-policy-card reco-card';

    // Tabs
    live.tabDots = new Map();
    const tabs = document.createElement('div');
    tabs.className = 'reco-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', t('admin_reco.tabs_label', 'Feed settings'));
    const entries = [...order.map((k) => ({ key: k })), { key: 'results' }];
    entries.forEach(({ key }) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'reco-tab';
      b.id = `reco-tab-${key}`;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(key === active));
      b.setAttribute('aria-controls', 'reco-panel');
      b.tabIndex = key === active ? 0 : -1;
      const label = document.createElement('span');
      label.textContent = key === 'results' ? t('admin_reco.tab.results', 'Results') : sectionLabel(key);
      b.append(label);
      if (key !== 'results') {
        const dot = document.createElement('span');
        dot.className = 'reco-tab__dot';
        dot.hidden = !dirty(key);
        dot.setAttribute('role', 'img');
        dot.setAttribute('aria-label', t('admin_reco.unsaved', 'Unsaved changes'));
        b.append(dot);
        live.tabDots.set(key, dot);
      }
      b.addEventListener('click', () => {
        if (key === active) return;
        active = key;
        if (key === 'results' && !funnel && funnelState === 'idle') {
          loadFunnel();
          return;
        }
        render();
      });
      b.addEventListener('keydown', (event) => {
        const i = entries.findIndex((e) => e.key === key);
        const next = event.key === 'ArrowRight' ? i + 1 : event.key === 'ArrowLeft' ? i - 1 : null;
        if (next === null) return;
        event.preventDefault();
        const target = entries[(next + entries.length) % entries.length].key;
        active = target;
        pendingFocus = { tab: target };
        if (target === 'results' && !funnel && funnelState === 'idle') loadFunnel();
        else render();
      });
      tabs.append(b);
    });
    card.append(tabs);

    const panel = document.createElement('div');
    panel.id = 'reco-panel';
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `reco-tab-${active}`);
    panel.className = 'reco-card';

    if (active === 'results') {
      panel.append(renderResults());
      card.append(panel);
      return card;
    }

    const section = meta[active];
    const intro = document.createElement('p');
    intro.className = 'reco-intro';
    intro.textContent = t(`admin_reco.intro.${active}`, section.label_en);
    panel.append(intro);

    if (section.is_default) {
      panel.append(
        Object.assign(document.createElement('p'), {
          className: 'reco-notice',
          textContent: t('admin_reco.is_default', 'Nothing has been saved here yet, so the shipped defaults are running.'),
        })
      );
    }
    if (section.has_fallbacks) {
      panel.append(
        Object.assign(document.createElement('p'), {
          className: 'reco-notice reco-notice--warn',
          textContent: t('admin_reco.has_fallbacks', 'One or more stored values were outside the allowed range, so the feed is using the default for those. Saving this form replaces them.'),
        })
      );
    }
    if (!canUpdate) {
      panel.append(
        Object.assign(document.createElement('p'), {
          className: 'reco-notice',
          textContent: t('admin_reco.read_only', 'You can view these settings but not change them.'),
        })
      );
    }

    live.fields = [];
    panel.append(active === 'rails' ? renderRails(section) : renderFlat(section));

    if (canUpdate) {
      const actions = document.createElement('div');
      actions.className = 'reco-actions';
      actions.append(
        Button({
          label: t('admin_reco.btn_reset', 'Reset this tab to the defaults'),
          variant: 'secondary',
          disabled: isSaving || JSON.stringify(drafts[active]) === JSON.stringify(section.defaults),
          onClick: resetToDefaults,
        })
      );
      panel.append(actions);
    }
    card.append(panel);
    return card;
  }

  function renderAuthorityCard() {
    const authority = data?.authority || { roles: [], grants: [] };
    const card = document.createElement('section');
    card.className = 'card language-authority-card';

    const head = document.createElement('div');
    head.className = 'language-authority-card__head';
    head.innerHTML = `
      <h2 class="card-title">${esc(t('admin_reco.authority_title', 'Who can change this'))}</h2>
      <p data-page-info class="text-xs text-secondary">
        ${esc(t('admin_reco.authority_hint', 'Super Admin always can. Anyone else needs a standing grant for platform.recommendation.update.'))}
      </p>
    `;
    card.append(head);

    const list = document.createElement('ul');
    list.className = 'language-authority-list';
    (authority.roles || []).forEach((role) => {
      const li = document.createElement('li');
      li.className = 'language-authority-list__item';
      li.innerHTML = `
        <span class="language-authority-list__name">${esc(isBn ? role.label_bn || role.label_en : role.label_en)}</span>
        <span class="language-authority-list__kind">${esc(t('admin_reco.by_role', 'by role'))}</span>
      `;
      list.append(li);
    });
    (authority.grants || []).forEach((grant) => {
      const li = document.createElement('li');
      li.className = 'language-authority-list__item';
      const name = grant.display_name || grant.full_name || grant.user_ref;
      const until = grant.expires_at ? formatDate(new Date(grant.expires_at).getTime(), { lang: isBn ? 'bn' : 'en' }) : '';
      li.innerHTML = `
        <span class="language-authority-list__name">${esc(name)}</span>
        <span class="language-authority-list__kind">
          ${esc(t('admin_reco.by_grant', 'granted'))}${until ? ` · ${esc(t('admin_reco.until', 'until'))} ${esc(until)}` : ''}
        </span>
      `;
      list.append(li);
    });

    if (!list.children.length) {
      card.append(
        EmptyState({
          title: t('admin_reco.authority_empty', 'No one holds this permission yet'),
          description: t('admin_reco.authority_empty_desc', 'Assign it from Access Grants to let someone other than a Super Admin tune the feed.'),
        })
      );
    } else {
      card.append(list);
    }

    const actions = document.createElement('div');
    actions.className = 'language-authority-card__actions';
    actions.append(
      Button({
        label: t('admin_reco.btn_manage_grants', 'Assign this permission'),
        variant: 'secondary',
        size: 'sm',
        onClick: () => navigate?.('/admin/grants'),
      })
    );
    card.append(actions);
    return card;
  }

  /** "trending 2.5 → 4, quality 2 → 3 (+1 more)" for a flat section; a count for rails. */
  function summariseHistory(row) {
    const section = row.after_json?.section || row.before_json?.section;
    const before = row.before_json?.value;
    const after = row.after_json?.value;
    if (!section || !before || !after) return '';
    const label = sectionLabel(section);
    if (section === 'rails') {
      const n = diffRails(before, after).length;
      return `${label}: ${t('admin_reco.history_n_changes', '{{n}} changes', { n })}`;
    }
    const keys = Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    const shown = keys.slice(0, 3).map((k) => `${fieldLabel(k)} ${before[k]} → ${after[k]}`);
    const more = keys.length > 3 ? ` (+${keys.length - 3} ${t('admin_reco.history_more', 'more')})` : '';
    return `${label}: ${shown.join(', ') || t('admin_reco.history_no_change', 'no value changed')}${more}`;
  }

  function renderHistoryCard() {
    const history = data?.history || [];
    const card = document.createElement('section');
    card.className = 'card language-history-card';
    const heading = document.createElement('h2');
    heading.className = 'card-title';
    heading.textContent = t('admin_reco.history_title', 'Recent changes');
    card.append(heading);

    if (!history.length) {
      card.append(
        EmptyState({
          title: t('admin_reco.history_empty', 'No changes recorded yet'),
          description: t('admin_reco.history_empty_desc', 'Every change to the feed is written to the audit log with its old and new values.'),
        })
      );
      return card;
    }

    const list = document.createElement('ol');
    list.className = 'language-history-list';
    history.forEach((row) => {
      const reason = row.after?.meta?.reason || row.after_json?.meta?.reason || '';
      const li = document.createElement('li');
      li.className = 'language-history-list__item';
      li.innerHTML = `
        <div class="language-history-list__head">
          <span class="language-history-list__actor font-mono">${esc(row.actor_ref || row.actor_id || '—')}</span>
          <span class="language-history-list__time">${esc(
            row.created_at ? formatRelativeTime(new Date(row.created_at).getTime(), { lang: isBn ? 'bn' : 'en' }) : ''
          )}</span>
        </div>
        <p class="language-history-list__change">${esc(summariseHistory(row))}</p>
        ${reason ? `<p class="language-history-list__reason">${esc(reason)}</p>` : ''}
      `;
      list.append(li);
    });
    card.append(list);
    return card;
  }

  // ── Page ──────────────────────────────────────────────────────────────────────────────────────

  function render() {
    container.innerHTML = '';
    live = { fields: [], saveBtn: null, discardBtn: null, status: null, tabDots: new Map() };

    const header = document.createElement('header');
    header.className = 'admin-page-header';

    const infoCol = document.createElement('div');
    // WHY the badge is appended and not interpolated: Badge() returns a DOM node, so putting it in a
    // template literal renders the string "[object HTMLSpanElement]".
    const eyebrow = document.createElement('div');
    eyebrow.className = 'admin-page-eyebrow';
    eyebrow.append(Badge({ label: t('admin_reco.badge', 'PERSONALIZED FEED'), variant: 'primary' }));
    const titleEl = document.createElement('h1');
    titleEl.className = 'admin-page-title';
    titleEl.textContent = t('admin_reco.title', 'Personalized Feed');
    const subtitleEl = document.createElement('p');
    subtitleEl.className = 'admin-page-subtitle';
    subtitleEl.textContent = t(
      'admin_reco.subtitle',
      'Tune how products are ranked and which shelves appear on the home page, and see which surfaces actually lead to purchases.'
    );
    infoCol.append(eyebrow, titleEl, subtitleEl);

    const actionsCol = document.createElement('div');
    actionsCol.className = 'admin-page-actions';
    const onSection = active !== 'results' && Boolean(meta[active]);
    if (canUpdate && onSection) {
      live.discardBtn = Button({
        label: t('common.discard', 'Discard'),
        variant: 'secondary',
        disabled: true,
        onClick: discardChanges,
      });
      live.saveBtn = Button({
        label: t('admin_reco.btn_save', 'Save this tab'),
        variant: 'primary',
        disabled: true,
        onClick: (event) => openSaveModal(event?.currentTarget || null),
      });
      live.status = document.createElement('p');
      live.status.className = 'reco-status';
      live.status.setAttribute('role', 'status');
      live.status.setAttribute('aria-live', 'polite');
      actionsCol.append(live.status, live.discardBtn, live.saveBtn);
    } else if (!canUpdate) {
      const note = document.createElement('p');
      note.className = 'admin-page-actions__note';
      note.textContent = t('admin_reco.read_only', 'You can view these settings but not change them.');
      actionsCol.append(note);
    }

    header.append(infoCol, actionsCol);
    container.append(header);
    container.append(PlatformSubnav({ activeKey: 'recommendations', navigate }));

    if (isLoading) {
      const loader = document.createElement('div');
      loader.className = 'card p-8 text-center text-secondary';
      loader.innerHTML = `<div class="spinner"></div><p class="mt-2">${esc(t('common.loading', 'Loading'))}…</p>`;
      container.append(loader);
      root.replaceChildren(container);
      return;
    }

    if (!data || !order.length) {
      container.append(
        EmptyState({
          title: t('admin_reco.load_failed', 'Feed settings are unavailable'),
          description: t('admin_reco.load_failed_desc', 'The settings could not be read. The feed keeps running on what it had until this loads.'),
          action: Button({ label: t('common.retry', 'Retry'), variant: 'primary', onClick: () => loadData() }),
        })
      );
      root.replaceChildren(container);
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'language-settings-grid';
    grid.append(renderMainCard(), renderAuthorityCard(), renderHistoryCard());
    container.append(grid);
    root.replaceChildren(container);

    refreshChrome();

    if (pendingFocus) {
      const f = pendingFocus;
      pendingFocus = null;
      const target = f.tab
        ? container.querySelector(`#reco-tab-${f.tab}`)
        : container.querySelectorAll(`[data-rail="${f.rail}"] .reco-rail__order button`)[f.dir < 0 ? 0 : 1];
      target?.focus();
    }
  }

  loadData();
  return container;
}
