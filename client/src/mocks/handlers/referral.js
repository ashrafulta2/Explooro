/**
 * referral.js — Mock API handlers for Multi-Tier Referral & Network Growth Engine (Prompt 9.3).
 */

let mockOverview = {
  code: 'REF-EXP8820',
  custom_slug: 'tanvir-deals',
  clicks_count: 168,
  signups_count: 14,
  stats: {
    total_referrals: 14,
    tier1_count: 10,
    tier2_count: 4,
    qualified_count: 11,
    pending_count: 3,
  },
  earnings: {
    total_earnings: '8450.00',
    pending_escrow: '2100.00',
    available_earnings: '6350.00',
  },
  coins: {
    coins_earned: 1400,
    coins_per_signup: 100,
  },
  tier_badge: 'GOLD_VIP',
  next_tier_progress: {
    current: 14,
    target: 20,
    pct: 70,
    next_tier: 'PLATINUM_DIRECTOR',
    reward_boost: '+2.5% Commission Bonus',
  },
};

let mockTree = [
  {
    id: 1,
    ref: 'REF-LK-912A',
    referee_name: 'Farhana Sultana',
    referee_email: 'farhana.s@example.com',
    tier_level: 1,
    status: 'QUALIFIED',
    joined_at: new Date(Date.now() - 3 * 86400000).toISOString(),
    created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
    earned_from_referee: '1850.00',
  },
  {
    id: 2,
    ref: 'REF-LK-884B',
    referee_name: 'Rafiqul Islam',
    referee_email: 'rafiq.islam@example.com',
    tier_level: 1,
    status: 'QUALIFIED',
    joined_at: new Date(Date.now() - 6 * 86400000).toISOString(),
    created_at: new Date(Date.now() - 6 * 86400000).toISOString(),
    earned_from_referee: '2100.00',
  },
  {
    id: 3,
    ref: 'REF-LK-771C',
    referee_name: 'Sadia Jahan',
    referee_email: 'sadia.j@example.com',
    tier_level: 2,
    status: 'QUALIFIED',
    joined_at: new Date(Date.now() - 8 * 86400000).toISOString(),
    created_at: new Date(Date.now() - 8 * 86400000).toISOString(),
    earned_from_referee: '640.00',
  },
  {
    id: 4,
    ref: 'REF-LK-662D',
    referee_name: 'Kamrul Hasan',
    referee_email: 'kamrul.hasan@example.com',
    tier_level: 1,
    status: 'QUALIFIED',
    joined_at: new Date(Date.now() - 12 * 86400000).toISOString(),
    created_at: new Date(Date.now() - 12 * 86400000).toISOString(),
    earned_from_referee: '1450.00',
  },
  {
    id: 5,
    ref: 'REF-LK-553E',
    referee_name: 'Nasrin Akter',
    referee_email: 'nasrin.akter@example.com',
    tier_level: 2,
    status: 'QUALIFIED',
    joined_at: new Date(Date.now() - 14 * 86400000).toISOString(),
    created_at: new Date(Date.now() - 14 * 86400000).toISOString(),
    earned_from_referee: '520.00',
  },
  {
    id: 6,
    ref: 'REF-LK-441F',
    referee_name: 'Tanvir Ahmed',
    referee_email: 'tanvir.a@example.com',
    tier_level: 1,
    status: 'PENDING',
    joined_at: new Date(Date.now() - 1 * 86400000).toISOString(),
    created_at: new Date(Date.now() - 1 * 86400000).toISOString(),
    earned_from_referee: '0.00',
  },
  {
    id: 7,
    ref: 'REF-LK-332G',
    referee_name: 'Mehedi Hasan',
    referee_email: 'mehedi.h@example.com',
    tier_level: 2,
    status: 'PENDING',
    joined_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    earned_from_referee: '0.00',
  },
];

