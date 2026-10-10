/**
 * questClaimMessage.js — the toast text after a quest reward is claimed.
 *
 * WHY separate: the server says when the daily coin cap ate some or all of the reward (`capped`), and
 * the panel used to ignore it and show a made-up "+20 coins" — telling a shopper they were paid coins
 * they never received. The amount shown is now always what the server actually awarded.
 */
export function questClaimMessage(claim, isBn) {
  const awarded = Number(claim?.rewardCoins);
  if (!Number.isFinite(awarded)) {
    return isBn ? 'রিওয়ার্ড সংগ্রহ করা হয়েছে!' : 'Reward claimed!';
  }
  if (claim?.capped && awarded <= 0) {
    return isBn
      ? 'রিওয়ার্ড সংগ্রহ হয়েছে, কিন্তু আজকের কয়েনের সীমা পূর্ণ হওয়ায় কোনো কয়েন যুক্ত হয়নি।'
      : "Reward claimed, but today's coin limit was reached so no coins were added.";
  }
  if (claim?.capped) {
    return isBn
      ? `+${awarded} কয়েন যুক্ত হয়েছে। আজকের কয়েনের সীমা পূর্ণ হওয়ায় বাকিটা যুক্ত হয়নি।`
      : `+${awarded} coins added. Today's coin limit was reached, so the rest was not.`;
  }
  return isBn
    ? `অভিনন্দন! +${awarded} কয়েন সফলভাবে আপনার অ্যাকাউন্টে যুক্ত হয়েছে!`
    : `Reward claimed! +${awarded} coins added to your balance!`;
}
