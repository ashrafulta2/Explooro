/**
 * TeamPurchasePage.js — Social Group Buying / Team Purchase Hub (Prompt 9.5).
 *
 * Implements:
 * 1. Pinduoduo-style viral team purchase view (/team/:id and /account/team-purchases).
 * 2. Live countdown timer with auto-expiry.
 * 3. Member slot visualizer with avatars and empty invitation slots.
 * 4. 1-Tap Join Modal with shipping address and payment method selector.
 * 5. Viral share toolbar with 1-click WhatsApp and Facebook actions.
 * 6. Bilingual localization (English & Bengali).
 */

import { api } from '../core/api.js';
import { getLanguage, subscribe as subscribeLang } from '../services/i18n.js';
import { toast } from '../services/toast.js';

export class TeamPurchasePage {
  constructor(params = {}) {
    this.teamId = params?.id || null;
    this.team = null;
    this.myTeams = [];
    this.loading = true;
    this.rootEl = null;
    this.timerInterval = null;
    this.unsubscribeLang = null;
  }

  async mount(outlet, routerParams) {
    this.rootEl = outlet;
    this.teamId = routerParams?.id || null;
    this.unsubscribeLang = subscribeLang(() => this.render());
    await this.fetchData();
    this.render();
    this._startCountdownTicker();
  }

