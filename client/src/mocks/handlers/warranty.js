/**
 * warranty.js — Mock API handlers for Digital Warranty Cards & Claims (Prompt 10.4).
 */

let mockWarrantyCards = [
  {
    id: 1,
    serial_number: 'WAR-WALT-2026-9910',
    product_id: 1,
    product_title: 'Walton 43-inch Android Smart TV',
    product_title_en: 'Walton 43-inch Android Smart TV',
    product_title_bn: 'ওয়ালটন ৪৩-ইঞ্চি অ্যান্ড্রয়েড স্মার্ট টিভি',
    image_url: 'https://images.unsplash.com/photo-1593784991095-a205069470b6?w=600',
    customer_name: 'Karim Ahmed',
    customer_phone: '+8801711223344',
    supplier_name: 'Walton Hi-Tech Industries PLC',
    duration_months: 24,
    starts_at: new Date(Date.now() - 60 * 86400000).toISOString(),
    expires_at: new Date(Date.now() + 670 * 86400000).toISOString(),
    is_transferable: true,
    status: 'ACTIVE',
    claims_count: 0,
    claims: [],
  },
  {
    id: 2,
    serial_number: 'WAR-RICE-2026-4412',
    product_id: 4,
    product_title: 'Miniket Premium Rice 25kg Bag',
    product_title_en: 'Miniket Premium Rice 25kg Bag',
    product_title_bn: 'মিনিকেট প্রিমিয়াম চাল ২৫ কেজি ব্যাগ',
    image_url: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=600',
    customer_name: 'Karim Ahmed',
    customer_phone: '+8801711223344',
    supplier_name: 'Bengal Agro Foods Ltd.',
    duration_months: 6,
    starts_at: new Date(Date.now() - 30 * 86400000).toISOString(),
    expires_at: new Date(Date.now() + 150 * 86400000).toISOString(),
    is_transferable: false,
    status: 'ACTIVE',
    claims_count: 1,
    claims: [
      {
        id: 101,
        ref: 'CLM-2026-001',
        card_id: 2,
        issue_description: 'Packaging seal was broken during courier transit and grain had moisture.',
        preferred_resolution: 'REPLACE',
        resolution: null,
        status: 'SUBMITTED',
        sla_due_at: new Date(Date.now() + 48 * 3600000).toISOString(),
        created_at: new Date(Date.now() - 24 * 3600000).toISOString(),
      },
    ],
  },
];

let mockClaims = [
  {
    id: 101,
    ref: 'CLM-2026-001',
    card_id: 2,
    serial_number: 'WAR-RICE-2026-4412',
    product_title: 'Miniket Premium Rice 25kg Bag',
    product_title_en: 'Miniket Premium Rice 25kg Bag',
    customer_name: 'Karim Ahmed',
    customer_phone: '+8801711223344',
    supplier_id: 1,
    supplier_name: 'Bengal Agro Foods Ltd.',
    issue_description: 'Packaging seal was broken during courier transit and grain had moisture.',
    preferred_resolution: 'REPLACE',
    resolution: null,
    status: 'SUBMITTED',
    sla_due_at: new Date(Date.now() + 48 * 3600000).toISOString(),
    created_at: new Date(Date.now() - 24 * 3600000).toISOString(),
    evidence_media: [],
    timeline: [
      { step: 'SUBMITTED', label: 'Claim Submitted by Buyer', timestamp: new Date(Date.now() - 24 * 3600000).toISOString() },
    ],
  },
  {
    id: 102,
    ref: 'CLM-2026-002',
    card_id: 1,
    serial_number: 'WAR-WALT-2026-9910',
    product_title: 'Walton 43-inch Android Smart TV',
    product_title_en: 'Walton 43-inch Android Smart TV',
    customer_name: 'Farhana Sultana',
    customer_phone: '+8801819988776',
    supplier_id: 1,
    supplier_name: 'Walton Hi-Tech Industries PLC',
    issue_description: 'Display backlight flickering intermittently on HDMI input.',
    preferred_resolution: 'REPAIR',
    resolution: 'APPROVED_REPAIR',
    status: 'IN_PROGRESS',
    sla_due_at: new Date(Date.now() + 12 * 3600000).toISOString(),
    created_at: new Date(Date.now() - 48 * 3600000).toISOString(),
    evidence_media: [],
    reverse_tracking_number: 'STDF-REV-99210',
    reverse_courier: 'Steadfast Reverse Logistics',
    timeline: [
      { step: 'SUBMITTED', label: 'Claim Submitted by Buyer', timestamp: new Date(Date.now() - 48 * 3600000).toISOString() },
      { step: 'APPROVED', label: 'Claim Approved by Supplier (Free Repair)', timestamp: new Date(Date.now() - 20 * 3600000).toISOString() },
      { step: 'IN_TRANSIT', label: 'Reverse Courier Picked Up Item', timestamp: new Date(Date.now() - 6 * 3600000).toISOString() },
    ],
  },
];

