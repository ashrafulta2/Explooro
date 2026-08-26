/**
 * disputes.js — Mock API handlers for Dispute Resolution & Arbitration (Prompt 7.3).
 */

let mockDisputes = [
  {
    id: 1,
    ref: 'DSP-2026-0891',
    sub_order_id: 1044,
    sub_order_ref: 'SO-1044-A',
    disputed_amount: 3200,
    reason: 'DAMAGED_IN_TRANSIT',
    status: 'UNDER_REVIEW',
    customer_id: 2,
    customer_name: 'Tanvir Hossain',
    saler_id: 3,
    saler_name: 'Dhaka Trendz Reseller',
    supplier_id: 4,
    supplier_name: 'Walton Electronics Ltd',
    sla_expires_at: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
    messages: [
      {
        id: 101,
        sender_id: 2,
        sender_name: 'Tanvir Hossain',
        sender_role: 'CUSTOMER',
        body: 'The smartphone package arrived with a cracked screen corner. The courier box was crushed.',
        is_internal_note: false,
        created_at: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
      },
      {
        id: 102,
        sender_id: 4,
        sender_name: 'Walton Electronics Ltd',
        sender_role: 'SUPPLIER',
        body: 'Our warehouse security CCTV shows the item was packaged in double bubble-wrap prior to Pathao courier handover.',
        is_internal_note: false,
        created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      },
      {
        id: 103,
        sender_id: 1,
        sender_name: 'Moderator Staff',
        sender_role: 'MODERATOR',
        body: 'Internal Check: Courier transit insurance claim can cover 50% split. Recommend replacement for buyer.',
        is_internal_note: true,
        created_at: new Date(Date.now() - 1 * 3600 * 1000).toISOString(),
      },
    ],
  },
  {
    id: 2,
    ref: 'DSP-2026-0872',
    sub_order_id: 1021,
    sub_order_ref: 'SO-1021-B',
    disputed_amount: 1850,
    reason: 'WRONG_ITEM_DELIVERED',
    status: 'OPEN',
    customer_id: 5,
    customer_name: 'Nusrat Jahan',
    saler_id: 6,
    saler_name: 'Ananya Boutique',
    supplier_id: 7,
    supplier_name: 'Tangail Weavers Hub',
    sla_expires_at: new Date(Date.now() + 180 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
    messages: [
      {
        id: 201,
        sender_id: 5,
        sender_name: 'Nusrat Jahan',
        sender_role: 'CUSTOMER',
        body: 'Ordered Blue Jamdani but received Red silk saree.',
        is_internal_note: false,
        created_at: new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
      },
    ],
  },
];

export const disputeHandlers = [
  {
    method: 'GET',
    path: '/disputes',
    handler({ query }) {
      const status = query?.status;
      let list = [...mockDisputes];
      if (status && status !== 'ALL') {
        list = list.filter((d) => d.status === status);
      }
      return {
        status: 200,
        body: {
          data: {
            disputes: list,
            total: list.length,
          },
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/disputes/precedents',
    handler() {
      return {
        status: 200,
        body: {
          data: {
            precedents: [
              {
                id: 91,
                ref: 'DSP-2026-0512',
                reason: 'DAMAGED_IN_TRANSIT',
                outcome: 'SPLIT_LIABILITY',
                disputed_amount: 2800,
                resolved_at: new Date(Date.now() - 15 * 86400 * 1000).toISOString(),
                resolution_notes: 'Split 50% courier claim, 50% supplier replacement with buyer receiving brand new unit.',
              },
            ],
          },
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/disputes/:id',
    handler({ params }) {
      const dispute = mockDisputes.find((d) => d.id === Number(params.id)) || mockDisputes[0];
      return {
        status: 200,
        body: {
          data: dispute,
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/disputes/:id/timeline',
    handler({ params }) {
      const dispute = mockDisputes.find((d) => d.id === Number(params.id)) || mockDisputes[0];
      return {
        status: 200,
        body: {
          data: {
            timeline: [
              {
                id: 1,
                type: 'ORDER_PLACED',
                actor_role: 'CUSTOMER',
                actor_name: dispute.customer_name,
                created_at: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
                metadata: { order_ref: dispute.sub_order_ref, total: dispute.disputed_amount },
              },
              {
                id: 2,
                type: 'COURIER_EVENT',
                actor_role: 'COURIER',
                actor_name: 'Pathao Logistics',
                created_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
                metadata: { status: 'DELIVERED', tracking_code: 'PTH-99210' },
              },
              {
                id: 3,
                type: 'DISPUTE_OPENED',
                actor_role: 'CUSTOMER',
                actor_name: dispute.customer_name,
                created_at: dispute.created_at,
                metadata: { reason: dispute.reason, amount: dispute.disputed_amount },
              },
            ],
          },
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/disputes/:id/messages',
    handler({ params, body }) {
      const dispute = mockDisputes.find((d) => d.id === Number(params.id));
      if (dispute) {
        dispute.messages.push({
          id: Date.now(),
          sender_id: 1,
          sender_name: 'Moderator Staff',
          sender_role: 'MODERATOR',
          body: body?.body || '',
          is_internal_note: Boolean(body?.is_internal_note),
          created_at: new Date().toISOString(),
        });
      }
      return {
        status: 200,
        body: {
          data: { success: true },
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/disputes/:id/arbitrate',
    handler({ params, body }) {
      const dispute = mockDisputes.find((d) => d.id === Number(params.id));
      if (dispute) {
        dispute.status = 'RESOLVED';
        dispute.outcome = body?.outcome || 'FULL_REFUND';
        dispute.resolution_notes = body?.resolution_notes || '';
      }
      return {
        status: 200,
        body: {
          data: dispute,
        },
      };
    },
  },
];

export default disputeHandlers;
