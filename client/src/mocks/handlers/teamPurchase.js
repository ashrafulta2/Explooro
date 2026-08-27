/**
 * teamPurchase.js — Mock API handlers for Social Group Buying & Team Purchases (Prompt 9.5).
 */

let mockTeamPurchases = [
  {
    id: 1,
    ref: 'TEAM-9A1B2C',
    product_id: 11,
    product_slug: 'smartwatch-amoled-bluetooth-calling',
    product_name_en: 'Ultra 2 Smartwatch with 1.96" AMOLED & BT Calling',
    product_name_bn: '১.৯৬" অ্যামোলেড ডিসপ্লে ও কলিং স্মার্টওয়াচ',
    product_image_url: 'https://images.unsplash.com/photo-1579586337278-3befd40fd17a?w=600',
    original_price: 3200.0,
    group_price: 2450.0,
    required_members: 3,
    current_members_count: 2,
    remaining_seconds: 52200,
    status: 'ACTIVE',
    starts_at: new Date(Date.now() - 10 * 3600000).toISOString(),
    expires_at: new Date(Date.now() + 14.5 * 3600000).toISOString(),
    members: [
      {
        id: 1,
        user_id: 1,
        user_name: 'Rahim Ahmed (Host)',
        avatar_key: null,
        joined_at: new Date(Date.now() - 10 * 3600000).toISOString(),
        payment_hold_status: 'HELD',
      },
      {
        id: 2,
        user_id: 7,
        user_name: 'Karim Customer',
        avatar_key: null,
        joined_at: new Date(Date.now() - 2 * 3600000).toISOString(),
        payment_hold_status: 'HELD',
      },
    ],
  },
  {
    id: 2,
    ref: 'TEAM-4D5E6F',
    product_id: 5,
    product_slug: 'traditional-dhakai-jamdani-saree-red',
    product_name_en: 'Authentic Handloom Dhakai Jamdani Saree - Crimson Red',
    product_name_bn: 'ঐতিহ্যবাহী তাঁতের খাঁটি ঢাকাই জামদানি শাড়ি - গাঢ় লাল',
    product_image_url: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=600',
    original_price: 6500.0,
    group_price: 4850.0,
    required_members: 2,
    current_members_count: 1,
    remaining_seconds: 29700,
    status: 'ACTIVE',
    starts_at: new Date(Date.now() - 4 * 3600000).toISOString(),
    expires_at: new Date(Date.now() + 8.25 * 3600000).toISOString(),
    members: [
      {
        id: 3,
        user_id: 7,
        user_name: 'Karim Customer (Host)',
        avatar_key: null,
        joined_at: new Date(Date.now() - 4 * 3600000).toISOString(),
        payment_hold_status: 'HELD',
      },
    ],
  },
  {
    id: 3,
    ref: 'TEAM-7G8H9J',
    product_id: 1,
    product_slug: 'mens-cotton-punjabi-maroon',
    product_name_en: 'Premium Combed Cotton Semi-Long Panjabi - Maroon',
    product_name_bn: 'প্রিমিয়াম মার্জিত সুতি সেমি-লং পাঞ্জাবি - মেরুন',
    product_image_url: 'https://images.unsplash.com/photo-1593784991095-a205069470b6?w=600',
    original_price: 1650.0,
    group_price: 1250.0,
    required_members: 3,
    current_members_count: 3,
    remaining_seconds: 0,
    status: 'COMPLETED',
    starts_at: new Date(Date.now() - 48 * 3600000).toISOString(),
    expires_at: new Date(Date.now() - 24 * 3600000).toISOString(),
    completed_at: new Date(Date.now() - 26 * 3600000).toISOString(),
    order_id: 1042,
    members: [
      {
        id: 4,
        user_id: 2,
        user_name: 'Sadia Islam (Host)',
        avatar_key: null,
        joined_at: new Date(Date.now() - 48 * 3600000).toISOString(),
        payment_hold_status: 'CAPTURED',
      },
      {
        id: 5,
        user_id: 7,
        user_name: 'Karim Customer',
        avatar_key: null,
        joined_at: new Date(Date.now() - 32 * 3600000).toISOString(),
        payment_hold_status: 'CAPTURED',
      },
      {
        id: 6,
        user_id: 3,
        user_name: 'Arif Hossain',
        avatar_key: null,
        joined_at: new Date(Date.now() - 26 * 3600000).toISOString(),
        payment_hold_status: 'CAPTURED',
      },
    ],
  },
  {
    id: 4,
    ref: 'TEAM-1K2L3M',
    product_id: 8,
    product_slug: 'genuine-leather-bifold-wallet-tan',
    product_name_en: 'Full-Grain Genuine Leather Bifold Wallet - Tan Brown',
    product_name_bn: 'খাঁটি লেদার বাইফোল্ড ওয়ালেট - ট্যান ব্রাউন',
    product_image_url: 'https://images.unsplash.com/photo-1627123424574-724758594e93?w=600',
    original_price: 1150.0,
    group_price: 850.0,
    required_members: 3,
    current_members_count: 1,
    remaining_seconds: 0,
    status: 'EXPIRED',
    payment_hold_status: 'REFUNDED',
    starts_at: new Date(Date.now() - 72 * 3600000).toISOString(),
    expires_at: new Date(Date.now() - 48 * 3600000).toISOString(),
    members: [
      {
        id: 7,
        user_id: 7,
        user_name: 'Karim Customer (Host)',
        avatar_key: null,
        joined_at: new Date(Date.now() - 72 * 3600000).toISOString(),
        payment_hold_status: 'REFUNDED',
      },
    ],
  },
];

