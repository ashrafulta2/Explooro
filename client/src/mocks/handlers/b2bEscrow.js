/**
 * b2bEscrow.js — Mock handlers for B2B Wholesale Escrow & Milestone Settlement (Prompt 10.6).
 */

const SEEDED_DEALS = [
  {
    id: 1,
    ref: 'B2B-9K2P4L8X',
    title_en: 'Bulk Export Garments Batch #401 (1,000 Pcs Pure Cotton Formal Shirts)',
    title_bn: 'বাল্ক এক্সপোর্ট পোশাক ব্যাচ #৪০১ (১,০০০ পিস সুতি ফর্মাল শার্ট)',
    sub_order_id: 101,
    buyer_id: 6,
    buyer_name: 'Rahim Fashion Store',
    buyer_phone: '+8801711223344',
    supplier_id: 5,
    supplier_name: 'Walton Textile Mills Ltd.',
    supplier_phone: '+8801811223344',
    total_amount: 850000.00,
    released_amount: 255000.00,
    refunded_amount: 0.00,
    frozen_amount: 0.00,
    status: 'IN_PROGRESS',
    agreed_terms_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    contract_terms_json: {
      delivery_days: 21,
      inspection_period_hours: 48,
      quality_specs: '100% Ring-spun cotton, 180 GSM, AZO-free reactive dye, double stitched hem.',
      penalty_terms: '0.5% per day delay after grace period.',
    },
    buyer_signed_at: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
    supplier_signed_at: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
    created_at: new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString(),
    milestones: [
      {
        id: 101,
        ref: 'MLS-101-CONF',
        deal_id: 1,
        sequence_no: 1,
        label_en: 'Phase 1: Fabric Procurement & Production Line Setup',
        label_bn: 'পর্যায় ১: কাপড় সংগ্রহ ও প্রোডাকশন সেটআপ',
        release_pct: 30.0,
        amount: 255000.00,
        evidence_required: 'NONE',
        status: 'RELEASED',
        released_by: 6,
        released_at: new Date(Date.now() - 6 * 24 * 3600 * 1000).toISOString(),
      },
      {
        id: 102,
        ref: 'MLS-102-DISP',
        deal_id: 1,
        sequence_no: 2,
        label_en: 'Phase 2: Factory Inspection & Carrier Dispatch Consignment',
        label_bn: 'পর্যায় ২: কারখানা পরিদর্শন ও কুরিয়ার চালান হস্তান্তর',
        release_pct: 40.0,
        amount: 340000.00,
        evidence_required: 'DISPATCH_PROOF',
        status: 'EVIDENCE_SUBMITTED',
        evidence_media_json: {
          evidence_type: 'DISPATCH_PROOF',
          media_urls: ['/placeholder-challan.pdf'],
          notes: 'Dispatched via Pathao Freight Truck #DH-11-9921. Challan #CH-8812 attached.',
          submitted_at: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
        },
      },
      {
        id: 103,
        ref: 'MLS-103-INSP',
        deal_id: 1,
        sequence_no: 3,
        label_en: 'Phase 3: Central Warehouse Quality Inspection & Final Acceptance',
        label_bn: 'পর্যায় ৩: কেন্দ্রীয় গুদাম কোয়ালিটি পরিদর্শন ও চূড়ান্ত অনুমোদন',
        release_pct: 30.0,
        amount: 255000.00,
        evidence_required: 'INSPECTION',
        status: 'PENDING',
      },
    ],
  },
  {
    id: 2,
    ref: 'B2B-3X7T9Q1M',
    title_en: 'Monsoon Jute Handicrafts Bulk Wholesale (500 Sets)',
    title_bn: 'বর্ষা পাটজাত হস্তশিল্প পাইকারি লট (৫০০ সেট)',
    sub_order_id: null,
    buyer_id: 6,
    buyer_name: 'Rahim Fashion Store',
    buyer_phone: '+8801711223344',
    supplier_id: 8,
    supplier_name: 'Aarong Rural Artisans Cooperative',
    supplier_phone: '+8801911223344',
    total_amount: 350000.00,
    released_amount: 0.00,
    refunded_amount: 0.00,
    frozen_amount: 0.00,
    status: 'PENDING_SUPPLIER_ACCEPTANCE',
    agreed_terms_hash: '9a3b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b',
    contract_terms_json: {
      delivery_days: 14,
      inspection_period_hours: 72,
      quality_specs: 'Export-grade braided natural golden jute, eco-friendly dye.',
    },
    buyer_signed_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    supplier_signed_at: null,
    created_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    milestones: [
      {
        id: 201,
        ref: 'MLS-201-ADV',
        deal_id: 2,
        sequence_no: 1,
        label_en: 'Upfront Artisan Material Advance',
        label_bn: 'কারিগর কাঁচামাল অগ্রিম',
        release_pct: 50.0,
        amount: 175000.00,
        evidence_required: 'NONE',
        status: 'PENDING',
      },
      {
        id: 202,
        ref: 'MLS-202-DELV',
        deal_id: 2,
        sequence_no: 2,
        label_en: 'Final Delivery & Acceptance Signoff',
        label_bn: 'চূড়ান্ত ডেলিভারি ও সাইনঅফ',
        release_pct: 50.0,
        amount: 175000.00,
        evidence_required: 'DELIVERY_PROOF',
        status: 'PENDING',
      },
    ],
  },
];

let dealsStore = JSON.parse(JSON.stringify(SEEDED_DEALS));

function notFound(message) {
  return { status: 404, body: { error: { code: 'NOT_FOUND', message_en: message, message_bn: message } } };
}

