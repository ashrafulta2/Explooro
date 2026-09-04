/**
 * SalerOrdersPage.js — Saler Reseller Orders & Commission Dashboard (Prompt 11.2 / §AL.2).
 *
 * Route: /saler/orders
 * Implements:
 * 1. Reseller-specific orders dashboard with supplier fulfillment tracking & net commission calculations.
 * 2. Status filter tabs (All, Pending Packing, In Transit, Delivered, Cancelled).
 * 3. Search by Order Ref, Buyer Name, Phone, and Product Title.
 * 4. 1-Tap Buyer WhatsApp Messaging & Direct Phone Call shortcuts.
 * 5. Escrow clearance status indicator (Locked vs Settled in Vault).
 * 6. CSV Orders & Commission ledger export.
 */

import { salerApi } from '../../services/saler.api.js';
import { formatCurrency, formatDate } from '../../services/format.js';
import { t, getLanguage, subscribe as subscribeLang } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { Button } from '../../components/ui/Button.js';
import { Skeleton } from '../../components/ui/Skeleton.js';
import { EmptyState } from '../../components/ui/EmptyState.js';

export default function SalerOrdersPage(root, { navigate } = {}) {
  const nav = (url) => {
    if (typeof navigate === 'function') navigate(url);
    else {
      history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const container = document.createElement('div');
  container.className = 'saler-page-container';

  let orders = [];
  let summary = {};
  let currentTab = 'ALL';
  let searchQuery = '';
  let loading = true;
  let unsubscribeLang = null;

  async function loadData() {
    loading = true;
    render();
    try {
      const res = await salerApi.getOrders({
        status: currentTab !== 'ALL' ? currentTab : undefined,
        search: searchQuery || undefined,
      });
      orders = res?.data?.orders || [];
      summary = res?.data?.summary || {};
    } catch (err) {
      toast.error(err.message || 'Failed to load saler orders');
    } finally {
      loading = false;
      render();
    }
  }

  function render() {
    container.innerHTML = '';
    const isBn = getLanguage() === 'bn';

    // 1. Header
    const header = document.createElement('div');
    header.className = 'saler-header-row';
    header.innerHTML = `
      <div class="saler-header-row__titles">
        <div class="saler-header-row__breadcrumb">
          <a href="/saler" class="hover:text-primary">← ${t('saler.dashboard.title', 'Dashboard')}</a>
          <span>/</span>
          <span class="text-primary font-bold">${t('saler_orders.title')}</span>
        </div>
        <h1 class="saler-header-row__title">
          <span>🛒</span>
          <span>${t('saler_orders.title')}</span>
        </h1>
        <p class="saler-header-row__subtitle">
          ${t('saler_orders.subtitle')}
        </p>
      </div>
      <div class="saler-header-row__actions">
        <button id="btn-export-csv" class="btn btn--secondary btn--sm">
          ${t('saler_orders.btn_export_csv')}
        </button>
      </div>
    `;

    header.querySelector('#btn-export-csv').onclick = () => {
      exportCsv(orders);
    };

    container.append(header);

    // 2. KPI Summary Strip
    const kpiGrid = document.createElement('div');
    kpiGrid.className = 'saler-kpi-grid';
    kpiGrid.innerHTML = `
      <div class="saler-kpi-card">
        <div class="saler-kpi-card__header">
          <span>${t('saler_orders.kpi_total_orders')}</span>
          <span>📦</span>
        </div>
        <div class="saler-kpi-card__value">${summary.total_orders || orders.length}</div>
        <div class="saler-kpi-card__subtext">${isBn ? 'মোট অর্ডারের খতিয়ান' : 'Lifetime store orders'}</div>
      </div>
      <div class="saler-kpi-card">
        <div class="saler-kpi-card__header">
          <span>${t('saler_orders.kpi_pending_fulfillment')}</span>
          <span>⏳</span>
        </div>
        <div class="saler-kpi-card__value text-amber-600">${summary.pending_fulfillment || orders.filter(o => o.fulfillment_status === 'PROCESSING').length}</div>
        <div class="saler-kpi-card__subtext">${isBn ? 'সাপ্লায়ার প্যাকেজিং চলছে' : 'Supplier is packing'}</div>
      </div>
      <div class="saler-kpi-card">
        <div class="saler-kpi-card__header">
          <span>${t('saler_orders.kpi_in_transit')}</span>
          <span>🚚</span>
        </div>
        <div class="saler-kpi-card__value text-blue-600">${summary.in_transit_count || orders.filter(o => o.fulfillment_status === 'SHIPPED').length}</div>
        <div class="saler-kpi-card__subtext">${isBn ? 'কুরিয়ারে ডেলিভারির পথে' : 'Courier on the road'}</div>
      </div>
      <div class="saler-kpi-card">
        <div class="saler-kpi-card__header">
          <span>${t('saler_orders.kpi_total_commission')}</span>
          <span>💰</span>
        </div>
        <div class="saler-kpi-card__value saler-kpi-card__value--profit">
          +${formatCurrency(summary.total_commission_earned || orders.reduce((sum, o) => sum + o.saler_commission_earned, 0))}
        </div>
        <div class="saler-kpi-card__subtext">${isBn ? 'অর্জিত মোট নিট কমিশন' : 'Total reseller earnings'}</div>
      </div>
    `;
    container.append(kpiGrid);

    // 3. Toolbar & Status Filter Tabs
    const toolbar = document.createElement('div');
    toolbar.className = 'saler-toolbar';
    toolbar.innerHTML = `
      <div class="saler-toolbar__search">
        <span>🔍</span>
        <input
          type="text"
          id="order-search"
          class="input input--sm w-full"
          placeholder="${t('saler_orders.search_placeholder')}"
          value="${searchQuery}"
        />
      </div>
      <div class="saler-toolbar__filters">
        <div class="flex gap-1.5 flex-wrap">
          ${[
            ['ALL', t('saler_orders.tab_all')],
            ['PROCESSING', t('saler_orders.tab_pending')],
            ['SHIPPED', t('saler_orders.tab_in_transit')],
            ['DELIVERED', t('saler_orders.tab_delivered')],
          ].map(([val, label]) => `
            <button class="btn btn--xs ${currentTab === val ? 'btn--primary font-bold' : 'btn--neutral'} tab-btn" data-tab="${val}">
              ${label}
            </button>
          `).join('')}
        </div>
      </div>
    `;

    toolbar.querySelector('#order-search').oninput = (e) => {
      searchQuery = e.target.value;
      loadData();
    };

    toolbar.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.onclick = () => {
        currentTab = btn.getAttribute('data-tab');
        loadData();
      };
    });

    container.append(toolbar);

    // 4. Orders List Cards
    const listSlot = document.createElement('div');
    listSlot.className = 'saler-orders-list';

    if (loading) {
      listSlot.append(
        Skeleton({ width: '100%', height: '160px' }),
        Skeleton({ width: '100%', height: '160px' })
      );
    } else if (orders.length === 0) {
      const empty = EmptyState({
        icon: '🛒',
        title: t('saler_orders.empty_title'),
        description: t('saler_orders.empty_desc'),
      });
      listSlot.append(empty);
    } else {
      orders.forEach((ord) => {
        const card = document.createElement('div');
        card.className = 'saler-order-card';

        const statusBadge = ord.fulfillment_status === 'DELIVERED'
          ? '<span class="badge badge--success text-xs font-bold">✓ DELIVERED</span>'
          : ord.fulfillment_status === 'SHIPPED'
          ? '<span class="badge badge--primary text-xs font-bold">🚚 IN TRANSIT</span>'
          : '<span class="badge badge--warning text-xs font-bold">⏳ PROCESSING</span>';

        const escrowBadge = ord.escrow_status === 'RELEASED'
          ? `<span class="badge badge--success text-[10px]">${t('saler_orders.escrow_released')}</span>`
          : `<span class="badge badge--neutral text-[10px] font-mono">${t('saler_orders.escrow_locked')}</span>`;

        card.innerHTML = `
          <!-- Order Card Header -->
          <div class="saler-order-card__header">
            <div class="flex items-center gap-3">
              <span class="font-mono font-bold text-sm text-foreground">${ord.order_ref}</span>
              ${statusBadge}
              ${escrowBadge}
            </div>
            <div class="text-xs text-muted font-mono">
              📅 ${formatDate(ord.placed_at)}
            </div>
          </div>

          <!-- Buyer Details & Courier Box -->
          <div class="saler-order-card__buyer-info">
            <div>
              <div class="text-muted font-bold text-[10px] uppercase">${t('saler_orders.buyer_label')}</div>
              <div class="font-bold text-foreground">${ord.customer_name}</div>
              <div class="text-primary font-mono">${ord.customer_phone}</div>
            </div>
            <div>
              <div class="text-muted font-bold text-[10px] uppercase">${t('saler_orders.delivery_address')}</div>
              <div class="text-muted text-xs">${ord.shipping_address} (${ord.district})</div>
            </div>
            <div>
              <div class="text-muted font-bold text-[10px] uppercase">${t('saler_orders.courier_label')} & ${t('saler_orders.tracking_number')}</div>
              <div class="font-bold text-foreground">${ord.courier_name}</div>
              <div class="text-xs font-mono text-muted">${ord.tracking_number}</div>
            </div>
            <div>
              <div class="text-muted font-bold text-[10px] uppercase">${t('saler_orders.commission_earned')}</div>
              <div class="text-base font-black font-mono text-emerald-600">+${formatCurrency(ord.saler_commission_earned)}</div>
              <div class="text-[10px] text-muted">${t('saler_orders.retail_total')}: ${formatCurrency(ord.total_retail_amount)}</div>
            </div>
          </div>

          <!-- Order Items -->
          <div class="saler-order-card__items">
            ${(ord.items || []).map((item) => `
              <div class="saler-order-item-row">
                <div class="flex items-center gap-3">
                  <img src="${item.image_url || '/placeholder-product.png'}" alt="${item.title_en}" class="saler-order-item-thumb" />
                  <div>
                    <div class="font-bold text-sm text-foreground">${isBn ? (item.title_bn || item.title_en) : item.title_en}</div>
                    <div class="text-xs text-muted">Qty: ${item.qty} × Retail ৳${item.retail_price} (Wholesale Cost: ৳${item.wholesale_price})</div>
                  </div>
                </div>
                <div class="text-right">
                  <div class="font-mono text-sm font-bold text-emerald-600">+${formatCurrency(item.saler_profit)}</div>
                  <div class="text-[10px] text-muted uppercase">Saler Profit</div>
                </div>
              </div>
            `).join('')}
          </div>

          <!-- Card Actions Footer -->
          <div class="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-subtle">
            <div class="flex items-center gap-2">
              <a
                href="https://api.whatsapp.com/send?phone=${ord.customer_phone.replace(/[^0-9]/g, '')}&text=${encodeURIComponent(`Hello ${ord.customer_name}, thank you for ordering from our store (${ord.order_ref})!`)}"
                target="_blank"
                rel="noopener noreferrer"
                class="btn btn--xs bg-[#25D366] text-white hover:bg-[#1ebc59] font-bold flex items-center gap-1"
              >
                ${t('saler_orders.btn_contact_whatsapp')}
              </a>
              <a
                href="tel:${ord.customer_phone}"
                class="btn btn--neutral btn--xs font-semibold"
              >
                ${t('saler_orders.btn_call_customer')}
              </a>
            </div>
            <button class="btn-view-order btn btn--secondary btn--xs font-bold" data-id="${ord.id}">
              ${t('saler_orders.btn_view_details')}
            </button>
          </div>
        `;

        card.querySelector('.btn-view-order').onclick = () => {
          nav(`/saler/orders/${ord.id}`);
        };

        listSlot.append(card);
      });
    }

    container.append(listSlot);
  }

  function exportCsv(data) {
    if (!data.length) return;
    const rows = [
      ['Order Ref', 'Date', 'Customer Name', 'Phone', 'District', 'Payment Method', 'Status', 'Courier', 'Tracking No', 'Retail Total (BDT)', 'Wholesale Cost (BDT)', 'Saler Commission (BDT)'],
      ...data.map(o => [
        o.order_ref,
        o.placed_at,
        `"${o.customer_name}"`,
        `"${o.customer_phone}"`,
        o.district,
        o.payment_method,
        o.fulfillment_status,
        `"${o.courier_name}"`,
        o.tracking_number,
        o.total_retail_amount,
        o.total_wholesale_cost,
        o.saler_commission_earned
      ])
    ];
    const csvContent = 'data:text/csv;charset=utf-8,' + rows.map(e => e.join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `explooro-saler-orders-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Orders exported as CSV');
  }

  unsubscribeLang = subscribeLang(() => render());

  loadData();
  root.append(container);

  return () => {
    if (unsubscribeLang) unsubscribeLang();
    container.remove();
  };
}