export const warrantyHandlers = [
  {
    method: 'GET',
    path: '/warranties/my-cards',
    handler() {
      return {
        status: 200,
        body: {
          data: {
            cards: mockWarrantyCards,
            total: mockWarrantyCards.length,
          },
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/warranties/:id',
    handler({ params }) {
      const card = mockWarrantyCards.find((c) => c.id === Number(params.id)) || mockWarrantyCards[0];
      return {
        status: 200,
        body: {
          data: {
            card,
          },
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/warranties/:id/claim',
    handler({ params, body }) {
      const card = mockWarrantyCards.find((c) => c.id === Number(params.id));
      const b = body || {};
      const newClaim = {
        id: Date.now(),
        ref: `CLM-${Date.now().toString().slice(-6)}`,
        card_id: Number(params.id),
        serial_number: card?.serial_number || 'WAR-SERIAL-DEFAULT',
        product_title: card?.product_title || 'Claimed Product',
        product_title_en: card?.product_title_en || 'Claimed Product',
        customer_name: 'Current User',
        customer_phone: '+8801700000000',
        issue_description: b.issue_description,
        preferred_resolution: b.preferred_resolution || 'REPAIR',
        resolution: null,
        status: 'SUBMITTED',
        sla_due_at: new Date(Date.now() + 72 * 3600000).toISOString(),
        created_at: new Date().toISOString(),
        evidence_media: b.evidence_media || [],
      };

      mockClaims.unshift(newClaim);
      if (card) {
        card.claims_count += 1;
        card.claims.push(newClaim);
      }

      return {
        status: 201,
        body: {
          data: {
            claim: newClaim,
            message_en: 'Warranty claim filed successfully. Supplier has 72h SLA to respond.',
          },
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/warranties/:id/transfer',
    handler({ params, body }) {
      const card = mockWarrantyCards.find((c) => c.id === Number(params.id));
      if (card) {
        card.customer_name = `Transferred (${body?.target_phone_or_email})`;
      }
      return {
        status: 200,
        body: {
          data: {
            card,
            message_en: 'Digital warranty card transferred successfully.',
          },
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/supplier/claims',
    handler({ query }) {
      const status = query?.status;
      let claimsList = mockClaims;
      if (status && status !== 'all') {
        claimsList = claimsList.filter((c) => c.status === status);
      }
      return {
        status: 200,
        body: {
          data: {
            claims: claimsList,
            total: claimsList.length,
          },
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/supplier/claims/analytics',
    handler() {
      return {
        status: 200,
        body: {
          data: {
            products: [
              {
                product_id: 1,
                product_title_en: 'Walton 43-inch Android Smart TV',
                total_units_sold: 140,
                total_claims: 2,
                claim_rate_pct: 1.4,
                risk_tier: 'NORMAL',
              },
              {
                product_id: 4,
                product_title_en: 'Miniket Premium Rice 25kg Bag',
                total_units_sold: 520,
                total_claims: 3,
                claim_rate_pct: 0.5,
                risk_tier: 'NORMAL',
              },
            ],
            summary: {
              total_claims: mockClaims.length,
              pending_sla_claims: mockClaims.filter((c) => c.status === 'SUBMITTED').length,
              sla_breached_count: 0,
              avg_resolution_hours: 18.5,
            },
          },
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/supplier/claims/:id/review',
    handler({ params, body }) {
      const claim = mockClaims.find((c) => c.id === Number(params.id));
      if (claim) {
        claim.status = body?.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
        claim.resolution = body?.resolution || (body?.action === 'APPROVE' ? 'APPROVED' : 'REJECTED');
        if (body?.rejection_reason) {
          claim.rejection_reason = body.rejection_reason;
        }
      }
      return {
        status: 200,
        body: {
          data: {
            claim,
            message_en: 'Claim reviewed successfully.',
          },
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/supplier/claims/:id/progress',
    handler({ params, body }) {
      const claim = mockClaims.find((c) => c.id === Number(params.id));
      if (claim) {
        claim.status = body?.status || 'COMPLETED';
        if (body?.tracking_number) {
          claim.reverse_tracking_number = body.tracking_number;
        }
      }
      return {
        status: 200,
        body: {
          data: {
            claim,
            message_en: 'Claim status updated.',
          },
        },
      };
    },
  },
];

export default warrantyHandlers;
