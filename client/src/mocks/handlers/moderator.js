/**
 * moderator.js — Mock API handlers for Moderator Dashboard & Unified Queue (Prompt 7.4 / 7.6).
 */

let mockModerationItems = [
  {
    id: 1,
    ref: 'MOD-PRD-2026-091',
    item_type: 'PRODUCT_NEW',
    target_entity: 'PRODUCT',
    target_id: 101,
    status: 'PENDING',
    claimed_by: null,
    claimed_by_name: null,
    submitted_by: 4,
    submitter_name: 'Walton Electronics Official',
    data: {
      title_en: 'Walton Primo S9 Pro 128GB Smartphone',
      title_bn: 'ওয়ালটন প্রিমো এস৯ প্রো ১২৮জিবি স্মার্টফোন',
      category: 'Electronics > Smartphones',
      price: 18500,
      description: 'Official flagship smartphone with 6.67" AMOLED display, 64MP triple camera, 5000mAh fast charge.',
      images: [
        'https://images.unsplash.com/photo-1598327105666-5b89351aff97?w=600',
      ],
    },
    pre_screening: {
      has_flags: false,
      banned_keywords: [],
      price_anomaly: false,
      duplicate_risk: 'LOW',
      auto_decision_eligible: true,
      flags: [],
    },
    sla_due_at: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  },
  {
    id: 2,
    ref: 'MOD-REV-2026-088',
    item_type: 'REVIEW',
    target_entity: 'REVIEW',
    target_id: 402,
    status: 'PENDING',
    claimed_by: null,
    claimed_by_name: null,
    submitted_by: 8,
    submitter_name: 'Shopper_Dhaka_99',
    data: {
      rating: 5,
      comment: 'Very good product, contact me on WhatsApp 01711998877 for wholesale discounts!',
      product_title: 'Heritage Dhakai Jamdani Saree',
    },
    pre_screening: {
      has_flags: true,
      banned_keywords: ['01711998877', 'whatsapp'],
      price_anomaly: false,
      duplicate_risk: 'NONE',
      auto_decision_eligible: false,
      flags: [
        { code: 'EXTERNAL_CONTACT_LEAK', message: 'Detected phone number / off-platform contact in review.' },
      ],
    },
    sla_due_at: new Date(Date.now() + 80 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
  },
  {
    id: 3,
    ref: 'MOD-UGC-2026-074',
    item_type: 'UGC_VIDEO',
    target_entity: 'STORY',
    target_id: 88,
    status: 'IN_REVIEW',
    claimed_by: 1,
    claimed_by_name: 'Current Moderator',
    submitted_by: 12,
    submitter_name: 'Fashionista Bangladesh',
    data: {
      title_en: 'Eid Styling Lookbook & Saree Draping Demo',
      video_url: 'https://sample-videos.com/video123/mp4/720/big_buck_bunny_720p_1mb.mp4',
      tagged_products: ['Tangail Cotton Saree', 'Rajshahi Silk Dupatta'],
    },
    pre_screening: {
      has_flags: false,
      banned_keywords: [],
      price_anomaly: false,
      duplicate_risk: 'LOW',
      auto_decision_eligible: true,
      flags: [],
    },
    sla_due_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
  },
  {
    id: 4,
    ref: 'MOD-REP-2026-061',
    item_type: 'CHAT_REPORT',
    target_entity: 'CHAT_MESSAGE',
    target_id: 991,
    status: 'PENDING',
    claimed_by: null,
    claimed_by_name: null,
    submitted_by: 15,
    submitter_name: 'Customer_Report_User',
    data: {
      report_reason: 'Seller requested payment via personal bKash number instead of platform checkout.',
      chat_excerpt: 'Please send 500 taka advance to my personal bKash 01811223344',
      reported_user: 'Boutique Store 22',
    },
    pre_screening: {
      has_flags: true,
      banned_keywords: ['personal bkash'],
      price_anomaly: false,
      duplicate_risk: 'NONE',
      auto_decision_eligible: false,
      flags: [
        { code: 'OFF_PLATFORM_PAYMENT', message: 'Seller requested off-platform money transfer.' },
      ],
    },
    sla_due_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 180 * 60 * 1000).toISOString(),
  },
];

