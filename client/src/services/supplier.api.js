/**
 * supplier.api.js — API client methods for Supplier / Manufacturer Dashboard & operations (Prompt 11.1).
 */

import { api } from '../core/api.js';

export const supplierApi = {
  getDashboardOverview() {
    return api.get('/supplier/dashboard');
  },

  getInventory(params = {}) {
    return api.get('/supplier/inventory', { query: params });
  },

  updateStock(payload) {
    return api.post('/supplier/inventory/stock', payload);
  },

  getBatches(params = {}) {
    return api.get('/supplier/batches', { query: params });
  },

  createBatch(payload) {
    return api.post('/supplier/batches', payload);
  },

  triggerBatchClearance(batchId, discountPct = 20) {
    return api.post(`/supplier/batches/${batchId}/clearance`, { discountPct });
  },

  recallBatch(batchId, reason) {
    return api.post(`/supplier/batches/${batchId}/recall`, { reason });
  },

  getWarehouses() {
    return api.get('/supplier/warehouses');
  },

  createWarehouse(payload) {
    return api.post('/supplier/warehouses', payload);
  },

  getFulfilmentQueue() {
    return api.get('/supplier/fulfilment');
  },

  bookConsignment(payload) {
    return api.post('/supplier/fulfilment/consign', payload);
  },

  getResellerInsights() {
    return api.get('/supplier/resellers');
  },

  getStoreStatus() {
    return api.get('/supplier/store-status');
  },

  updateStoreStatus(payload) {
    return api.patch('/supplier/store-status', payload);
  },
};
