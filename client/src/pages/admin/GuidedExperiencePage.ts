/**
 * GuidedExperiencePage.ts — /admin/platform/guided-experience (Prompt 13.7).
 *
 * Shows, for every journey step (config/journeys.ts), how many users reached it, how many finished
 * it, the median time it took, and how many stopped there. A step where more than the configured
 * share stopped is flagged and listed as a numbered fix, the same list docs/usability-report.md
 * carries. Read-only (`platform.guidance.view`, LOW); the one control is the `guided_experience`
 * module switch, shown only to someone who holds `platform.module.toggle`.
 *
 * Every number is computed by the server (services/journeyMetrics.service.ts) from
 * journey_step_events. The page only adds up its own rows to show they equal the event totals.
 */

import '../../styles/components/guided-experience.css';

import { PlatformSubnav } from '../../components/admin/PlatformSubnav.ts';
import { confirmDialogWithReason } from '../../components/ui/ConfirmDialog.ts';
import { api, pickMessage } from '../../core/api.ts';
import { adminApi } from '../../services/admin.api.ts';
import { can } from '../../services/permissions.ts';
import { toast } from '../../services/toast.ts';
import { t } from '../../services/i18n.ts';
import { formatNumber } from '../../services/format.ts';
import { escapeHtml as esc } from '../../services/html.ts';
import { formatDuration, formatOneDecimal, reconcile } from '../../services/guidanceReport.ts';
import type { PageContext } from '../types.ts';

const MIN_REASON_LENGTH = 10;

