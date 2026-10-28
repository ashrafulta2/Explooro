/**
 * ModerationQueue — the staff view of reported and hidden posts.
 *
 * Posts publish at once and are reviewed after a report, so this queue is where "after" happens:
 * the most reported post first, with one decision per post.
 *   Keep live   the post stays up (or comes back) and its open reports are dismissed
 *   Hide post   the post leaves the timeline; reversible with Keep live
 *   Remove      the post is gone for good; asks first
 *
 * The auto-hide threshold shown in the note is read from the API (platform setting), not typed here.
 */
import { el, productTitle } from './dom.ts';
import { Button } from '../ui/Button.ts';
import { confirmDialog } from '../ui/ConfirmDialog.ts';
import { t, getLanguage } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { formatNumber } from '../../services/format.js';
import { can } from '../../services/permissions.js';
import { getQueue, moderatePost, updateThreshold, errorText } from '../../services/community.api.ts';
import type { CommunityPost } from '../../services/community.api.ts';

function preview(post: CommunityPost): string {
  const d = post.details || {};
  const text = post.title || post.body || d.liked || d.could_improve || (d.steps || [])[0] || productTitle(post.product, getLanguage());
  return String(text || '').slice(0, 140);
}

const MIN_REASON = 10; // mirrors the server's rule for a settings change

/**
 * The auto-hide threshold. Everyone who can see the queue sees the rule; only a holder of
 * community.settings.update gets the form (changing it needs a reason, which goes in the audit log).
 */
function thresholdPanel({ threshold, limits, onSaved }: { threshold: number; limits: { min: number; max: number }; onSaved: () => void }) {
  const rule = el('p', 'cm-callout', t('community.mod.rule', { n: formatNumber(threshold) }));
  if (!can('community.settings.update')) return rule;

  const num = el('input', 'input cm-settings__num', null, { type: 'number', min: limits.min, max: limits.max, step: 1, value: threshold, 'aria-label': t('community.mod.settings.label') });
  const reason = el('input', 'input', null, { type: 'text', maxlength: 500, placeholder: t('community.mod.settings.reason_ph'), 'aria-label': t('community.mod.settings.reason') });
  const error = el('p', 'cm-composer__error cm-settings__error', '', { role: 'alert' });
  const save = Button({
    label: t('community.mod.settings.save'),
    size: 'sm',
    onClick: async () => {
      error.textContent = '';
      const value = Number(num.value);
      if (!Number.isInteger(value) || value < limits.min || value > limits.max) {
        error.textContent = t('community.mod.settings.range', { min: formatNumber(limits.min), max: formatNumber(limits.max) });
        return;
      }
      if (value === threshold) { error.textContent = t('community.mod.settings.unchanged'); return; }
      if (reason.value.trim().length < MIN_REASON) { error.textContent = t('community.mod.settings.reason_short', { n: formatNumber(MIN_REASON) }); return; }
      save.disabled = true;
      try {
        await updateThreshold(value, reason.value.trim());
        toast.success(t('community.mod.settings.saved'));
        onSaved();
      } catch (err) {
        error.textContent = errorText(err) || t('community.error.generic');
        save.disabled = false;
      }
    },
  });

  return el('div', 'cm-settings', [
    el('h4', 'cm-settings__title', t('community.mod.settings.title')),
    rule,
    el('div', 'cm-settings__row', [
      el('label', 'cm-settings__field', [el('span', 'cm-field__label', t('community.mod.settings.label')), num]),
      el('label', 'cm-settings__field cm-settings__field--wide', [el('span', 'cm-field__label', t('community.mod.settings.reason')), reason]),
      save,
    ]),
    el('p', 'cm-field__hint', t('community.mod.settings.hint', { min: formatNumber(limits.min), max: formatNumber(limits.max) })),
    error,
  ]);
}

function statCard(label: string, value: number) {
  return el('div', 'cm-stat', [el('span', 'cm-stat__label', label), el('strong', 'cm-stat__value', formatNumber(value))]);
}

/** `onChanged` is called after any decision so the timeline can refresh. */
export function ModerationQueue({ onChanged }: { onChanged?: () => void } = {}): HTMLElement {
  const root = el('section', 'cm-queue', null, { 'aria-label': t('community.mod.title') });
  const list = el('div', 'cm-queue__list');
  const head = el('div', 'cm-queue__head');
  root.append(head, list);

  async function decide(post: CommunityPost, action: 'KEEP' | 'HIDE' | 'REMOVE') {
    if (action === 'REMOVE') {
      const ok = await confirmDialog({
        title: t('community.mod.remove_title'),
        description: t('community.mod.remove_desc'),
        confirmLabel: t('community.mod.remove'),
        cancelLabel: t('community.composer.cancel'),
        variant: 'danger',
      });
      if (!ok) return;
    }
    try {
      await moderatePost(post.id, action);
      toast.success(t(`community.mod.done.${action}`));
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(errorText(err) || t('community.error.generic'));
    }
  }

  function row(post) {
    const hidden = post.status === 'HIDDEN';
    const meta = el('div', 'cm-qrow__meta', [
      el('span', `cm-role cm-role--${post.author.role}`, t(`community.role.${post.author.role}`)),
      post.top_reason
        ? el('span', 'cm-pill cm-pill--danger', t('community.mod.reason_count', {
          reason: t(`community.report.reason.${post.top_reason}`), n: formatNumber(post.open_report_count),
        }))
        : null,
      el('span', 'cm-qrow__state', hidden ? t('community.mod.state_hidden') : t('community.mod.state_live')),
    ]);
    const actions = el('div', 'cm-qrow__actions', [
      Button({ label: t('community.mod.keep'), size: 'sm', onClick: () => decide(post, 'KEEP') }),
      hidden ? null : Button({ label: t('community.mod.hide_post'), size: 'sm', variant: 'secondary', onClick: () => decide(post, 'HIDE') }),
      Button({ label: t('community.mod.remove'), size: 'sm', variant: 'ghost', onClick: () => decide(post, 'REMOVE') }),
    ]);
    return el('article', 'cm-qrow', [
      meta,
      el('p', 'cm-qrow__text', [el('strong', '', `${post.author.name} `), preview(post)]),
      actions,
    ]);
  }

  async function load() {
    try {
      const { items, stats, threshold, threshold_limits: limits } = await getQueue();
      head.replaceChildren(
        el('div', 'cm-stats', [
          statCard(t('community.mod.stat.open'), stats.open_reports),
          statCard(t('community.mod.stat.today'), stats.posts_today),
          statCard(t('community.mod.stat.hidden'), stats.hidden_this_week),
          statCard(t('community.mod.stat.hours'), stats.avg_review_hours),
        ]),
        thresholdPanel({ threshold, limits, onSaved: load }),
      );
      list.replaceChildren(...(items.length
        ? items.map(row)
        : [el('p', 'cm-empty-note', t('community.mod.empty'))]));
    } catch (err) {
      list.replaceChildren(el('p', 'cm-composer__error', errorText(err) || t('community.error.generic')));
    }
  }

  load();
  return root;
}