let mockStatement = [
  {
    id: 101,
    referral_ref: 'REF-LK-912A',
    referee_name: 'Farhana Sultana',
    tier_level: 1,
    order_amount: '4500.00',
    commission_rate_pct: 5.0,
    commission_amount: '225.00',
    status: 'PENDING_ESCROW',
    escrow_release_at: new Date(Date.now() + 4 * 86400000).toISOString(),
    created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
  {
    id: 102,
    referral_ref: 'REF-LK-884B',
    referee_name: 'Rafiqul Islam',
    tier_level: 1,
    order_amount: '3800.00',
    commission_rate_pct: 5.0,
    commission_amount: '190.00',
    status: 'AVAILABLE',
    escrow_release_at: new Date(Date.now() - 1 * 86400000).toISOString(),
    created_at: new Date(Date.now() - 8 * 86400000).toISOString(),
  },
  {
    id: 103,
    referral_ref: 'REF-LK-771C',
    referee_name: 'Sadia Jahan',
    tier_level: 2,
    order_amount: '7000.00',
    commission_rate_pct: 2.0,
    commission_amount: '140.00',
    status: 'AVAILABLE',
    escrow_release_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    created_at: new Date(Date.now() - 9 * 86400000).toISOString(),
  },
  {
    id: 104,
    referral_ref: 'REF-LK-662D',
    referee_name: 'Kamrul Hasan',
    tier_level: 1,
    order_amount: '5200.00',
    commission_rate_pct: 5.0,
    commission_amount: '260.00',
    status: 'AVAILABLE',
    escrow_release_at: new Date(Date.now() - 5 * 86400000).toISOString(),
    created_at: new Date(Date.now() - 12 * 86400000).toISOString(),
  },
  {
    id: 105,
    referral_ref: 'REF-LK-553E',
    referee_name: 'Nasrin Akter',
    tier_level: 2,
    order_amount: '4000.00',
    commission_rate_pct: 2.0,
    commission_amount: '80.00',
    status: 'AVAILABLE',
    escrow_release_at: new Date(Date.now() - 6 * 86400000).toISOString(),
    created_at: new Date(Date.now() - 14 * 86400000).toISOString(),
  },
];

export const referralHandlers = [
  // Overview endpoints
  {
    method: 'GET',
    path: '/saler/referrals/overview',
    handler: () => ({
      status: 200,
      body: { overview: { ...mockOverview } },
    }),
  },
  {
    method: 'GET',
    path: '/referrals/overview',
    handler: () => ({
      status: 200,
      body: { overview: { ...mockOverview } },
    }),
  },
  {
    method: 'GET',
    path: '/account/referrals/overview',
    handler: () => ({
      status: 200,
      body: { overview: { ...mockOverview } },
    }),
  },

  // Tree endpoints
  {
    method: 'GET',
    path: '/saler/referrals/tree',
    handler: () => ({
      status: 200,
      body: { tree: [...mockTree] },
    }),
  },
  {
    method: 'GET',
    path: '/referrals/tree',
    handler: () => ({
      status: 200,
      body: { tree: [...mockTree] },
    }),
  },
  {
    method: 'GET',
    path: '/account/referrals/tree',
    handler: () => ({
      status: 200,
      body: { tree: [...mockTree] },
    }),
  },

  // Statement endpoints
  {
    method: 'GET',
    path: '/saler/referrals/statement',
    handler: () => ({
      status: 200,
      body: { statement: [...mockStatement] },
    }),
  },
  {
    method: 'GET',
    path: '/referrals/statement',
    handler: () => ({
      status: 200,
      body: { statement: [...mockStatement] },
    }),
  },
  {
    method: 'GET',
    path: '/account/referrals/statement',
    handler: () => ({
      status: 200,
      body: { statement: [...mockStatement] },
    }),
  },

  // Custom slug update
  {
    method: 'POST',
    path: '/saler/referrals/custom-code',
    handler: ({ body }) => {
      const slug = String(body?.custom_slug || '').trim().toLowerCase();
      if (!slug) {
        return {
          status: 400,
          body: { error: { message_en: 'Invalid slug' } },
        };
      }
      mockOverview.custom_slug = slug;
      return {
        status: 200,
        body: { referral_code: { custom_slug: slug } },
      };
    },
  },
  {
    method: 'POST',
    path: '/referrals/custom-code',
    handler: ({ body }) => {
      const slug = String(body?.custom_slug || '').trim().toLowerCase();
      if (!slug) {
        return {
          status: 400,
          body: { error: { message_en: 'Invalid slug' } },
        };
      }
      mockOverview.custom_slug = slug;
      return {
        status: 200,
        body: { referral_code: { custom_slug: slug } },
      };
    },
  },

  // QA Simulation endpoints
  {
    method: 'POST',
    path: '/saler/referrals/simulate',
    handler: ({ body }) => {
      const type = body?.type || 'SIGNUP';
      if (type === 'SIGNUP') {
        const newId = Date.now();
        const names = ['Arif Chowdhury', 'Nabila Haque', 'Zubair Al Mamun', 'Sultana Razia', 'Ashiqur Rahman'];
        const randomName = names[Math.floor(Math.random() * names.length)];
        const newNode = {
          id: newId,
          ref: `REF-LK-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
          referee_name: `${randomName} (Test ${mockTree.length + 1})`,
          referee_email: `test.${newId}@example.com`,
          tier_level: 1,
          status: 'PENDING',
          joined_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          earned_from_referee: '0.00',
        };
        mockTree.unshift(newNode);
        mockOverview.signups_count += 1;
        mockOverview.stats.total_referrals += 1;
        mockOverview.stats.tier1_count += 1;
        mockOverview.stats.pending_count += 1;
        mockOverview.coins.coins_earned += 100;
        return {
          status: 200,
          body: { success: true, message: `Simulated signup for ${newNode.referee_name} (+100 Coins awarded)` },
        };
      }

      if (type === 'ORDER') {
        const orderAmount = Number(body?.amount || 2500);
        const commRate = 5.0;
        const commAmount = (orderAmount * commRate) / 100;
        const targetNode = mockTree[0] || { referee_name: 'Test Referee', ref: 'REF-DEMO' };
        targetNode.status = 'QUALIFIED';
        targetNode.earned_from_referee = (Number(targetNode.earned_from_referee || 0) + commAmount).toFixed(2);

        const newTx = {
          id: Date.now(),
          referral_ref: targetNode.ref,
          referee_name: targetNode.referee_name,
          tier_level: 1,
          order_amount: orderAmount.toFixed(2),
          commission_rate_pct: commRate,
          commission_amount: commAmount.toFixed(2),
          status: 'PENDING_ESCROW',
          escrow_release_at: new Date(Date.now() + 7 * 86400000).toISOString(),
          created_at: new Date().toISOString(),
        };
        mockStatement.unshift(newTx);

        mockOverview.stats.qualified_count += 1;
        if (mockOverview.stats.pending_count > 0) mockOverview.stats.pending_count -= 1;
        mockOverview.earnings.total_earnings = (Number(mockOverview.earnings.total_earnings) + commAmount).toFixed(2);
        mockOverview.earnings.pending_escrow = (Number(mockOverview.earnings.pending_escrow) + commAmount).toFixed(2);

        return {
          status: 200,
          body: { success: true, message: `Simulated ৳${orderAmount} order: ৳${commAmount.toFixed(2)} commission placed into escrow!` },
        };
      }

      return {
        status: 200,
        body: { success: true },
      };
    },
  },
  {
    method: 'POST',
    path: '/referrals/simulate',
    handler: ({ body }) => referralHandlers.find((h) => h.path === '/saler/referrals/simulate').handler({ body }),
  },

  // Admin governance overview — powers /admin/growth/referrals (docs/ia-sitemap.md: "Referral rules").
  {
    method: 'GET',
    path: '/admin/growth/referrals',
    handler: () => ({
      status: 200,
      body: {
        stats: {
          total_referrals: 1420,
          qualified_count: 980,
          fraud_flagged_count: 12,
          active_referrers_count: 310,
        },
        total_commissions_paid: '482500.00',
        // Programme rules are configuration, never hardcoded numbers (CLAUDE.md §business numbers).
        rules: {
          tier_depth: 2,
          tier_1_rate_pct: 5,
          tier_2_rate_pct: 2,
          attribution_window_days: 30,
          qualify_on: 'FIRST_DELIVERED_ORDER',
          min_order_value_bdt: 500,
          max_payout_per_referrer_bdt: 25000,
          is_active: true,
        },
        fraud_controls: {
          block_same_device: true,
          block_same_ip: true,
          block_same_nid: true,
          block_same_payment_instrument: true,
          block_circular: true,
          velocity_cap_per_day: 10,
        },
        flagged_referrals: [
          { id: 'REF-2026-0412', referrer_name: 'Shakil Ahmed', referee_name: 'S. Ahmed (alt)', reason: 'SAME_DEVICE_FINGERPRINT', amount_held_bdt: 850, flagged_at: new Date(Date.now() - 3600000 * 6).toISOString(), status: 'HELD' },
          { id: 'REF-2026-0398', referrer_name: 'Mitu Akter', referee_name: 'Rina Akter', reason: 'SAME_NID', amount_held_bdt: 1200, flagged_at: new Date(Date.now() - 3600000 * 27).toISOString(), status: 'HELD' },
          { id: 'REF-2026-0371', referrer_name: 'Jubayer Hasan', referee_name: 'Rafi Hasan', reason: 'CIRCULAR_REFERRAL', amount_held_bdt: 640, flagged_at: new Date(Date.now() - 3600000 * 52).toISOString(), status: 'HELD' },
          { id: 'REF-2026-0355', referrer_name: 'Nadia Islam', referee_name: 'Anonymous #4471', reason: 'VELOCITY_SPIKE', amount_held_bdt: 3100, flagged_at: new Date(Date.now() - 3600000 * 80).toISOString(), status: 'HELD' },
        ],
      },
    }),
  },

  // Save referral programme rules.
  {
    method: 'PATCH',
    path: '/admin/growth/referrals/rules',
    handler: ({ body }) => ({
      status: 200,
      body: {
        data: { rules: { ...body } },
        message_en: 'Referral rules updated.',
        message_bn: 'রেফারেল নীতিমালা হালনাগাদ হয়েছে।',
      },
    }),
  },

  // Resolve one flagged referral: release the held commission or void it.
  {
    method: 'POST',
    path: '/admin/growth/referrals/flagged/:id/resolve',
    handler: ({ params, body }) => ({
      status: 200,
      body: {
        data: { id: params?.id, status: body?.decision === 'RELEASE' ? 'RELEASED' : 'VOIDED' },
        message_en: `Referral ${params?.id} ${body?.decision === 'RELEASE' ? 'released' : 'voided'}.`,
        message_bn: `রেফারেলটি ${body?.decision === 'RELEASE' ? 'ছাড় দেওয়া' : 'বাতিল'} হয়েছে।`,
      },
    }),
  },
];
