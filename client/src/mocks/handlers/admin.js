/**
 * mocks/handlers/admin.js — Mock API endpoints for Super Admin Executive Analytics, Diagnostics & Backups.
 */

function traceId() {
  return `MOCK-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

const mockBackups = [
  {
    id: 1,
    ref: 'BAK-20260825-101',
    snapshot_type: 'SCHEDULED_NIGHTLY',
    snapshot_tag: 'NIGHTLY_SNAP_20260825',
    sha256_checksum: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    checksum_sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    table_count: 95,
    row_count: 142850,
    size_bytes: 48920140,
    status: 'VERIFIED',
    created_at: new Date(Date.now() - 3600000 * 8).toISOString(),
  },
  {
    id: 2,
    ref: 'BAK-20260824-202',
    snapshot_type: 'MANUAL_SNAPSHOT',
    snapshot_tag: 'MANUAL_SNAP_PRE_DEPLOY',
    sha256_checksum: '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
    checksum_sha256: '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
    table_count: 95,
    row_count: 141200,
    size_bytes: 48110200,
    status: 'VERIFIED',
    created_at: new Date(Date.now() - 3600000 * 32).toISOString(),
  },
];

export const adminHandlers = [
  // 1. Executive Analytics Overview
  {
    method: 'GET',
    path: '/admin/analytics/overview',
    handler({ query }) {
      const timeframe = query?.timeframe || '30d';

      let mult = 1;
      let points = 30;
      if (timeframe === '7d') {
        mult = 0.25;
        points = 7;
      } else if (timeframe === '90d') {
        mult = 2.8;
        points = 12;
      } else if (timeframe === '1y') {
        mult = 11.5;
        points = 12;
      }

      const curGmv = Math.round(1485000 * mult);
      const curRev = Math.round(118800 * mult);
      const prevGmv = Math.round(curGmv * 0.88);
      const prevRev = Math.round(curRev * 0.86);

      const chartData = Array.from({ length: points }, (_, i) => {
        const factor = 0.85 + Math.sin(i / 2) * 0.2 + (i / points) * 0.3;
        const gmv = Math.round((curGmv / points) * factor);
        const revenue = Math.round(gmv * 0.08);
        return {
          date: timeframe === '7d' ? `Day ${i + 1}` : (timeframe === '30d' ? `Aug ${i + 1}` : `M${i + 1}`),
          gmv,
          revenue,
          orders: Math.round(gmv / 1800),
        };
      });

      return {
        status: 200,
        body: {
          data: {
            timeframe,
            kpis: {
              gmv: { value: curGmv, delta_pct: 13.6, trend: 'up', is_positive: true, format: 'currency' },
              net_platform_revenue: { value: curRev, delta_pct: 16.2, trend: 'up', is_positive: true, format: 'currency' },
              take_rate: { value: 8.00, delta_pct: 0.2, trend: 'up', is_positive: true, format: 'percent' },
              active_sellers: { value: 142, delta_pct: 8.7, trend: 'up', is_positive: true, format: 'number' },
              new_signups: { value: Math.round(310 * mult), delta_pct: 17.6, trend: 'up', is_positive: true, format: 'number' },
              conversion_rate: { value: 3.65, delta_pct: 17.7, trend: 'up', is_positive: true, format: 'percent' },
              aov: { value: 1810.00, delta_pct: 2.0, trend: 'up', is_positive: true, format: 'currency' },
              escrow_liability: { value: 184500.00, delta_pct: 5.3, trend: 'up', is_positive: true, format: 'currency' },
              pending_payout_liability: { value: 42000.00, delta_pct: 10.0, trend: 'down', is_positive: false, format: 'currency' },
              cod_exposure: { value: 96000.00, delta_pct: 6.4, trend: 'up', is_positive: true, format: 'currency' },
              dispute_rate: { value: 0.85, delta_pct: 22.7, trend: 'down', is_positive: true, format: 'percent' },
            },
            chart_data: chartData,
            breakdown: {
              categories: [
                { name: 'Traditional Handloom & Sarees', share_pct: 35, revenue: curRev * 0.35 },
                { name: 'Electronics & Audio Gadgets', share_pct: 28, revenue: curRev * 0.28 },
                { name: 'Organic Honey & Foods', share_pct: 22, revenue: curRev * 0.22 },
                { name: 'Home Living & Brasscrafts', share_pct: 15, revenue: curRev * 0.15 },
              ],
              channels: [
                { name: 'Direct Storefronts', share_pct: 44, volume: curGmv * 0.44 },
                { name: 'Team Social Buying', share_pct: 26, volume: curGmv * 0.26 },
                { name: 'Live Stream & Video Reels', share_pct: 18, volume: curGmv * 0.18 },
                { name: 'Affiliate Links', share_pct: 12, volume: curGmv * 0.12 },
              ],
            },
            last_rollup_at: new Date().toISOString(),
          },
        },
      };
    },
  },

  // 2. Operational Action Alerts
  {
    method: 'GET',
    path: '/admin/analytics/alerts',
    handler() {
      const alerts = [
        {
          key: 'pending_kyc',
          severity: 'HIGH',
          count: 4,
          title_en: 'Pending Identity (KYC) Verifications',
          title_bn: 'অপেক্ষমাণ এনআইডি/কেওয়াইসি যাচাই',
          details_en: '4 seller/supplier verification applications are awaiting review.',
          details_bn: '৪টি সেলার ও সাপ্লায়ার কেওয়াইসি আবেদন পর্যালোচনার অপেক্ষায়।',
          action_url: '/admin/verification',
          action_label_en: 'Review KYC Queue',
          action_label_bn: 'কেওয়াইসি কিউ দেখুন',
        },
        {
          key: 'pending_payouts',
          severity: 'HIGH',
          count: 6,
          title_en: 'Pending Seller Payout Requests',
          title_bn: 'অপেক্ষমাণ পেআউট অনুরোধ',
          details_en: '৳42,000 in seller earnings ready for dual-approval clearance.',
          details_bn: '৳৪২,০০০ সেলার উইথড্রয়াল রিকোয়েস্ট অনুমোদনের অপেক্ষায়।',
          action_url: '/admin/finance/payouts',
          action_label_en: 'Approve Payouts',
          action_label_bn: 'পেআউট অনুমোদন করুন',
        },
        {
          key: 'unreconciled_cod',
          severity: 'MEDIUM',
          count: 12,
          title_en: 'Unreconciled Delivered COD Parcels',
          title_bn: 'অমীমাংসিত সিওডি পার্সেল',
          details_en: '12 delivered courier consignments have unremitted cash balances.',
          details_bn: '১২টি ডেলিভার্ড পার্সেলের ক্যাশ কালেকশন সমন্বয় বাকি।',
          action_url: '/admin/cod-reconciliation',
          action_label_en: 'Reconcile Remittances',
          action_label_bn: 'সিওডি সমন্বয় করুন',
        },
        {
          key: 'approval_inbox',
          severity: 'HIGH',
          count: 2,
          title_en: 'Maker-Checker Approval Inbox',
          title_bn: 'অ্যাডমিন অনুমোদন ইনবক্স',
          details_en: '2 high-risk state mutations require secondary administrator sign-off.',
          details_bn: '২টি গুরুত্বপূর্ণ পরিবর্তনের জন্য দ্বিতীয় অ্যাডমিনের অনুমোদন প্রয়োজন।',
          action_url: '/admin/approvals',
          action_label_en: 'Open Approval Inbox',
          action_label_bn: 'অনুমোদন ইনবক্স খুলুন',
        },
        {
          key: 'ledger_integrity',
          severity: 'LOW',
          count: 0,
          title_en: 'Double-Entry Ledger Integrity',
          title_bn: 'ডাবল-এন্ট্রি লেজার স্থিতি',
          details_en: 'Debits and credits match with 0.00 drift across all currency vaults.',
          details_bn: 'সকল ওয়ালেটে ডেবিট ও ক্রেডিট নিখুঁতভাবে মিলে গেছে।',
          action_url: '/admin/finance',
          action_label_en: 'Inspect Ledger',
          action_label_bn: 'লেজার পরিদর্শন',
        },
      ];

      return {
        status: 200,
        body: {
          data: {
            alerts,
            critical_count: alerts.filter((a) => a.severity === 'CRITICAL' && a.count > 0).length,
            high_count: alerts.filter((a) => a.severity === 'HIGH' && a.count > 0).length,
            total_actionable: alerts.filter((a) => a.count > 0).length,
          },
        },
      };
    },
  },

  // 3. Nightly Rollup Trigger
  {
    method: 'POST',
    path: '/admin/analytics/rollup-now',
    handler() {
      return {
        status: 200,
        body: {
          data: {
            success: true,
            rollup_date: new Date().toISOString().split('T')[0],
            message_en: 'Calculated daily analytics summary successfully.',
            message_bn: 'দৈনিক অ্যানালিটিক্স সারাংশ সফলভাবে হিসাব করা হয়েছে।',
          },
        },
      };
    },
  },

  // 4. System Health & Diagnostics
  {
    method: 'GET',
    path: '/admin/system/health',
    handler() {
      return {
        status: 200,
        body: {
          data: {
            overall_status: 'HEALTHY',
            timestamp: new Date().toISOString(),
            api_vitals: {
              uptime_seconds: 86400 * 3 + 1420,
              uptime_human: '3d 0h 23m',
              error_rate_pct: 0.02,
              request_count_24h: 184520,
              p50_ms: 12.4,
              p95_ms: 45.2,
              p99_ms: 118.0,
            },
            db_health: {
              status: 'CONNECTED',
              active_connections: 4,
              idle_connections: 16,
              max_connections: 20,
              waiting_clients: 0,
              database_size_bytes: 52428800,
            },
            cache_health: {
              status: 'HEALTHY',
              driver: 'in-memory',
              key_count: 1420,
              hit_rate_pct: 94.6,
              memory_used_bytes: 8388608,
            },
            webhooks: {
              total_24h: 3420,
              delivered_24h: 3418,
              failed_24h: 2,
              dlq_depth: 0,
            },
            job_runs: [
              { name: 'analytics_nightly_rollup', status: 'SUCCESS', last_run_at: new Date(Date.now() - 3600000 * 6).toISOString(), duration_ms: 420 },
              { name: 'fefo_batch_expiry_scan', status: 'SUCCESS', last_run_at: new Date(Date.now() - 3600000 * 4).toISOString(), duration_ms: 180 },
              { name: 'escrow_auto_release', status: 'SUCCESS', last_run_at: new Date(Date.now() - 3600000 * 2).toISOString(), duration_ms: 310 },
              { name: 'standing_grants_cleanup', status: 'SUCCESS', last_run_at: new Date(Date.now() - 3600000).toISOString(), duration_ms: 95 },
            ],
          },
        },
      };
    },
  },

  // 5. Backups List
  {
    method: 'GET',
    path: '/admin/system/backups',
    handler() {
      return {
        status: 200,
        body: {
          data: {
            backups: mockBackups,
            count: mockBackups.length,
          },
        },
      };
    },
  },

  // 6. Trigger Backup
  {
    method: 'POST',
    path: '/admin/system/backups/trigger',
    handler() {
      const newBackup = {
        id: mockBackups.length + 1,
        snapshot_tag: `SNAP_${Date.now()}`,
        checksum_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        table_count: 95,
        row_count: 143500,
        size_bytes: 49100000,
        status: 'VERIFIED',
        created_at: new Date().toISOString(),
      };
      mockBackups.unshift(newBackup);

      return {
        status: 200,
        body: {
          data: {
            success: true,
            backup: newBackup,
          },
        },
      };
    },
  },

  // 7. Restore Backup
  {
    method: 'POST',
    path: '/admin/system/backups/:id/restore',
    handler({ params }) {
      return {
        status: 200,
        body: {
          data: {
            success: true,
            backup_id: params?.id,
            restored_at: new Date().toISOString(),
            status: 'RESTORE_SIMULATION_SUCCESS',
          },
        },
      };
    },
  },

  // 8. Users List & Search
  {
    method: 'GET',
    path: '/admin/users',
    handler({ query }) {
      const q = (query?.q || '').toLowerCase();
      const role = query?.role || 'ALL';
      const district = query?.district || 'ALL';
      const restriction = query?.restriction || 'ALL';

      const mockUsers = [
        { id: 1, ref: 'USR-8F2K9QX7', phone: '01711000001', email: 'rahim.khan@explooro.com', full_name: 'Rahim Khan', role_key: 'super_admin', role_label_en: 'Super Admin', role_label_bn: 'সুপার অ্যাডমিন', tier: 'ELITE_PARTNER', district: 'Dhaka', status: 'ACTIVE', kyc_status: 'VERIFIED', active_restrictions_count: 0, orders_count: 142, gmv_bdt: 420000, created_at: '2026-01-15T09:00:00Z' },
        { id: 2, ref: 'USR-3M7V2WQ1', phone: '01711000002', email: 'fatima.fashion@gmail.com', full_name: 'Fatima Sultana', role_key: 'saler', role_label_en: 'Saler', role_label_bn: 'সেলার', tier: 'PRO_SELLER', district: 'Sylhet', status: 'ACTIVE', kyc_status: 'VERIFIED', active_restrictions_count: 1, orders_count: 89, gmv_bdt: 185000, created_at: '2026-02-10T11:20:00Z' },
        { id: 3, ref: 'USR-9K4P8ZN2', phone: '01711000003', email: 'karim.textiles@ctg.bd', full_name: 'Karim Textile Mills', role_key: 'supplier', role_label_en: 'Supplier', role_label_bn: 'সাপ্লায়ার', tier: 'VERIFIED_SUPPLIER', district: 'Chittagong', status: 'ACTIVE', kyc_status: 'VERIFIED', active_restrictions_count: 0, orders_count: 310, gmv_bdt: 980000, created_at: '2026-01-20T08:15:00Z' },
        { id: 4, ref: 'USR-5X8L3MB9', phone: '01711000004', email: 'tariq.moderation@explooro.com', full_name: 'Tariq Ahmed', role_key: 'moderator', role_label_en: 'Moderator', role_label_bn: 'মডারেটর', tier: 'STAFF', district: 'Rajshahi', status: 'ACTIVE', kyc_status: 'VERIFIED', active_restrictions_count: 0, orders_count: 12, gmv_bdt: 24000, created_at: '2026-03-01T14:30:00Z' },
        { id: 5, ref: 'USR-2P9C7RT4', phone: '01711000005', email: 'nusrat.editor@explooro.com', full_name: 'Nusrat Jahan', role_key: 'editor', role_label_en: 'Editor', role_label_bn: 'এডিটর', tier: 'STAFF', district: 'Dhaka', status: 'ACTIVE', kyc_status: 'VERIFIED', active_restrictions_count: 0, orders_count: 5, gmv_bdt: 8500, created_at: '2026-03-12T10:00:00Z' },
        { id: 6, ref: 'USR-7N1D5KL8', phone: '01711000006', email: 'anwar.customer@yahoo.com', full_name: 'Anwar Hossain', role_key: 'customer', role_label_en: 'Customer', role_label_bn: 'ক্রেতা', tier: 'STARTER', district: 'Khulna', status: 'ACTIVE', kyc_status: 'UNVERIFIED', active_restrictions_count: 0, orders_count: 18, gmv_bdt: 34500, created_at: '2026-04-05T16:45:00Z' },
        { id: 7, ref: 'USR-4H6J9PV3', phone: '01711000007', email: 'tanvir.crafts@gmail.com', full_name: 'Tanvir Crafts', role_key: 'saler', role_label_en: 'Saler', role_label_bn: 'সেলার', tier: 'STARTER', district: 'Bogura', status: 'RESTRICTED', kyc_status: 'PENDING', active_restrictions_count: 2, orders_count: 7, gmv_bdt: 12800, created_at: '2026-05-18T13:10:00Z' },
      ];

      let filtered = mockUsers.filter((u) => {
        if (q && !u.full_name.toLowerCase().includes(q) && !u.phone.includes(q) && !u.ref.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) {
          return false;
        }
        if (role !== 'ALL' && u.role_key !== role) return false;
        if (district !== 'ALL' && u.district !== district) return false;
        if (restriction === 'CLEAN' && u.active_restrictions_count > 0) return false;
        if (restriction === 'RESTRICTED' && u.active_restrictions_count === 0) return false;
        return true;
      });

      return {
        status: 200,
        body: {
          users: filtered,
          total: filtered.length,
        },
      };
    },
  },

  // 9. User Detail Deep-Dive
  {
    method: 'GET',
    path: '/admin/users/:id',
    handler({ params }) {
      const id = parseInt(params?.id || '1', 10);
      const user = {
        id,
        ref: `USR-${(id * 12345).toString(36).toUpperCase()}`,
        phone: `0171100000${id}`,
        email: `user${id}@explooro.com`,
        full_name: id === 1 ? 'Rahim Khan' : (id === 2 ? 'Fatima Sultana' : `User ${id} Demo`),
        role_key: id === 1 ? 'super_admin' : (id === 2 ? 'saler' : (id === 3 ? 'supplier' : 'customer')),
        role_label_en: id === 1 ? 'Super Admin' : (id === 2 ? 'Saler' : 'Supplier'),
        role_label_bn: id === 1 ? 'সুপার অ্যাডমিন' : (id === 2 ? 'সেলার' : 'সাপ্লায়ার'),
        tier: 'ELITE_PARTNER',
        district: 'Dhaka',
        status: 'ACTIVE',
        kyc_status: 'VERIFIED',
        kyc_document_type: 'NID_SMART_CARD',
        kyc_verified_at: '2026-02-01T12:00:00Z',
        active_restrictions_count: id === 2 ? 1 : 0,
        wallet_balance_bdt: 45800.50,
        escrow_held_bdt: 12400.00,
        total_gmv_bdt: 385000.00,
        total_orders_count: 89,
        created_at: '2026-01-15T09:00:00Z',
        last_login_at: new Date().toISOString(),
        restrictions: id === 2 ? [
          { key: 'can_withdraw', status: 'BLOCKED', reason: 'Suspected high-velocity withdrawal spike under manual verification review.', enforced_by: 'Super Admin', created_at: '2026-08-20T10:00:00Z' },
        ] : [],
        permissions: [
          { key: 'admin.dashboard.view', label_en: 'Executive Dashboard View', domain: 'admin', why: 'Held via super_admin role', status: 'GRANTED' },
          { key: 'users.account.view', label_en: 'Inspect User Accounts', domain: 'users', why: 'Held via super_admin role', status: 'GRANTED' },
          { key: 'finance.payout.approve', label_en: 'Approve Payouts', domain: 'finance', why: 'Standing Grant by Super Admin until 2026-09-30', status: 'GRANTED' },
        ],
      };

      return {
        status: 200,
        body: { user },
      };
    },
  },

  // 10. User Timeline
  {
    method: 'GET',
    path: '/admin/users/:id/timeline',
    handler({ params }) {
      return {
        status: 200,
        body: {
          events: [
            { id: 1, event_type: 'LOGIN_2FA_SUCCESS', details_en: 'Successful TOTP 2FA verification from IP 103.145.2.14', created_at: new Date(Date.now() - 3600000 * 2).toISOString() },
            { id: 2, event_type: 'PROFILE_UPDATED', details_en: 'Updated store display banner and bank account routing number.', created_at: new Date(Date.now() - 3600000 * 28).toISOString() },
            { id: 3, event_type: 'KYC_APPROVED', details_en: 'National ID smart card approved by Compliance Officer #4.', created_at: new Date(Date.now() - 3600000 * 120).toISOString() },
          ],
        },
      };
    },
  },

  // 11. Roles & Permissions Baseline Matrix
  {
    method: 'GET',
    path: '/admin/roles-permissions',
    handler() {
      const roles = [
        { id: 1, key: 'customer', label_en: 'Customer', label_bn: 'ক্রেতা', level: 10, is_system: true },
        { id: 2, key: 'saler', label_en: 'Saler', label_bn: 'সেলার', level: 20, is_system: true },
        { id: 3, key: 'supplier', label_en: 'Supplier', label_bn: 'সাপ্লায়ার', level: 20, is_system: true },
        { id: 4, key: 'moderator', label_en: 'Moderator', label_bn: 'মডারেটর', level: 50, is_system: true },
        { id: 5, key: 'editor', label_en: 'Editor', label_bn: 'এডিটর', level: 60, is_system: true },
        { id: 6, key: 'super_admin', label_en: 'Super Admin', label_bn: 'সুপার অ্যাডমিন', level: 100, is_system: true },
      ];

      const permissions = [
        // Admin
        { key: 'admin.dashboard.view', domain: 'admin', label_en: 'Executive Dashboard View', label_bn: 'ড্যাশবোর্ড দর্শন', plain_en: 'Access live revenue, KPIs and operational alert cards', plain_bn: 'লাইভ রাজস্ব, কেপিআই ও অ্যালার্ট কার্ড দেখুন', risk_tier: 'LOW' },
        { key: 'admin.system.diagnostics', domain: 'admin', label_en: 'System Diagnostics & Health', label_bn: 'সিস্টেম স্বাস্থ্য ও ডায়াগনস্টিকস', plain_en: 'Inspect database pool, cache layer and scheduler', plain_bn: 'ডাটাবেস পুল ও ক্যাশ মনিটর করুন', risk_tier: 'HIGH' },
        { key: 'admin.backup.restore', domain: 'admin', label_en: 'Disaster Recovery Snapshot Restore', label_bn: 'সিস্টেম স্ন্যাপশট রিস্টোর', plain_en: 'Revert state to SHA-256 verified snapshot', plain_bn: 'সিস্টেম স্ন্যাপশটে ডেটা রিস্টোর করুন', risk_tier: 'CRITICAL' },

        // Users
        { key: 'users.account.view', domain: 'users', label_en: 'Inspect User Accounts', label_bn: 'ব্যবহারকারী অ্যাকাউন্ট পরিদর্শন', plain_en: 'View customer, saler and supplier profiles', plain_bn: 'ব্যবহারকারীর বিস্তারিত প্রোফাইল দেখুন', risk_tier: 'LOW' },
        { key: 'users.kyc.approve', domain: 'users', label_en: 'KYC & NID Verification', label_bn: 'কেওয়াইসি ও এনআইডি অনুমোদন', plain_en: 'Approve or reject trade license and NID submissions', plain_bn: 'এনআইডি ও ট্রেড লাইসেন্স যাচাই করুন', risk_tier: 'MEDIUM' },
        { key: 'users.permission.grant', domain: 'users', label_en: 'Issue Standing Access Grant', label_bn: 'স্ট্যান্ডিং অ্যাক্সেস অনুদান', plain_en: 'Temporarily elevate staff permissions', plain_bn: 'স্টাফের পারমিশন সাময়িকভাবে বৃদ্ধি করুন', risk_tier: 'HIGH' },
        { key: 'users.restriction.manage', domain: 'users', label_en: 'Apply User Restrictions & Sanctions', label_bn: 'ব্যবহারকারী নিষেধাজ্ঞা প্রয়োগ', plain_en: 'Block capability such as selling, buying or withdrawing', plain_bn: 'অ্যাকাউন্টে বিভিন্ন নিষেধাজ্ঞা আরোপ করুন', risk_tier: 'HIGH' },

        // Catalog
        { key: 'catalog.product.view', domain: 'catalog', label_en: 'View Product Catalog', label_bn: 'পণ্য ক্যাটালগ দেখুন', plain_en: 'Browse wholesale and reseller products', plain_bn: 'পণ্য তালিকা দেখুন', risk_tier: 'LOW' },
        { key: 'catalog.product.approve', domain: 'catalog', label_en: 'Approve Supplier Products', label_bn: 'সাপ্লায়ার পণ্য অনুমোদন', plain_en: 'Review and publish supplier listings', plain_bn: 'সাপ্লায়ারের পণ্য অনুমোদন করুন', risk_tier: 'MEDIUM' },
        { key: 'catalog.product.delete', domain: 'catalog', label_en: 'Permanent Catalog Deletion', label_bn: 'স্থায়ী পণ্য মুছে ফেলা', plain_en: 'Irreversibly delete products and variants', plain_bn: 'পণ্য স্থায়ীভাবে মুছে ফেলুন', risk_tier: 'CRITICAL' },

        // Finance
        { key: 'finance.vault.view', domain: 'finance', label_en: 'View Vault Balances', label_bn: 'ভল্ট ব্যালেন্স দেখুন', plain_en: 'Inspect earnings and ledger movements', plain_bn: 'আয় ও ব্যালেন্স দেখুন', risk_tier: 'LOW' },
        { key: 'finance.cod.reconcile', domain: 'finance', label_en: 'COD Courier Reconciliation', label_bn: 'সিওডি কুরিয়ার সমন্বয়', plain_en: 'Reconcile remittance spreadsheets and mark settled', plain_bn: 'কুরিয়ার রেমিট্যান্স শিট যাচাই করুন', risk_tier: 'HIGH' },
        { key: 'finance.payout.approve', domain: 'finance', label_en: 'Approve Payout Cashouts', label_bn: 'পেআউট উইথড্রয়াল অনুমোদন', plain_en: 'Disburse funds to bKash/Nagad/Bank', plain_bn: 'সেলারদের টাকা তোলার আবেদন অনুমোদন করুন', risk_tier: 'CRITICAL' },

        // Platform
        { key: 'platform.apikey.issue', domain: 'platform', label_en: 'Manage API Keys & Webhooks', label_bn: 'এপিআই কী ও ওয়েবহুক পরিচালনা', plain_en: 'Issue developer access credentials', plain_bn: 'ডেভেলপার এপিআই কী ইস্যু করুন', risk_tier: 'HIGH' },
        { key: 'platform.theme.publish', domain: 'platform', label_en: 'Publish Theme & Palettes', label_bn: 'থিম ও প্যালেট প্রকাশ', plain_en: 'Activate system-wide color palette', plain_bn: 'নতুন কালার থিম সক্রিয় করুন', risk_tier: 'CRITICAL' },
        { key: 'platform.module.toggle', domain: 'platform', label_en: 'Toggle Platform Modules (Feature Flags)', label_bn: 'মডিউল অন/অফ নিয়ন্ত্রণ', plain_en: 'Enable or disable commerce core modules', plain_bn: 'কোর মডিউল চালু বা বন্ধ করুন', risk_tier: 'CRITICAL' },
      ];

      const rolePermissions = [
        // Customer
        { role_id: 1, permission_key: 'catalog.product.view' },
        { role_id: 1, permission_key: 'finance.vault.view' },

        // Saler
        { role_id: 2, permission_key: 'catalog.product.view' },
        { role_id: 2, permission_key: 'finance.vault.view' },

        // Supplier
        { role_id: 3, permission_key: 'catalog.product.view' },
        { role_id: 3, permission_key: 'finance.vault.view' },

        // Moderator
        { role_id: 4, permission_key: 'admin.dashboard.view' },
        { role_id: 4, permission_key: 'users.account.view' },
        { role_id: 4, permission_key: 'users.kyc.approve' },
        { role_id: 4, permission_key: 'users.restriction.manage' },
        { role_id: 4, permission_key: 'catalog.product.view' },
        { role_id: 4, permission_key: 'catalog.product.approve' },
        { role_id: 4, permission_key: 'finance.vault.view' },

        // Editor
        { role_id: 5, permission_key: 'admin.dashboard.view' },
        { role_id: 5, permission_key: 'catalog.product.view' },
        { role_id: 5, permission_key: 'catalog.product.approve' },

        // Super admin inherits all via isSuperAdmin
      ];

      return {
        status: 200,
        body: {
          roles,
          permissions,
          rolePermissions,
        },
      };
    },
  },

  // 12. Staff Roster & Management
  {
    method: 'GET',
    path: '/admin/staff',
    handler({ query }) {
      const q = (query?.q || '').toLowerCase();
      const role = query?.role || 'ALL';

      const staffList = [
        { id: 1, ref: 'STF-001', full_name: 'Rahim Khan', email: 'rahim.khan@explooro.com', phone: '01711000001', role_key: 'super_admin', role_label_en: 'Super Admin', role_label_bn: 'সুপার অ্যাডমিন', department: 'Executive Operations', two_factor_enabled: true, status: 'ACTIVE', last_active_at: new Date().toISOString(), permissions_count: 86 },
        { id: 4, ref: 'STF-002', full_name: 'Tariq Ahmed', email: 'tariq.moderation@explooro.com', phone: '01711000004', role_key: 'moderator', role_label_en: 'Moderator', role_label_bn: 'মডারেটর', department: 'Trust & Safety', two_factor_enabled: true, status: 'ACTIVE', last_active_at: new Date(Date.now() - 3600000 * 3).toISOString(), permissions_count: 24 },
        { id: 5, ref: 'STF-003', full_name: 'Nusrat Jahan', email: 'nusrat.editor@explooro.com', phone: '01711000005', role_key: 'editor', role_label_en: 'Editor', role_label_bn: 'এডিটর', department: 'Content Commerce', two_factor_enabled: true, status: 'ACTIVE', last_active_at: new Date(Date.now() - 3600000 * 12).toISOString(), permissions_count: 16 },
        { id: 8, ref: 'STF-004', full_name: 'Kamal Uddin', email: 'kamal.finance@explooro.com', phone: '01711000008', role_key: 'moderator', role_label_en: 'Finance Compliance', role_label_bn: 'ফাইন্যান্স কমপ্লায়েন্স', department: 'Finance & Escrow', two_factor_enabled: true, status: 'ACTIVE', last_active_at: new Date(Date.now() - 3600000 * 24).toISOString(), permissions_count: 28 },
      ];

      let filtered = staffList.filter((s) => {
        if (q && !s.full_name.toLowerCase().includes(q) && !s.email.toLowerCase().includes(q) && !s.ref.toLowerCase().includes(q) && !s.phone.includes(q)) {
          return false;
        }
        if (role !== 'ALL' && s.role_key !== role) return false;
        return true;
      });

      return {
        status: 200,
        body: {
          staff: filtered,
          total: filtered.length,
          vitals: {
            total_staff: staffList.length,
            active_staff: staffList.filter(s => s.status === 'ACTIVE').length,
            two_factor_rate_pct: 100.0,
            privileged_roles_count: staffList.filter(s => s.role_key === 'super_admin').length,
          },
        },
      };
    },
  },

  // 13. Add / Provision Staff Member
  {
    method: 'POST',
    path: '/admin/staff',
    handler({ body }) {
      const newStaff = {
        id: Math.floor(100 + Math.random() * 900),
        ref: `STF-00${Math.floor(5 + Math.random() * 20)}`,
        full_name: body?.full_name || 'New Staff Member',
        email: body?.email || 'staff@explooro.com',
        phone: body?.phone || '01700000000',
        role_key: body?.role_key || 'moderator',
        role_label_en: body?.role_key === 'super_admin' ? 'Super Admin' : (body?.role_key === 'editor' ? 'Editor' : 'Moderator'),
        role_label_bn: body?.role_key === 'super_admin' ? 'সুপার অ্যাডমিন' : (body?.role_key === 'editor' ? 'এডিটর' : 'মডারেটর'),
        department: body?.department || 'Operations',
        two_factor_enabled: false,
        status: 'INVITED',
        last_active_at: null,
        permissions_count: 20,
      };

      return {
        status: 201,
        body: {
          success: true,
          staff: newStaff,
          message_en: `Provisioned staff member ${newStaff.full_name} with role ${newStaff.role_label_en}. Temporary invitation credentials dispatched.`,
          message_bn: `${newStaff.full_name}-কে সফলভাবে যোগ করা হয়েছে। সাময়িক ইনভিটেশন পাঠানো হয়েছে।`,
        },
      };
    },
  },

  // 14. Reset Staff 2FA
  {
    method: 'POST',
    path: '/admin/staff/:id/reset-2fa',
    handler({ params }) {
      return {
        status: 200,
        body: {
          success: true,
          staff_id: params?.id,
          message_en: 'Staff 2FA has been reset. The user will be required to configure TOTP on next login.',
          message_bn: 'স্টাফের ২এফএ রিসেট করা হয়েছে। পরবর্তী লগইনে নতুন করে ২এফএ সেট করতে হবে।',
        },
      };
    },
  },

  // 15. Update Staff Role
  {
    method: 'PATCH',
    path: '/admin/staff/:id/role',
    handler({ params, body }) {
      return {
        status: 200,
        body: {
          success: true,
          staff_id: params?.id,
          new_role: body?.role_key,
          message_en: 'Staff role updated successfully with audit trail recording.',
          message_bn: 'স্টাফ রোল সফলভাবে আপডেট করা হয়েছে।',
        },
      };
    },
  },

  // 16. Update Staff Status (Activate / Suspend)
  {
    method: 'PATCH',
    path: '/admin/staff/:id/status',
    handler({ params, body }) {
      return {
        status: 200,
        body: {
          success: true,
          staff_id: params?.id,
          status: body?.status,
          message_en: `Staff account status updated to ${body?.status}.`,
          message_bn: `স্টাফ অ্যাকাউন্টের অবস্থা ${body?.status} করা হয়েছে।`,
        },
      };
    },
  },

  // 17. Standing Access Grants (Mode A)
  {
    method: 'GET',
    path: '/admin/grants',
    handler({ query }) {
      const statusFilter = query?.status || 'ALL';
      const mockGrants = [
        {
          id: 1,
          user_id: 4,
          grantee_phone: '01711000004',
          grantee_name: 'Tariq Ahmed',
          grantee_ref: 'STF-002',
          permission_key: 'finance.payout.approve',
          effect: 'GRANT',
          scope_json: { max_amount_bdt: 50000 },
          reason: 'Covering senior finance compliance officer during annual medical leave window.',
          granted_by: 'Rahim Khan (Super Admin)',
          created_at: new Date(Date.now() - 3600000 * 48).toISOString(),
          expires_at: new Date(Date.now() + 3600000 * 24 * 14).toISOString(),
          revoked_at: null,
          revocation_reason: null,
        },
        {
          id: 2,
          user_id: 5,
          grantee_phone: '01711000005',
          grantee_name: 'Nusrat Jahan',
          grantee_ref: 'STF-003',
          permission_key: 'catalog.product.delete',
          effect: 'GRANT',
          scope_json: { category: 'fashion' },
          reason: 'Emergency catalog spam purge for duplicate fake supplier submissions.',
          granted_by: 'Rahim Khan (Super Admin)',
          created_at: new Date(Date.now() - 3600000 * 24 * 5).toISOString(),
          expires_at: new Date(Date.now() + 3600000 * 24 * 2).toISOString(),
          revoked_at: null,
          revocation_reason: null,
        },
        {
          id: 3,
          user_id: 8,
          grantee_phone: '01711000008',
          grantee_name: 'Kamal Uddin',
          grantee_ref: 'STF-004',
          permission_key: 'finance.cod.reconcile',
          effect: 'GRANT',
          scope_json: null,
          reason: 'Month-end courier settlement reconciliation support.',
          granted_by: 'Rahim Khan (Super Admin)',
          created_at: new Date(Date.now() - 3600000 * 24 * 35).toISOString(),
          expires_at: new Date(Date.now() - 3600000 * 24 * 5).toISOString(),
          revoked_at: null,
          revocation_reason: null,
        },
      ];

      let filtered = mockGrants.filter((g) => {
        const isRevoked = Boolean(g.revoked_at);
        const isExpired = new Date(g.expires_at).getTime() <= Date.now();
        const curStatus = isRevoked ? 'REVOKED' : (isExpired ? 'EXPIRED' : 'ACTIVE');

        if (statusFilter !== 'ALL' && curStatus !== statusFilter) return false;
        return true;
      });

      return {
        status: 200,
        body: {
          data: {
            grants: filtered,
          },
          grants: filtered,
          total: filtered.length,
        },
      };
    },
  },

  // 18. Create Standing Access Grant
  {
    method: 'POST',
    path: '/admin/grants',
    handler({ body }) {
      const newGrant = {
        id: Math.floor(10 + Math.random() * 90),
        user_id: body?.user_id,
        grantee_phone: body?.grantee_phone || '01711000004',
        grantee_name: 'Staff Operator',
        grantee_ref: `STF-00${body?.user_id || 2}`,
        permission_key: body?.permission_key,
        effect: body?.effect || 'GRANT',
        scope_json: body?.scope_json || null,
        reason: body?.reason,
        granted_by: 'Super Admin',
        created_at: new Date().toISOString(),
        expires_at: body?.expires_at || new Date(Date.now() + 3600000 * 24 * 7).toISOString(),
        revoked_at: null,
      };

      return {
        status: 201,
        body: {
          data: { grant: newGrant },
          grant: newGrant,
          message_en: `Issued standing grant for ${newGrant.permission_key} with automatic expiration on ${new Date(newGrant.expires_at).toLocaleDateString()}.`,
          message_bn: `${newGrant.permission_key}-এর জন্য স্ট্যান্ডিং গ্রান্ট সফলভাবে প্রদান করা হয়েছে।`,
        },
      };
    },
  },

  // 19. Revoke Standing Access Grant
  {
    method: 'DELETE',
    path: '/admin/grants/:id',
    handler({ params, body }) {
      return {
        status: 200,
        body: {
          data: {
            revoked: true,
            grant_id: params?.id,
            revocation_reason: body?.reason,
          },
          message_en: 'Standing grant successfully revoked.',
          message_bn: 'স্ট্যান্ডিং গ্রান্ট সফলভাবে প্রত্যাহার করা হয়েছে।',
        },
      };
    },
  },

  // 20. Mode B: Just-In-Time Access Requests
  {
    method: 'GET',
    path: '/access-requests',
    handler({ query }) {
      const mockJit = [
        {
          id: 1,
          ref: 'JIT-84920',
          requester_id: 4,
          requester_phone: '01711000004',
          requester_name: 'Tariq Ahmed (Trust & Safety)',
          permission_key: 'users.restriction.manage',
          risk_tier: 'HIGH',
          reason: 'Urgent seller velocity limit override for verified high-volume Eid merchant.',
          status: 'PENDING',
          created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
          expires_at: new Date(Date.now() + 3600000 * 22).toISOString(),
        },
        {
          id: 2,
          ref: 'JIT-84921',
          requester_id: 5,
          requester_phone: '01711000005',
          requester_name: 'Nusrat Jahan (Content Commerce)',
          permission_key: 'catalog.product.delete',
          risk_tier: 'HIGH',
          reason: 'Removing counterfeit duplicate batch submitted by flagged vendor.',
          status: 'PENDING',
          created_at: new Date(Date.now() - 3600000 * 5).toISOString(),
          expires_at: new Date(Date.now() + 3600000 * 19).toISOString(),
        },
      ];

      return {
        status: 200,
        body: {
          data: { requests: mockJit },
          requests: mockJit,
          total: mockJit.length,
        },
      };
    },
  },

  // 21. Decide JIT Access Request
  {
    method: 'PATCH',
    path: '/access-requests/:id',
    handler({ params, body }) {
      const decision = body?.decision || 'APPROVE';
      return {
        status: 200,
        body: {
          data: {
            request_id: params?.id,
            status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
            decided_at: new Date().toISOString(),
          },
          message_en: `JIT Access request ${decision === 'APPROVE' ? 'approved' : 'rejected'}.`,
          message_bn: `জেআইটি অ্যাক্সেস অনুরোধ ${decision === 'APPROVE' ? 'অনুমোদিত' : 'প্রত্যাখ্যাত'}।`,
        },
      };
    },
  },

  // 22. Mode C: Pending Maker-Checker Admin Actions
  {
    method: 'GET',
    path: '/admin/pending-actions',
    handler({ query }) {
      const mockActions = [
        {
          id: 1,
          action_key: 'platform.module.toggle',
          action_ref: 'ACT-9021',
          submitter_id: 4,
          submitter_name: 'Tariq Ahmed',
          submitter_role: 'moderator',
          risk_tier: 'CRITICAL',
          target_entity_type: 'MODULE',
          target_entity_id: 'supplier_verification',
          reason: 'Temporarily relax mandatory trade license for rural artisanal weavers.',
          before_state_json: {
            module: 'supplier_verification',
            enabled: true,
            require_trade_license: true,
          },
          payload_json: {
            module: 'supplier_verification',
            enabled: true,
            require_trade_license: false,
          },
          status: 'PENDING',
          created_at: new Date(Date.now() - 3600000 * 1).toISOString(),
        },
        {
          id: 2,
          action_key: 'finance.payout.batch_disburse',
          action_ref: 'ACT-9022',
          submitter_id: 8,
          submitter_name: 'Kamal Uddin',
          submitter_role: 'moderator',
          risk_tier: 'CRITICAL',
          target_entity_type: 'PAYOUT_BATCH',
          target_entity_id: 'BATCH-2026-W34',
          reason: 'Weekly aggregated merchant cashouts exceeding standard single-operator ceiling.',
          before_state_json: {
            batch_id: 'BATCH-2026-W34',
            total_bdt: 450000.00,
            status: 'QUEUED',
          },
          payload_json: {
            batch_id: 'BATCH-2026-W34',
            total_bdt: 450000.00,
            status: 'DISBURSED',
            gateway: 'bKash Merchant B2C',
          },
          status: 'PENDING',
          created_at: new Date(Date.now() - 3600000 * 4).toISOString(),
        },
      ];

      return {
        status: 200,
        body: {
          data: { actions: mockActions },
          actions: mockActions,
          total: mockActions.length,
        },
      };
    },
  },

  // 23. Decide Maker-Checker Action
  {
    method: 'PATCH',
    path: '/admin/pending-actions/:id',
    handler({ params, body }) {
      const decision = body?.decision || 'APPROVE';
      return {
        status: 200,
        body: {
          data: {
            action_id: params?.id,
            status: decision === 'APPROVE' ? 'EXECUTED' : 'REJECTED',
            decided_at: new Date().toISOString(),
          },
          message_en: `Critical mutation ${decision === 'APPROVE' ? 'approved and executed' : 'rejected'}.`,
          message_bn: `গুরুত্বপূর্ণ অ্যাকশন ${decision === 'APPROVE' ? 'অনুমোদিত ও কার্যকর' : 'প্রত্যাখ্যাত'}।`,
        },
      };
    },
  },

  // 24. Admin KYC Verification Queue
  {
    method: 'GET',
    path: '/admin/kyc/queue',
    handler({ query }) {
      const statusFilter = query?.status || 'PENDING';
      const mockKyc = [
        {
          id: 1,
          ref: 'KYC-98210',
          user_id: 2,
          applicant_name: 'Anisur Rahman',
          applicant_phone: '01711000002',
          applicant_email: 'anisur@jamdani-crafts.bd',
          business_name: 'Jamdani Heritage Weavers Ltd.',
          business_address: 'Rupganj, Narayanganj, Dhaka',
          kyc_type: 'SUPPLIER',
          current_tier: 'TIER_1',
          trust_score: 42,
          doc_count: 3,
          status: 'PENDING',
          created_at: new Date(Date.now() - 3600000 * 3).toISOString(),
          documents: [
            { id: 101, doc_type: 'National ID (NID Front)', mime_type: 'image/jpeg', view_count: 1, storage_key: 'kyc/nid_front_98210.jpg' },
            { id: 102, doc_type: 'National ID (NID Back)', mime_type: 'image/jpeg', view_count: 1, storage_key: 'kyc/nid_back_98210.jpg' },
            { id: 103, doc_type: 'Trade License 2025-2026', mime_type: 'application/pdf', view_count: 2, storage_key: 'kyc/trade_lic_98210.pdf' },
          ],
        },
        {
          id: 2,
          ref: 'KYC-98211',
          user_id: 3,
          applicant_name: 'Farzana Akter',
          applicant_phone: '01711000003',
          applicant_email: 'farzana@saffron-glam.com',
          business_name: 'Saffron Glam Cosmetics',
          business_address: 'House 42, Road 11, Banani, Dhaka',
          kyc_type: 'SALER',
          current_tier: 'TIER_2',
          trust_score: 68,
          doc_count: 2,
          status: 'PENDING',
          created_at: new Date(Date.now() - 3600000 * 6).toISOString(),
          documents: [
            { id: 104, doc_type: 'Smart National ID', mime_type: 'image/jpeg', view_count: 0, storage_key: 'kyc/smart_nid_98211.jpg' },
            { id: 105, doc_type: 'Selfie with NID', mime_type: 'image/jpeg', view_count: 0, storage_key: 'kyc/selfie_nid_98211.jpg' },
          ],
        },
        {
          id: 3,
          ref: 'KYC-98212',
          user_id: 6,
          applicant_name: 'Mahmudul Hasan',
          applicant_phone: '01711000006',
          applicant_email: 'mahmud@bengal-leather.com',
          business_name: 'Bengal Leather Crafts',
          business_address: 'Hazaribagh, Dhaka',
          kyc_type: 'SUPPLIER',
          current_tier: 'TIER_3',
          trust_score: 88,
          doc_count: 4,
          status: 'VERIFIED',
          created_at: new Date(Date.now() - 3600000 * 48).toISOString(),
          documents: [
            { id: 106, doc_type: 'National ID', mime_type: 'image/jpeg', view_count: 3, storage_key: 'kyc/nid_98212.jpg' },
            { id: 107, doc_type: 'Trade License', mime_type: 'application/pdf', view_count: 4, storage_key: 'kyc/trade_98212.pdf' },
            { id: 108, doc_type: 'TIN Certificate', mime_type: 'application/pdf', view_count: 2, storage_key: 'kyc/tin_98212.pdf' },
            { id: 109, doc_type: 'Warehouse Utility Bill', mime_type: 'image/png', view_count: 2, storage_key: 'kyc/bill_98212.png' },
          ],
        },
      ];

      const filtered = statusFilter === 'ALL'
        ? mockKyc
        : mockKyc.filter((k) => k.status === statusFilter);

      return {
        status: 200,
        body: {
          data: { items: filtered, total: filtered.length },
          items: filtered,
          total: filtered.length,
        },
      };
    },
  },

  // 25. Admin KYC Details by ID
  {
    method: 'GET',
    path: '/admin/kyc/:id',
    handler({ params }) {
      const id = Number(params?.id) || 1;
      const kycDetail = {
        id,
        ref: `KYC-982${id + 9}`,
        user_id: id + 1,
        applicant_name: id === 1 ? 'Anisur Rahman' : (id === 2 ? 'Farzana Akter' : 'Mahmudul Hasan'),
        applicant_phone: id === 1 ? '01711000002' : (id === 2 ? '01711000003' : '01711000006'),
        applicant_email: id === 1 ? 'anisur@jamdani-crafts.bd' : (id === 2 ? 'farzana@saffron-glam.com' : 'mahmud@bengal-leather.com'),
        business_name: id === 1 ? 'Jamdani Heritage Weavers Ltd.' : (id === 2 ? 'Saffron Glam Cosmetics' : 'Bengal Leather Crafts'),
        business_address: id === 1 ? 'Rupganj, Narayanganj, Dhaka' : (id === 2 ? 'House 42, Road 11, Banani, Dhaka' : 'Hazaribagh, Dhaka'),
        kyc_type: id === 2 ? 'SALER' : 'SUPPLIER',
        current_tier: id === 3 ? 'TIER_3' : (id === 2 ? 'TIER_2' : 'TIER_1'),
        trust_score: id === 3 ? 88 : (id === 2 ? 68 : 42),
        doc_count: id === 3 ? 4 : (id === 2 ? 2 : 3),
        status: id === 3 ? 'VERIFIED' : 'PENDING',
        created_at: new Date(Date.now() - 3600000 * 5).toISOString(),
        documents: [
          { id: 101, doc_type: 'National ID (NID Front)', mime_type: 'image/jpeg', view_count: 1, storage_key: 'kyc/nid_front_98210.jpg' },
          { id: 102, doc_type: 'National ID (NID Back)', mime_type: 'image/jpeg', view_count: 1, storage_key: 'kyc/nid_back_98210.jpg' },
          { id: 103, doc_type: 'Trade License 2025-2026', mime_type: 'application/pdf', view_count: 2, storage_key: 'kyc/trade_lic_98210.pdf' },
        ],
      };

      return {
        status: 200,
        body: {
          data: kycDetail,
          ...kycDetail,
        },
      };
    },
  },

  // 26. Audited Document View
  {
    method: 'GET',
    path: '/admin/kyc/:id/documents/:docId',
    handler({ params }) {
      return {
        status: 200,
        body: {
          data: {
            id: Number(params?.docId),
            kyc_id: Number(params?.id),
            doc_type: 'National ID / Trade License',
            mime_type: 'image/jpeg',
            storage_key: `secure_vault/kyc_${params?.id}_doc_${params?.docId}.enc`,
            view_count: 1,
            watermark_text: 'CONFIDENTIAL · EXPLOORO AUDITED VIEW',
          },
        },
      };
    },
  },

  // 27. Decide KYC Submission
  {
    method: 'POST',
    path: '/admin/kyc/:id/decide',
    handler({ params, body }) {
      const decision = body?.decision || 'VERIFIED';
      return {
        status: 200,
        body: {
          data: {
            kyc_id: params?.id,
            status: decision,
            decided_at: new Date().toISOString(),
          },
          message_en: `KYC submission marked as ${decision}.`,
          message_bn: `কেওয়াইসি আবেদন সফলভাবে ${decision === 'VERIFIED' ? 'অনুমোদিত' : 'প্রত্যাখ্যাত'} করা হয়েছে।`,
        },
      };
    },
  },

  // 28. List Account Restrictions & Sanctions
  {
    method: 'GET',
    path: '/admin/restrictions',
    handler({ query }) {
      const statusFilter = query?.status || 'ALL';
      const capabilityFilter = query?.capability || 'ALL';

      const mockRestrictions = [
        {
          id: 1,
          ref: 'RST-84920',
          subject_type: 'USER',
          subject_ref: 'USR-89210',
          user_name: 'Tanvir Hossain',
          user_phone: '01811000002',
          capability_key: 'can_sell',
          mode: 'HARD_BLOCK',
          limit_value: null,
          reason: 'Multiple counterfeit product copyright infringement complaints.',
          applied_by: 'Rahim Khan (Super Admin)',
          created_at: new Date(Date.now() - 3600000 * 24 * 4).toISOString(),
          expires_at: new Date(Date.now() + 3600000 * 24 * 26).toISOString(),
          lifted_at: null,
        },
        {
          id: 2,
          ref: 'RST-84921',
          subject_type: 'USER',
          subject_ref: 'USR-89211',
          user_name: 'Nasrin Sultana',
          user_phone: '01811000003',
          capability_key: 'can_withdraw',
          mode: 'HARD_BLOCK',
          limit_value: null,
          reason: 'KYC identity verification pending audit review.',
          applied_by: 'Tariq Ahmed (Moderator)',
          created_at: new Date(Date.now() - 3600000 * 24 * 2).toISOString(),
          expires_at: null,
          lifted_at: null,
        },
        {
          id: 3,
          ref: 'RST-84922',
          subject_type: 'USER',
          subject_ref: 'USR-89215',
          user_name: 'Belal Ahmed',
          user_phone: '01811000007',
          capability_key: 'max_daily_order_count',
          mode: 'SOFT_LIMIT',
          limit_value: 5,
          reason: 'Unusual rapid ordering pattern velocity throttle.',
          applied_by: 'System Risk Engine',
          created_at: new Date(Date.now() - 3600000 * 12).toISOString(),
          expires_at: new Date(Date.now() + 3600000 * 36).toISOString(),
          lifted_at: null,
        },
        {
          id: 4,
          ref: 'RST-84923',
          subject_type: 'USER',
          subject_ref: 'USR-89219',
          user_name: 'Suman Roy',
          user_phone: '01811000010',
          capability_key: 'can_chat',
          mode: 'HARD_BLOCK',
          limit_value: null,
          reason: 'Inappropriate language in seller inquiries.',
          applied_by: 'Tariq Ahmed (Moderator)',
          created_at: new Date(Date.now() - 3600000 * 24 * 15).toISOString(),
          expires_at: new Date(Date.now() - 3600000 * 24 * 1).toISOString(),
          lifted_at: new Date(Date.now() - 3600000 * 24 * 1).toISOString(),
          lifted_by: 'Tariq Ahmed',
          lift_reason: 'Completed 14-day communication cooling-off period.',
        },
      ];

      let filtered = mockRestrictions.filter((r) => {
        const isActive = !r.lifted_at && (!r.expires_at || new Date(r.expires_at).getTime() > Date.now());
        if (statusFilter === 'ACTIVE' && !isActive) return false;
        if (statusFilter === 'LIFTED' && isActive) return false;
        if (capabilityFilter !== 'ALL' && r.capability_key !== capabilityFilter) return false;
        return true;
      });

      return {
        status: 200,
        body: {
          data: { restrictions: filtered, total: filtered.length },
          restrictions: filtered,
          total: filtered.length,
        },
      };
    },
  },

  // 29. Create Restriction
  {
    method: 'POST',
    path: '/admin/restrictions',
    handler({ body }) {
      const newRestriction = {
        id: Math.floor(100 + Math.random() * 900),
        ref: `RST-${Math.floor(10000 + Math.random() * 90000)}`,
        subject_type: body?.subject_type || 'USER',
        subject_ref: body?.subject_ref || 'USR-89210',
        user_name: 'Target Account',
        user_phone: '01811000000',
        capability_key: body?.capability_key || 'can_sell',
        mode: body?.mode || 'HARD_BLOCK',
        limit_value: body?.limit_value || null,
        reason: body?.reason || 'Administrative restriction applied.',
        applied_by: 'Super Admin',
        created_at: new Date().toISOString(),
        expires_at: body?.expires_at || null,
        lifted_at: null,
      };

      return {
        status: 201,
        body: {
          data: { restriction: newRestriction },
          restriction: newRestriction,
          message_en: 'Restriction successfully applied.',
          message_bn: 'নিষেধাজ্ঞা সফলভাবে কার্যকর করা হয়েছে।',
        },
      };
    },
  },

  // 30. Lift / Revoke Restriction
  {
    method: 'DELETE',
    path: '/admin/restrictions/:id',
    handler({ params, body }) {
      return {
        status: 200,
        body: {
          data: {
            lifted: true,
            restriction_id: params?.id,
            lift_reason: body?.reason,
          },
          message_en: 'Restriction successfully lifted.',
          message_bn: 'নিষেধাজ্ঞা সফলভাবে প্রত্যাহার করা হয়েছে।',
        },
      };
    },
  },

  // 31. Verify Audit Tamper-Evident Hash Chain
  {
    method: 'GET',
    path: '/admin/audit/verify',
    handler() {
      return {
        status: 200,
        body: {
          valid: true,
          verified_count: 248,
          verifiedCount: 248,
          broken_index: null,
          brokenIndex: null,
          hash_algorithm: 'SHA-256',
          last_verified_at: new Date().toISOString(),
          message_en: 'Audit log cryptographic hash chain is 100% intact and tamper-evident.',
          message_bn: 'অডিট লগ ক্রিপ্টোগ্রাফিক হ্যাশ চেইন সম্পূর্ণ অটুট ও যাচাইকৃত।',
        },
      };
    },
  },

  // 32. List Audit Logs
  {
    method: 'GET',
    path: '/admin/audit',
    handler({ query }) {
      const riskFilter = query?.risk_tier || 'ALL';
      const actionFilter = query?.action || 'ALL';

      const mockLogs = [
        {
          id: 104,
          action: 'platform.module.toggle',
          action_label: 'Toggle Platform Module',
          target_type: 'MODULE',
          target_ref: 'supplier_verification',
          actor_id: 1,
          actor_ref: 'STF-001',
          actor_name: 'Rahim Khan',
          actor_phone: '01711000001',
          ip: '103.205.71.12',
          trace_id: 'TRC-98A72B81',
          risk_tier: 'CRITICAL',
          before: { key: 'supplier_verification', require_trade_license: true },
          after: { key: 'supplier_verification', require_trade_license: false, reason: 'Boishakh craft fair weaver support' },
          undo_payload: { action: 'platform.module.toggle', module_key: 'supplier_verification', is_enabled: true },
          created_at: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
        },
        {
          id: 103,
          action: 'users.restriction.create',
          action_label: 'Apply User Sanction',
          target_type: 'USER',
          target_ref: 'USR-89210',
          actor_id: 1,
          actor_ref: 'STF-001',
          actor_name: 'Rahim Khan',
          actor_phone: '01711000001',
          ip: '103.205.71.12',
          trace_id: 'TRC-98A72B82',
          risk_tier: 'HIGH',
          before: {},
          after: { capability_key: 'can_sell', mode: 'HARD_BLOCK', reason: 'Counterfeit copyright infringement' },
          created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
        },
        {
          id: 102,
          action: 'users.grant.create',
          action_label: 'Issue Standing Access Grant',
          target_type: 'USER',
          target_ref: 'STF-002',
          actor_id: 1,
          actor_ref: 'STF-001',
          actor_name: 'Rahim Khan',
          actor_phone: '01711000001',
          ip: '103.205.71.12',
          trace_id: 'TRC-98A72B83',
          risk_tier: 'HIGH',
          before: {},
          after: { permission_key: 'finance.payout.approve', expires_at: '2026-09-01T00:00:00Z' },
          created_at: new Date(Date.now() - 3600000 * 24).toISOString(),
        },
        {
          id: 101,
          action: 'auth.staff_2fa_reset',
          action_label: 'Reset Staff 2FA Credentials',
          target_type: 'STAFF',
          target_ref: 'STF-003',
          actor_id: 1,
          actor_ref: 'STF-001',
          actor_name: 'Rahim Khan',
          actor_phone: '01711000001',
          ip: '103.205.71.12',
          trace_id: 'TRC-98A72B84',
          risk_tier: 'MEDIUM',
          before: { enrolled: true },
          after: { enrolled: false, reason: 'Device lost ticket #8920' },
          created_at: new Date(Date.now() - 3600000 * 48).toISOString(),
        },
        {
          id: 100,
          action: 'auth.login_password',
          action_label: 'Super Admin Session Login',
          target_type: 'SESSION',
          target_ref: 'SES-001',
          actor_id: 1,
          actor_ref: 'STF-001',
          actor_name: 'Rahim Khan',
          actor_phone: '01711000001',
          ip: '103.205.71.12',
          trace_id: 'TRC-98A72B85',
          risk_tier: 'LOW',
          before: {},
          after: { auth_method: 'PASSWORD_PLUS_2FA', user_agent: 'Chrome/128 MacOS' },
          created_at: new Date(Date.now() - 3600000 * 72).toISOString(),
        },
      ];

      let filtered = mockLogs.filter((l) => {
        if (riskFilter !== 'ALL' && l.risk_tier !== riskFilter) return false;
        if (actionFilter !== 'ALL' && l.action !== actionFilter) return false;
        return true;
      });

      return {
        status: 200,
        body: {
          records: filtered,
          data: filtered,
          total: filtered.length,
          next_cursor: null,
        },
      };
    },
  },

  // 33. List All Platform Modules
  {
    method: 'GET',
    path: '/admin/modules',
    handler() {
      const mockModules = [
        {
          key: 'user_registration',
          group_key: 'trust',
          label_en: 'User Registration & Dual Authentication',
          label_bn: 'ইউজার রেজিস্ট্রেশন ও টু-ফ্যাক্টর অথেনটিকেশন',
          description_en: 'Customer and merchant account sign-up via Phone OTP or Password.',
          description_bn: 'ফোন ওটিপি বা পাসওয়ার্ডের মাধ্যমে অ্যাকাউন্ট সাইন-আপ।',
          is_enabled: true,
          risk_of_disabling: 'CRITICAL',
          last_reason: 'Core security baseline active',
          updated_at: new Date(Date.now() - 3600000 * 48).toISOString(),
          targeting_rules: [],
        },
        {
          key: 'supplier_verification',
          group_key: 'trust',
          label_en: 'Supplier KYC & Trust Tiers',
          label_bn: 'সাপ্লায়ার কেওয়াইসি ও ট্রাস্ট টিয়ার',
          description_en: 'Government NID and Trade License verification for wholesale suppliers.',
          description_bn: 'হোলসেল সাপ্লায়ারদের জন্য সরকারি এনআইডি ও ট্রেড লাইসেন্স যাচাই।',
          is_enabled: true,
          risk_of_disabling: 'HIGH',
          last_reason: 'Mandatory seller compliance active',
          updated_at: new Date(Date.now() - 3600000 * 24).toISOString(),
          targeting_rules: [{ id: 1, type: 'DISTRICT', value: 'Dhaka, Chittagong' }],
        },
        {
          key: 'bkash_direct_checkout',
          group_key: 'finance',
          label_en: 'bKash Direct Merchant Payment',
          label_bn: 'বিকাশ সরাসরি পেমেন্ট গেটওয়ে',
          description_en: 'Instant automated checkout tokenization via bKash payment API.',
          description_bn: 'বিকাশ পেমেন্ট এপিআই-এর মাধ্যমে সরাসরি অটোমেটেড পেমেন্ট।',
          is_enabled: true,
          risk_of_disabling: 'HIGH',
          last_reason: 'Primary MFS gateway active',
          updated_at: new Date(Date.now() - 3600000 * 12).toISOString(),
          targeting_rules: [],
        },
        {
          key: 'nagad_direct_checkout',
          group_key: 'finance',
          label_en: 'Nagad Direct Payment Gateway',
          label_bn: 'নগদ সরাসরি পেমেন্ট গেটওয়ে',
          description_en: 'Automated checkout via Bangladesh Post Office Nagad payment gateway.',
          description_bn: 'নগদ পেমেন্ট গেটওয়ের মাধ্যমে সরাসরি পেমেন্ট।',
          is_enabled: true,
          risk_of_disabling: 'HIGH',
          last_reason: 'Operational',
          updated_at: new Date(Date.now() - 3600000 * 72).toISOString(),
          targeting_rules: [],
        },
        {
          key: 'cod_cash_on_delivery',
          group_key: 'finance',
          label_en: 'Cash on Delivery (COD) Checkout',
          label_bn: 'ক্যাশ অন ডেলিভারি (সিওডি)',
          description_en: 'Allow buyers to pay cash upon doorstep delivery by courier partners.',
          description_bn: 'কুরিয়ারের মাধ্যমে হোম ডেলিভারিতে ক্যাশ পেমেন্টের সুযোগ।',
          is_enabled: true,
          risk_of_disabling: 'MEDIUM',
          last_reason: 'Enabled for all 64 districts',
          updated_at: new Date(Date.now() - 3600000 * 96).toISOString(),
          targeting_rules: [],
        },
        {
          key: 'live_streaming_studio',
          group_key: 'commerce',
          label_en: 'Live Selling & Shoppable Video Stream',
          label_bn: 'লাইভ স্ট্রিমিং ও শপিং ভিডিও',
          description_en: 'Interactive live video broadcasting with real-time checkout pinned products.',
          description_bn: 'রিয়েল-টাইম প্রোডাক্ট পিন করে লাইভ ভিডিও শপিং ব্রডকাস্ট।',
          is_enabled: true,
          risk_of_disabling: 'MEDIUM',
          last_reason: 'Boishakh festival campaigns active',
          updated_at: new Date(Date.now() - 3600000 * 8).toISOString(),
          targeting_rules: [],
        },
        {
          key: 'b2b_wholesale_escrow',
          group_key: 'commerce',
          label_en: 'B2B Wholesale Escrow Lock',
          label_bn: 'বিটুবি পাইকারি এসক্রো পেমেন্ট',
          description_en: 'Milestone escrow fund protection for bulk reseller-supplier trade.',
          description_bn: 'রিসেলার ও সাপ্লায়ারদের পাইকারি লেনদেনে এসক্রো ফান্ড সুরক্ষা।',
          is_enabled: true,
          risk_of_disabling: 'HIGH',
          last_reason: 'Active with 3% platform commission',
          updated_at: new Date(Date.now() - 3600000 * 18).toISOString(),
          targeting_rules: [],
        },
        {
          key: 'ai_bengali_copywriter',
          group_key: 'advanced',
          label_en: 'AI Bengali Ad Copywriter & Visual Generator',
          label_bn: 'এআই বাংলা কপিরাইটিং ও ইমেজ জেনারেটর',
          description_en: 'Automated high-converting Bengali marketing captions for Facebook and TikTok.',
          description_bn: 'ফেসবুক ও টিকটকের জন্য আকর্ষক বাংলা বিজ্ঞাপন ক্যাপশন জেনারেটর।',
          is_enabled: true,
          risk_of_disabling: 'LOW',
          last_reason: 'Claude 3.5 Sonnet pipeline enabled',
          updated_at: new Date(Date.now() - 3600000 * 5).toISOString(),
          targeting_rules: [],
        },
      ];

      return {
        status: 200,
        body: {
          modules: mockModules,
          data: mockModules,
          total: mockModules.length,
        },
      };
    },
  },

  // 34. Toggle Platform Module
  {
    method: 'PATCH',
    path: '/admin/modules/:key',
    handler({ params, body }) {
      const isEnabled = Boolean(body?.enabled ?? body?.is_enabled ?? true);
      const reason = body?.reason || 'Administrative toggle';
      return {
        status: 200,
        body: {
          data: {
            key: params?.key,
            is_enabled: isEnabled,
            last_reason: reason,
            updated_at: new Date().toISOString(),
          },
          message_en: `Module ${params?.key} is now ${isEnabled ? 'ENABLED' : 'DISABLED'}.`,
          message_bn: `মডিউলটি সফলভাবে ${isEnabled ? 'চালু' : 'বন্ধ'} করা হয়েছে।`,
        },
      };
    },
  },

  // 35. AI Usage & Monthly Spend Cap
  {
    method: 'GET',
    path: '/admin/ai/usage',
    handler() {
      return {
        status: 200,
        body: {
          current_month_spent_usd: 142.50,
          current_month_spent_bdt: 17100,
          monthly_spend_cap_usd: 500.00,
          monthly_spend_cap_bdt: 60000,
          usage_percent: 28.5,
          total_prompts_this_month: 8420,
          total_images_generated: 1240,
        },
      };
    },
  },

  // 36. Update AI Spend Cap
  {
    method: 'PATCH',
    path: '/admin/ai/spend-cap',
    handler({ body }) {
      const newCap = body?.monthly_spend_cap_usd || 500;
      return {
        status: 200,
        body: {
          monthly_spend_cap_usd: newCap,
          monthly_spend_cap_bdt: newCap * 120,
          message_en: `Monthly AI spend cap updated to $${newCap}.`,
          message_bn: `মাসিক এআই বাজেট সফলভাবে $${newCap}-এ আপডেট করা হয়েছে।`,
        },
      };
    },
  },
];

export default adminHandlers;

