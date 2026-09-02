/**
 * FulfilmentPage.js — Supplier 3PL Order Fulfilment Queue, Packing Slips & Consignments (Prompt 11.1).
 *
 * Implements `idea proposition.md` §AL.1:
 * - Fulfilment queue of pending orders awaiting packaging.
 * - 1-Click Courier Consignment booking (Steadfast, Pathao, RedX).
 * - Printable Packing Slips with FEFO lot/batch number directives.
 * - Printable Thermal Shipping Labels with courier barcodes.
 */

import { supplierApi } from '../../services/supplier.api.js';
import { isFeatureEnabled } from '../../services/featureFlags.js';
import { t } from '../../services/i18n.js';
import { formatCurrency } from '../../services/format.js';
import { toast } from '../../services/toast.js';
import { Badge } from '../../components/ui/Badge.js';
import { Button } from '../../components/ui/Button.js';
import { EmptyState } from '../../components/ui/EmptyState.js';

export default function FulfilmentPage(root) {
  const container = document.createElement('div');
  container.className = 'supplier-page-container';

  let orders = [];
  let loading = true;

  async function loadQueue() {
    loading = true;
    render();
    try {
      const res = await supplierApi.getFulfilmentQueue();
      orders = res.data || res || [];
    } catch (err) {
      console.error('Failed to load fulfilment queue:', err);
      toast.error(t('supplier.fulfilment_load_failed', 'Failed to load fulfilment queue.'));
      orders = [];
    } finally {
      loading = false;
      render();
    }
  }

  function render() {
    container.innerHTML = '';

    // 1. Header
    const header = document.createElement('header');
    header.className = 'supplier-header';
    header.innerHTML = `
      <div class="supplier-header__titles">
        <div class="supplier-header__badge-row">
          <a href="/supplier" class="text-xs font-bold text-muted hover:text-primary">← ${t('supplier.back_to_dashboard', 'Dashboard')}</a>
          <span class="text-muted">/</span>
          <span class="text-xs text-muted font-mono">Print Labels & 3PL</span>
        </div>
        <h1 class="supplier-header__title">
          <span>🖨️</span> ${t('supplier.fulfilment_title', 'Fulfilment & Packing Queue')}
        </h1>
        <p class="supplier-header__subtitle">
          ${t('supplier.fulfilment_subtitle', '1-Click courier consignments, FEFO batch-directed packing slips, and shipping label generation.')}
        </p>
      </div>
      <div class="supplier-header__actions">
        <button class="btn btn--sm btn--primary" id="print-all-btn" ${orders.length === 0 ? 'disabled' : ''}>
          📑 Batch Print All Labels
        </button>
        <button class="btn btn--sm btn--secondary" id="refresh-queue-btn">
          🔄 ${t('common.refresh', 'Refresh')}
        </button>
      </div>
    `;

    header.querySelector('#refresh-queue-btn').onclick = loadQueue;
    const printAllBtn = header.querySelector('#print-all-btn');
    if (printAllBtn) {
      printAllBtn.onclick = () => window.print();
    }
    container.appendChild(header);

    // 2. Summary KPI Strip
    const bookedCount = orders.filter((o) => Boolean(o.tracking_number)).length;
    const unbookedCount = orders.filter((o) => !o.tracking_number).length;

    const summaryStrip = document.createElement('div');
    summaryStrip.className = 'supplier-kpi-grid';
    summaryStrip.innerHTML = `
      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">Pending Consignments</span>
        <div class="supplier-kpi-card__value text-warning" style="font-size: 1.5rem; margin: 4px 0;">${unbookedCount}</div>
        <span class="text-xs text-muted">Awaiting 1-click 3PL booking</span>
      </div>

      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">Ready to Print</span>
        <div class="supplier-kpi-card__value text-primary" style="font-size: 1.5rem; margin: 4px 0;">${bookedCount}</div>
        <span class="text-xs text-muted">Thermal label & barcode generated</span>
      </div>

      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">Dhaka Delivery</span>
        <div class="supplier-kpi-card__value" style="font-size: 1.5rem; margin: 4px 0;">Pathao Express</div>
        <span class="text-xs text-muted">Same-day pickup cutoff: 4:00 PM</span>
      </div>

      <div class="supplier-kpi-card" style="padding: 16px;">
        <span class="supplier-kpi-card__label">Nationwide Delivery</span>
        <div class="supplier-kpi-card__value" style="font-size: 1.5rem; margin: 4px 0;">Steadfast 3PL</div>
        <span class="text-xs text-muted">64 districts door-to-door</span>
      </div>
    `;
    container.appendChild(summaryStrip);

    // 3. Queue list or Empty State
    if (loading) {
      const loader = document.createElement('div');
      loader.className = 'p-12 text-center text-muted';
      loader.innerHTML = `
        <div class="spinner" style="margin: 0 auto 16px auto;"></div>
        <p>${t('common.loading', 'Loading packing queue...')}</p>
      `;
      container.appendChild(loader);
      return;
    }

    if (orders.length === 0) {
      container.appendChild(
        EmptyState({
          icon: '✨',
          title: t('supplier.all_orders_fulfilled', 'All caught up! No pending orders to pack.'),
          description: t('supplier.all_orders_fulfilled_desc', 'New customer and wholesale orders will appear here automatically when placed.'),
        })
      );
      return;
    }

    const orderList = document.createElement('div');
    orderList.style.display = 'flex';
    orderList.style.flexDirection = 'column';
    orderList.style.gap = 'var(--space-4, 16px)';

    orders.forEach((order) => {
      const items = Array.isArray(order.items) ? order.items : [];
      const hasConsignment = Boolean(order.tracking_number);

      const card = document.createElement('div');
      card.className = 'supplier-order-card';

      card.innerHTML = `
        <div class="supplier-order-card__header">
          <div class="supplier-order-card__ref-group">
            <span class="supplier-order-card__ref">${order.ref}</span>
            <span class="badge ${order.status === 'PROCESSING' ? 'badge--info' : 'badge--warning'} text-xs uppercase font-mono">
              ${order.status}
            </span>
            ${order.payment_method === 'COD' ? `
              <span class="badge badge--neutral text-xs font-bold">💵 COD Collect: ${formatCurrency(order.total_amount)}</span>
            ` : `
              <span class="badge badge--success text-xs font-bold">💳 Prepaid</span>
            `}
          </div>

          <div class="supplier-order-card__meta">
            <span>Recipient: <strong>${order.recipient_name}</strong></span> (${order.recipient_phone}) · 📍 <strong>${order.district}</strong>
          </div>
        </div>

        <!-- Packing Slip Items with FEFO Lot Directives -->
        <div class="supplier-order-card__items-box">
          <div style="display: flex; align-items: center; justify-content: space-between; font-size: var(--text-xs); font-weight: 700;">
            <span>📦 ${t('supplier.packing_slip_items', 'Items to Pack (FEFO Directives)')}</span>
            <span class="text-muted font-mono">Node: ${order.warehouse_name || 'Central Depot'}</span>
          </div>

          <div style="margin-top: 6px;">
            ${items.map((item) => `
              <div class="supplier-order-card__item-row">
                <div>
                  <span style="font-weight: 700; color: var(--text-primary);">${item.title_snapshot || 'Product Item'}</span>
                  ${item.batch_number ? `
                    <span class="badge badge--info text-xs font-mono" style="margin-left: 8px;">
                      🏷️ Lot: #${item.batch_number} (Exp: ${item.batch_exp_date ? item.batch_exp_date.slice(0, 10) : 'N/A'})
                    </span>
                  ` : '<span class="text-xs text-muted" style="margin-left: 8px;">(Standard SKU)</span>'}
                </div>
                <div style="font-family: var(--font-mono); font-weight: 800; color: var(--text-brand);">
                  Qty: ${item.qty}
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Consignment Actions -->
        <div class="supplier-order-card__footer">
          <div>
            ${hasConsignment ? `
              <div style="font-size: var(--text-xs);">
                <span class="text-muted">${t('supplier.carrier', 'Courier')}:</span> <strong>${order.carrier}</strong> ·
                <span class="text-muted">${t('supplier.tracking', 'Tracking')}:</span> <span class="supplier-order-card__ref" style="font-size: 11px;">${order.tracking_number}</span>
              </div>
            ` : `
              <div style="font-size: var(--text-xs); color: var(--warning); font-weight: 700; display: flex; align-items: center; gap: 4px;">
                <span>⚠️</span> ${t('supplier.consignment_not_booked', 'Courier consignment not yet booked.')}
              </div>
            `}
          </div>

          <div style="display: flex; align-items: center; gap: var(--space-2, 8px);">
            <button class="btn btn--xs btn--outline print-slip-btn">
              📄 ${t('supplier.print_packing_slip', 'Print Packing Slip')}
            </button>
            <button class="btn btn--xs btn--secondary print-label-btn" ${!hasConsignment ? 'disabled title="Book consignment first"' : ''}>
              🏷️ ${t('supplier.print_shipping_label', 'Print Label')}
            </button>
            ${!hasConsignment ? `
              <button class="btn btn--xs btn--primary consign-btn" data-id="${order.id}">
                🚚 1-Click Book (${order.district === 'Dhaka' ? 'Pathao' : 'Steadfast'})
              </button>
            ` : `
              <span class="badge badge--success text-xs font-bold">✅ Consignment Manifested</span>
            `}
          </div>
        </div>
      `;

      // 1-Click Consignment
      const consignBtn = card.querySelector('.consign-btn');
      if (consignBtn) {
        consignBtn.onclick = async () => {
          const carrier = order.district === 'Dhaka' ? 'PATHAO' : 'STEADFAST';
          try {
            const res = await supplierApi.bookConsignment({ subOrderId: order.id, carrier });
            toast.success(res.data?.message || t('supplier.consignment_booked_success', 'Consignment booked successfully.'));
            loadQueue();
          } catch (err) {
            toast.error(t('supplier.consignment_failed', 'Failed to book courier consignment.'));
          }
        };
      }

      // Print Packing Slip Dialog
      card.querySelector('.print-slip-btn').onclick = () => {
        openPrintSlipModal(order);
      };

      // Print Label Dialog
      const printLabelBtn = card.querySelector('.print-label-btn');
      if (printLabelBtn) {
        printLabelBtn.onclick = () => {
          openPrintLabelModal(order);
        };
      }

      orderList.appendChild(card);
    });

    container.appendChild(orderList);
  }

  function openPrintSlipModal(order) {
    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'supplier-modal-scrim';
    modalBackdrop.innerHTML = `
      <div class="supplier-modal" style="max-width: 600px;">
        <div class="supplier-modal__header">
          <h3 class="supplier-modal__title">📄 EXPLOORO PACKING DIRECTIVE</h3>
          <button class="supplier-modal__close close-modal-btn">&times;</button>
        </div>

        <div style="display: flex; flex-direction: column; gap: var(--space-3, 12px); font-family: var(--font-mono); font-size: var(--text-xs);">
          <div style="background: var(--surface-1); padding: 10px 14px; border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
            <div><strong>Order Ref:</strong> ${order.ref}</div>
            <div><strong>Depot Node:</strong> ${order.warehouse_name || 'Central Depot'}</div>
            <div><strong>Recipient:</strong> ${order.recipient_name} | ${order.recipient_phone}</div>
            <div><strong>Address:</strong> ${order.address_line || 'Address'}, ${order.district}</div>
          </div>

          <table class="supplier-table" style="font-size: 12px; margin-top: 6px;">
            <thead>
              <tr>
                <th>Item</th>
                <th>Lot / Batch</th>
                <th style="text-align: right;">Qty</th>
              </tr>
            </thead>
            <tbody>
              ${(order.items || []).map((i) => `
                <tr>
                  <td><strong>${i.title_snapshot}</strong></td>
                  <td class="font-mono font-bold">${i.batch_number ? '#' + i.batch_number : 'Standard'}</td>
                  <td style="text-align: right; font-weight: 800; color: var(--text-brand);">${i.qty}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div style="font-size: 11px; color: var(--text-secondary); padding: 8px 12px; background: rgba(59, 130, 246, 0.08); border-radius: var(--radius-md); border-left: 3px solid var(--info);">
            * <strong>FEFO Priority Rule:</strong> Strictly dispatch from indicated lot numbers to prevent shelf expiration.
          </div>
        </div>

        <div class="supplier-modal__footer">
          <button class="btn btn--sm btn--secondary close-modal-btn">${t('common.close', 'Close')}</button>
          <button class="btn btn--sm btn--primary" onclick="window.print()">
            🖨️ ${t('supplier.print_packing_slip', 'Print Slip')}
          </button>
        </div>
      </div>
    `;

    const close = () => modalBackdrop.remove();
    modalBackdrop.querySelectorAll('.close-modal-btn').forEach((b) => (b.onclick = close));
    document.body.appendChild(modalBackdrop);
  }

  function openPrintLabelModal(order) {
    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'supplier-modal-scrim';
    modalBackdrop.innerHTML = `
      <div class="supplier-modal" style="max-width: 420px;">
        <div class="supplier-modal__header">
          <h3 class="supplier-modal__title">🏷️ Thermal Shipping Label (4x6)</h3>
          <button class="supplier-modal__close close-modal-btn">&times;</button>
        </div>

        <div class="thermal-shipping-label">
          <div class="thermal-shipping-label__carrier-row">
            <span style="font-weight: 800; font-size: 14px;">EXPLOORO 3PL EXPRESS</span>
            <span style="font-weight: 800; text-transform: uppercase;">${order.carrier || 'STEADFAST'}</span>
          </div>

          <div class="thermal-shipping-label__barcode-box">
            <div style="font-size: 10px; text-transform: uppercase; color: #444;">TRACKING BARCODE</div>
            <div style="font-size: 18px; font-weight: 800; letter-spacing: 2px; margin: 4px 0;">
              ${order.tracking_number}
            </div>
            <div class="thermal-shipping-label__barcode">||| | |||| || ||||| |||</div>
          </div>

          <div class="thermal-shipping-label__address-box">
            <div><strong>DELIVER TO:</strong> ${order.recipient_name}</div>
            <div><strong>PHONE:</strong> ${order.recipient_phone}</div>
            <div><strong>ADDRESS:</strong> ${order.address_line || 'Address'}, ${order.district}</div>
          </div>

          <div class="thermal-shipping-label__cod-banner">
            ${order.payment_method === 'COD' ? `COD COLLECT: ${formatCurrency(order.total_amount)}` : 'PREPAID — DO NOT COLLECT CASH'}
          </div>

          <div style="font-size: 9px; color: #555; text-align: center;">
            Order Ref: ${order.ref} · Fast-Tracked 3PL Handover
          </div>
        </div>

        <div class="supplier-modal__footer">
          <button class="btn btn--sm btn--secondary close-modal-btn">${t('common.close', 'Close')}</button>
          <button class="btn btn--sm btn--primary" onclick="window.print()">
            🖨️ ${t('supplier.print_shipping_label', 'Print Label')}
          </button>
        </div>
      </div>
    `;

    const close = () => modalBackdrop.remove();
    modalBackdrop.querySelectorAll('.close-modal-btn').forEach((b) => (b.onclick = close));
    document.body.appendChild(modalBackdrop);
  }

  loadQueue();
  root.appendChild(container);

  return () => {
    container.remove();
  };
}