export const b2bEscrowHandlers = [
  {
    path: '/b2b-escrow/deals',
    method: 'GET',
    handler: ({ query }) => {
      let res = dealsStore;
      if (query?.status) {
        res = res.filter((d) => d.status === query.status);
      }
      return { status: 200, body: { data: res, meta: { total: res.length } } };
    },
  },
  {
    path: '/b2b-escrow/deals',
    method: 'POST',
    handler: ({ body }) => {
      const newId = dealsStore.length + 1;
      const newDeal = {
        id: newId,
        ref: `B2B-${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
        title_en: body.title_en || body.titleEn,
        title_bn: body.title_bn || body.titleBn,
        buyer_id: body.buyer_id || 6,
        buyer_name: 'Current Buyer Store',
        supplier_id: body.supplier_id || 5,
        supplier_name: 'Selected Supplier',
        total_amount: parseFloat(body.total_amount || 100000),
        released_amount: 0,
        refunded_amount: 0,
        frozen_amount: 0,
        status: 'PENDING_SUPPLIER_ACCEPTANCE',
        agreed_terms_hash: 'seeded_sha256_hash_' + Date.now(),
        contract_terms_json: body.contract_terms || {},
        created_at: new Date().toISOString(),
        milestones: (body.milestones || []).map((m, idx) => ({
          id: newId * 100 + idx + 1,
          ref: `MLS-${newId}0${idx + 1}`,
          deal_id: newId,
          sequence_no: idx + 1,
          label_en: m.label_en || m.labelEn,
          label_bn: m.label_bn || m.labelBn,
          release_pct: parseFloat(m.release_pct || m.releasePct),
          amount: parseFloat(body.total_amount || 100000) * (parseFloat(m.release_pct || m.releasePct) / 100),
          evidence_required: m.evidence_required || m.evidenceRequired || 'NONE',
          status: 'PENDING',
        })),
      };
      dealsStore.unshift(newDeal);
      return { status: 201, body: { data: { deal: newDeal, milestones: newDeal.milestones } } };
    },
  },
  {
    path: '/b2b-escrow/deals/:idOrRef',
    method: 'GET',
    handler: ({ params }) => {
      const deal = dealsStore.find((d) => String(d.id) === String(params.idOrRef) || d.ref === params.idOrRef);
      if (!deal) return notFound('Deal not found.');
      return { status: 200, body: { data: deal } };
    },
  },
  {
    path: '/b2b-escrow/deals/:id/accept',
    method: 'POST',
    handler: ({ params }) => {
      const deal = dealsStore.find((d) => String(d.id) === String(params.id));
      if (!deal) return notFound('Deal not found.');
      deal.buyer_signed_at = deal.buyer_signed_at || new Date().toISOString();
      deal.supplier_signed_at = new Date().toISOString();
      deal.status = 'IN_PROGRESS';
      return { status: 200, body: { data: { deal, locked: true } } };
    },
  },
  {
    path: '/b2b-escrow/milestones/:id/evidence',
    method: 'POST',
    handler: ({ params, body }) => {
      for (const d of dealsStore) {
        const m = (d.milestones || []).find((x) => String(x.id) === String(params.id));
        if (m) {
          m.status = 'EVIDENCE_SUBMITTED';
          m.evidence_media_json = {
            evidence_type: body?.evidence_type || m.evidence_required,
            media_urls: body?.media_urls || [],
            notes: body?.notes || '',
            submitted_at: new Date().toISOString(),
          };
          return { status: 200, body: { data: m } };
        }
      }
      return notFound('Milestone not found.');
    },
  },
  {
    path: '/b2b-escrow/milestones/:id/release',
    method: 'POST',
    handler: ({ params }) => {
      for (const d of dealsStore) {
        const m = (d.milestones || []).find((x) => String(x.id) === String(params.id));
        if (m) {
          m.status = 'RELEASED';
          m.released_at = new Date().toISOString();
          d.released_amount += m.amount;
          if (d.milestones.every((x) => x.status === 'RELEASED')) {
            d.status = 'COMPLETED';
          }
          return { status: 200, body: { data: { is_pending_maker_checker: false, milestone: m } } };
        }
      }
      return notFound('Milestone not found.');
    },
  },
  {
    path: '/b2b-escrow/deals/:id/dispute',
    method: 'POST',
    handler: ({ params }) => {
      const deal = dealsStore.find((d) => String(d.id) === String(params.id));
      if (!deal) return notFound('Deal not found.');
      deal.status = 'DISPUTED';
      deal.milestones.forEach((m) => {
        if (m.status === 'PENDING' || m.status === 'EVIDENCE_SUBMITTED') {
          m.status = 'FROZEN';
        }
      });
      return { status: 200, body: { data: { deal, frozen_milestones_count: 2 } } };
    },
  },
  {
    path: '/b2b-escrow/milestones/:id/refund',
    method: 'POST',
    handler: ({ params }) => {
      for (const d of dealsStore) {
        const m = (d.milestones || []).find((x) => String(x.id) === String(params.id));
        if (m) {
          m.status = 'REFUNDED';
          d.refunded_amount += m.amount;
          return { status: 200, body: { data: { milestone: m, refunded_amount: m.amount } } };
        }
      }
      return notFound('Milestone not found.');
    },
  },
  {
    path: '/b2b-escrow/deals/:id/cancel',
    method: 'POST',
    handler: ({ params }) => {
      const deal = dealsStore.find((d) => String(d.id) === String(params.id));
      if (!deal) return notFound('Deal not found.');
      deal.status = 'CANCELLED';
      deal.milestones.forEach((m) => {
        if (m.status !== 'RELEASED') m.status = 'REFUNDED';
      });
      return { status: 200, body: { data: { deal } } };
    },
  },
];
