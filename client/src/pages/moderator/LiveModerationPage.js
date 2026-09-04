/**
 * LiveModerationPage.js — Live Moderation Console (/moderator/live).
 *
 * Prompt 10.1 REQUIREMENT 6 says "a moderator can mute a participant or terminate a stream". Both
 * endpoints shipped, but /moderator/live pointed at LiveStreamPage.js — the customer-facing
 * shopping browse page — so the nav item promised a moderation surface and delivered a storefront
 * with a "Host a Live Stream" button. This is that surface.
 *
 * The console is built around one question: which running broadcast is about to hurt a buyer, and
 * what is the smallest action that stops it?
 *
 *   Left rail   — every broadcast, LIVE first, ordered by chat volume, each carrying the signals a
 *                 moderator triages on (flagged messages, removals, active mutes).
 *   Right pane  — the selected broadcast: what it is selling, and three tabs — the chat monitor
 *                 with advisory flags resolved per message, who is currently muted, and the log of
 *                 every moderation action already taken on it.
 *
 * Three actions, deliberately ordered by how much they cost the seller:
 *   1. Remove one message   (chat.message.moderate) — the sale continues.
 *   2. Mute a participant   (moderation.live.handle) — timed, reversible, they can still buy.
 *   3. Terminate the stream (live.stream.terminate)  — HIGH tier, so a moderator's request is
 *      filed for Super Admin sign-off rather than executed. The UI says so before you click.
 */

import { api } from '../../core/api.js';
import { formatCurrency, formatDate } from '../../services/format.js';
import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';

/** Live chat is entirely viewer-authored, so nothing from it reaches innerHTML unescaped. */
const esc = (value) =>
  value == null
    ? ''
    : String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const STATUS_TABS = ['LIVE', 'SCHEDULED', 'ENDED', 'TERMINATED', 'ALL'];
const STATUS_TAB_LABELS = {
  LIVE: 'live_mod.tab_live',
  SCHEDULED: 'live_mod.tab_scheduled',
  ENDED: 'live_mod.tab_ended',
  TERMINATED: 'live_mod.tab_terminated',
  ALL: 'live_mod.tab_all',
};

const REASON_PRESETS = [
  'live_mod.preset_contact_leak',
  'live_mod.preset_counterfeit',
  'live_mod.preset_harassment',
  'live_mod.preset_spam',
  'live_mod.preset_prohibited',
];

// A running broadcast changes by the second; anything else is settled history and polling it is
// pure waste. Only LIVE streams are re-fetched.
const POLL_INTERVAL_MS = 10_000;

