/**
 * returns.ts — Mock API handlers for Returns & Reverse Logistics Queue (Prompt 7.2).
 */

import type { MockRoute } from '../types.ts';
import { mockSendBackAddress, mockReturnShippingPolicy, mockOperationsModes } from './operations.ts';

/** As server/src/services/returnShipping.service.ts withShippingTerms: who pays to send it back. */
function withTerms(r) {
  const policy = mockReturnShippingPolicy();
  const decided = r.return_shipping_paid_by === 'SUPPLIER' || r.return_shipping_paid_by === 'CUSTOMER';
  return {
    ...r,
    return_shipping: {
      paid_by: decided ? r.return_shipping_paid_by : (policy.supplier_fault_reasons.includes(r.reason_code) ? 'SUPPLIER' : 'CUSTOMER'),
      decided,
      max_courier_refund: policy.max_courier_refund,
      pickup_fee: policy.pickup_fee,
      settlement: r.shipping_settlement_json ?? null,
    },
  };
}

/** A short mirror of planSettlement for the mock refund (the server's is the one that counts). */
function mockSettle(r) {
  const policy = mockReturnShippingPolicy();
  const paidBy = withTerms(r).return_shipping.paid_by;
  const hand = r.reverse_carrier === 'MANUAL';
  const moves = [];
  if (paidBy === 'SUPPLIER') {
    const cost = Math.min(Number(r.customer_courier_cost) || 0, policy.max_courier_refund);
    if (hand && cost > 0) moves.push({ kind: 'COURIER_RECEIPT_REPAID', from: 'SUPPLIER', to: 'CUSTOMER', amount: cost.toFixed(2) });
    if (!hand && policy.pickup_fee > 0) moves.push({ kind: 'PICKUP_FEE', from: 'SUPPLIER', to: 'PLATFORM', amount: policy.pickup_fee.toFixed(2) });
  } else {
    moves.push({ kind: 'DELIVERY_CHARGE_KEPT', from: 'CUSTOMER', to: 'SUPPLIER', amount: '60.00' });
    if (!hand && policy.pickup_fee > 0) moves.push({ kind: 'PICKUP_FEE', from: 'CUSTOMER', to: 'PLATFORM', amount: policy.pickup_fee.toFixed(2) });
  }
  const net = moves.reduce((s, m) => s + (m.to === 'CUSTOMER' ? +m.amount : 0) - (m.from === 'CUSTOMER' ? +m.amount : 0), 0);
  return { paid_by: paidBy, mode: hand ? 'HAND' : 'COURIER', moves, customer_net: net.toFixed(2) };
}

let mockReturns: Record<string, any>[] = [
  // Approved with couriers manual: the customer sends it back to the returns address (migration 105).
  {
    id: 4,
    ref: 'RET-2026-0044',
    sub_order_id: 1051,
    sub_order_ref: 'SO-1051-A',
    status: 'PICKUP_SCHEDULED',
    reason_code: 'WRONG_ITEM',
    customer_id: 2,
    customer_name: 'Tanvir Hossain',
    customer_phone: '+880 1711-223344',
    customer_trust_score: 92,
    customer_note: 'Received a blue shirt instead of the black one I ordered.',
    refund_amount: 1450,
    reverse_tracking_number: null,
    reverse_carrier: 'MANUAL',
    evidence_urls_json: [],
    created_at: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
  },
  {
    id: 1,
    ref: 'RET-2026-0041',
    sub_order_id: 1044,
    sub_order_ref: 'SO-1044-A',
    status: 'REQUESTED',
    reason_code: 'DEFECTIVE',
    customer_id: 2,
    customer_name: 'Tanvir Hossain',
    customer_phone: '+880 1711-223344',
    customer_trust_score: 92,
    customer_note: 'Charging port loose out of the box and device shuts off randomly.',
    refund_amount: 3200,
    reverse_tracking_number: 'STD-RET-88912',
    reverse_carrier: 'Steadfast Reverse',
    evidence_urls_json: [
      'https://images.unsplash.com/photo-1598327105666-5b89351aff97?w=600',
    ],
    created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
  },
  {
    id: 2,
    ref: 'RET-2026-0038',
    sub_order_id: 1029,
    sub_order_ref: 'SO-1029-C',
    status: 'RECEIVED',
    reason_code: 'SIZE_MISMATCH',
    customer_id: 8,
    customer_name: 'Mahmuda Akter',
    customer_phone: '+880 1812-998877',
    customer_trust_score: 85,
    customer_note: 'Ordered XL size Panjabi but received M.',
    refund_amount: 1650,
    reverse_tracking_number: 'PTH-REV-44120',
    reverse_carrier: 'Pathao Courier',
    evidence_urls_json: [
      'https://images.unsplash.com/photo-1617137984095-74e4e5e3613f?w=600',
    ],
    created_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
  },
  {
    id: 3,
    ref: 'RET-2026-0029',
    sub_order_id: 1012,
    sub_order_ref: 'SO-1012-B',
    status: 'INSPECTED',
    reason_code: 'DAMAGED',
    customer_id: 14,
    customer_name: 'Rafiqul Islam',
    customer_phone: '+880 1913-556677',
    customer_trust_score: 95,
    customer_note: 'Clay pot cracked during transit.',
    refund_amount: 850,
    reverse_tracking_number: 'REDX-REV-1092',
    reverse_carrier: 'RedX Express',
    evidence_urls_json: [],
    created_at: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
  },
];

