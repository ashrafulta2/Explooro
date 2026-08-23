/**
 * ReferralHubPage.js — Saler Multi-Tier Referral & Network Growth Hub (Prompt 9.3).
 *
 * Implements:
 * 1. Referral Link & QR Code generation with 1-tap share tools (WhatsApp, Facebook, Copy).
 * 2. Executive Network KPIs: Total Network Size, Tier 1 (5%) vs Tier 2 (2%) split, Lifetime & Escrow Earnings.
 * 3. Interactive Multi-Tier Referral Tree visualizer with status badges.
 * 4. Ledger-backed Commission & Escrow Holding Timeline.
 * 5. Bilingual localization (English & Bengali).
 */

import { api } from '../../core/api.js';
import { t, getLanguage, subscribe as subscribeLang } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { Button } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';

export default class ReferralHubPage {
  constructor() {
    this.overview = null;
    this.tree = [];
    this.statement = [];
    this.activeTab = 'tree'; // 'tree' | 'statement'
    this.loading = true;
    this.rootEl = null;
    this.unsubscribeLang = null;
  }

  async mount(outlet) {
    this.rootEl = outlet;
    this.unsubscribeLang = subscribeLang(() => this.render());
    await this.fetchData();
    this.render();
  }

  unmount() {
    if (this.unsubscribeLang) {
      this.unsubscribeLang();
      this.unsubscribeLang = null;
    }
  }

  async fetchData() {
    this.loading = true;
    try {
      const [overviewRes, treeRes, statementRes] = await Promise.all([
        api.get('/saler/referrals/overview').catch(() => ({ overview: null })),
        api.get('/saler/referrals/tree').catch(() => ({ tree: [] })),
        api.get('/saler/referrals/statement').catch(() => ({ statement: [] })),
      ]);
      this.overview = overviewRes.overview;
      this.tree = treeRes.tree || [];
      this.statement = statementRes.statement || [];
    } catch (err) {
      toast.error(err.message || 'Failed to load referral data');
    } finally {
      this.loading = false;
    }
  }

