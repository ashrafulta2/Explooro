/**
 * UserTimeline.js — Categorized activity stream timeline with metadata badges & diff inspect (Prompt 3.4).
 */

import { Badge } from '../ui/Badge.js';
import { Button } from '../ui/Button.js';
import { openAuditDiffModal } from './AuditDiffViewer.js';
import { t, getLanguage } from '../../services/i18n.js';
import { formatRelativeTime, formatDate } from '../../services/format.js';

export function UserTimeline({ events = [] }) {
  const isBn = getLanguage() === 'bn';
  const container = document.createElement('div');
  container.className = 'user-timeline';

  if (!events || events.length === 0) {
    const emptyBox = document.createElement('div');
    emptyBox.className = 'text-sm text-muted text-center';
    emptyBox.style.padding = 'var(--space-6)';
    emptyBox.textContent = t('user_timeline.empty');
    container.append(emptyBox);
    return container;
  }

  for (const ev of events) {
    const item = document.createElement('div');
    item.className = 'user-timeline__item';

    const node = document.createElement('div');
    node.className = 'user-timeline__node';

    // Header: Action & Category Badge + Timestamp
    const header = document.createElement('div');
    header.className = 'user-timeline__header';

    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.alignItems = 'center';
    left.style.gap = 'var(--space-2)';

    const actionTitle = document.createElement('strong');
    actionTitle.style.fontSize = 'var(--text-sm)';
    actionTitle.textContent = ev.action || 'activity.event';

    const catVariant =
      ev.category === 'AUTH'
        ? 'info'
        : ev.category === 'PERMISSIONS'
        ? 'primary'
        : ev.category === 'RESTRICTIONS'
        ? 'danger'
        : ev.category === 'ORDERS'
        ? 'success'
        : 'neutral';

    const catBadge = Badge({
      label: ev.category || 'SYSTEM',
      variant: catVariant,
    });

    left.append(actionTitle, catBadge);

    const timeSpan = document.createElement('span');
    timeSpan.style.fontSize = '11px';
    timeSpan.style.color = 'var(--text-muted)';
    if (ev.created_at) {
      const ts = new Date(ev.created_at).getTime();
      timeSpan.textContent = `${formatRelativeTime(ts, { lang: isBn ? 'bn' : 'en' })} · ${formatDate(ts, { lang: isBn ? 'bn' : 'en' })}`;
    }

    header.append(left, timeSpan);

    // Description text
    const descP = document.createElement('p');
    descP.style.margin = 'var(--space-1) 0';
    descP.style.fontSize = 'var(--text-xs)';
    descP.style.color = 'var(--text-secondary)';
    descP.textContent = ev.description || ev.action;

    // Footer Metadata & Diff Trigger
    const footerMeta = document.createElement('div');
    footerMeta.className = 'user-timeline__meta';
    footerMeta.style.justifyContent = 'space-between';

    const tagsLeft = document.createElement('div');
    tagsLeft.style.display = 'flex';
    tagsLeft.style.alignItems = 'center';
    tagsLeft.style.gap = 'var(--space-2)';

    if (ev.ip) {
      const ipTag = document.createElement('span');
      ipTag.textContent = `${t('user_timeline.ip_label')}: ${ev.ip}`;
      tagsLeft.append(ipTag);
    }

    if (ev.trace_id) {
      const traceTag = document.createElement('span');
      traceTag.style.fontFamily = 'monospace';
      traceTag.textContent = `${t('user_timeline.trace_label')}: ${ev.trace_id.substring(0, 8)}…`;
      tagsLeft.append(traceTag);
    }

    footerMeta.append(tagsLeft);

    if (ev.before || ev.after || ev.before_state_json || ev.after_state_json) {
      const diffBtn = Button({
        label: `🔍 ${t('audit_explorer.view_diff')}`,
        variant: 'ghost',
        size: 'sm',
        onClick: () => openAuditDiffModal({ record: ev, trigger: diffBtn }),
      });
      footerMeta.append(diffBtn);
    }

    item.append(node, header, descP, footerMeta);
    container.append(item);
  }

  return container;
}