export const returnHandlers = [
  {
    method: 'GET',
    path: '/returns/my-returns',
    handler({ query }) {
      const status = query?.status;
      let list = [...mockReturns];
      if (status && status !== 'ALL') {
        list = list.filter((r) => r.status === status);
      }
      // As the server's withSendBackAddress: only an approved return the customer sends themselves.
      const sendBack = mockSendBackAddress();
      list = list.map((r) => withTerms(r.status === 'PICKUP_SCHEDULED' && r.reverse_carrier === 'MANUAL' ? { ...r, send_back: sendBack } : r));
      return {
        status: 200,
        body: {
          data: {
            returns: list,
            total: list.length,
          },
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/returns/shipping-terms',
    handler() {
      const { supplier_fault_reasons, max_courier_refund, pickup_fee } = mockReturnShippingPolicy();
      return { status: 200, body: { data: { supplier_fault_reasons, max_courier_refund, pickup_fee } } };
    },
  },
  {
    method: 'POST',
    path: '/returns/request',
    handler({ body }) {
      const newReturn = {
        id: mockReturns.length + 1,
        ref: `RET-2026-00${mockReturns.length + 42}`,
        ...body,
        status: 'REQUESTED',
        created_at: new Date().toISOString()
      };
      mockReturns.unshift(newReturn);
      return { status: 200, body: { data: newReturn } };
    },
  },
  {
    method: 'GET',
    path: '/admin/returns/queue',
    handler({ query }) {
      const status = query?.status;
      let list = [...mockReturns];
      if (status && status !== 'ALL') {
        list = list.filter((r) => r.status === status);
      }
      return {
        status: 200,
        body: {
          data: {
            returns: list.map(withTerms),
            total: list.length,
          },
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/admin/returns/:id/review',
    handler({ params, body }) {
      const item = mockReturns.find((r) => r.id === Number(params.id));
      if (item) {
        if (body?.action === 'APPROVE') {
          // As return.service: approval schedules the pickup, by hand while couriers are manual.
          const manual = mockOperationsModes().courier_mode === 'MANUAL';
          item.status = 'PICKUP_SCHEDULED';
          item.reverse_carrier = manual ? 'MANUAL' : 'MOCK';
          item.reverse_tracking_number = manual ? null : `TRK-MOCK-${Date.now().toString(36).toUpperCase()}`;
          item.return_shipping_paid_by = body?.return_shipping_paid_by || withTerms(item).return_shipping.paid_by;
        } else {
          item.status = 'REJECTED';
          item.rejection_reason = body?.rejection_reason || 'Rejected by moderator';
        }
      }
      return {
        status: 200,
        body: {
          data: item,
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/admin/returns/:id/inspect',
    handler({ params, body }) {
      const item = mockReturns.find((r) => r.id === Number(params.id));
      if (item) {
        item.status = body?.condition_pass ? 'INSPECTED' : 'DISPUTED';
        item.inspection_notes = body?.inspection_notes || '';
        if (body?.customer_courier_cost != null) item.customer_courier_cost = Number(body.customer_courier_cost).toFixed(2);
      }
      return {
        status: 200,
        body: {
          data: item,
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/admin/returns/:id/refund',
    handler({ params }) {
      const item = mockReturns.find((r) => r.id === Number(params.id));
      if (item) {
        item.status = 'REFUNDED';
        item.refunded_at = new Date().toISOString();
        item.shipping_settlement_json = mockSettle(item);
        item.return_shipping_paid_by = item.shipping_settlement_json.paid_by;
      }
      return {
        status: 200,
        body: {
          data: item,
        },
      };
    },
  },
] satisfies MockRoute[];

export default returnHandlers;
