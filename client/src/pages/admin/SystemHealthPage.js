/**
 * SystemHealthPage.js — System Diagnostics, API Latency & Backup Hub (Prompt 11.4 / Master Spec §AL.4).
 *
 * Implements:
 * 1. API Latency percentiles (p50, p95, p99), error rates, uptime, and request volume.
 * 2. Database connection pool & in-memory cache driver telemetry with interactive diagnostic actions.
 * 3. Background Job Scheduler execution history inspector with 1-click "Run Now" triggers.
 * 4. Webhook delivery stats and Dead-Letter Queue (DLQ) depth with replay tests.
 * 5. Backup & Disaster Recovery management (manual snapshot creation, SHA-256 hash list, restore modal).
 * 6. Interactive section tab filtering, search filters, clipboard copy, zero-CLS skeleton, and full bilingual i18n.
 */

import { adminApi } from '../../services/admin.api.js';
import { t, getLanguage } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { Modal } from '../../components/ui/Modal.js';
import { confirmDialog, confirmDialogWithReason } from '../../components/ui/ConfirmDialog.js';
import { loadSystemHealthStyles } from '../../styles/loadSystemHealthStyles.js';
import { scheduleLabel } from './jobSchedule.js';

export default function SystemHealthPage(root, { navigate } = {}) {
  loadSystemHealthStyles();
  const isBn = getLanguage() === 'bn';
  // Infra status comes back as a raw backend enum (CONNECTED, DEGRADED, CONNECTION_ERROR, …) — shown
  // verbatim it reads as leftover code rather than a status label.
  const infraStatusLabel = (s) => String(s || '').toLowerCase().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  let healthData = null;
  let backupData = null;
  let isLoading = true;
  let activeTab = 'all'; // 'all' | 'vitals' | 'infra' | 'scheduler' | 'backups'
  let jobFilterQuery = '';
  let backupFilterQuery = '';
  let isCreatingSnapshot = false;

  const nav = (url) => {
    if (typeof navigate === 'function') navigate(url);
    else {
      history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  async function loadData(showToast = false) {
    isLoading = true;
    render();

    try {
      const [hlRes, bkRes] = await Promise.all([
        adminApi.getSystemHealth(),
        adminApi.getBackups(20),
      ]);

      healthData = hlRes.data || {};
      backupData = bkRes.data || {};

      if (showToast) {
        toast.success(isBn ? 'সিস্টেম ডায়াগনস্টিকস সফলভাবে রিফ্রেশ হয়েছে!' : 'System telemetry refreshed successfully!');
      }
    } catch {
      toast.error(t('admin.health.load_failed', 'Failed to load system diagnostics.'));
    } finally {
      isLoading = false;
      render();
    }
  }

  function formatBytes(bytes) {
    if (!bytes || isNaN(bytes)) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  function renderSkeleton() {
    return `
      <div class="system-health-page" aria-busy="true" aria-live="polite">
        <!-- Header Skeleton -->
        <div class="system-health__header">
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <div style="width: 220px; height: 18px; background: var(--surface-2); border-radius: var(--radius-sm);"></div>
            <div style="width: 360px; height: 32px; background: var(--surface-2); border-radius: var(--radius-md);"></div>
            <div style="width: 280px; height: 16px; background: var(--surface-2); border-radius: var(--radius-sm);"></div>
          </div>
          <div style="display: flex; gap: 8px;">
            <div style="width: 140px; height: 36px; background: var(--surface-2); border-radius: var(--radius-md);"></div>
            <div style="width: 120px; height: 36px; background: var(--surface-2); border-radius: var(--radius-md);"></div>
          </div>
        </div>

        <!-- Vitals Skeleton Grid -->
        <div class="system-vitals-grid">
          ${Array.from({ length: 4 }).map(() => `
            <div class="system-vital-card" style="min-height: 120px; opacity: 0.7;">
              <div style="display: flex; justify-content: space-between;">
                <div style="width: 100px; height: 14px; background: var(--surface-2); border-radius: 4px;"></div>
                <div style="width: 20px; height: 20px; background: var(--surface-2); border-radius: 50%;"></div>
              </div>
              <div style="width: 120px; height: 30px; background: var(--surface-2); border-radius: 4px; margin: 12px 0 8px;"></div>
              <div style="width: 100%; height: 6px; background: var(--surface-2); border-radius: 4px; margin-bottom: 8px;"></div>
              <div style="width: 140px; height: 12px; background: var(--surface-2); border-radius: 4px;"></div>
            </div>
          `).join('')}
        </div>

        <!-- Infra Skeleton Grid -->
        <div class="system-infra-grid">
          ${Array.from({ length: 3 }).map(() => `
            <div class="system-infra-card" style="min-height: 220px; opacity: 0.7;">
              <div style="width: 140px; height: 20px; background: var(--surface-2); border-radius: 4px;"></div>
              <div style="width: 100%; height: 140px; background: var(--surface-2); border-radius: var(--radius-md); margin-top: 14px;"></div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function render() {
    root.innerHTML = '';

    if (isLoading && !healthData) {
      root.innerHTML = renderSkeleton();
      return;
    }

    const container = document.createElement('div');
    container.className = 'system-health-page';

    const vitals = healthData?.api_vitals || {};
    const db = healthData?.db_health || {};
    const cache = healthData?.cache_health || {};
    const webhooks = healthData?.webhooks || {};
    // WHY empty, not demo rows: these used to fall back to four invented jobs and two invented
    // SNAP_* backups with fake checksums whenever the API omitted them.
    // One row per registered job (its own latest run, or NEVER_RUN) so a daily job is not pushed out
    // by busier ones; older APIs without the catalogue fall back to the recent-run list.
    const allJobs = Array.isArray(healthData?.jobs)
      ? healthData.jobs.map((j) => ({
        job_name: j.name,
        schedule: scheduleLabel(j.interval_ms),
        module_key: j.module_key || null,
        module_enabled: j.module_enabled,
        // A switched-off module is not a failure: the scheduler skips it without writing a run.
        status: j.last_run?.status || (j.module_enabled === false ? 'MODULE_OFF' : 'NEVER_RUN'),
        started_at: j.last_run?.started_at || null,
        duration_ms: j.last_run?.duration_ms ?? null,
        processed_count: j.last_run?.processed_count ?? null,
      }))
      : (healthData?.job_runs || []);
    const allBackups = backupData?.backups || [];

    // Filter Jobs
    const jobs = allJobs.filter((j) => {
      if (!jobFilterQuery) return true;
      return (j.name || j.job_name || '').toLowerCase().includes(jobFilterQuery.toLowerCase());
    });

    // Filter Backups
    const backups = allBackups.filter((b) => {
      if (!backupFilterQuery) return true;
      const q = backupFilterQuery.toLowerCase();
      return (b.ref || '').toLowerCase().includes(q) || (b.checksum_sha256 || '').toLowerCase().includes(q) || (b.snapshot_type || '').toLowerCase().includes(q);
    });

    // P50, P95, P99 values
    // WHY null, not a default: these used to fall back to 12.4 / 45.2 / 118.0 ms and 0.02%, so a
    // server with no measurements still showed healthy-looking numbers. null renders as "—".
    const numOrNull = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
    const p50Val = numOrNull(vitals.p50_ms ?? vitals.p50_latency_ms);
    const p95Val = numOrNull(vitals.p95_ms ?? vitals.p95_latency_ms);
    const p99Val = numOrNull(vitals.p99_ms ?? vitals.p99_latency_ms);
    const errRate = numOrNull(vitals.error_rate_pct);
    const ms = (v) => (v === null ? '—' : `${v.toFixed(1)} ms`);
    const pctText = (v, digits = 1) => (v === null || v === undefined ? '—' : `${Number(v).toFixed(digits)}%`);
    const countText = (v) => (v === null || v === undefined ? '—' : String(v));
    const bytesText = (v) => (v === null || v === undefined ? '—' : formatBytes(v));
    const dbMax = numOrNull(db.max_connections ?? db.max_pool_size);
    const dbActive = numOrNull(db.active_connections);
    const hitRate = numOrNull(cache.hit_rate_pct);
    const whTotal24 = numOrNull(webhooks.total_24h);
    const whDelivered24 = numOrNull(webhooks.delivered_24h);
    const whRate = whTotal24 ? Math.round((whDelivered24 / whTotal24) * 10000) / 100 : null;
    const sampleNote = vitals.sample_size === 0 ? (isBn ? 'এখনও কোনো রিকোয়েস্ট পরিমাপ হয়নি' : 'No requests measured yet') : null;

    const isAllTab = activeTab === 'all';
    const isVitalsTab = activeTab === 'vitals' || isAllTab;
    const isInfraTab = activeTab === 'infra' || isAllTab;
    const isSchedulerTab = activeTab === 'scheduler' || isAllTab;
    const isBackupsTab = activeTab === 'backups' || isAllTab;

    container.innerHTML = `
      <!-- 1. Header with Live Pulse and Primary Actions -->
      <div class="system-health__header">
        <div>
          <div class="system-health__eyebrow">
            <span class="system-health__status-badge">
              <span class="system-health__pulse-dot"></span>
              ${healthData?.overall_status || 'OPERATIONAL'}
            </span>
            <span style="font-size: var(--text-xs); color: var(--text-muted); font-weight: 600;">
              • Uptime: ${vitals.uptime_human || '—'}
            </span>
          </div>
          <h1 class="system-health__title">
            ${isBn ? 'প্ল্যাটফর্ম সিস্টেম হেলথ ও ডায়াগনস্টিকস' : 'Platform Infrastructure & Diagnostics'}
          </h1>
          <p class="system-health__subtitle">
            ${isBn ? 'রিয়েল-টাইম এপিআই লেটেন্সি, পোস্টগ্রেসকিউএল কানেকশন পুল, ইন-মেমোরি ক্যাশিং ড্রাইভার, ব্যাকগ্রাউন্ড শিডিউলার ক্রন ও ক্রিপ্টোগ্রাফিক ব্যাকআপ স্ন্যাপশট।' : 'Real-time API latency percentiles, PostgreSQL connection pool, in-memory caching engine, background cron scheduler, and cryptographic backup snapshots.'}
          </p>
        </div>

        <div class="system-health__actions">
          <div id="back-cockpit-slot"></div>
          <div id="refresh-slot"></div>
          <div id="create-backup-header-slot"></div>
        </div>
      </div>

      <!-- 2. Segmented Section Navigation Tabs -->
      <div class="system-health__tabs" role="tablist">
        <button type="button" class="system-health__tab-btn ${activeTab === 'all' ? 'system-health__tab-btn--active' : ''}" data-tab="all">
          <span>🌐 ${isBn ? 'সম্পূর্ণ ওভারভিউ' : 'All Overview'}</span>
        </button>
        <button type="button" class="system-health__tab-btn ${activeTab === 'vitals' ? 'system-health__tab-btn--active' : ''}" data-tab="vitals">
          <span>⚡ ${isBn ? 'এপিআই লেটেন্সি ও ভাইটালস' : 'API Latencies & Vitals'}</span>
        </button>
        <button type="button" class="system-health__tab-btn ${activeTab === 'infra' ? 'system-health__tab-btn--active' : ''}" data-tab="infra">
          <span>🐘 ${isBn ? 'ডাটাবেজ ও ক্যাশ' : 'Database & Cache'}</span>
        </button>
        <button type="button" class="system-health__tab-btn ${activeTab === 'scheduler' ? 'system-health__tab-btn--active' : ''}" data-tab="scheduler">
          <span>⏱️ ${isBn ? 'শিডিউলার জবস' : 'Scheduler Cron'}</span>
          <span class="system-health__tab-badge">${allJobs.length}</span>
        </button>
        <button type="button" class="system-health__tab-btn ${activeTab === 'backups' ? 'system-health__tab-btn--active' : ''}" data-tab="backups">
          <span>🛡️ ${isBn ? 'ব্যাকআপ ও রিস্টোর' : 'Backups & DR'}</span>
          <span class="system-health__tab-badge">${allBackups.length}</span>
        </button>
      </div>

      <!-- 3. API Vitals & Latencies (4 Cards Grid) -->
      ${isVitalsTab ? `
        <div class="system-vitals-grid">
          <!-- p50 Median Latency -->
          <div class="system-vital-card">
            <div class="system-vital-card__top">
              <span class="system-vital-card__title">
                <span>API Latency (p50)</span>
              </span>
              <span class="system-vital-card__icon" title="Median response speed">⚡</span>
            </div>
            <div class="system-vital-card__val">${ms(p50Val)}</div>
            <div class="system-vital-card__meter-wrap">
              <div class="system-vital-card__meter-bar system-vital-card__meter-bar--success" style="width: ${Math.min(100, ((p50Val ?? 0) / 50) * 100)}%;"></div>
            </div>
            <p class="system-vital-card__hint">
              <span>${isBn ? 'গড় রেসপন্স টাইম' : 'Median response time'}</span>
              <span class="system-vital-card__badge">${p50Val === null ? (sampleNote || '—') : (p50Val < 50 ? '✓ ' + (isBn ? 'স্বাভাবিক' : 'Fast') : '⚠ ' + (isBn ? 'ধীর' : 'Slow'))}</span>
            </p>
          </div>

          <!-- p95 Latency -->
          <div class="system-vital-card">
            <div class="system-vital-card__top">
              <span class="system-vital-card__title">
                <span>API Latency (p95)</span>
              </span>
              <span class="system-vital-card__icon" title="95% of traffic responds faster than this"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="inline-icon"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path><path d="m12 15-3-3a22 22 0 0 1 3.81-2 24.36 24.36 0 0 1 5.9-2c3.55-1 6-4 6-4s-3 2.45-4 6a24.36 24.36 0 0 1-2 5.9A22 22 0 0 1 15 12z"></path><path d="M9 11l.01-.01"></path></svg></span>
            </div>
            <div class="system-vital-card__val">${ms(p95Val)}</div>
            <div class="system-vital-card__meter-wrap">
              <div class="system-vital-card__meter-bar ${(p95Val ?? 0) > 100 ? 'system-vital-card__meter-bar--warn' : 'system-vital-card__meter-bar--success'}" style="width: ${Math.min(100, ((p95Val ?? 0) / 150) * 100)}%;"></div>
            </div>
            <p class="system-vital-card__hint">
              <span>${isBn ? '৯৫তম পারসেন্টাইল উইন্ডো' : '95th percentile window'}</span>
              <span class="system-vital-card__badge">${p95Val === null ? '—' : (p95Val <= 100 ? '✓ SLA &lt;100ms' : '⚠ Over 100ms')}</span>
            </p>
          </div>

          <!-- p99 Tail Latency -->
          <div class="system-vital-card">
            <div class="system-vital-card__top">
              <span class="system-vital-card__title">
                <span>API Latency (p99)</span>
              </span>
              <span class="system-vital-card__icon" title="Tail SLA budget limit 250ms">⏱️</span>
            </div>
            <div class="system-vital-card__val">${ms(p99Val)}</div>
            <div class="system-vital-card__meter-wrap">
              <div class="system-vital-card__meter-bar ${(p99Val ?? 0) > 200 ? 'system-vital-card__meter-bar--danger' : 'system-vital-card__meter-bar--success'}" style="width: ${Math.min(100, ((p99Val ?? 0) / 250) * 100)}%;"></div>
            </div>
            <p class="system-vital-card__hint">
              <span>${isBn ? 'সর্বোচ্চ ১% রিকোয়েস্ট লেটেন্সি' : 'Tail SLA budget < 250ms'}</span>
              <span class="system-vital-card__badge">${p99Val === null ? '—' : (p99Val <= 250 ? '✓ ' + (isBn ? 'সম্মত' : 'Compliant') : '⚠ ' + (isBn ? 'সীমা ছাড়িয়েছে' : 'Over budget'))}</span>
            </p>
          </div>

          <!-- 5xx Error Rate -->
          <div class="system-vital-card">
            <div class="system-vital-card__top">
              <span class="system-vital-card__title">
                <span>API Error Rate (5xx)</span>
              </span>
              <span class="system-vital-card__icon" title="Platform error frequency">🛡️</span>
            </div>
            <div class="system-vital-card__val" style="color: ${errRate === null ? 'var(--text-muted)' : (errRate > 0.5 ? 'var(--danger)' : 'var(--success)')};">${pctText(errRate, 2)}</div>
            <div class="system-vital-card__meter-wrap">
              <div class="system-vital-card__meter-bar ${(errRate ?? 0) > 0.1 ? 'system-vital-card__meter-bar--warn' : 'system-vital-card__meter-bar--success'}" style="width: ${Math.min(100, (errRate ?? 0) * 100)}%;"></div>
            </div>
            <p class="system-vital-card__hint">
              <span>${isBn ? 'এইচটিটিপি ৫xx ত্রুটি মাত্রা' : 'HTTP 5xx error frequency'}</span>
              <span class="system-vital-card__badge">${errRate === null ? '—' : (errRate <= 0.5 ? '✓ ' + (isBn ? 'নগণ্য' : 'Nominal') : '⚠ ' + (isBn ? 'উচ্চ' : 'Elevated'))}</span>
            </p>
          </div>
        </div>
      ` : ''}

      <!-- 4. Storage & Infrastructure Section (PostgreSQL, Cache, Webhooks) -->
      ${isInfraTab ? `
        <div class="system-infra-grid">
          <!-- PostgreSQL Pool Status -->
          <div class="system-infra-card">
            <div class="system-infra-card__top">
              <h3 class="system-infra-card__title">
                <span>🐘 ${isBn ? 'পোস্টগ্রেসকিউএল পুল' : 'PostgreSQL Pool'}</span>
              </h3>
              <span class="system-infra-card__badge">
                ${infraStatusLabel(db.status || 'UNKNOWN')}
              </span>
            </div>

            <div class="system-infra-card__gauge">
              <div class="system-infra-card__gauge-head">
                <span>${isBn ? 'কানেকশন ব্যবহার' : 'Connection Utilization'}</span>
                <span>${countText(dbActive)} / ${countText(dbMax)}</span>
              </div>
              <div class="system-infra-card__gauge-bar">
                <div class="system-infra-card__gauge-fill" style="width: ${dbMax ? Math.min(100, ((dbActive ?? 0) / dbMax) * 100) : 0}%;"></div>
              </div>
            </div>

            <div class="system-infra-card__list">
              <div class="system-infra-card__row">
                <span class="system-infra-card__key">${isBn ? 'সক্রিয় কানেকশন' : 'Active Connections'}</span>
                <span class="system-infra-card__val">${countText(dbActive)}</span>
              </div>
              <div class="system-infra-card__row">
                <span class="system-infra-card__key">${isBn ? 'আইডল কানেকশন' : 'Idle Connections'}</span>
                <span class="system-infra-card__val">${countText(db.idle_connections)}</span>
              </div>
              <div class="system-infra-card__row">
                <span class="system-infra-card__key">${isBn ? 'সর্বোচ্চ ধারণক্ষমতা' : 'Max Pool Capacity'}</span>
                <span class="system-infra-card__val">${countText(dbMax)}</span>
              </div>
              <div class="system-infra-card__row">
                <span class="system-infra-card__key">${isBn ? 'অপেক্ষমাণ ক্লায়েন্ট' : 'Waiting Clients'}</span>
                <span class="system-infra-card__val">${countText(db.waiting_clients)}</span>
              </div>
              <div class="system-infra-card__row">
                <span class="system-infra-card__key">${isBn ? 'ডেটাবেজ সাইজ' : 'Database Storage'}</span>
                <span class="system-infra-card__val">${bytesText(db.database_size_bytes)}</span>
              </div>
            </div>

            <div class="system-infra-card__actions">
              <button type="button" class="btn btn--secondary btn--sm w-full test-db-btn" style="width: 100%;">
                🔍 ${isBn ? 'আবার মাপুন' : 'Re-measure'}
              </button>
            </div>
          </div>

          <!-- Cache Engine (In-Memory / Redis) -->
          <div class="system-infra-card">
            <div class="system-infra-card__top">
              <h3 class="system-infra-card__title">
                <span>⚡ ${isBn ? 'ক্যাশিং লেয়ার' : 'Cache Layer'}</span>
              </h3>
              <span class="system-infra-card__badge">
                ${infraStatusLabel(cache.status || 'UNKNOWN')}
              </span>
            </div>

            <div class="system-infra-card__gauge">
              <div class="system-infra-card__gauge-head">
                <span>${isBn ? 'ক্যাশ হিট রেট' : 'Cache Hit Efficiency'}</span>
                <span style="color: var(--success); font-weight: 700;">${pctText(hitRate)}</span>
              </div>
              <div class="system-infra-card__gauge-bar">
                <div class="system-infra-card__gauge-fill" style="width: ${hitRate ?? 0}%; background: linear-gradient(90deg, #10b981, #06b6d4);"></div>
              </div>
            </div>

            <div class="system-infra-card__list">
              <div class="system-infra-card__row">
                <span class="system-infra-card__key">${isBn ? 'ড্রাইভার অ্যাডাপ্টার' : 'Driver Adapter'}</span>
                <span class="system-infra-card__val">${cache.driver || '—'}</span>
              </div>
              <div class="system-infra-card__row">
                <span class="system-infra-card__key">${isBn ? 'ক্যাশ হিট রেট' : 'Cache Hit Rate'}</span>
                <span class="system-infra-card__val" style="color: var(--success);">${pctText(hitRate)}</span>
              </div>
              <div class="system-infra-card__row">
                <span class="system-infra-card__key">${isBn ? 'ইনডেক্সড কি' : 'Indexed Keys'}</span>
                <span class="system-infra-card__val">${countText(cache.key_count ?? cache.keys_count)} keys</span>
              </div>
              <div class="system-infra-card__row">
                <span class="system-infra-card__key">${isBn ? 'মেমোরি ব্যবহার' : 'Memory Footprint'}</span>
                <span class="system-infra-card__val">${bytesText(cache.memory_used_bytes)}</span>
              </div>
              <div class="system-infra-card__row">
                <span class="system-infra-card__key">${isBn ? 'এভিকশন পলিসি' : 'Eviction Policy'}</span>
                <span class="system-infra-card__val">${cache.driver === 'memory' ? 'TTL sweep (5s)' : cache.driver === 'redis' ? 'Server-managed' : '—'}</span>
              </div>
            </div>

          </div>

          <!-- Webhooks & Dead-Letter Queue (DLQ) -->
          <div class="system-infra-card">
            <div class="system-infra-card__top">
              <h3 class="system-infra-card__title">
                <span>🪝 ${isBn ? 'আউটবাউন্ড ওয়েবহুক' : 'Outbound Webhooks'}</span>
              </h3>
              <span class="system-infra-card__badge ${webhooks.dlq_depth > 0 ? 'system-infra-card__badge--warn' : ''}">
                ${webhooks.dlq_depth > 0 ? `${webhooks.dlq_depth} in DLQ` : 'DLQ Clean (0)'}
              </span>
            </div>

            <div class="system-infra-card__gauge">
              <div class="system-infra-card__gauge-head">
                <span>${isBn ? 'ডেলিভারি সাকসেস রেট' : 'Delivery Success Rate'}</span>
                <span style="color: var(--success); font-weight: 700;">${pctText(whRate, 2)}</span>
              </div>
              <div class="system-infra-card__gauge-bar">
                <div class="system-infra-card__gauge-fill" style="width: ${whRate ?? 0}%; background: linear-gradient(90deg, #3b82f6, #8b5cf6);"></div>
              </div>
            </div>

            <div class="system-infra-card__list">
              <div class="system-infra-card__row">
                <span class="system-infra-card__key">${isBn ? 'মোট ইভেন্ট (২৪ ঘণ্টা)' : 'Total Events (24h)'}</span>
                <span class="system-infra-card__val">${countText(whTotal24)}</span>
              </div>
              <div class="system-infra-card__row">
                <span class="system-infra-card__key">${isBn ? 'সফল ডেলিভারি' : 'Delivered (24h)'}</span>
                <span class="system-infra-card__val" style="color: var(--success);">${countText(whDelivered24)}</span>
              </div>
              <div class="system-infra-card__row">
                <span class="system-infra-card__key">${isBn ? 'ব্যর্থ ডেলিভারি' : 'Failed Attempts'}</span>
                <span class="system-infra-card__val">${countText(webhooks.failed_24h)}</span>
              </div>
              <div class="system-infra-card__row">
                <span class="system-infra-card__key">${isBn ? 'ডেড-লেটার কিউ (DLQ)' : 'Dead-Letter Queue'}</span>
                <span class="system-infra-card__val ${webhooks.dlq_depth > 0 ? 'text-amber' : ''}">${webhooks.dlq_depth || 0}</span>
              </div>
            </div>
            </div>

          </div>
        </div>
      ` : ''}

      <!-- 5. Background Scheduler Jobs Execution Log Panel -->
      ${isSchedulerTab ? `
        <div class="system-panel">
          <div class="system-panel__header">
            <div>
              <h3 class="system-panel__title">
                <span>⏱️ ${isBn ? 'ব্যাকগ্রাউন্ড শিডিউলার ক্রন হিস্ট্রি' : 'Background Scheduler Jobs History'}</span>
              </h3>
              <p class="system-panel__sub">
                ${isBn ? 'ডিস্ট্রিবিউটেড ক্রন ওয়ার্কার্স, এডভাইজরি লকিং ও স্বয়ংক্রিয় রোলআপ সমন্বয়।' : 'Distributed cron workers with advisory locking, automated rollups, and queue sweeps.'}
              </p>
            </div>

            <div class="system-panel__header-actions">
              <input type="search" id="job-search-input" class="input input--sm" aria-label="${isBn ? 'জব সার্চ করুন...' : 'Filter jobs by name...'}" placeholder="${isBn ? 'জব সার্চ করুন...' : 'Filter jobs by name...'}" value="${jobFilterQuery}" style="width: 200px;" />
            </div>
          </div>

          <div class="system-table-wrap">
            <table class="system-table">
              <thead>
                <tr>
                  <th>${isBn ? 'জবের নাম' : 'Job Name'}</th>
                  <th>${isBn ? 'শিডিউল ফ্রিকোয়েন্সি' : 'Frequency'}</th>
                  <th>${isBn ? 'স্ট্যাটাস' : 'Status'}</th>
                  <th>${isBn ? 'শেষ রান' : 'Last Execution'}</th>
                  <th>${isBn ? 'সময়কাল' : 'Duration'}</th>
                  <th>${isBn ? 'প্রসেসকৃত আইটেম' : 'Items'}</th>
                </tr>
              </thead>
              <tbody>
                ${jobs.length > 0 ? jobs.map((j) => {
                  const jobName = j.name || j.job_name || 'cron_job';
                  // WHY no defaults: a missing duration/count used to render as 120 ms and a random
                  // 5-24 items, and every status was drawn with a green tick. Unknown shows "—".
                  const schedule = j.schedule || null;
                  const status = j.status || 'UNKNOWN';
                  const lastRunAt = j.last_run_at || j.started_at;
                  const durationMs = numOrNull(j.duration_ms);
                  const count = numOrNull(j.processed_count);
                  const statusOk = ['SUCCESS', 'COMPLETED'].includes(String(status).toUpperCase());
                  const statusBad = ['FAILED', 'ERROR'].includes(String(status).toUpperCase());

                  return `
                    <tr>
                      <td>
                        <span style="font-family: var(--font-mono); font-weight: 700; color: var(--text-primary);">
                          ${jobName}
                        </span>
                        ${j.module_key ? `<div style="font-size: 11px; color: var(--text-muted);">${isBn ? 'মডিউল' : 'Module'}: ${j.module_key}</div>` : ''}
                      </td>
                      <td>
                        ${schedule ? `<span class="badge badge--neutral" style="font-size: 11px;">${schedule}</span>` : '—'}
                      </td>
                      <td>
                        <span class="system-table__badge ${statusOk ? 'system-table__badge--success' : statusBad ? 'system-table__badge--danger' : 'system-table__badge--warn'}">
                          ${statusOk ? '✓ ' : statusBad ? '✗ ' : ''}${status}
                        </span>
                      </td>
                      <td style="color: var(--text-secondary);">
                        ${lastRunAt ? new Date(lastRunAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
                      </td>
                      <td style="font-family: var(--font-mono); font-weight: 600;">
                        ${durationMs === null ? '—' : `${durationMs} ms`}
                      </td>
                      <td style="color: var(--text-secondary);">
                        ${count === null ? '—' : `${count} ${isBn ? 'টি আইটেম' : 'items'}`}
                      </td>
                    </tr>
                  `;
                }).join('') : `
                  <tr>
                    <td colspan="6" style="text-align: center; padding: var(--space-6); color: var(--text-muted);">
                      ${isBn ? 'কোনো শিডিউলার জব পাওয়া যায়নি।' : 'No scheduler jobs match your filter.'}
                    </td>
                  </tr>
                `}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}

      <!-- 6. Disaster Recovery & Backup Snapshots Section -->
      ${isBackupsTab ? `
        <div class="system-panel">
          <div class="system-panel__header">
            <div>
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                <span class="badge badge--neutral" style="font-weight: 800; font-size: 10px; text-transform: uppercase;">
                  🛡️ ${isBn ? 'ক্রিটিকাল টায়ার কন্ট্রোল' : 'CRITICAL Tier Control'}
                </span>
              </div>
              <h3 class="system-panel__title">
                <span>💾 ${isBn ? 'ইন্টিগ্রিটি ফিঙ্গারপ্রিন্ট' : 'Integrity Fingerprints'}</span>
              </h3>
              <p class="system-panel__sub">
                ${isBn ? 'মূল টেবিলের সারি-সংখ্যা ও SHA-256 হ্যাশ রেকর্ড করে। এতে ডেটার কপি থাকে না, তাই এটি ব্যাকআপ নয় এবং এ থেকে ডেটা ফেরানো যায় না।' : 'Records core-table row counts and a SHA-256 hash. No data is copied, so this is not a backup and cannot be used to roll the database back.'}
              </p>
            </div>

            <div class="system-panel__header-actions">
              <input type="search" id="backup-search-input" class="input input--sm" aria-label="${isBn ? 'স্ন্যাপশট সার্চ করুন...' : 'Filter snapshots by ref / hash...'}" placeholder="${isBn ? 'স্ন্যাপশট সার্চ করুন...' : 'Filter snapshots by ref / hash...'}" value="${backupFilterQuery}" style="width: 220px;" />
              <div id="create-snapshot-panel-slot"></div>
            </div>
          </div>

          <!-- Backup Table -->
          <div class="system-table-wrap">
            <table class="system-table">
              <thead>
                <tr>
                  <th>${isBn ? 'স্ন্যাপশট রেফারেন্স' : 'Snapshot Ref'}</th>
                  <th>${isBn ? 'টাইপ' : 'Type'}</th>
                  <th>${isBn ? 'SHA-256 ইন্টিগ্রিটি চেকসাম' : 'SHA-256 Integrity Checksum'}</th>
                  <th>${isBn ? 'টেবিল ও সারি' : 'Tables & Rows'}</th>
                  <th>${isBn ? 'ডেটাবেজ সাইজ (তৈরির সময়)' : 'DB Size at Snapshot'}</th>
                  <th>${isBn ? 'তৈরির সময়' : 'Created At'}</th>
                  <th style="text-align: right;">${isBn ? 'অ্যাকশন' : 'Action'}</th>
                </tr>
              </thead>
              <tbody>
                ${backups.length > 0 ? backups.map((b) => {
                  const ref = b.ref || b.snapshot_tag || `SNAP-${b.id}`;
                  // WHY derived from table_counts_json: the API never sent table_count/row_count, so every
                  // snapshot showed "95 tables - 144k rows" and a 49 MB size, and a missing checksum
                  // was replaced by the SHA-256 of the empty string.
                  const type = b.snapshot_type || '—';
                  const checksum = b.checksum_sha256 || b.sha256_checksum || '';
                  let counts = b.table_counts_json;
                  if (typeof counts === 'string') { try { counts = JSON.parse(counts); } catch { counts = null; } }
                  const countVals = counts && typeof counts === 'object' ? Object.values(counts).map(Number).filter(Number.isFinite) : null;
                  const tableCount = b.table_count ?? (countVals ? countVals.length : null);
                  const rowCount = b.row_count ?? (countVals ? countVals.reduce((a, n) => a + n, 0) : null);
                  const size = numOrNull(b.size_bytes) === null ? '—' : formatBytes(Number(b.size_bytes));
                  const isRestored = b.status === 'RESTORED';

                  return `
                    <tr>
                      <td>
                        <div style="display: flex; align-items: center; gap: 6px;">
                          <span style="font-family: var(--font-mono); font-weight: 700; color: var(--text-primary);">
                            ${ref}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span class="system-table__badge system-table__badge--info">
                          ${type}
                        </span>
                      </td>
                      <td>
                        ${checksum ? `<div class="system-table__checksum-box" title="${checksum}">
                          <span>${checksum.substring(0, 16)}…${checksum.substring(checksum.length - 8)}</span>
                          <button type="button" class="system-table__checksum-copy copy-checksum-btn" data-checksum="${checksum}" title="${isBn ? 'কপি করুন' : 'Copy Checksum'}">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="inline-icon"><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path></svg>
                          </button>
                        </div>` : '—'}
                      </td>
                      <td style="color: var(--text-secondary);">
                        ${tableCount === null || rowCount === null ? '—' : `${tableCount} tables • ${rowCount.toLocaleString()} rows`}
                      </td>
                      <td style="font-family: var(--font-mono); font-weight: 600;">
                        ${size}
                      </td>
                      <td style="color: var(--text-secondary);">
                        ${b.created_at ? new Date(b.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                      </td>
                      <td style="text-align: right;">
                        <button type="button" class="btn btn--danger btn--sm restore-snapshot-btn" data-id="${b.id}" data-ref="${ref}" style="padding: 3px 10px; font-size: 11px;">
                          ${isRestored ? `✓ ${isBn ? 'রিস্টোরড' : 'Restored'}` : `${isBn ? 'রিস্টোরড চিহ্নিত করুন' : 'Mark Restored'}`}
                        </button>
                      </td>
                    </tr>
                  `;
                }).join('') : `
                  <tr>
                    <td colspan="7" style="text-align: center; padding: var(--space-6); color: var(--text-muted);">
                      ${isBn ? 'এখনো কোনো ফিঙ্গারপ্রিন্ট নেই। উপরের "ফিঙ্গারপ্রিন্ট নিন" এ ক্লিক করুন।' : 'No fingerprints recorded yet. Click "Record Fingerprint" above.'}
                    </td>
                  </tr>
                `}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}
    `;

    // =========================================================================
    // Bind Event Listeners & Buttons
    // =========================================================================

    // Tab switcher
    container.querySelectorAll('.system-health__tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTab = btn.getAttribute('data-tab');
        render();
      });
    });

    // Back to Cockpit button
    const cockpitSlot = container.querySelector('#back-cockpit-slot');
    if (cockpitSlot) {
      const cockpitBtn = Button({
        label: isBn ? '← এক্সিকিউটিভ ড্যাশবোর্ড' : '← Executive Cockpit',
        variant: 'secondary',
        size: 'sm',
        onClick: () => nav('/admin'),
      });
      cockpitSlot.append(cockpitBtn);
    }

    // Refresh Telemetry button
    const refreshSlot = container.querySelector('#refresh-slot');
    if (refreshSlot) {
      const refreshBtn = Button({
        label: isBn ? '🔄 রিফ্রেশ' : '🔄 Refresh',
        variant: 'secondary',
        size: 'sm',
        onClick: () => loadData(true),
      });
      refreshSlot.append(refreshBtn);
    }

    // Create Snapshot function
    const handleCreateSnapshot = async (btn) => {
      if (isCreatingSnapshot) return;
      isCreatingSnapshot = true;
      if (btn) btn.disabled = true;

      toast.info(isBn ? 'SHA-256 ফিঙ্গারপ্রিন্ট তৈরি হচ্ছে...' : 'Computing SHA-256 fingerprint...');

      try {
        const res = await adminApi.triggerBackup();
        const createdRef = res.data?.backup?.ref || res.data?.ref || `SNAP_${Date.now()}`;
        toast.success(isBn ? `ফিঙ্গারপ্রিন্ট #${createdRef} রেকর্ড হয়েছে।` : `Fingerprint #${createdRef} recorded.`);
        await loadData();
      } catch {
        toast.error(isBn ? 'ব্যাকআপ স্ন্যাপশট তৈরিতে সমস্যা হয়েছে।' : 'Failed to generate backup snapshot.');
      } finally {
        isCreatingSnapshot = false;
        if (btn) btn.disabled = false;
      }
    };

    // Header Create Snapshot button
    const createHeaderSlot = container.querySelector('#create-backup-header-slot');
    if (createHeaderSlot) {
      const snapBtn = Button({
        label: isBn ? '📸 ফিঙ্গারপ্রিন্ট নিন' : '📸 Record Fingerprint',
        variant: 'primary',
        size: 'sm',
        onClick: () => handleCreateSnapshot(snapBtn),
      });
      createHeaderSlot.append(snapBtn);
    }

    // Panel Create Snapshot button
    const createPanelSlot = container.querySelector('#create-snapshot-panel-slot');
    if (createPanelSlot) {
      const snapPanelBtn = Button({
        label: isBn ? '📸 ফিঙ্গারপ্রিন্ট নিন' : '📸 Record Fingerprint',
        variant: 'primary',
        size: 'sm',
        onClick: () => handleCreateSnapshot(snapPanelBtn),
      });
      createPanelSlot.append(snapPanelBtn);
    }

    // Re-measure: refetches the live vitals; nothing is simulated.
    const testDbBtn = container.querySelector('.test-db-btn');
    if (testDbBtn) {
      testDbBtn.addEventListener('click', () => loadData(true));
    }

    // Job search input
    const jobSearchInput = container.querySelector('#job-search-input');
    if (jobSearchInput) {
      jobSearchInput.addEventListener('input', (e) => {
        jobFilterQuery = e.target.value;
        render();
        const input = root.querySelector('#job-search-input');
        if (input) {
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }
      });
    }

    // Backup search input
    const backupSearchInput = container.querySelector('#backup-search-input');
    if (backupSearchInput) {
      backupSearchInput.addEventListener('input', (e) => {
        backupFilterQuery = e.target.value;
        render();
        const input = root.querySelector('#backup-search-input');
        if (input) {
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }
      });
    }

    // Checksum Copy buttons
    container.querySelectorAll('.copy-checksum-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const checksum = btn.getAttribute('data-checksum');
        if (checksum) {
          navigator.clipboard.writeText(checksum);
          btn.textContent = '✓';
          toast.success(isBn ? 'SHA-256 চেকসাম ক্লিপবোর্ডে কপি করা হয়েছে!' : 'Copied SHA-256 checksum to clipboard!');
          setTimeout(() => {
            btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="inline-icon"><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path></svg>';
          }, 1500);
        }
      });
    });

    // Restore Snapshot with Confirmation Dialog
    container.querySelectorAll('.restore-snapshot-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const ref = btn.getAttribute('data-ref');
        if (!id) return;

        const title = isBn ? 'রিস্টোরড হিসেবে চিহ্নিত করুন' : 'Mark Snapshot as Restored';
        const msg = isBn
          ? `স্ন্যাপশট #${ref} রিস্টোরড হিসেবে চিহ্নিত করবেন? এটি শুধু রেকর্ড রাখে; ডেটাবেজের কোনো ডেটা ফিরিয়ে আনা হবে না।`
          : `Mark snapshot #${ref} as restored? This only records the action; no database data is rolled back.`;

        const confirmed = await confirmDialog({
          title,
          message: msg,
          confirmLabel: isBn ? 'চিহ্নিত করুন' : 'Mark as Restored',
          cancelLabel: isBn ? 'বাতিল' : 'Cancel',
          isDanger: true,
        });

        if (confirmed) {
          btn.disabled = true;
          btn.textContent = isBn ? '⏳ চিহ্নিত হচ্ছে...' : '⏳ Marking...';
          try {
            await adminApi.restoreBackup(id);
            toast.success(isBn ? `স্ন্যাপশট #${ref} রিস্টোরড হিসেবে চিহ্নিত হয়েছে (কোনো ডেটা ফেরানো হয়নি)।` : `Snapshot #${ref} marked as restored (no data was rolled back).`);
            await loadData();
          } catch {
            toast.error(isBn ? 'স্ন্যাপশট চিহ্নিত করতে ত্রুটি হয়েছে।' : 'Failed to mark snapshot as restored.');
          } finally {
            btn.disabled = false;
          }
        }
      });
    });

    root.appendChild(container);
  }

  loadData();
}