export const teamPurchaseHandlers = [
  // 1. List customer's team purchases
  {
    method: 'GET',
    path: '/account/team-purchases',
    handler() {
      const refreshed = mockTeamPurchases.map((tp) => {
        const remaining = Math.max(0, Math.floor((new Date(tp.expires_at) - Date.now()) / 1000));
        return {
          ...tp,
          remaining_seconds: tp.status === 'ACTIVE' ? remaining : 0,
        };
      });
      return {
        status: 200,
        body: {
          team_purchases: refreshed,
        },
      };
    },
  },

  // 2. Get specific team purchase detail
  {
    method: 'GET',
    path: '/team-purchases/:id',
    handler({ params }) {
      const idOrRef = params.id;
      const team = mockTeamPurchases.find(
        (t) => String(t.id) === String(idOrRef) || t.ref.toLowerCase() === String(idOrRef).toLowerCase()
      );

      if (!team) {
        return {
          status: 404,
          body: {
            error: {
              code: 'TEAM_NOT_FOUND',
              message_en: 'Team purchase not found.',
              message_bn: 'টিম পারচেজ পাওয়া যায়নি।',
            },
          },
        };
      }

      const remaining = Math.max(0, Math.floor((new Date(team.expires_at) - Date.now()) / 1000));
      return {
        status: 200,
        body: {
          team: {
            ...team,
            remaining_seconds: team.status === 'ACTIVE' ? remaining : 0,
          },
        },
      };
    },
  },

  // 3. Join team purchase
  {
    method: 'POST',
    path: '/team-purchases/:id/join',
    handler({ params, body }) {
      const idOrRef = params.id;
      const teamIndex = mockTeamPurchases.findIndex(
        (t) => String(t.id) === String(idOrRef) || t.ref.toLowerCase() === String(idOrRef).toLowerCase()
      );

      if (teamIndex === -1) {
        return {
          status: 404,
          body: {
            error: {
              code: 'TEAM_NOT_FOUND',
              message_en: 'Team purchase not found.',
              message_bn: 'টিম পারচেজ পাওয়া যায়নি।',
            },
          },
        };
      }

      const team = mockTeamPurchases[teamIndex];

      if (team.status !== 'ACTIVE') {
        return {
          status: 400,
          body: {
            error: {
              code: 'TEAM_NOT_ACTIVE',
              message_en: `Team purchase is already ${team.status.toLowerCase()}.`,
              message_bn: `টিম পারচেজটি ইতিমধ্যে ${team.status.toLowerCase()} হয়েছে।`,
            },
          },
        };
      }

      if (new Date() >= new Date(team.expires_at)) {
        return {
          status: 400,
          body: {
            error: {
              code: 'TEAM_EXPIRED',
              message_en: 'This team purchase window has expired.',
              message_bn: 'এই টিম পারচেজের সময়সীমা শেষ হয়েছে।',
            },
          },
        };
      }

      const newMember = {
        id: team.members.length + 10,
        user_id: 7,
        user_name: 'Karim Customer',
        avatar_key: null,
        shipping_address: body?.shipping_address || {},
        payment_method: body?.payment_method || 'COD',
        joined_at: new Date().toISOString(),
        payment_hold_status: 'HELD',
      };

      team.members.push(newMember);
      team.current_members_count += 1;

      const isCompleted = team.current_members_count >= team.required_members;
      if (isCompleted) {
        team.status = 'COMPLETED';
        team.completed_at = new Date().toISOString();
        team.members.forEach((m) => {
          m.payment_hold_status = 'CAPTURED';
        });
      }

      return {
        status: 200,
        body: {
          team,
          member: newMember,
          completed: isCompleted,
        },
      };
    },
  },

  // 4. Create new team purchase
  {
    method: 'POST',
    path: '/team-purchases',
    handler({ body }) {
      const { product_id, group_price, required_members = 3, shipping_address, payment_method } = body || {};
      const newId = mockTeamPurchases.length + 1;
      const ref = `TEAM-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

      const newTeam = {
        id: newId,
        ref,
        product_id: Number(product_id) || 1,
        product_name_en: 'Selected Team Product',
        product_name_bn: 'নির্বাচিত টিম পণ্য',
        product_image_url: 'https://images.unsplash.com/photo-1593784991095-a205069470b6?w=600',
        original_price: Number(group_price ? group_price * 1.25 : 2000),
        group_price: Number(group_price || 1600),
        required_members: Number(required_members) || 3,
        current_members_count: 1,
        remaining_seconds: 86400,
        status: 'ACTIVE',
        starts_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 24 * 3600000).toISOString(),
        members: [
          {
            id: 1,
            user_id: 7,
            user_name: 'Karim Customer (Host)',
            joined_at: new Date().toISOString(),
            payment_hold_status: 'HELD',
            shipping_address,
            payment_method,
          },
        ],
      };

      mockTeamPurchases.unshift(newTeam);

      return {
        status: 201,
        body: {
          team: newTeam,
        },
      };
    },
  },
];