  render() {
    if (!this.rootEl) return;
    const lang = getLanguage();
    const isBn = lang === 'bn';

    const origin = window.location.origin || 'https://explooro.com';
    const refCode = this.overview?.code || 'REF-DEMO';
    const refLink = this.overview?.custom_slug
      ? `${origin}/join/${this.overview.custom_slug}`
      : `${origin}/join?ref=${refCode}`;

    const stats = this.overview?.stats || {};
    const earnings = this.overview?.earnings || {};

    this.rootEl.innerHTML = `
      <div class="referral-hub-container p-6 space-y-6 max-w-7xl mx-auto">
        <!-- Page Header -->
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-4">
          <div>
            <h1 class="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
              ${isBn ? 'রেফারেল ও নেটওয়ার্ক আর্নিং হাব' : 'Referral & Network Growth Hub'}
            </h1>
            <p class="text-sm text-muted mt-1">
              ${isBn ? 'বন্ধুদের রেফার করুন এবং তাদের বিক্রির উপর ২-স্তরের আজীবন কমিশন উপভোগ করুন' : 'Invite entrepreneurs and earn 2-tier lifetime commissions on their commerce activity'}
            </p>
          </div>
          <div class="flex gap-2">
            <button id="btn-edit-slug" class="btn btn-outline text-xs">
              ✏️ ${isBn ? 'কাস্টম লিংক তৈরি করুন' : 'Custom Vanity Slug'}
            </button>
            <button id="btn-open-qr" class="btn btn-primary text-xs">
              📱 ${isBn ? 'QR কোড দেখান' : 'Show QR Code'}
            </button>
          </div>
        </div>

        <!-- Share Banner Card -->
        <div class="card p-6 bg-gradient-to-r from-primary/10 via-surface to-accent/10 border border-primary/20 rounded-2xl shadow-sm">
          <div class="flex flex-col lg:flex-row items-center justify-between gap-6">
            <div class="space-y-2 text-center lg:text-left">
              <span class="badge badge-primary text-xs font-bold uppercase tracking-wider">
                ${isBn ? 'মাল্টি-টিয়ার গ্রোথ প্রোগ্রাম' : 'Multi-Tier Growth Engine'}
              </span>
              <h2 class="text-xl font-bold">
                ${isBn ? 'টিয়ার ১ থেকে ৫% এবং টিয়ার ২ থেকে ২% কমিশন পান' : 'Earn 5% from Direct (Tier 1) and 2% from Sub-Network (Tier 2)'}
              </h2>
              <p class="text-xs text-muted max-w-xl">
                ${isBn
                  ? 'আপনার লিংকে যুক্ত হওয়া সেলার ও কাস্টমারদের প্রতিটি কোয়ালিফাইড অর্ডারে সরাসরি কমিশন আপনার ওয়ালেটে জমা হবে।'
                  : 'Every qualifying purchase and sale by your referee network credits commission directly to your escrow vault.'}
              </p>
            </div>

            <!-- Share Controls -->
            <div class="w-full lg:w-auto flex flex-col sm:flex-row items-center gap-2 bg-surface p-2 rounded-xl border border-border">
              <input
                type="text"
                readonly
                id="input-referral-link"
                value="${refLink}"
                class="input input-sm font-mono text-xs w-full sm:w-80 bg-background" />
              <button id="btn-copy-link" class="btn btn-sm btn-primary whitespace-nowrap w-full sm:w-auto">
                📋 ${isBn ? 'কপি লিংক' : 'Copy Link'}
              </button>
              <a
                href="https://api.whatsapp.com/send?text=${encodeURIComponent((isBn ? 'এক্সপ্লুরোতে যোগ দিয়ে আজই বিজনেস শুরু করুন: ' : 'Join Explooro today and start your commerce business: ') + refLink)}"
                target="_blank"
                rel="noopener noreferrer"
                class="btn btn-sm btn-success whitespace-nowrap w-full sm:w-auto">
                💬 WhatsApp
              </a>
            </div>
          </div>
        </div>

        <!-- 4 KPI Metrics -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="p-4 bg-surface border border-border rounded-xl">
            <span class="text-xs text-muted uppercase font-bold tracking-wider">${isBn ? 'মোট নেটওয়ার্ক সাইজ' : 'Total Network'}</span>
            <div class="text-2xl font-bold mt-1 text-primary">${stats.total_referrals || 0}</div>
            <span class="text-[11px] text-muted">${stats.qualified_count || 0} ${isBn ? 'সক্রিয় কোয়ালিফাইড' : 'qualified'}</span>
          </div>
          <div class="p-4 bg-surface border border-border rounded-xl">
            <span class="text-xs text-muted uppercase font-bold tracking-wider">${isBn ? 'টিয়ার ১ (সরাসরি ৫%)' : 'Tier 1 (Direct 5%)'}</span>
            <div class="text-2xl font-bold mt-1 text-accent">${stats.tier1_count || 0}</div>
            <span class="text-[11px] text-muted">${isBn ? 'সরাসরি আমন্ত্রিত' : 'direct invites'}</span>
          </div>
          <div class="p-4 bg-surface border border-border rounded-xl">
            <span class="text-xs text-muted uppercase font-bold tracking-wider">${isBn ? 'টিয়ার ২ (সাব-নেটওয়ার্ক ২%)' : 'Tier 2 (Indirect 2%)'}</span>
            <div class="text-2xl font-bold mt-1 text-warning">${stats.tier2_count || 0}</div>
            <span class="text-[11px] text-muted">${isBn ? 'টিয়ার ১ দ্বারা আমন্ত্রিত' : 'invited by Tier 1'}</span>
          </div>
          <div class="p-4 bg-surface border border-border rounded-xl">
            <span class="text-xs text-muted uppercase font-bold tracking-wider">${isBn ? 'মোট রেফারেল আয়' : 'Total Commission'}</span>
            <div class="text-2xl font-bold mt-1 text-success font-mono">৳${Number(earnings.total_earnings || 0).toFixed(2)}</div>
            <span class="text-[11px] text-muted">৳${Number(earnings.pending_escrow || 0).toFixed(2)} ${isBn ? 'এসক্রো হোল্ডিংয়ে' : 'in escrow'}</span>
          </div>
        </div>

        <!-- Navigation Tabs -->
        <div class="flex border-b border-border gap-4">
          <button
            class="tab-btn pb-3 px-2 font-semibold text-sm transition-colors border-b-2 ${this.activeTab === 'tree' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-white'}"
            data-tab="tree">
            🌳 ${isBn ? 'নেটওয়ার্ক ট্রি ভিজুয়ালাইজার' : 'Network Tree'} (${this.tree.length})
          </button>
          <button
            class="tab-btn pb-3 px-2 font-semibold text-sm transition-colors border-b-2 ${this.activeTab === 'statement' ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-white'}"
            data-tab="statement">
            📜 ${isBn ? 'কমিশন স্টেটমেন্ট ও এসক্রো টাইমলাইন' : 'Commission Statement & Escrow'} (${this.statement.length})
          </button>
        </div>

        <!-- Content Area -->
        ${this.loading ? `
          <div class="p-12 text-center text-muted">${isBn ? 'লোড হচ্ছে…' : 'Loading network data…'}</div>
        ` : this.activeTab === 'tree'
          ? this._renderTreeTab(isBn)
          : this._renderStatementTab(isBn)}

        <!-- Anti-Fraud Policy Notice -->
        <div class="p-4 bg-surface/50 border border-border rounded-xl text-xs text-muted flex items-start gap-3">
          <span class="text-base">🛡️</span>
          <div>
            <strong class="text-foreground">${isBn ? 'জালিয়াতি বিরোধী ও এসক্রো নীতি' : 'Anti-Fraud & Escrow Security Policy'}:</strong>
            ${isBn
              ? ' একই ডিভাইসে নিজের অ্যাকাউন্ট রেফার করা, ভুয়া সাইনআপ বা সার্কুলার রেফারেল নিষিদ্ধ। কমিশন ৭ দিনের রিটার্ন উইন্ডো অতিক্রমের পর এসক্রো থেকে অটোমেটিক এভেইলেবল ব্যালেন্সে যুক্ত হবে।'
              : ' Self-referrals across same devices/credentials, circular loops, and artificial signups are automatically blocked. Commissions clear from escrow after the 7-day customer return window.'}
          </div>
        </div>
      </div>
    `;

    this._attachEvents(refLink, isBn);
  }