  unmount() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.unsubscribeLang) {
      this.unsubscribeLang();
      this.unsubscribeLang = null;
    }
  }

  async fetchData() {
    this.loading = true;
    try {
      if (this.teamId) {
        const res = await api.get(`/team-purchases/${this.teamId}`);
        this.team = res.team;
      } else {
        const res = await api.get('/account/team-purchases').catch(() => ({ team_purchases: [] }));
        this.myTeams = res.team_purchases || [];
      }
    } catch (err) {
      toast.error(err.message || 'Failed to load team purchase');
    } finally {
      this.loading = false;
    }
  }

  _startCountdownTicker() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      if (this.team && this.team.remaining_seconds > 0 && this.team.status === 'ACTIVE') {
        this.team.remaining_seconds -= 1;
        const countdownEl = this.rootEl?.querySelector('#live-countdown');
        if (countdownEl) {
          countdownEl.textContent = this._formatRemaining(this.team.remaining_seconds);
        }
      }
    }, 1000);
  }

  _formatRemaining(totalSeconds) {
    if (totalSeconds <= 0) return '00:00:00';
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
  }

  render() {
    if (!this.rootEl) return;
    const isBn = getLanguage() === 'bn';

    if (this.loading) {
      this.rootEl.innerHTML = `
        <div class="p-12 text-center text-muted">${isBn ? 'টিম পারচেজ লোড হচ্ছে…' : 'Loading team purchase…'}</div>
      `;
      return;
    }

    if (!this.teamId) {
      this._renderMyTeamsList(isBn);
      return;
    }

    if (!this.team) {
      this.rootEl.innerHTML = `
        <div class="card p-12 text-center text-muted bg-surface border border-border rounded-xl max-w-xl mx-auto my-8">
          <div class="text-4xl mb-2">👥</div>
          <p class="font-bold">${isBn ? 'টিম পারচেজ পাওয়া যায়নি।' : 'Team purchase not found.'}</p>
        </div>
      `;
      return;
    }

    const t = this.team;
    const required = t.required_members || 3;
    const current = t.current_members_count || 1;
    const members = t.members || [];
    const discountPct = Math.round(((t.original_price - t.group_price) / t.original_price) * 100);
    const origin = window.location.origin || 'https://explooro.com';
    const teamShareUrl = `${origin}/team/${t.id}`;

    this.rootEl.innerHTML = `
      <div class="team-purchase-container p-6 space-y-6 max-w-4xl mx-auto">
        <!-- Status Banner -->
        ${t.status === 'COMPLETED' ? `
          <div class="p-4 bg-success/15 border border-success/30 rounded-2xl flex items-center gap-3 text-success">
            <span class="text-2xl">🎉</span>
            <div>
              <strong class="font-bold text-sm">${isBn ? 'টিম সফলভাবে পূর্ণ হয়েছে!' : 'Team Goal Achieved!'}</strong>
              <p class="text-xs text-foreground/80">${isBn ? 'সকল সদস্যের জন্য গ্রুপ মূল্যে অর্ডার তৈরি সম্পন্ন হয়েছে।' : 'Real orders have been created for all team members at the discounted group price.'}</p>
            </div>
          </div>
        ` : t.status === 'EXPIRED' ? `
          <div class="p-4 bg-danger/15 border border-danger/30 rounded-2xl flex items-center gap-3 text-danger">
            <span class="text-2xl">⏰</span>
            <div>
              <strong class="font-bold text-sm">${isBn ? 'টিমের সময়সীমা শেষ হয়েছে।' : 'Team Purchase Expired'}</strong>
              <p class="text-xs text-foreground/80">${isBn ? 'সময় শেষ হওয়ায় সকল সদস্যের অর্থ ১০০% রিফান্ড করা হয়েছে।' : 'The 24-hour window closed before filling. All member payment holds have been 100% refunded.'}</p>
            </div>
          </div>
        ` : `
          <div class="p-4 bg-gradient-to-r from-primary/15 via-surface to-accent/15 border border-primary/20 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm">
            <div class="flex items-center gap-3 text-center sm:text-left">
              <span class="text-3xl animate-pulse">🔥</span>
              <div>
                <span class="badge badge-accent text-[10px] font-bold uppercase tracking-wider">${isBn ? 'গ্রুপ বাই ডিল' : 'Social Team Purchase'}</span>
                <h2 class="font-bold text-base mt-0.5">${isBn ? `${required} জনের টিম পূর্ণ করে ডিসকাউন্ট উপভোগ করুন` : `Assemble a team of ${required} to unlock group price`}</h2>
              </div>
            </div>
            <div class="text-center sm:text-right">
              <span class="text-[11px] text-muted uppercase font-bold tracking-wider">${isBn ? 'বাকি সময়' : 'Time Remaining'}</span>
              <div id="live-countdown" class="text-xl font-black font-mono text-warning mt-0.5">
                ${this._formatRemaining(t.remaining_seconds)}
              </div>
            </div>
          </div>
        `}

        <!-- Product Card -->
        <div class="card p-6 bg-surface border border-border rounded-2xl flex flex-col sm:flex-row items-center gap-6">
          <div class="w-32 h-32 rounded-xl overflow-hidden bg-muted/10 border border-border shrink-0 flex items-center justify-center">
            ${t.product_image_url ? `
              <img src="${t.product_image_url}" alt="${t.product_name_en}" class="w-full h-full object-cover" />
            ` : `
              <span class="text-4xl">🛍️</span>
            `}
          </div>

          <div class="space-y-2 flex-1 text-center sm:text-left">
            <div class="flex flex-wrap items-center justify-center sm:justify-start gap-2">
              <span class="badge badge-success text-xs font-bold">Save ${discountPct}%</span>
              <span class="badge badge-neutral text-xs font-mono">${t.ref}</span>
            </div>
            <h3 class="font-bold text-lg text-foreground">${isBn ? (t.product_name_bn || t.product_name_en) : t.product_name_en}</h3>

            <div class="flex items-baseline justify-center sm:justify-start gap-3 pt-1 font-mono">
              <span class="text-2xl font-black text-primary">৳${Number(t.group_price).toFixed(2)}</span>
              <span class="text-sm line-through text-muted">৳${Number(t.original_price).toFixed(2)}</span>
            </div>
          </div>
        </div>

        <!-- Team Progress Slots -->
        <div class="card p-6 bg-surface border border-border rounded-2xl space-y-6 text-center">
          <div class="space-y-1">
            <h4 class="font-bold text-base text-foreground">
              ${isBn ? `টিম সদস্য (${current} / ${required})` : `Team Members (${current} / ${required} Joined)`}
            </h4>
            <p class="text-xs text-muted">
              ${t.status === 'ACTIVE'
                ? (isBn ? `আর মাত্র ${required - current} জন যুক্ত হলেই সবার অর্ডার নিশ্চিত হবে!` : `Only ${required - current} more spot left to lock in group discount!`)
                : ''}
            </p>
          </div>

          <!-- Avatar Circles Grid -->
          <div class="flex justify-center items-center gap-4 flex-wrap">
            ${Array.from({ length: required }).map((_, idx) => {
              const member = members[idx];
              const isFilled = Boolean(member);

              return `
                <div class="flex flex-col items-center gap-1.5">
                  <div class="w-16 h-16 rounded-full border-2 ${isFilled ? 'border-primary bg-primary/10 shadow-md' : 'border-dashed border-border bg-muted/5 flex items-center justify-center'} overflow-hidden relative flex items-center justify-center">
                    ${isFilled ? `
                      <span class="text-2xl">👤</span>
                    ` : `
                      <span class="text-muted text-xl font-bold">+</span>
                    `}
                    ${isFilled && idx === 0 ? `
                      <span class="absolute bottom-0 bg-primary text-white text-[9px] font-bold px-1.5 rounded-full uppercase">Host</span>
                    ` : ''}
                  </div>
                  <span class="text-xs font-semibold text-foreground truncate max-w-[80px]">
                    ${isFilled ? (member.user_name || `Member ${idx + 1}`) : (isBn ? 'খালি আসন' : 'Open Spot')}
                  </span>
                </div>
              `;
            }).join('')}
          </div>

          <!-- Actions -->
          ${t.status === 'ACTIVE' ? `
            <div class="pt-4 border-t border-border flex flex-col sm:flex-row items-center justify-center gap-3">
              <button id="btn-join-team" class="btn btn-primary font-bold btn-md w-full sm:w-auto shadow-md">
                ⚡ ${isBn ? `৳${t.group_price} মূল্যে টিমে যুক্ত হন` : `Join Team for ৳${t.group_price}`}
              </button>
              <button id="btn-copy-team-link" class="btn btn-outline text-xs w-full sm:w-auto">
                📋 ${isBn ? 'লিংক কপি করুন' : 'Copy Team Link'}
              </button>
              <a
                href="https://api.whatsapp.com/send?text=${encodeURIComponent((isBn ? `আমার সাথে এক্সপ্লুরো গ্রুপ বাইয়ে যোগ দিন (${current}/${required} জন যুক্ত): ` : `Join my team purchase on Explooro (${current}/${required} joined): `) + teamShareUrl)}"
                target="_blank"
                rel="noopener noreferrer"
                class="btn btn-success text-xs w-full sm:w-auto">
                💬 WhatsApp Share
              </a>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    this._attachEvents(teamShareUrl, isBn);
  }

  _renderMyTeamsList(isBn) {
    this.rootEl.innerHTML = `
      <div class="my-teams-container p-6 space-y-6 max-w-5xl mx-auto">
        <div class="border-b border-border pb-4">
          <h1 class="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <span>👥</span>
            <span>${isBn ? 'আমার গ্রুপ বাই ও টিম পারচেজ' : 'My Team Purchases'}</span>
          </h1>
          <p class="text-sm text-muted mt-1">
            ${isBn ? 'আপনার শুরু করা বা অংশগ্রহণ করা সকল টিম অর্ডারের তালিকা' : 'Track your active and completed social team purchases'}
          </p>
        </div>

        ${this.myTeams.length === 0 ? `
          <div class="card p-12 text-center text-muted bg-surface border border-border rounded-xl">
            <div class="text-4xl mb-2">🛍️</div>
            <p class="font-semibold">${isBn ? 'আপনি এখনো কোনো টিম পারচেজে যুক্ত হননি।' : 'No team purchases joined yet.'}</p>
          </div>
        ` : `
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            ${this.myTeams.map(t => `
              <div class="card p-5 bg-surface border border-border rounded-xl space-y-4 hover:border-primary/30 transition-all">
                <div class="flex justify-between items-start">
                  <div>
                    <span class="badge badge-${t.status === 'COMPLETED' ? 'success' : t.status === 'EXPIRED' ? 'danger' : 'accent'} text-xs font-bold">
                      ${t.status}
                    </span>
                    <h4 class="font-bold text-sm text-foreground mt-1">${isBn ? (t.product_name_bn || t.product_name_en) : t.product_name_en}</h4>
                  </div>
                  <span class="font-mono font-bold text-primary text-base">৳${Number(t.group_price).toFixed(2)}</span>
                </div>

                <div class="flex items-center justify-between text-xs text-muted font-mono border-t border-border pt-3">
                  <span>${t.current_members_count} / ${t.required_members} Members</span>
                  <a href="/team/${t.id}" class="btn btn-sm btn-primary text-xs font-semibold">
                    ${isBn ? 'বিস্তারিত দেখুন' : 'View Team'} →
                  </a>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    `;
  }

  _attachEvents(teamShareUrl, isBn) {
    const btnCopy = this.rootEl.querySelector('#btn-copy-team-link');
    if (btnCopy) {
      btnCopy.addEventListener('click', () => {
        navigator.clipboard.writeText(teamShareUrl);
        toast.success(isBn ? 'টিম লিংক কপি করা হয়েছে!' : 'Team link copied to clipboard!');
      });
    }

    const btnJoin = this.rootEl.querySelector('#btn-join-team');
    if (btnJoin) {
      btnJoin.addEventListener('click', () => {
        this._openJoinModal(isBn);
      });
    }
  }

  _openJoinModal(isBn) {
    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'modal-backdrop fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4';

    modalBackdrop.innerHTML = `
      <div class="modal-dialog bg-surface border border-border rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
        <div class="flex justify-between items-center border-b border-border pb-3">
          <h3 class="font-bold text-lg">${isBn ? 'টিমে যুক্ত হন' : 'Join Team Purchase'}</h3>
          <button type="button" class="btn-close text-muted hover:text-white font-bold text-xl">×</button>
        </div>

        <form id="form-join-team" class="space-y-4">
          <div>
            <label class="block text-xs font-semibold text-muted uppercase mb-1">
              ${isBn ? 'ডেলিভারি ঠিকানা' : 'Shipping Address'}
            </label>
            <input
              type="text"
              name="address"
              required
              placeholder="House 12, Road 4, Dhanmondi, Dhaka"
              class="input input-sm w-full" />
          </div>

          <div>
            <label class="block text-xs font-semibold text-muted uppercase mb-1">
              ${isBn ? 'পেমেন্ট পদ্ধতি' : 'Payment Method'}
            </label>
            <select name="payment_method" class="select select-sm w-full">
              <option value="COD">Cash on Delivery (Hold on Complete)</option>
              <option value="BKASH">bKash Authorization Hold</option>
              <option value="NAGAD">Nagad Authorization Hold</option>
              <option value="WALLET">Explooro Earner Vault</option>
            </select>
            <p class="text-[11px] text-muted mt-1">${isBn ? 'টিম পূর্ণ না হওয়া পর্যন্ত কোনো অর্থ কাটা হবে না।' : 'Funds are held only; auto-refunded 100% if team window closes.'}</p>
          </div>

          <div class="flex justify-end gap-2 pt-3 border-t border-border">
            <button type="button" class="btn btn-outline btn-sm btn-cancel">${isBn ? 'বাতিল' : 'Cancel'}</button>
            <button type="submit" class="btn btn-primary btn-sm font-bold">${isBn ? 'নিশ্চিত করুন' : 'Confirm Join'}</button>
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

    const form = modalBackdrop.querySelector('#form-join-team');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const address = formData.get('address');
      const paymentMethod = formData.get('payment_method');

      try {
        const res = await api.post(`/team-purchases/${this.team.id}/join`, {
          shipping_address: { street: address },
          payment_method: paymentMethod,
        });

        toast.success(
          res.completed
            ? (isBn ? 'অভিনন্দন! টিম পূর্ণ হয়েছে এবং অর্ডার সফল হয়েছে!' : 'Team goal reached! Order created!')
            : (isBn ? 'সফলভাবে টিমে যুক্ত হয়েছেন!' : 'Joined team successfully!')
        );
        closeModal();
        await this.fetchData();
        this.render();
      } catch (err) {
        toast.error(err.message || 'Failed to join team');
      }
    });
  }
}

// WHY: this page is written as a class, but the router page contract (core/router.js) is a
// plain function `(container, ctx) => cleanup?`. Calling a class without `new` throws, so the
// default export adapts the two — mount() is fire-and-forget async, unmount() is the cleanup.
export default function mountTeamPurchasePage(root, ctx = {}) {
  const page = new TeamPurchasePage(ctx.params);
  page.mount(root, ctx.params);
  return () => page.unmount();
}
