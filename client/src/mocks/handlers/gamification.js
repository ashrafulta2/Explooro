/**
 * gamification.js — Mock API handlers for Loyalty Coins, Daily Quests & Leaderboard (Prompt 9.4).
 */

const todayStr = new Date().toISOString().slice(0, 10);
const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);
const yesterdayStr = yesterday.toISOString().slice(0, 10);

let mockCoinBalance = {
  id: 1,
  user_id: 7,
  balance: 450,
  lifetime_earned: 920,
  lifetime_spent: 470,
  current_streak_days: 3,
  last_check_in_date: yesterdayStr,
};

let mockHistory = [
  {
    id: 101,
    user_id: 7,
    entry_type: 'CREDIT',
    amount: 20,
    balance_after: 450,
    source_category: 'CHECK_IN',
    memo: 'Day 3 Consecutive Daily Check-In Bonus',
    created_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
  },
  {
    id: 102,
    user_id: 7,
    entry_type: 'CREDIT',
    amount: 30,
    balance_after: 430,
    source_category: 'QUEST_REWARD',
    memo: 'Quest: Complete 1 Social Team Purchase',
    created_at: new Date(Date.now() - 36 * 3600 * 1000).toISOString(),
  },
  {
    id: 103,
    user_id: 7,
    entry_type: 'DEBIT',
    amount: 200,
    balance_after: 400,
    source_category: 'CHECKOUT_REDEMPTION',
    memo: 'Redeemed at Checkout on Order #EXP-88912 (৳20.00 OFF)',
    created_at: new Date(Date.now() - 3 * 86400 * 1000).toISOString(),
  },
  {
    id: 104,
    user_id: 7,
    entry_type: 'CREDIT',
    amount: 40,
    balance_after: 600,
    source_category: 'REVIEW_BONUS',
    memo: 'Verified Product Review with Photos & Unboxing',
    created_at: new Date(Date.now() - 5 * 86400 * 1000).toISOString(),
  },
  {
    id: 105,
    user_id: 7,
    entry_type: 'CREDIT',
    amount: 15,
    balance_after: 560,
    source_category: 'CHECK_IN',
    memo: 'Day 2 Consecutive Daily Check-In Bonus',
    created_at: new Date(Date.now() - 6 * 86400 * 1000).toISOString(),
  },
  {
    id: 106,
    user_id: 7,
    entry_type: 'CREDIT',
    amount: 10,
    balance_after: 545,
    source_category: 'CHECK_IN',
    memo: 'Day 1 Daily Check-In Welcome Bonus',
    created_at: new Date(Date.now() - 7 * 86400 * 1000).toISOString(),
  },
];

let mockQuests = [
  {
    id: 1,
    title_en: 'Daily Explorer Check-in',
    title_bn: 'দৈনিক এক্সপ্লোরার চেক-ইন',
    description_en: 'Open the app and claim your daily streak reward',
    description_bn: 'প্রতিদিন অ্যাপে প্রবেশ করে আপনার স্ট্রিক রিওয়ার্ড সংগ্রহ করুন',
    cadence: 'DAILY',
    target_count: 1,
    current_count: 1,
    progress_pct: 100,
    reward_coins: 10,
    is_completed: true,
    is_claimed: true,
  },
  {
    id: 2,
    title_en: 'Browse Trending Flash Deals',
    title_bn: 'ট্রেন্ডিং ফ্ল্যাশ ডিল এক্সপ্লোর করুন',
    description_en: 'View at least 3 products from today’s campaign sale',
    description_bn: 'আজকের ক্যাম্পেইন ডিল থেকে অন্তত ৩টি পণ্য বিস্তারিত দেখুন',
    cadence: 'DAILY',
    target_count: 3,
    current_count: 3,
    progress_pct: 100,
    reward_coins: 15,
    is_completed: true,
    is_claimed: false,
  },
  {
    id: 3,
    title_en: 'Add Items to Wishlist',
    title_bn: 'উইশলিস্টে পণ্য সংরক্ষণ করুন',
    description_en: 'Save 2 interesting items to your personal wishlist',
    description_bn: 'আপনার পছন্দের ২টি পণ্য উইশলিস্টে সংরক্ষণ করুন',
    cadence: 'DAILY',
    target_count: 2,
    current_count: 1,
    progress_pct: 50,
    reward_coins: 15,
    is_completed: false,
    is_claimed: false,
  },
  {
    id: 4,
    title_en: 'Social Group Buying Champion',
    title_bn: 'সোশ্যাল টিম পারচেজ মিশন',
    description_en: 'Start or join a group buying team with friends',
    description_bn: 'বন্ধুদের সাথে যেকোনো একটি গ্রুপ বাই টিমে অংশগ্রহণ করুন',
    cadence: 'WEEKLY',
    target_count: 1,
    current_count: 1,
    progress_pct: 100,
    reward_coins: 35,
    is_completed: true,
    is_claimed: false,
  },
  {
    id: 5,
    title_en: 'Write Verified Product Reviews',
    title_bn: 'পণ্য রিভিউ প্রদান মিশন',
    description_en: 'Share your feedback and photos for 2 delivered items',
    description_bn: 'ডেলিভারি সম্পন্ন হওয়া ২টি পণ্যের জন্য ছবিসহ রিভিউ লিখুন',
    cadence: 'WEEKLY',
    target_count: 2,
    current_count: 0,
    progress_pct: 0,
    reward_coins: 40,
    is_completed: false,
    is_claimed: false,
  },
];

