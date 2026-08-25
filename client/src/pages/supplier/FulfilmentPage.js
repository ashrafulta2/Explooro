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
  container.className = 'supplier-fulfilment-page container py-6 space-y-6';

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
    header.className = 'page-header flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-subtle';
    header.innerHTML = `
      <div>
        <div class="flex items-center gap-2">
          <a href="/supplier" class="text-xs text-muted hover:text-primary">← ${t('supplier.back_to_dashboard', 'Dashboard')}</a>
        </div>
        <h1 class="text-2xl font-bold flex items-center gap-2 mt-1">
          <span>🚚</span> ${t('supplier.fulfilment_title', 'Fulfilment & Packing Queue')}
        </h1>
        <p class="text-sm text-muted mt-1">
          ${t('supplier.fulfilment_subtitle', '1-Click courier consignments, FEFO batch-directed packing slips, and shipping label generation.')}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button class="btn btn--sm btn--secondary" id="refresh-queue-btn">
          🔄 ${t('common.refresh', 'Refresh')}
        </button>
      </div>
    `;

    header.querySelector('#refresh-queue-btn').onclick = loadQueue;
    container.appendChild(header);

    // 2. Queue list or Empty State
    if (loading) {
      const loader = document.createElement('div');
      loader.className = 'p-12 text-center text-muted';
      loader.innerHTML = `<div class="animate-spin inline-block w-8 h-8 border-4 border-primary border-t-transparent rounded-full mb-3"></div><p>${t('common.loading', 'Loading packing queue...')}</p>`;
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
    orderList.className = 'space-y-4';

    orders.forEach((order) => {
      const items = Array.isArray(order.items) ? order.items : [];
      const hasConsignment = Boolean(order.tracking_number);

      const card = document.createElement('div');
      card.className = 'order-fulfil-card p-5 rounded-2xl border border-subtle bg-surface shadow-sm space-y-4';

      card.innerHTML = `
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-subtle pb-3">
          <div class="flex items-center gap-3">
            <span class="font-mono text-sm font-bold text-primary bg-primary/10 px-2.5 py-1 rounded">
              ${order.ref}
            </span>
            <span class="badge ${order.status === 'PROCESSING' ? 'badge--info' : 'badge--warning'} text-xs uppercase">
              ${order.status}
            </span>
            ${order.payment_method === 'COD' ? '<span class="badge badge--neutral text-xs">Cash on Delivery</span>' : '<span class="badge badge--success text-xs">Prepaid</span>'}
          </div>

          <div class="text-xs text-muted">
            <span>Recipient:</span> <strong>${order.recipient_name}</strong> (${order.recipient_phone}) · 📍 ${order.district}
          </div>
        </div>

        <!-- Packing Slip Items with FEFO Lot Directives -->
        <div class="bg-surface-2 p-3.5 rounded-xl border border-subtle">
          <div class="text-xs font-bold text-foreground mb-2 flex items-center justify-between">
            <span>📦 ${t('supplier.packing_slip_items', 'Items to Pack (FEFO Directives)')}</span>
            <span class="text-2xs text-muted">Node: ${order.warehouse_name || 'Central Depot'}</span>
          </div>

          <div class="space-y-2">
            ${items.map((item) => `
              <div class="flex items-center justify-between text-xs py-1 border-b border-subtle/50 last:border-0">
                <div>
                  <span class="font-semibold text-foreground">${item.title_snapshot || 'Product Item'}</span>
                  ${item.batch_number ? `
                    <span class="badge badge--info text-2xs font-mono ml-2">
                      🏷️ Lot: #${item.batch_number} (Exp: ${item.batch_exp_date ? item.batch_exp_date.slice(0, 10) : 'N/A'})
                    </span>
                  ` : '<span class="text-2xs text-muted ml-2">(Standard SKU)</span>'}
                </div>
                <div class="font-mono font-bold text-primary">Qty: ${item.qty}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Consignment Actions -->
        <div class="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div>
            ${hasConsignment ? `
              <div class="text-xs">
                <span class="text-muted">${t('supplier.carrier', 'Courier')}:</span> <strong>${order.carrier}</strong> ·
                <span class="text-muted">${t('supplier.tracking', 'Tracking')}:</span> <span class="font-mono text-primary font-bold">${order.tracking_number}</span>
              </div>
            ` : `
              <div class="text-xs text-amber-600 font-semibold flex items-center gap-1">
                <span>⚠️</span> ${t('supplier.consignment_not_booked', 'Courier consignment not yet booked.')}
              </div>
            `}
          </div>

          <div class="flex items-center gap-2">
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
              <span class="badge badge--success text-xs">✅ Consignment Manifested</span>
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
    modalBackdrop.className = 'modal-backdrop fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4';
    modalBackdrop.innerHTML = `
      <div class="modal-box bg-white text-black p-6 rounded-2xl max-w-lg w-full shadow-2xl space-y-4 print:p-0">
        <div class="flex items-center justify-between border-b border-gray-200 pb-3">
          <div class="font-bold text-lg">EXPLOORO PACKING DIRECTIVE</div>
          <button class="text-gray-500 hover:text-black text-xl close-modal-btn">&times;</button>
        </div>

        <div class="text-xs space-y-1 font-mono">
          <div><strong>Order Ref:</strong> ${order.ref}</div>
          <div><strong>Depot Node:</strong> ${order.warehouse_name || 'Central Depot'}</div>
          <div><strong>Recipient:</strong> ${order.recipient_name} | ${order.recipient_phone}</div>
          <div><strong>Address:</strong> ${order.address_line}, ${order.district}</div>
        </div>

        <table class="w-full text-xs text-left border border-gray-300">
          <thead class="bg-gray-100">
            <tr>
              <th class="p-2 border">Item</th>
              <th class="p-2 border">Lot / Batch</th>
              <th class="p-2 border">Qty</th>
            </tr>
          </thead>
          <tbody>
            ${(order.items || []).map((i) => `
              <tr>
                <td class="p-2 border">${i.title_snapshot}</td>
                <td class="p-2 border font-mono font-bold">${i.batch_number ? '#' + i.batch_number : 'Standard'}</td>
                <td class="p-2 border font-bold">${i.qty}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="text-2xs text-gray-500 font-mono">
          * FEFO Priority Rule: Strictly dispatch from indicated lot numbers to prevent shelf expiration.
        </div>

        <div class="flex justify-end gap-2 pt-3 border-t">
          <button class="btn btn--sm btn--secondary close-modal-btn">Close</button>
          <button class="btn btn--sm btn--primary" onclick="window.print()">🖨️ Print Slip</button>
        </div>
      </div>
    `;

    const close = () => modalBackdrop.remove();
    modalBackdrop.querySelectorAll('.close-modal-btn').forEach((b) => (b.onclick = close));
    document.body.appendChild(modalBackdrop);
  }

  function openPrintLabelModal(order) {
    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'modal-backdrop fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4';
    modalBackdrop.innerHTML = `
      <div class="modal-box bg-white text-black p-6 rounded-2xl max-w-sm w-full shadow-2xl space-y-4 border-2 border-black">
        <div class="flex justify-between items-center border-b-2 border-black pb-2">
          <span class="font-bold text-base">EXPLOORO 3PL EXPRESS</span>
          <button class="text-gray-500 hover:text-black text-xl close-modal-btn">&times;</button>
        </div>

        <div class="text-center py-2 border-b border-dashed border-gray-400">
          <div class="text-xs text-gray-600 uppercase font-mono">${order.carrier || 'STEADFAST'} LOGISTICS</div>
          <div class="font-mono text-xl font-bold tracking-widest my-1">${order.tracking_number}</div>
          <div class="text-3xl font-mono tracking-tighter">||| | |||| || ||||| |||</div>
        </div>

        <div class="text-xs space-y-1">
          <div><strong>Deliver To:</strong> ${order.recipient_name}</div>
          <div><strong>Phone:</strong> ${order.recipient_phone}</div>
          <div><strong>Address:</strong> ${order.address_line}, ${order.district}</div>
          <div class="pt-2 font-bold text-sm">
            ${order.payment_method === 'COD' ? `COD COLLECT: ${formatCurrency(order.total_amount)}` : 'PREPAID — DO NOT COLLECT CASH'}
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-3 border-t">
          <button class="btn btn--sm btn--secondary close-modal-btn">Close</button>
          <button class="btn btn--sm btn--primary" onclick="window.print()">🖨️ Print Label</button>
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
