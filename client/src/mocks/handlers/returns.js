/**
 * returns.js — Mock API handlers for Returns & Reverse Logistics Queue (Prompt 7.2).
 */

let mockReturns = [
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
            returns: list,
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
          item.status = 'APPROVED';
          item.reverse_tracking_number = `REV-${Date.now().toString(36).toUpperCase()}`;
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
      }
      return {
        status: 200,
        body: {
          data: item,
        },
      };
    },
  },
];

export default returnHandlers;