export const gamificationHandlers = [
  {
    method: 'GET',
    path: '/coins/balance',
    handler: () => ({
      status: 200,
      body: {
        coin_balance: { ...mockCoinBalance },
      },
    }),
  },
  {
    method: 'POST',
    path: '/coins/check-in',
    handler: () => {
      const isAlreadyCheckedIn = mockCoinBalance.last_check_in_date === todayStr;
      if (isAlreadyCheckedIn) {
        return {
          status: 409,
          body: {
            error: {
              code: 'ALREADY_CHECKED_IN',
              message_en: 'You have already claimed your check-in reward today.',
              message_bn: 'আপনি আজ ইতোমধ্যেই চেক-ইন রিওয়ার্ড গ্রহণ করেছেন।',
            },
          },
        };
      }

      const streakRewards = [10, 15, 20, 25, 30, 35, 50];
      const nextStreak = (mockCoinBalance.current_streak_days % 7) + 1;
      const awarded = streakRewards[nextStreak - 1] || 10;

      mockCoinBalance.current_streak_days = nextStreak;
      mockCoinBalance.balance += awarded;
      mockCoinBalance.lifetime_earned += awarded;
      mockCoinBalance.last_check_in_date = todayStr;

      const newTx = {
        id: Date.now(),
        user_id: 7,
        entry_type: 'CREDIT',
        amount: awarded,
        balance_after: mockCoinBalance.balance,
        source_category: 'CHECK_IN',
        memo: `Day ${nextStreak} Consecutive Daily Check-In Bonus`,
        created_at: new Date().toISOString(),
      };
      mockHistory.unshift(newTx);

      return {
        status: 200,
        body: {
          check_in: {
            streakDays: nextStreak,
            coinsAwarded: awarded,
            newBalance: mockCoinBalance.balance,
          },
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/coins/history',
    handler: () => ({
      status: 200,
      body: {
        history: [...mockHistory],
      },
    }),
  },
  {
    method: 'GET',
    path: '/quests',
    handler: () => ({
      status: 200,
      body: {
        quests: [...mockQuests],
      },
    }),
  },
  {
    method: 'POST',
    path: '/quests/:id/claim',
    handler: ({ params }) => {
      const qId = parseInt(params.id, 10);
      const quest = mockQuests.find((q) => q.id === qId);
      if (!quest) {
        return {
          status: 404,
          body: { error: { code: 'NOT_FOUND', message_en: 'Quest not found.' } },
        };
      }
      if (quest.is_claimed) {
        return {
          status: 409,
          body: { error: { code: 'ALREADY_CLAIMED', message_en: 'Reward already claimed.' } },
        };
      }

      quest.is_claimed = true;
      const reward = quest.reward_coins;
      mockCoinBalance.balance += reward;
      mockCoinBalance.lifetime_earned += reward;

      mockHistory.unshift({
        id: Date.now(),
        user_id: 7,
        entry_type: 'CREDIT',
        amount: reward,
        balance_after: mockCoinBalance.balance,
        source_category: 'QUEST_REWARD',
        memo: `Quest: ${quest.title_en}`,
        created_at: new Date().toISOString(),
      });

      return {
        status: 200,
        body: {
          claim: {
            questId: quest.id,
            rewardCoins: reward,
            newBalance: mockCoinBalance.balance,
          },
        },
      };
    },
  },
];