export default function LiveModerationPage(root, ctx = {}) {
  const container = document.createElement('div');
  container.className = 'live-moderation-page';
  container.style.cssText = `
    max-width: 1360px;
    margin: 0 auto;
    padding: 24px 20px 48px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    color: var(--text-primary, #0f172a);
    font-family: inherit;
  `;

  const query = ctx.query ?? {};

  let statusTab = STATUS_TABS.includes(query.status) ? query.status : 'LIVE';
  let streams = [];
  let selectedId = query.stream ? Number(query.stream) : null;
  let feed = null;
  let detailTab = 'chat';
  let flaggedOnly = false;
  let loadingList = true;
  let loadingFeed = false;
  let autoRefresh = true;
  let pollTimer = null;
  let previewOpen = true;
  let audioOnly = false;
  let videoEl = null;

  // ── data ──────────────────────────────────────────────────────────────────

  async function fetchStreams({ silent = false } = {}) {
    try {
      if (!silent) {
        loadingList = true;
        render();
      }
      const res = await api.get(`/live/moderation/streams?status=${encodeURIComponent(statusTab)}`);
      streams = res.data?.streams ?? [];

      // Keep a selection that is still in the filtered list; otherwise fall to the first row so
      // the right pane is never left rendering a stream the rail no longer shows.
      if (!streams.some((s) => s.id === selectedId)) {
        selectedId = streams[0]?.id ?? null;
        feed = null;
      }
    } catch (err) {
      toast.error(err.message || 'Failed to load broadcasts.');
      streams = [];
    } finally {
      loadingList = false;
      render();
      if (selectedId && !feed) await fetchFeed(selectedId);
    }
  }

  async function fetchFeed(streamId, { silent = false } = {}) {
    if (!streamId) return;
    try {
      if (!silent) {
        loadingFeed = true;
        render();
      }
      const res = await api.get(
        `/live/moderation/streams/${streamId}?audio_only=${audioOnly ? 'true' : 'false'}`
      );
      feed = res.data ?? null;
    } catch (err) {
      toast.error(err.message || 'Failed to load the moderation feed.');
      feed = null;
    } finally {
      loadingFeed = false;
      render();
    }
  }

  function schedulePoll() {
    clearInterval(pollTimer);
    if (!autoRefresh) return;
    pollTimer = setInterval(async () => {
      // Silent refresh: re-rendering the whole rail under the moderator's cursor every 10s would
      // steal a click mid-action, so the poll never shows a loading state.
      if (document.hidden) return;
      await fetchStreams({ silent: true });
      if (selectedId && feed?.stream?.status === 'LIVE') await fetchFeed(selectedId, { silent: true });
    }, POLL_INTERVAL_MS);
  }

  // ── actions ───────────────────────────────────────────────────────────────

  async function removeMessage(messageId, reason) {
    try {
      await api.post(`/live/streams/${selectedId}/moderate/messages/${messageId}/remove`, { reason });
      toast.success(t('live_mod.remove_success'));
      await fetchFeed(selectedId, { silent: true });
      await fetchStreams({ silent: true });
    } catch (err) {
      toast.error(err.message || 'Failed to remove the message.');
    }
  }

  async function muteParticipant(userId, durationMinutes, reason) {
    try {
      await api.post(`/live/streams/${selectedId}/moderate/mute`, {
        target_user_id: userId,
        duration_minutes: durationMinutes,
        reason,
      });
      toast.success(t('live_mod.mute_success'));
      await fetchFeed(selectedId, { silent: true });
    } catch (err) {
      toast.error(err.message || 'Failed to mute the participant.');
    }
  }

  async function unmuteParticipant(userId) {
    try {
      await api.post(`/live/streams/${selectedId}/moderate/unmute`, { target_user_id: userId });
      toast.success(t('live_mod.unmute_success'));
      await fetchFeed(selectedId, { silent: true });
    } catch (err) {
      toast.error(err.message || 'Failed to lift the mute.');
    }
  }

  async function terminateStream(reason) {
    try {
      const res = await api.post(`/live/streams/${selectedId}/moderate/terminate`, { reason });

      // A HIGH-tier permission returns 202 with a `deferred` envelope and mutates nothing
      // (core/api.js §2.2). Reporting that as success would tell a moderator a harmful broadcast
      // is off the air when it is still selling.
      if (res.deferred) {
        toast.info(t('live_mod.terminate_pending'), { duration: 9000 });
      } else {
        toast.success(t('live_mod.terminate_success'));
      }

      await fetchStreams({ silent: true });
      await fetchFeed(selectedId, { silent: true });
    } catch (err) {
      toast.error(err.message || 'Failed to terminate the broadcast.');
    }
  }

  // ── rendering ─────────────────────────────────────────────────────────────

  function chip(label, value, tone = 'neutral') {
    const tones = {
      neutral: ['var(--surface-2, #f8fafc)', 'var(--text-secondary, #475569)', 'var(--border-subtle, #e2e8f0)'],
      danger: ['var(--danger-bg, rgba(225,29,72,0.1))', 'var(--danger, #e11d48)', 'var(--danger-border, rgba(225,29,72,0.25))'],
      warning: ['var(--warning-bg, rgba(217,119,6,0.1))', 'var(--warning, #d97706)', 'var(--warning-border, rgba(217,119,6,0.25))'],
      success: ['var(--success-bg, rgba(5,150,105,0.1))', 'var(--success, #059669)', 'var(--success-border, rgba(5,150,105,0.25))'],
    };
    const [bg, fg, border] = tones[tone] ?? tones.neutral;
    return `
      <span style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: var(--radius-md, 8px); background: ${bg}; color: ${fg}; border: 1px solid ${border}; font-size: 12px; font-weight: 600;">
        ${esc(label)}
        <strong style="font-variant-numeric: tabular-nums;">${esc(value)}</strong>
      </span>
    `;
  }

  function statusBadge(status) {
    const tone =
      status === 'LIVE' ? 'danger' : status === 'SCHEDULED' ? 'warning' : status === 'TERMINATED' ? 'danger' : 'neutral';
    const tones = {
      danger: ['var(--danger-bg, rgba(225,29,72,0.1))', 'var(--danger, #e11d48)'],
      warning: ['var(--warning-bg, rgba(217,119,6,0.1))', 'var(--warning, #d97706)'],
      neutral: ['var(--surface-2, #f8fafc)', 'var(--text-muted, #64748b)'],
    };
    const [bg, fg] = tones[tone];
    const dot = status === 'LIVE' ? '<span style="width:6px;height:6px;border-radius:50%;background:currentColor;"></span>' : '';
    return `<span style="display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:6px;background:${bg};color:${fg};font-size:11px;font-weight:800;letter-spacing:0.03em;">${dot}${esc(status)}</span>`;
  }

  function renderHeader() {
    return `
      <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap;">
        <div>
          <h1 style="display: flex; align-items: center; gap: 10px; margin: 0; font-size: 22px; font-weight: 800;">
            <span aria-hidden="true">📡</span>${esc(t('live_mod.page_title'))}
          </h1>
          <p style="margin: 6px 0 0; font-size: 13px; color: var(--text-muted, #64748b); max-width: 640px;">
            ${esc(t('live_mod.page_subtitle'))}
          </p>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <label for="chk-auto-refresh" style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--text-secondary, #475569); cursor: pointer;">
            <input type="checkbox" id="chk-auto-refresh" ${autoRefresh ? 'checked' : ''} />
            ${esc(t('live_mod.auto_refresh'))}
          </label>
          <button id="btn-refresh-live" style="padding: 8px 14px; font-size: 13px; font-weight: 600; border-radius: var(--radius-md, 8px); border: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-1, #ffffff); color: var(--text-primary, #0f172a); cursor: pointer;">
            🔄 ${esc(t('live_mod.refresh'))}
          </button>
        </div>
      </div>
    `;
  }

  function renderRail() {
    const tabs = STATUS_TABS.map((key) => {
      const active = statusTab === key;
      return `
        <button data-status-tab="${key}" style="
          padding: 5px 10px; font-size: 12px; font-weight: 600; cursor: pointer;
          border-radius: var(--radius-md, 8px);
          border: 1px solid ${active ? 'var(--brand, #4f46e5)' : 'var(--border-subtle, #e2e8f0)'};
          background: ${active ? 'var(--brand, #4f46e5)' : 'var(--surface-1, #ffffff)'};
          color: ${active ? 'var(--brand-contrast, #ffffff)' : 'var(--text-secondary, #475569)'};
        ">${esc(t(STATUS_TAB_LABELS[key]))}</button>
      `;
    }).join('');

    let body;
    if (loadingList) {
      body = `<p style="padding: 24px 12px; text-align: center; font-size: 13px; color: var(--text-muted, #64748b);">${esc(t('live_mod.rail_loading'))}</p>`;
    } else if (streams.length === 0) {
      body = `<p style="padding: 24px 12px; text-align: center; font-size: 13px; color: var(--text-muted, #64748b);">${esc(t('live_mod.rail_empty'))}</p>`;
    } else {
      body = streams
        .map((s) => {
          const active = s.id === selectedId;
          const flagged = s.flagged_count ?? 0;
          return `
            <button data-stream-id="${s.id}" style="
              display: block; width: 100%; text-align: left; cursor: pointer;
              padding: 12px; border-radius: var(--radius-md, 8px);
              border: 1px solid ${active ? 'var(--brand, #4f46e5)' : 'var(--border-subtle, #e2e8f0)'};
              border-left: 3px solid ${flagged > 0 ? 'var(--danger, #e11d48)' : active ? 'var(--brand, #4f46e5)' : 'transparent'};
              background: ${active ? 'var(--surface-2, #f8fafc)' : 'var(--surface-1, #ffffff)'};
              margin-bottom: 8px;
            ">
              <span style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px;">
                ${statusBadge(s.status)}
                <span style="font-size: 11px; color: var(--text-muted, #64748b);">👁 ${esc(s.viewer_count ?? 0)}</span>
              </span>
              <span style="display: block; font-size: 13px; font-weight: 700; color: var(--text-primary, #0f172a); line-height: 1.35;">
                ${esc(s.title)}
              </span>
              <span style="display: block; font-size: 11px; color: var(--text-muted, #64748b); margin-top: 3px;">
                ${esc(s.host_name ?? '—')}
              </span>
              <span style="display: flex; gap: 8px; margin-top: 7px; font-size: 11px; font-weight: 700;">
                ${
                  flagged > 0
                    ? `<span style="color: var(--danger, #e11d48);">⚠ ${esc(flagged)} ${esc(t('live_mod.flagged_badge'))}</span>`
                    : ''
                }
                ${
                  (s.muted_count ?? 0) > 0
                    ? `<span style="color: var(--warning, #d97706);">🔇 ${esc(s.muted_count)}</span>`
                    : ''
                }
                <span style="color: var(--text-muted, #64748b);">💬 ${esc(s.chat_message_count ?? 0)}</span>
              </span>
            </button>
          `;
        })
        .join('');
    }

    return `
      <aside style="background: var(--surface-1, #ffffff); border: 1px solid var(--border-subtle, #e2e8f0); border-radius: var(--radius-lg, 12px); padding: 14px; align-self: start;">
        <h2 style="margin: 0 0 10px; font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted, #64748b);">
          ${esc(t('live_mod.rail_title'))}
        </h2>
        <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px;">${tabs}</div>
        <div style="max-height: 620px; overflow-y: auto;">${body}</div>
      </aside>
    `;
  }

  function renderStreamSummary(stream) {
    const started = stream.started_at ? new Date(stream.started_at) : null;
    const runningMins = started ? Math.max(0, Math.round((Date.now() - started.getTime()) / 60000)) : null;
    const pinned = stream.pinned_product;

    return `
      <div style="border-bottom: 1px solid var(--border-subtle, #e2e8f0); padding-bottom: 14px; margin-bottom: 14px;">
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
          <div style="min-width: 260px; flex: 1;">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              ${statusBadge(stream.status)}
              <h2 style="margin: 0; font-size: 17px; font-weight: 800;">${esc(stream.title)}</h2>
            </div>
            <p style="margin: 6px 0 0; font-size: 12px; color: var(--text-muted, #64748b);">
              ${esc(t('live_mod.host_label'))}: <strong style="color: var(--text-primary, #0f172a);">${esc(stream.host_name ?? '—')}</strong>
              ${stream.store_name ? ` · ${esc(t('live_mod.store_label'))}: <strong style="color: var(--text-primary, #0f172a);">${esc(stream.store_name)}</strong>` : ''}
              ${runningMins != null ? ` · ${esc(t('live_mod.running_for'))} ${esc(runningMins)}m` : ''}
            </p>
          </div>
          ${
            stream.status === 'LIVE'
              ? `<button id="btn-terminate-stream" style="padding: 9px 16px; font-size: 13px; font-weight: 700; border-radius: var(--radius-md, 8px); border: 1px solid var(--danger, #e11d48); background: var(--danger, #e11d48); color: #ffffff; cursor: pointer;">
                   ⛔ ${esc(t('live_mod.btn_terminate'))}
                 </button>`
              : ''
          }
        </div>

        ${
          stream.status === 'TERMINATED'
            ? `<p style="margin: 12px 0 0; padding: 9px 12px; border-radius: var(--radius-md, 8px); background: var(--danger-bg, rgba(225,29,72,0.1)); border: 1px solid var(--danger-border, rgba(225,29,72,0.25)); color: var(--danger, #e11d48); font-size: 12px; font-weight: 600;">
                 ${esc(t('live_mod.terminated_notice', { reason: stream.termination_reason || '—' }))}
               </p>`
            : ''
        }

        <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px;">
          ${chip(t('live_mod.viewers'), stream.viewer_count ?? 0)}
          ${chip(t('live_mod.likes'), stream.like_count ?? stream.total_likes_count ?? 0)}
          ${chip(t('live_mod.signal_chat'), feed?.messages?.filter((m) => m.message_type === 'CHAT' && !m.deleted_at).length ?? 0)}
          ${chip(t('live_mod.signal_flagged'), feed?.flagged_count ?? 0, (feed?.flagged_count ?? 0) > 0 ? 'danger' : 'neutral')}
          ${chip(t('live_mod.signal_removed'), feed?.removed_count ?? 0)}
          ${chip(t('live_mod.signal_muted'), feed?.mutes?.length ?? 0, (feed?.mutes?.length ?? 0) > 0 ? 'warning' : 'neutral')}
          ${
            stream.total_sales_amount != null
              ? chip(t('live_mod.sales'), formatCurrency(stream.total_sales_amount), 'success')
              : ''
          }
        </div>

        <div style="margin-top: 12px; font-size: 12px; color: var(--text-muted, #64748b);">
          ${esc(t('live_mod.pinned_product'))}:
          ${
            pinned
              ? `<strong style="color: var(--text-primary, #0f172a);">${esc(pinned.title ?? pinned.title_en)}</strong> — ${esc(formatCurrency(pinned.price))}`
              : esc(t('live_mod.no_pinned_product'))
          }
        </div>
      </div>
    `;
  }

  function renderDetailTabs() {
    const tabs = [
      ['chat', t('live_mod.tab_chat')],
      ['mutes', t('live_mod.tab_participants')],
      ['log', t('live_mod.tab_log')],
    ];
    return `
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 12px;">
        <div style="display: flex; gap: 6px;">
          ${tabs
            .map(([key, label]) => {
              const active = detailTab === key;
              return `<button data-detail-tab="${key}" style="
                padding: 6px 12px; font-size: 12px; font-weight: 700; cursor: pointer;
                border-radius: var(--radius-md, 8px);
                border: 1px solid ${active ? 'var(--brand, #4f46e5)' : 'var(--border-subtle, #e2e8f0)'};
                background: ${active ? 'var(--brand, #4f46e5)' : 'var(--surface-1, #ffffff)'};
                color: ${active ? 'var(--brand-contrast, #ffffff)' : 'var(--text-secondary, #475569)'};
              ">${esc(label)}</button>`;
            })
            .join('')}
        </div>
        ${
          detailTab === 'chat'
            ? `<label for="chk-flagged-only" style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--text-secondary, #475569); cursor: pointer;">
                 <input type="checkbox" id="chk-flagged-only" ${flaggedOnly ? 'checked' : ''} />
                 ${esc(t('live_mod.only_flagged'))}
               </label>`
            : ''
        }
      </div>
    `;
  }

  function renderMessage(m) {
    const isSystem = m.message_type !== 'CHAT';
    const flagged = (m.flags?.length ?? 0) > 0;
    const removed = Boolean(m.deleted_at);
    const isHost = (m.user_roles ?? []).some((r) => r === 'saler' || r === 'supplier');

    const border = removed
      ? 'var(--border-subtle, #e2e8f0)'
      : flagged
        ? 'var(--danger, #e11d48)'
        : 'var(--border-subtle, #e2e8f0)';

    const flagList = (m.flags ?? [])
      .map(
        (f) => `
        <span style="display: inline-flex; align-items: center; gap: 5px; padding: 2px 7px; border-radius: 5px; background: var(--danger-bg, rgba(225,29,72,0.1)); color: var(--danger, #e11d48); border: 1px solid var(--danger-border, rgba(225,29,72,0.25)); font-size: 10px; font-weight: 800; font-family: monospace;">
          ${esc(f.code)}
        </span>
        <span style="font-size: 11px; color: var(--text-muted, #64748b);">${esc(f.label_en)}</span>
      `
      )
      .join('');

    return `
      <li style="
        list-style: none; padding: 10px 12px; margin-bottom: 8px;
        border: 1px solid ${border}; border-radius: var(--radius-md, 8px);
        background: ${removed ? 'var(--surface-2, #f8fafc)' : 'var(--surface-1, #ffffff)'};
        opacity: ${removed ? '0.72' : '1'};
      ">
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px;">
          <strong style="font-size: 12px; color: var(--text-primary, #0f172a);">${esc(m.user_name ?? '—')}</strong>
          ${isHost ? `<span style="font-size: 10px; font-weight: 800; padding: 1px 6px; border-radius: 4px; background: var(--info-bg, rgba(79,70,229,0.1)); color: var(--text-brand, #4f46e5);">${esc(t('live_mod.host_badge'))}</span>` : ''}
          ${isSystem ? `<span style="font-size: 10px; font-weight: 800; padding: 1px 6px; border-radius: 4px; background: var(--surface-2, #f8fafc); color: var(--text-muted, #64748b); font-family: monospace;">${esc(m.message_type)}</span>` : ''}
          ${flagged ? `<span style="font-size: 10px; font-weight: 800; padding: 1px 6px; border-radius: 4px; background: var(--danger-bg, rgba(225,29,72,0.1)); color: var(--danger, #e11d48);">⚠ ${esc(t('live_mod.flagged_badge'))}</span>` : ''}
          ${removed ? `<span style="font-size: 10px; font-weight: 800; padding: 1px 6px; border-radius: 4px; background: var(--surface-3, #f1f5f9); color: var(--text-secondary, #475569);">${esc(t('live_mod.removed_badge'))}</span>` : ''}
          <span style="margin-left: auto; font-size: 11px; color: var(--text-muted, #64748b);">${esc(formatDate(m.created_at))}</span>
        </div>

        <p style="margin: 0; font-size: 13px; line-height: 1.5; color: ${removed ? 'var(--text-muted, #64748b)' : 'var(--text-primary, #0f172a)'}; ${removed ? 'text-decoration: line-through;' : ''}">
          ${esc(m.content)}
        </p>

        ${flagged ? `<div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 7px;">${flagList}</div>` : ''}

        ${
          removed
            ? `<p style="margin: 7px 0 0; font-size: 11px; color: var(--text-muted, #64748b);">
                 ${esc(t('live_mod.removed_by', { name: m.deleted_by_name ?? '—' }))} — ${esc(m.deletion_reason ?? '')}
               </p>`
            : ''
        }

        ${
          !removed && !isSystem
            ? `<div style="display: flex; gap: 8px; margin-top: 9px;">
                 <button data-remove-message="${m.id}" style="padding: 4px 10px; font-size: 11px; font-weight: 700; border-radius: 6px; border: 1px solid var(--danger, #e11d48); background: transparent; color: var(--danger, #e11d48); cursor: pointer;">
                   ${esc(t('live_mod.btn_remove_message'))}
                 </button>
                 <button data-mute-user="${m.user_id}" data-mute-name="${esc(m.user_name ?? '')}" style="padding: 4px 10px; font-size: 11px; font-weight: 700; border-radius: 6px; border: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-1, #ffffff); color: var(--text-secondary, #475569); cursor: pointer;">
                   🔇 ${esc(t('live_mod.btn_mute_user'))}
                 </button>
               </div>`
            : ''
        }
      </li>
    `;
  }

  function renderChatTab() {
    let messages = feed?.messages ?? [];
    if (flaggedOnly) messages = messages.filter((m) => (m.flags?.length ?? 0) > 0);

    if (messages.length === 0) {
      return `<p style="padding: 36px 12px; text-align: center; font-size: 13px; color: var(--text-muted, #64748b);">${esc(t('live_mod.chat_empty'))}</p>`;
    }
    return `<ul style="margin: 0; padding: 0; max-height: 540px; overflow-y: auto;">${messages.map(renderMessage).join('')}</ul>`;
  }

  function renderMutesTab() {
    const mutes = feed?.mutes ?? [];
    if (mutes.length === 0) {
      return `<p style="padding: 36px 12px; text-align: center; font-size: 13px; color: var(--text-muted, #64748b);">${esc(t('live_mod.mutes_empty'))}</p>`;
    }

    // A mute is a countdown, not a state — showing the raw expiry timestamp would make the
    // moderator do the subtraction themselves.
    return `<ul style="margin: 0; padding: 0;">${mutes
      .map((mute) => {
        const minutesLeft = Math.max(0, Math.round((new Date(mute.expires_at).getTime() - Date.now()) / 60000));
        const name = feed?.messages?.find((m) => m.user_id === mute.user_id)?.user_name;
        return `
          <li style="list-style: none; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 12px; margin-bottom: 8px; border: 1px solid var(--border-subtle, #e2e8f0); border-radius: var(--radius-md, 8px); background: var(--surface-1, #ffffff);">
            <span>
              <strong style="font-size: 13px;">${esc(name ?? `#${mute.user_id}`)}</strong>
              <span style="display: block; font-size: 11px; color: var(--warning, #d97706); font-weight: 600; margin-top: 2px;">
                🔇 ${esc(t('live_mod.mute_expires_in', { minutes: minutesLeft }))}
              </span>
            </span>
            <button data-unmute-user="${mute.user_id}" style="padding: 5px 12px; font-size: 12px; font-weight: 700; border-radius: 6px; border: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-1, #ffffff); color: var(--text-primary, #0f172a); cursor: pointer;">
              ${esc(t('live_mod.unmute'))}
            </button>
          </li>
        `;
      })
      .join('')}</ul>`;
  }

  function renderLogTab() {
    const log = feed?.action_log ?? [];
    if (log.length === 0) {
      return `<p style="padding: 36px 12px; text-align: center; font-size: 13px; color: var(--text-muted, #64748b);">${esc(t('live_mod.log_empty'))}</p>`;
    }
    return `<ol style="margin: 0; padding: 0;">${log
      .map(
        (entry) => `
        <li style="list-style: none; padding: 10px 12px; margin-bottom: 8px; border: 1px solid var(--border-subtle, #e2e8f0); border-left: 3px solid var(--brand, #4f46e5); border-radius: var(--radius-md, 8px); background: var(--surface-1, #ffffff);">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <strong style="font-size: 12px;">${esc(t(`live_mod.log_action_${entry.action}`, entry.action))}</strong>
            <span style="font-size: 11px; color: var(--text-muted, #64748b);">${esc(t('live_mod.log_by', { name: entry.actor_name ?? '—' }))}</span>
            <span style="margin-left: auto; font-size: 11px; color: var(--text-muted, #64748b);">${esc(formatDate(entry.created_at))}</span>
          </div>
          <p style="margin: 5px 0 0; font-size: 12px; color: var(--text-secondary, #475569);">${esc(entry.content)}</p>
        </li>
      `
      )
      .join('')}</ol>`;
  }

  // ── broadcast preview ─────────────────────────────────────────────────────

  /**
   * The <video> element is built once and *moved* between renders rather than re-serialised into
   * innerHTML. The feed polls every 10s and every poll re-renders; if the player lived in the HTML
   * string it would tear down and restart playback twice a minute, which is the one thing a
   * moderator watching for a single bad moment cannot afford.
   */
  function ensureVideoEl(src, { live }) {
    if (videoEl && videoEl.dataset.src === src && videoEl.dataset.live === String(live)) return videoEl;
    videoEl = document.createElement('video');
    videoEl.dataset.src = src;
    videoEl.dataset.live = String(live);
    videoEl.src = src;
    videoEl.controls = true;
    videoEl.playsInline = true;
    videoEl.preload = live ? 'auto' : 'metadata';
    // Observation is silent in both senses: a console that starts blaring audio across an open-plan
    // moderation floor gets muted at the OS level and then nobody hears the next stream either.
    videoEl.muted = true;
    videoEl.autoplay = live;
    videoEl.style.cssText = 'width: 100%; height: 100%; object-fit: contain; background: #090d16;';
    return videoEl;
  }

  function previewStageInner(preview) {
    const stage = (icon, title, body, extra = '') => `
      <div class="mock-presenter-canvas">
        <div style="font-size: 34px; line-height: 1;" aria-hidden="true">${icon}</div>
        <div style="font-size: 14px; font-weight: 700;">${esc(title)}</div>
        ${body ? `<div style="font-size: 12px; opacity: 0.75; max-width: 420px; line-height: 1.5;">${esc(body)}</div>` : ''}
        ${extra}
      </div>
    `;

    if (preview.mode === 'NOT_STARTED') {
      return stage('🗓️', t('live_mod.preview_not_started'), t('live_mod.preview_not_started_desc'));
    }

    if (preview.mode === 'UNAVAILABLE') {
      return stage('🚫', t('live_mod.preview_unavailable'), t('live_mod.preview_unavailable_desc'));
    }

    if (preview.mode === 'RECORDING') {
      // A real driver hands back a URL a <video> can actually load; the mock hands back a path that
      // resolves to nothing, so it gets the placeholder rather than a broken player.
      if (preview.driver !== 'mock' && preview.recording_url) {
        return '<div id="preview-video-mount" style="width: 100%; height: 100%;"></div>';
      }
      const mins = preview.duration_seconds ? Math.round(preview.duration_seconds / 60) : null;
      return stage(
        '🎞️',
        t('live_mod.preview_recording_title'),
        t('live_mod.preview_recording_desc'),
        `<div style="display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; font-size: 11px; opacity: 0.75;">
           ${mins != null ? `<span>${esc(t('live_mod.preview_duration'))}: ${esc(mins)}m</span>` : ''}
           ${preview.recorded_at ? `<span>${esc(t('live_mod.preview_recorded_at'))}: ${esc(formatDate(preview.recorded_at))}</span>` : ''}
         </div>
         ${
           preview.recording_url
             ? `<a href="${esc(preview.recording_url)}" target="_blank" rel="noopener noreferrer" style="margin-top: 4px; padding: 7px 14px; font-size: 12px; font-weight: 700; border-radius: var(--radius-md, 8px); background: rgba(255,255,255,0.14); border: 1px solid rgba(255,255,255,0.3); color: #ffffff; text-decoration: none;">${esc(t('live_mod.preview_open_recording'))}</a>`
             : ''
         }`
      );
    }

    // LIVE.
    if (!preview.audio_only && preview.driver !== 'mock' && preview.playback_url) {
      return '<div id="preview-video-mount" style="width: 100%; height: 100%;"></div>';
    }

    return `
      <div class="mock-presenter-canvas">
        <div class="mock-presenter-avatar" aria-hidden="true">${preview.audio_only ? '🎧' : '📹'}</div>
        <div class="mock-stream-wave" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>
        <div style="font-size: 13px; font-weight: 700;">
          ${esc(preview.audio_only ? t('live_mod.preview_audio_only_active') : t('live_mod.preview_connecting'))}
        </div>
        ${
          preview.driver === 'mock'
            ? `<div style="font-size: 11px; opacity: 0.7; max-width: 460px; line-height: 1.5;">${esc(t('live_mod.preview_mock_note'))}</div>`
            : ''
        }
      </div>
    `;
  }

  function renderPreview(stream) {
    const preview = feed?.preview;
    if (!preview) return '';

    const isLive = preview.mode === 'LIVE';
    const collapsed = !previewOpen;

    return `
      <section style="margin-bottom: 14px; border: 1px solid var(--border-subtle, #e2e8f0); border-radius: var(--radius-lg, 12px); overflow: hidden; background: var(--surface-2, #f8fafc);">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 10px 12px;">
          <div style="display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 800;">
            ${isLive ? '<span class="pulse-dot" aria-hidden="true"></span>' : ''}
            ${esc(t('live_mod.preview_title'))}
            ${
              isLive
                ? `<span style="font-size: 11px; font-weight: 800; letter-spacing: 0.04em; padding: 2px 7px; border-radius: 999px; background: var(--danger, #e11d48); color: #ffffff;">${esc(t('live_mod.preview_live_badge'))}</span>
                   <span style="font-size: 11px; font-weight: 600; color: var(--text-muted, #64748b);">${esc(t('live_mod.preview_viewers_watching', { count: stream.viewer_count ?? 0 }))}</span>`
                : ''
            }
          </div>
          <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
            ${
              isLive
                ? `<label for="chk-preview-audio" style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--text-secondary, #475569); cursor: pointer;">
                     <input type="checkbox" id="chk-preview-audio" ${preview.audio_only ? 'checked' : ''} />
                     ${esc(t('live_mod.preview_audio_only'))}
                   </label>`
                : ''
            }
            <button id="btn-preview-toggle" style="padding: 5px 11px; font-size: 12px; font-weight: 700; cursor: pointer; border-radius: var(--radius-md, 8px); border: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-1, #ffffff); color: var(--text-secondary, #475569);">
              ${esc(collapsed ? t('live_mod.preview_show') : t('live_mod.preview_hide'))}
            </button>
          </div>
        </div>

        ${
          collapsed
            ? ''
            : `<div style="position: relative; width: 100%; aspect-ratio: 16 / 9; max-height: 340px; background: #090d16; display: flex; align-items: center; justify-content: center;">
                 ${previewStageInner(preview)}
               </div>
               ${
                 isLive
                   ? `<div style="padding: 9px 12px; background: var(--info-bg, rgba(37,99,235,0.08)); border-top: 1px solid var(--border-subtle, #e2e8f0); font-size: 11px; line-height: 1.55; color: var(--text-secondary, #475569);">
                        <strong style="color: var(--text-primary, #0f172a);">👁️ ${esc(t('live_mod.preview_hidden_badge'))}.</strong>
                        ${esc(t('live_mod.preview_observer_notice'))}
                        ${preview.expires_at ? `<span style="display: block; margin-top: 4px; color: var(--text-muted, #64748b);">${esc(t('live_mod.preview_token_expires', { time: formatDate(preview.expires_at, { timeStyle: 'short' }) }))}</span>` : ''}
                      </div>`
                   : ''
               }`
        }
      </section>
    `;
  }

  function renderDetail() {
    if (!selectedId || (!feed && !loadingFeed)) {
      return `
        <section style="background: var(--surface-1, #ffffff); border: 1px solid var(--border-subtle, #e2e8f0); border-radius: var(--radius-lg, 12px); padding: 64px 24px; text-align: center;">
          <span style="font-size: 34px;" aria-hidden="true">📡</span>
          <h2 style="margin: 12px 0 6px; font-size: 16px; font-weight: 700;">${esc(t('live_mod.select_prompt_title'))}</h2>
          <p style="margin: 0; font-size: 13px; color: var(--text-muted, #64748b);">${esc(t('live_mod.select_prompt_body'))}</p>
        </section>
      `;
    }

    if (loadingFeed && !feed) {
      return `<section style="background: var(--surface-1, #ffffff); border: 1px solid var(--border-subtle, #e2e8f0); border-radius: var(--radius-lg, 12px); padding: 64px 24px; text-align: center; font-size: 13px; color: var(--text-muted, #64748b);">${esc(t('live_mod.rail_loading'))}</section>`;
    }

    const body = detailTab === 'chat' ? renderChatTab() : detailTab === 'mutes' ? renderMutesTab() : renderLogTab();

    return `
      <section style="background: var(--surface-1, #ffffff); border: 1px solid var(--border-subtle, #e2e8f0); border-radius: var(--radius-lg, 12px); padding: 16px;">
        ${renderStreamSummary(feed.stream)}
        ${renderPreview(feed.stream)}
        ${renderDetailTabs()}
        ${body}
      </section>
    `;
  }

  function render() {
    container.innerHTML = `
      ${renderHeader()}
      <div class="live-moderation-page__grid" style="display: grid; grid-template-columns: minmax(240px, 300px) 1fr; gap: 16px; align-items: start;">
        ${renderRail()}
        ${renderDetail()}
      </div>
    `;
    attachListeners();
  }

  // ── modals ────────────────────────────────────────────────────────────────

  /**
   * One reason-collecting modal serves all three actions: every one of them writes its reason into
   * an audit_logs row and the stream's own moderation log, so "why" is never optional.
   */
  function openReasonModal({ title, description, notice, confirmLabel, danger = true, extraField = null, onConfirm }) {
    const backdrop = document.createElement('div');
    backdrop.style.cssText = `
      position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center;
      padding: 20px; background: rgba(15, 23, 42, 0.55); backdrop-filter: blur(3px);
    `;
    backdrop.innerHTML = `
      <div role="dialog" aria-modal="true" aria-label="${esc(title)}" style="
        width: 100%; max-width: 480px; background: var(--surface-1, #ffffff);
        border: 1px solid var(--border-subtle, #e2e8f0); border-radius: var(--radius-lg, 12px);
        padding: 20px; display: flex; flex-direction: column; gap: 12px;
      ">
        <h2 style="margin: 0; font-size: 16px; font-weight: 800;">${esc(title)}</h2>
        <p style="margin: 0; font-size: 13px; color: var(--text-muted, #64748b); line-height: 1.5;">${esc(description)}</p>

        ${
          notice
            ? `<p style="margin: 0; padding: 10px 12px; border-radius: var(--radius-md, 8px); background: var(--warning-bg, rgba(217,119,6,0.1)); border: 1px solid var(--warning-border, rgba(217,119,6,0.25)); color: var(--warning-800, #92400e); font-size: 12px; font-weight: 600; line-height: 1.5;">
                 ⚖️ ${esc(notice)}
               </p>`
            : ''
        }

        ${extraField ?? ''}

        <label for="sel-reason-preset" style="font-size: 12px; font-weight: 700;">
          ${esc(t('live_mod.remove_reason'))}
          <select id="sel-reason-preset" style="width: 100%; margin-top: 5px; padding: 8px; font-size: 13px; border-radius: var(--radius-md, 8px); border: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-1, #ffffff); color: var(--text-primary, #0f172a);">
            ${REASON_PRESETS.map((key) => `<option value="${esc(t(key))}">${esc(t(key))}</option>`).join('')}
            <option value="">${esc(t('live_mod.preset_custom'))}</option>
          </select>
        </label>

        <textarea id="txt-reason" rows="3" aria-label="${esc(t('live_mod.remove_reason_placeholder'))}" placeholder="${esc(t('live_mod.remove_reason_placeholder'))}" style="
          width: 100%; padding: 9px; font-size: 13px; font-family: inherit; resize: vertical;
          border-radius: var(--radius-md, 8px); border: 1px solid var(--border-subtle, #e2e8f0);
          background: var(--surface-1, #ffffff); color: var(--text-primary, #0f172a);
        "></textarea>

        <div style="display: flex; justify-content: flex-end; gap: 8px;">
          <button id="btn-cancel-modal" style="padding: 8px 14px; font-size: 13px; font-weight: 600; border-radius: var(--radius-md, 8px); border: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-1, #ffffff); color: var(--text-primary, #0f172a); cursor: pointer;">
            ${esc(t('common.cancel', 'Cancel'))}
          </button>
          <button id="btn-confirm-modal" style="padding: 8px 16px; font-size: 13px; font-weight: 700; border-radius: var(--radius-md, 8px); border: none; background: ${danger ? 'var(--danger, #e11d48)' : 'var(--brand, #4f46e5)'}; color: #ffffff; cursor: pointer;">
            ${esc(confirmLabel)}
          </button>
        </div>
      </div>
    `;

    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });
    backdrop.querySelector('#btn-cancel-modal').addEventListener('click', close);

    const preset = backdrop.querySelector('#sel-reason-preset');
    const textarea = backdrop.querySelector('#txt-reason');
    // Seed the free-text box from the preset so the common case is one click, and an edited
    // reason is still the moderator's own words rather than a canned label.
    textarea.value = preset.value;
    preset.addEventListener('change', () => {
      textarea.value = preset.value;
    });

    backdrop.querySelector('#btn-confirm-modal').addEventListener('click', async () => {
      const reason = textarea.value.trim();
      if (!reason) {
        toast.error(t('live_mod.reason_required'));
        return;
      }
      close();
      await onConfirm(reason, backdrop);
    });

    document.body.append(backdrop);
    textarea.focus();
  }

  function openMuteModal(userId, userName) {
    const durationField = `
      <label style="font-size: 12px; font-weight: 700;">
        ${esc(t('live_mod.mute_target'))}
        <input type="text" value="${esc(userName || `#${userId}`)}" disabled style="width: 100%; margin-top: 5px; padding: 8px; font-size: 13px; border-radius: var(--radius-md, 8px); border: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-2, #f8fafc); color: var(--text-muted, #64748b);" />
      </label>
      <label for="sel-mute-duration" style="font-size: 12px; font-weight: 700;">
        ${esc(t('live_mod.mute_duration'))}
        <select id="sel-mute-duration" style="width: 100%; margin-top: 5px; padding: 8px; font-size: 13px; border-radius: var(--radius-md, 8px); border: 1px solid var(--border-subtle, #e2e8f0); background: var(--surface-1, #ffffff); color: var(--text-primary, #0f172a);">
          ${[5, 15, 30, 60].map((n) => `<option value="${n}" ${n === 15 ? 'selected' : ''}>${esc(t('live_mod.mute_minutes', { count: n }))}</option>`).join('')}
        </select>
      </label>
    `;

    openReasonModal({
      title: t('live_mod.mute_modal_title'),
      description: t('live_mod.mute_modal_desc'),
      confirmLabel: t('live_mod.confirm_mute'),
      danger: false,
      extraField: durationField,
      onConfirm: async (reason, backdrop) => {
        const minutes = Number(backdrop.querySelector('#sel-mute-duration')?.value) || 15;
        await muteParticipant(userId, minutes, reason);
      },
    });
  }

  // ── events ────────────────────────────────────────────────────────────────

  function attachListeners() {
    container.querySelector('#btn-refresh-live')?.addEventListener('click', async () => {
      await fetchStreams();
      if (selectedId) await fetchFeed(selectedId);
    });

    container.querySelector('#chk-auto-refresh')?.addEventListener('change', (e) => {
      autoRefresh = e.target.checked;
      schedulePoll();
    });

    // The persistent player is re-parented after every render (see ensureVideoEl).
    const mount = container.querySelector('#preview-video-mount');
    if (mount) {
      const preview = feed?.preview ?? {};
      const src = preview.mode === 'LIVE' ? preview.playback_url : preview.recording_url;
      if (src) mount.appendChild(ensureVideoEl(src, { live: preview.mode === 'LIVE' }));
    }

    container.querySelector('#btn-preview-toggle')?.addEventListener('click', () => {
      previewOpen = !previewOpen;
      render();
    });

    container.querySelector('#chk-preview-audio')?.addEventListener('change', async (e) => {
      // Audio-only is a property of the token the server mints, not a client-side mute, so the
      // feed has to be re-fetched for the choice to mean anything on the wire.
      audioOnly = e.target.checked;
      videoEl = null;
      await fetchFeed(selectedId);
    });

    container.querySelector('#chk-flagged-only')?.addEventListener('change', (e) => {
      flaggedOnly = e.target.checked;
      render();
    });

    container.querySelectorAll('[data-status-tab]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        statusTab = btn.getAttribute('data-status-tab');
        await fetchStreams();
      });
    });

    container.querySelectorAll('[data-stream-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        selectedId = Number(btn.getAttribute('data-stream-id'));
        feed = null;
        detailTab = 'chat';
        videoEl = null;
        await fetchFeed(selectedId);
      });
    });

    container.querySelectorAll('[data-detail-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        detailTab = btn.getAttribute('data-detail-tab');
        render();
      });
    });

    container.querySelectorAll('[data-remove-message]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const messageId = Number(btn.getAttribute('data-remove-message'));
        openReasonModal({
          title: t('live_mod.remove_modal_title'),
          description: t('live_mod.remove_modal_desc'),
          confirmLabel: t('live_mod.confirm_remove'),
          onConfirm: (reason) => removeMessage(messageId, reason),
        });
      });
    });

    container.querySelectorAll('[data-mute-user]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openMuteModal(Number(btn.getAttribute('data-mute-user')), btn.getAttribute('data-mute-name'));
      });
    });

    container.querySelectorAll('[data-unmute-user]').forEach((btn) => {
      btn.addEventListener('click', () => unmuteParticipant(Number(btn.getAttribute('data-unmute-user'))));
    });

    container.querySelector('#btn-terminate-stream')?.addEventListener('click', () => {
      openReasonModal({
        title: t('live_mod.terminate_modal_title'),
        description: t('live_mod.terminate_modal_desc'),
        // Stated before the click, not after: `live.stream.terminate` is HIGH tier, so a
        // moderator's press files a request rather than stopping the broadcast.
        notice: t('live_mod.terminate_maker_checker'),
        confirmLabel: t('live_mod.confirm_terminate'),
        onConfirm: (reason) => terminateStream(reason),
      });
    });
  }

  root.append(container);
  render();
  fetchStreams();
  schedulePoll();

  // The router calls this on navigation away; without it the poll keeps firing against a page
  // that no longer exists for the rest of the session.
  return () => {
    clearInterval(pollTimer);
    pollTimer = null;
    // Navigating away must actually stop pulling the broadcast. Detaching alone is not enough —
    // a <video> with a live src keeps its connection open until the src is cleared.
    if (videoEl) {
      videoEl.pause();
      videoEl.removeAttribute('src');
      videoEl.load();
      videoEl.remove();
      videoEl = null;
    }
  };
}
