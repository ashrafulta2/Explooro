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
import { el, productTitle } from './dom.js';
import { Button } from '../ui/Button.js';
import { confirmDialog } from '../ui/ConfirmDialog.js';
import { t, getLanguage } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { formatNumber } from '../../services/format.js';
import { getQueue, moderatePost, errorText } from '../../services/community.api.js';

function preview(post) {
  const d = post.details || {};
  const text = post.title || post.body || d.liked || d.could_improve || (d.steps || [])[0] || productTitle(post.product, getLanguage());
  return String(text || '').slice(0, 140);
}

function statCard(label, value) {
  return el('div', 'cm-stat', [el('span', 'cm-stat__label', label), el('strong', 'cm-stat__value', formatNumber(value))]);
}

/** @param {{ onChanged?: () => void }} [o] called after any decision so the timeline can refresh */
export function ModerationQueue({ onChanged } = {}) {
  const root = el('section', 'cm-queue', null, { 'aria-label': t('community.mod.title') });
  const list = el('div', 'cm-queue__list');
  const head = el('div', 'cm-queue__head');
  root.append(head, list);

  async function decide(post, action) {
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
      const { items, stats, threshold } = await getQueue();
      head.replaceChildren(
        el('div', 'cm-stats', [
          statCard(t('community.mod.stat.open'), stats.open_reports),
          statCard(t('community.mod.stat.today'), stats.posts_today),
          statCard(t('community.mod.stat.hidden'), stats.hidden_this_week),
          statCard(t('community.mod.stat.hours'), stats.avg_review_hours),
        ]),
        el('p', 'cm-callout', t('community.mod.rule', { n: formatNumber(threshold) })),
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