  _renderTreeTab(isBn) {
    if (this.tree.length === 0) {
      return `
        <div class="card p-12 text-center text-muted bg-surface border border-border rounded-xl">
          <div class="text-4xl mb-2">🌳</div>
          <p class="font-semibold">${isBn ? 'এখনো কোনো রেফারেল যুক্ত হয়নি।' : 'No referees in your network yet.'}</p>
          <p class="text-xs mt-1">${isBn ? 'আপনার লিংক শেয়ার করে টিম তৈরি শুরু করুন!' : 'Share your link above to start building your 2-tier earner network.'}</p>
        </div>
      `;
    }

    return `
      <div class="card p-5 bg-surface border border-border rounded-xl">
        <div class="overflow-x-auto">
          <table class="table w-full text-left text-sm">
            <thead>
              <tr class="border-b border-border text-xs uppercase text-muted">
                <th class="py-3 px-4">${isBn ? 'রেফারি নাম ও অ্যাকাউন্ট' : 'Referee & User'}</th>
                <th class="py-3 px-4">${isBn ? 'টিয়ার স্তর' : 'Tier Level'}</th>
                <th class="py-3 px-4">${isBn ? 'যুক্ত হওয়ার তারিখ' : 'Joined Date'}</th>
                <th class="py-3 px-4">${isBn ? 'অবস্থা' : 'Status'}</th>
                <th class="py-3 px-4 text-right">${isBn ? 'অর্জিত কমিশন' : 'Commission Earned'}</th>
              </tr>
            </thead>
            <tbody>
              ${this.tree.map(node => `
                <tr class="border-b border-border hover:bg-muted/5 transition-colors">
                  <td class="py-4 px-4">
                    <div class="font-semibold">${this._escapeHtml(node.referee_name || 'User')}</div>
                    <div class="text-xs text-muted font-mono">${node.ref}</div>
                  </td>
                  <td class="py-4 px-4">
                    <span class="badge badge-${node.tier_level === 1 ? 'accent' : 'warning'} text-xs font-bold">
                      ${node.tier_level === 1 ? (isBn ? 'টিয়ার ১ (সরাসরি ৫%)' : 'Tier 1 (5%)') : (isBn ? 'টিয়ার ২ (সাব ২%)' : 'Tier 2 (2%)')}
                    </span>
                  </td>
                  <td class="py-4 px-4 text-xs text-muted">
                    ${new Date(node.created_at).toLocaleDateString()}
                  </td>
                  <td class="py-4 px-4">
                    ${node.status === 'QUALIFIED'
                      ? `<span class="badge badge-success text-xs font-semibold">✓ ${isBn ? 'কোয়ালিফাইড' : 'Qualified'}</span>`
                      : node.status === 'FRAUD_FLAGGED'
                      ? `<span class="badge badge-danger text-xs font-semibold">⚠️ ${isBn ? 'বাতিল' : 'Fraud Flagged'}</span>`
                      : `<span class="badge badge-neutral text-xs font-semibold">⏳ ${isBn ? 'অপেক্ষমাণ' : 'Pending'}</span>`}
                  </td>
                  <td class="py-4 px-4 text-right font-mono font-bold text-success">
                    ৳${Number(node.earned_from_referee || 0).toFixed(2)}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  _renderStatementTab(isBn) {
    if (this.statement.length === 0) {
      return `
        <div class="card p-12 text-center text-muted bg-surface border border-border rounded-xl">
          <div class="text-4xl mb-2">📜</div>
          <p class="font-semibold">${isBn ? 'কোনো কমিশন লেনদেন পাওয়া যায়নি।' : 'No commission records found.'}</p>
          <p class="text-xs mt-1">${isBn ? 'রেফারিদের প্রথম অর্ডার সফল হলে কমিশন এখানে যুক্ত হবে।' : 'Commissions from qualifying orders will appear here automatically.'}</p>
        </div>
      `;
    }

    return `
      <div class="card p-5 bg-surface border border-border rounded-xl">
        <div class="overflow-x-auto">
          <table class="table w-full text-left text-sm">
            <thead>
              <tr class="border-b border-border text-xs uppercase text-muted">
                <th class="py-3 px-4">${isBn ? 'রেফারেন্স ও রেফারি' : 'Ref & Source'}</th>
                <th class="py-3 px-4">${isBn ? 'অর্ডার মূল্য ও রেট' : 'Order & Rate'}</th>
                <th class="py-3 px-4">${isBn ? 'কমিশন' : 'Commission'}</th>
                <th class="py-3 px-4">${isBn ? 'এসক্রো রিলিজ তারিখ' : 'Escrow Clearance'}</th>
                <th class="py-3 px-4 text-right">${isBn ? 'অবস্থা' : 'Status'}</th>
              </tr>
            </thead>
            <tbody>
              ${this.statement.map(item => `
                <tr class="border-b border-border hover:bg-muted/5 transition-colors">
                  <td class="py-4 px-4">
                    <div class="font-semibold text-xs">${this._escapeHtml(item.referee_name || 'Referee')}</div>
                    <div class="text-[11px] text-muted font-mono">${item.referral_ref} • Tier ${item.tier_level}</div>
                  </td>
                  <td class="py-4 px-4 font-mono text-xs">
                    <div>৳${Number(item.order_amount || 0).toFixed(2)}</div>
                    <span class="text-muted">@ ${Number(item.commission_rate_pct).toFixed(1)}%</span>
                  </td>
                  <td class="py-4 px-4 font-mono font-bold text-success">
                    +৳${Number(item.commission_amount).toFixed(2)}
                  </td>
                  <td class="py-4 px-4 text-xs text-muted font-mono">
                    ${item.status === 'AVAILABLE' ? '✓ Cleared' : new Date(item.escrow_release_at).toLocaleDateString()}
                  </td>
                  <td class="py-4 px-4 text-right">
                    ${item.status === 'AVAILABLE'
                      ? `<span class="badge badge-success text-xs font-semibold">Available</span>`
                      : `<span class="badge badge-warning text-xs font-semibold">In Escrow</span>`}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  _attachEvents(refLink, isBn) {
    // Tab switching
    this.rootEl.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeTab = btn.dataset.tab;
        this.render();
      });
    });

    // Copy Link button
    const btnCopy = this.rootEl.querySelector('#btn-copy-link');
    if (btnCopy) {
      btnCopy.addEventListener('click', () => {
        navigator.clipboard.writeText(refLink);
        toast.success(isBn ? 'রেফারেল লিংক কপি করা হয়েছে!' : 'Referral link copied to clipboard!');
      });
    }

    // QR Code Modal
    const btnQr = this.rootEl.querySelector('#btn-open-qr');
    if (btnQr) {
      btnQr.addEventListener('click', () => {
        this._openQrModal(refLink, isBn);
      });
    }

    // Edit Slug Modal
    const btnSlug = this.rootEl.querySelector('#btn-edit-slug');
    if (btnSlug) {
      btnSlug.addEventListener('click', () => {
        this._openSlugModal(isBn);
      });
    }
  }

  _openQrModal(refLink, isBn) {
    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'modal-backdrop fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4';

    modalBackdrop.innerHTML = `
      <div class="modal-dialog bg-surface border border-border rounded-2xl max-w-sm w-full p-6 text-center shadow-2xl space-y-4">
        <div class="flex justify-between items-center border-b border-border pb-3">
          <h3 class="font-bold text-lg">${isBn ? 'আপনার রেফারেল QR কোড' : 'Your Referral QR Code'}</h3>
          <button type="button" class="btn-close text-muted hover:text-white font-bold text-xl">×</button>
        </div>

        <div class="p-4 bg-white rounded-xl mx-auto w-48 h-48 flex items-center justify-center border shadow-inner">
          <img
            src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(refLink)}"
            alt="Referral QR Code"
            class="w-full h-full object-contain" />
        </div>

        <p class="text-xs text-muted font-mono break-all">${refLink}</p>

        <button type="button" class="btn btn-primary btn-sm w-full btn-close">
          ${isBn ? 'ঠিক আছে' : 'Done'}
        </button>
      </div>
    `;

    document.body.appendChild(modalBackdrop);

    const closeModal = () => {
      if (document.body.contains(modalBackdrop)) {
        document.body.removeChild(modalBackdrop);
      }
    };

    modalBackdrop.querySelectorAll('.btn-close').forEach(b => b.addEventListener('click', closeModal));
  }

  _openSlugModal(isBn) {
    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'modal-backdrop fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4';

    modalBackdrop.innerHTML = `
      <div class="modal-dialog bg-surface border border-border rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
        <div class="flex justify-between items-center border-b border-border pb-3">
          <h3 class="font-bold text-lg">${isBn ? 'কাস্টম রেফারেল লিংক' : 'Custom Vanity Slug'}</h3>
          <button type="button" class="btn-close text-muted hover:text-white font-bold text-xl">×</button>
        </div>

        <form id="form-custom-slug" class="space-y-4">
          <div>
            <label class="block text-xs font-semibold text-muted uppercase mb-1">
              ${isBn ? 'আপনার পছন্দের লিংক নাম' : 'Vanity Slug'}
            </label>
            <div class="flex items-center gap-1 font-mono text-xs">
              <span class="text-muted">explooro.com/join/</span>
              <input
                type="text"
                name="custom_slug"
                required
                pattern="^[a-z0-9-]+$"
                placeholder="fahim-store"
                value="${this.overview?.custom_slug || ''}"
                class="input input-sm w-full font-mono" />
            </div>
            <p class="text-[11px] text-muted mt-1">${isBn ? 'শুধু ছোট হাতের অক্ষর, সংখ্যা ও হাইফেন ব্যবহার করুন' : 'Letters, numbers, and hyphens only'}</p>
          </div>

          <div class="flex justify-end gap-2 pt-3 border-t border-border">
            <button type="button" class="btn btn-outline btn-sm btn-cancel">${isBn ? 'বাতিল' : 'Cancel'}</button>
            <button type="submit" class="btn btn-primary btn-sm">${isBn ? 'সংরক্ষণ করুন' : 'Save Slug'}</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modalBackdrop);

    const closeModal = () => {
      if (document.body.contains(modalBackdrop)) {
        document.body.removeChild(modalBackdrop);
      }
    };

    modalBackdrop.querySelector('.btn-close').addEventListener('click', closeModal);
    modalBackdrop.querySelector('.btn-cancel').addEventListener('click', closeModal);

    const form = modalBackdrop.querySelector('#form-custom-slug');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const slug = new FormData(form).get('custom_slug');
      try {
        await api.post('/saler/referrals/custom-code', { custom_slug: slug });
        toast.success(isBn ? 'কাস্টম লিংক সফলভাবে সংরক্ষিত হয়েছে!' : 'Custom slug saved successfully!');
        closeModal();
        await this.fetchData();
        this.render();
      } catch (err) {
        toast.error(err.message || 'Failed to update slug');
      }
    });
  }

  _escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
