/**
 * supplier.api.ts — API client methods for Supplier / Manufacturer Dashboard & operations (Prompt 11.1).
 */

import { api } from '../core/api.ts';

/** A request body or query string; the fields are the server's, passed through untouched. */
type Params = Record<string, any>;

export const supplierApi = {
  getDashboardOverview() {
    return api.get('/supplier/dashboard');
  },

  getInventory(params: Params = {}) {
    return api.get('/supplier/inventory', { query: params });
  },

  updateStock(payload: Params) {
    const formatted = {
      productId: payload?.productId ?? payload?.product_id ?? payload?.id,
      stockQty: payload?.stockQty ?? payload?.stock_qty ?? payload?.quantity,
    };
    return api.post('/supplier/inventory/stock', formatted);
  },

  getBatches(params: Params = {}) {
    return api.get('/supplier/batches', { query: params });
  },

  createBatch(payload: Params) {
    const formatted = {
      batchNumber: payload?.batchNumber || payload?.batch_number,
      productId: payload?.productId || payload?.product_id || 1,
      qty: payload?.qty || payload?.quantity_available || payload?.quantity_initial || 100,
      mfgDate: payload?.mfgDate || payload?.mfg_date,
      expDate: payload?.expDate || payload?.expiry_date || payload?.exp_date,
      warehouseNodeId: payload?.warehouseNodeId || payload?.warehouse_id || payload?.warehouse_node_id || 1,
    };
    return api.post('/supplier/batches', formatted);
  },

  triggerClearanceSale(payloadOrId: number | string | Params, maybeDiscount?: number) {
    let batchId = payloadOrId;
    let discountPct = maybeDiscount ?? 15;
    if (typeof payloadOrId === 'object' && payloadOrId !== null) {
      batchId = payloadOrId.batchId || payloadOrId.id;
      discountPct = payloadOrId.discountPct ?? 15;
    }
    return api.post(`/supplier/batches/${batchId}/clearance`, { discountPct });
  },

  triggerBatchClearance(batchId: number | string, discountPct: number = 20) {
    return api.post(`/supplier/batches/${batchId}/clearance`, { discountPct });
  },

  recallBatch(payloadOrId: number | string | Params, maybeReason?: string) {
    let batchId = payloadOrId;
    let reason = maybeReason || 'Supplier Recall';
    if (typeof payloadOrId === 'object' && payloadOrId !== null) {
      batchId = payloadOrId.batchId || payloadOrId.id;
      reason = payloadOrId.reason || 'Supplier Recall';
    }
    return api.post(`/supplier/batches/${batchId}/recall`, { reason });
  },

  getWarehouses() {
    return api.get('/supplier/warehouses');
  },

  createWarehouse(payload: Params) {
    return api.post('/supplier/warehouses', payload);
  },

  getFulfilmentQueue() {
    return api.get('/supplier/fulfilment');
  },

  bookConsignment(payload: Params) {
    return api.post('/supplier/fulfilment/consign', payload);
  },

  getSalerInsights() {
    return api.get('/supplier/salers');
  },

  getScorecard() {
    return api.get('/supplier/scorecard');
  },

  getIncentive() {
    return api.get('/supplier/incentive');
  },

  saveIncentive(payload: Params) {
    return api.put('/supplier/incentive', payload);
  },

  getStoreStatus() {
    return api.get('/supplier/store-status');
  },

  updateStoreStatus(payload: Params) {
    return api.patch('/supplier/store-status', payload);
  },
};