export const moderatorHandlers = [
  {
    method: 'GET',
    path: '/moderator/dashboard',
    handler() {
      const now = new Date();
      return {
        status: 200,
        body: {
          data: {
            workload: {
              my_queue_count: mockModerationItems.filter((i) => i.status === 'IN_REVIEW').length,
              unassigned_count: mockModerationItems.filter((i) => i.status === 'PENDING').length,
              sla_at_risk_count: mockModerationItems.filter((i) => i.pre_screening?.has_flags).length,
              resolved_today_count: 18,
            },
            performance: {
              total_resolved: 420,
              avg_handling_minutes: 6.2,
              overturn_rate_pct: 0.4,
              accuracy_score: 99.1,
            },
            sla_urgent_items: mockModerationItems.map((item) => {
              const slaDue = new Date(item.sla_due_at);
              const remainingMinutes = Math.round((slaDue.getTime() - now.getTime()) / (60 * 1000));
              const isBreached = remainingMinutes < 0;
              return {
                id: item.id,
                ref: item.ref,
                item_type: item.item_type,
                status: item.status,
                submitter_name: item.submitter_name,
                sla_due_at: item.sla_due_at,
                is_breached: isBreached,
                remaining_minutes: isBreached ? Math.abs(remainingMinutes) : remainingMinutes,
                urgency: isBreached ? 'BREACHED' : remainingMinutes <= 120 ? 'CRITICAL' : 'NORMAL',
                target_route: '/moderator/queue',
              };
            }),
            active_grants: [
              {
                id: 1,
                permission_key: 'disputes.arbitrate',
                effect: 'GRANT',
                expires_at: new Date(now.getTime() + 180 * 60 * 1000).toISOString(),
                remaining_minutes: 180,
                grant_reason: 'Assigned to high-priority B2B dispute resolution shift',
              },
            ],
            submitted_actions: [
              {
                id: 'paa-101',
                ref: 'PAA-2026-441',
                action_key: 'USER_BAN',
                target_user_name: 'Fraudulent Store #84',
                status: 'PENDING',
                submitted_at: new Date(now.getTime() - 2 * 3600 * 1000).toISOString(),
              },
            ],
          },
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/moderation/stats',
    handler() {
      return {
        status: 200,
        body: {
          data: {
            pending_count: mockModerationItems.filter((i) => i.status === 'PENDING').length,
            in_review_count: mockModerationItems.filter((i) => i.status === 'IN_REVIEW').length,
            flagged_count: mockModerationItems.filter((i) => i.pre_screening?.has_flags).length,
            approved_today: 18,
            rejected_today: 3,
            avg_decision_time_sec: 45,
          },
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/moderation/queue',
    handler({ query }) {
      const status = query?.status;
      const itemType = query?.item_type;
      let items = [...mockModerationItems];

      if (status && status !== 'ALL') {
        items = items.filter((i) => i.status === status);
      }
      if (itemType && itemType !== 'ALL') {
        items = items.filter((i) => i.item_type === itemType || i.item_type.startsWith(itemType));
      }
      if (query?.filter === 'claimed_by_me') {
        items = items.filter((i) => i.claimed_by !== null);
      }
      if (query?.flagged_only === 'true') {
        items = items.filter((i) => i.pre_screening?.has_flags);
      }

      return {
        status: 200,
        body: {
          data: {
            items,
            total: items.length,
          },
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/moderation/queue/:id',
    handler({ params }) {
      const item = mockModerationItems.find((i) => i.id === Number(params.id)) || mockModerationItems[0];
      return {
        status: 200,
        body: {
          data: { item },
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/moderation/queue/:id/claim',
    handler({ params }) {
      const item = mockModerationItems.find((i) => i.id === Number(params.id));
      if (item) {
        item.status = 'IN_REVIEW';
        item.claimed_by = 1;
        item.claimed_by_name = 'Current Moderator';
      }
      return {
        status: 200,
        body: {
          data: { item, message_en: 'Item claimed successfully.' },
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/moderation/queue/:id/release',
    handler({ params }) {
      const item = mockModerationItems.find((i) => i.id === Number(params.id));
      if (item) {
        item.status = 'PENDING';
        item.claimed_by = null;
        item.claimed_by_name = null;
      }
      return {
        status: 200,
        body: {
          data: { item, message_en: 'Claim lock released.' },
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/moderation/queue/:id/decide',
    handler({ params, body }) {
      const item = mockModerationItems.find((i) => i.id === Number(params.id));
      if (item) {
        item.status = body?.decision || 'APPROVED';
        item.decision_notes = body?.reason || '';
      }
      return {
        status: 200,
        body: {
          data: { item, message_en: 'Decision recorded.' },
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/moderation/bulk-decide',
    handler({ body }) {
      const ids = body?.ids || [];
      const decision = body?.decision || 'APPROVED';
      ids.forEach((id) => {
        const item = mockModerationItems.find((i) => i.id === Number(id));
        if (item) {
          item.status = decision;
        }
      });
      return {
        status: 200,
        body: {
          data: { affected: ids.length, message_en: `Bulk ${decision} completed.` },
        },
      };
    },
  },
];

export default moderatorHandlers;