export default function GuidedExperiencePage(root: HTMLElement, { navigate }: PageContext = {}) {
  const container = document.createElement('div');
  container.className = 'admin-page guidance-page';
  root.replaceChildren(container);

  let report = null;
  let loading = true;
  let failed = false;

  function roleLabel(role: string) {
    return t(`admin_guidance.role.${role}`);
  }

  function moduleCard() {
    const on = report.module.enabled;
    const mayToggle = can('platform.module.toggle');
    return `
      <section class="admin-panel guidance-module">
        <div>
          <h2 class="guidance-module__title">${esc(t('admin_guidance.module_title'))}
            <span class="badge ${on ? 'badge--success' : 'badge--neutral'}">${esc(t(on ? 'admin_guidance.module_on' : 'admin_guidance.module_off'))}</span>
          </h2>
          <p class="guidance-muted">${esc(t(on ? 'admin_guidance.module_on_desc' : 'admin_guidance.module_off_desc'))}</p>
        </div>
        ${
          mayToggle
            ? `<button type="button" class="btn btn--sm ${on ? 'btn--secondary' : 'btn--primary'}" data-action="toggle-module">${esc(t(on ? 'admin_guidance.turn_off' : 'admin_guidance.turn_on'))}</button>`
            : `<p class="guidance-muted guidance-module__who">${esc(t('admin_guidance.toggle_needs_permission'))}</p>`
        }
      </section>`;
  }

  function summary() {
    const r = reconcile(report);
    return `
      <section class="guidance-summary">
        <p>${esc(t('admin_guidance.rule', { pct: formatNumber(report.settings.abandon_threshold_pct), days: formatNumber(report.settings.abandon_after_days) }))}
          <a href="/admin/platform/modules" data-link>${esc(t('admin_guidance.change_rule'))}</a></p>
        <p class="${r.ok ? 'guidance-ok' : 'guidance-warn'}">
          ${esc(t(r.ok ? 'admin_guidance.reconciled' : 'admin_guidance.not_reconciled', {
            reached: formatNumber(report.totals.reached_events),
            completed: formatNumber(report.totals.completed_events),
          }))}
        </p>
      </section>`;
  }

  function fixes() {
    if (report.flagged.length === 0) {
      return `<section class="admin-panel"><h2 class="guidance-h2">${esc(t('admin_guidance.fixes_title'))}</h2><p class="guidance-muted">${esc(t('admin_guidance.fixes_none'))}</p></section>`;
    }
    return `
      <section class="admin-panel">
        <h2 class="guidance-h2">${esc(t('admin_guidance.fixes_title'))}</h2>
        <p class="guidance-muted">${esc(t('admin_guidance.fixes_desc'))}</p>
        <ol class="guidance-fixes">
          ${report.flagged
            .map(
              (f) => `<li><strong>${esc(roleLabel(f.role))} · ${esc(t(f.title_key))}</strong> — ${esc(t('admin_guidance.fix_rate', { rate: formatOneDecimal(f.abandon_rate) }))}</li>`
            )
            .join('')}
        </ol>
      </section>`;
  }

  function journeyTable(j) {
    const rows = j.steps
      .map(
        (s) => `
        <tr class="${s.flagged ? 'guidance-row--flagged' : ''}">
          <td><span class="guidance-order">${s.order}</span> ${esc(t(s.title_key))}
            ${s.waits_on_others ? `<span class="badge badge--neutral badge--sm" title="${esc(t('admin_guidance.waits_tip'))}">${esc(t('admin_guidance.waits'))}</span>` : ''}</td>
          <td class="num">${formatNumber(s.reached)}</td>
          <td class="num">${formatNumber(s.completed)}</td>
          <td class="num">${esc(formatDuration(s.median_seconds))}</td>
          <td class="num">${formatNumber(s.abandoned)}</td>
          <td class="num">${s.abandon_rate == null ? '—' : `${formatOneDecimal(s.abandon_rate)}%`}
            ${s.flagged ? `<span class="badge badge--danger badge--sm">${esc(t('admin_guidance.flagged'))}</span>` : ''}</td>
        </tr>`
      )
      .join('');
    const optOut = j.opt_out.rate == null ? '—' : `${formatOneDecimal(j.opt_out.rate)}%`;
    return `
      <section class="admin-panel guidance-journey">
        <header class="guidance-journey__head">
          <h2 class="guidance-h2">${esc(roleLabel(j.role))}</h2>
          <span class="guidance-muted">${esc(t('admin_guidance.opt_out', { rate: optOut, n: formatNumber(j.opt_out.opted_out), total: formatNumber(j.opt_out.users) }))}</span>
        </header>
        <div class="guidance-table-wrap">
          <table class="table guidance-table">
            <thead><tr>
              <th>${esc(t('admin_guidance.th_step'))}</th>
              <th class="num">${esc(t('admin_guidance.th_reached'))}</th>
              <th class="num">${esc(t('admin_guidance.th_finished'))}</th>
              <th class="num">${esc(t('admin_guidance.th_median'))}</th>
              <th class="num">${esc(t('admin_guidance.th_stopped'))}</th>
              <th class="num">${esc(t('admin_guidance.th_rate'))}</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </section>`;
  }

  function render() {
    const head = `
      <header class="admin-page-header">
        <div class="admin-page-eyebrow">${esc(t('admin_guidance.eyebrow'))}</div>
        <h1 class="admin-page-title">${esc(t('admin_guidance.title'))}</h1>
        <p class="admin-page-subtitle">${esc(t('admin_guidance.subtitle'))}</p>
      </header>`;
    let body;
    if (loading) body = `<p class="guidance-muted">${esc(t('admin_guidance.loading'))}</p>`;
    else if (failed || !report) body = `<p class="guidance-warn">${esc(t('admin_guidance.load_failed'))}</p>`;
    else body = moduleCard() + summary() + fixes() + report.journeys.map(journeyTable).join('');
    container.innerHTML = head + '<div data-slot="subnav"></div>' + body;
    container.querySelector('[data-slot="subnav"]')?.replaceWith(PlatformSubnav({ activeKey: 'guidance', navigate }));
  }

  async function load() {
    loading = true;
    render();
    try {
      const res: Record<string, any> = await adminApi.getGuidedExperience();
      report = res?.data ?? res;
      failed = !report?.journeys;
    } catch (err) {
      failed = true;
      toast.error(pickMessage(err) || t('admin_guidance.load_failed'));
    } finally {
      loading = false;
      render();
    }
  }

  container.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const link = target.closest('a[data-link]') as HTMLAnchorElement | null;
    if (link && navigate) {
      e.preventDefault();
      navigate(link.getAttribute('href'));
      return;
    }
    if (!target.closest('[data-action="toggle-module"]') || !report) return;
    const enable = !report.module.enabled;
    const res = await confirmDialogWithReason({
      title: t(enable ? 'admin_guidance.turn_on' : 'admin_guidance.turn_off'),
      description: t(enable ? 'admin_guidance.confirm_on' : 'admin_guidance.confirm_off'),
      reasonRequired: true,
      reasonMinLength: MIN_REASON_LENGTH,
      reasonLabel: t('admin_guidance.reason_label'),
      reasonHint: t('admin_guidance.reason_hint'),
      confirmLabel: t(enable ? 'admin_guidance.turn_on' : 'admin_guidance.turn_off'),
      variant: enable ? 'primary' : 'danger',
    });
    if (!res || !res.confirmed) return;
    try {
      await api.patch(`/admin/modules/${report.module.key}`, { enabled: enable, reason: res.reason });
      toast.success(t(enable ? 'admin_guidance.turned_on' : 'admin_guidance.turned_off'));
      await load();
    } catch (err) {
      toast.error(pickMessage(err) || t('admin_guidance.toggle_failed'));
    }
  });

  load();
  return container;
}
