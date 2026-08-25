/**
 * referral.controller.js — Route handlers for Multi-Tier Referral Network (Prompt 9.3).
 */

import * as referralService from '../services/referral.service.js';

export async function getOverview(req, reply) {
  const db = req.db || req.server?.db;
  const user = req.user;

  const overview = await referralService.getReferralNetworkOverview(db, user.id);
  return reply.send({
    overview,
  });
}

export async function getTree(req, reply) {
  const db = req.db || req.server?.db;
  const user = req.user;

  const tree = await referralService.getReferralTree(db, user.id);
  return reply.send({
    tree,
  });
}

export async function getStatement(req, reply) {
  const db = req.db || req.server?.db;
  const user = req.user;
  const { limit, offset } = req.query || {};

  const statement = await referralService.getReferralStatement(db, user.id, {
    limit: limit ? parseInt(limit, 10) : 50,
    offset: offset ? parseInt(offset, 10) : 0,
  });

  return reply.send({
    statement,
  });
}

export async function updateCustomSlug(req, reply) {
  const db = req.db || req.server?.db;
  const user = req.user;
  const { custom_slug } = req.body || {};

  const updated = await referralService.updateCustomSlug(db, user.id, custom_slug);
  return reply.send({
    referral_code: updated,
  });
}

export async function adminGetOverview(req, reply) {
  const db = req.db || req.server?.db;

  const { rows: stats } = await db.query(`
    SELECT
      COUNT(*)::int as total_referrals,
      COUNT(*) FILTER (WHERE status = 'QUALIFIED')::int as qualified_count,
      COUNT(*) FILTER (WHERE status = 'FRAUD_FLAGGED')::int as fraud_flagged_count,
      COUNT(DISTINCT referrer_user_id)::int as active_referrers_count
    FROM referrals
  `);

  const { rows: totalPaid } = await db.query(`
    SELECT COALESCE(SUM(commission_amount), 0)::numeric(14,2) as total_commissions_paid
    FROM referral_earnings
  `);

  const { rows: flaggedReferrals } = await db.query(`
    SELECT r.*,
           COALESCE(rup.display_name, rup.full_name) as referrer_name,
           COALESCE(up.display_name, up.full_name) as referee_name
    FROM referrals r
    JOIN users ru ON ru.id = r.referrer_user_id
    LEFT JOIN user_profiles rup ON rup.user_id = ru.id
    JOIN users u ON u.id = r.referred_user_id
    LEFT JOIN user_profiles up ON up.user_id = u.id
    WHERE r.status = 'FRAUD_FLAGGED'
    ORDER BY r.created_at DESC
    LIMIT 50
  `);

  return reply.send({
    stats: stats[0],
    total_commissions_paid: totalPaid[0]?.total_commissions_paid || '0.00',
    flagged_referrals: flaggedReferrals,
  });
}
