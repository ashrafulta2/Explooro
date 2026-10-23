/**
 * partnerReward.repository.ts — Raw SQL for the monthly shop partner reward pool (migration 086).
 *
 * No rules here: services/partnerReward.service.ts decides what the numbers are worth. Every metric
 * takes the period as local dates ('YYYY-MM-DD', inclusive) plus the timezone, and compares in that
 * timezone, so a sale at 23:30 Dhaka time on the 31st belongs to that month and not the next.
 */

export const RULES_KEY = 'partner_reward.rules';

type Period = { start: string; end: string; timezone: string };

export async function getRulesRow(db) {
  const { rows } = await db.query(
    `SELECT value_json, updated_at, updated_by FROM platform_settings WHERE key = $1`,
    [RULES_KEY]
  );
  return rows[0] ?? null;
}

/** "Today" and the first day of this month in the platform timezone (Postgres' zone database). */
export async function getLocalCalendar(db, timezone: string) {
  const { rows } = await db.query(
    `SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS today,
            to_char(date_trunc('month', now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS month_start`,
    [timezone]
  );
  return rows[0];
}

/** Every shop partner who can be paid: the saler role and an ACTIVE, undeleted account. */
export async function listEligiblePartners(db): Promise<number[]> {
  const { rows } = await db.query(
    `SELECT DISTINCT u.id
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
      WHERE r.key = 'saler' AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
      ORDER BY u.id`
  );
  return rows.map((r) => Number(r.id));
}

const toMap = (rows) => new Map<number, number>(rows.map((r) => [Number(r.saler_id), Number(r.value) || 0]));

/**
 * Store sales: parcels a partner brought (sub_orders.saler_id, set by attribution) that were delivered
 * in the period. Counted as parcels, not taka, because the owner's rule is "more customers buying from
 * the store", and a count cannot be pumped by one expensive order.
 */
export async function salesByPartner(db, { start, end, timezone }: Period) {
  const { rows } = await db.query(
    `SELECT saler_id, COUNT(*)::int AS value
       FROM sub_orders
      WHERE saler_id IS NOT NULL AND status = 'DELIVERED' AND delivered_at IS NOT NULL
        AND (delivered_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date
      GROUP BY saler_id`,
    [start, end, timezone]
  );
  return toMap(rows);
}

/**
 * Social shares: distinct visitor-days on the partner's tracked links in the period. A visitor (hashed
 * IP) opening the same partner's links ten times in a day counts once, so refreshing a link earns nothing.
 * WHY a click and not a "share" event: a share nobody opens promotes nothing, and there is no reliable
 * way to see a post on Facebook or WhatsApp; a tracked click is the share proving it reached someone.
 */
export async function socialByPartner(db, { start, end, timezone }: Period) {
  const { rows } = await db.query(
    `SELECT sl.saler_id,
            COUNT(DISTINCT COALESCE(c.ip_hash, 'click:' || c.id::text) || '|' || ((c.clicked_at AT TIME ZONE $3)::date)::text)::int AS value
       FROM short_link_clicks c
       JOIN short_links sl ON sl.id = c.short_link_id
      WHERE (c.clicked_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date
      GROUP BY sl.saler_id`,
    [start, end, timezone]
  );
  return toMap(rows);
}

/**
 * Community: the partner's published posts written in the period, at most `maxPostsPerDay` counted per
 * day, plus the likes, comments and saves those posts got from OTHER members (any time up to now).
 * A hidden or removed post earns nothing, so moderation takes the points away with the post.
 * Returns the raw counts; the service turns them into points.
 */
export async function communityByPartner(db, { start, end, timezone }: Period, maxPostsPerDay: number) {
  const { rows } = await db.query(
    `WITH posts AS (
       SELECT p.id, p.author_id, (p.created_at AT TIME ZONE $3)::date AS day
         FROM community_posts p
        WHERE p.status = 'PUBLISHED'
          AND (p.created_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date
     ),
     per_day AS (
       SELECT author_id, day, LEAST(COUNT(*), $4::int) AS counted FROM posts GROUP BY author_id, day
     ),
     engagement AS (
       SELECT po.author_id,
              (SELECT COUNT(*) FROM community_post_likes l WHERE l.post_id = po.id AND l.user_id <> po.author_id) AS likes,
              (SELECT COUNT(*) FROM community_post_comments cm WHERE cm.post_id = po.id AND cm.status = 'PUBLISHED' AND cm.author_id <> po.author_id) AS comments,
              (SELECT COUNT(*) FROM community_post_saves s WHERE s.post_id = po.id AND s.user_id <> po.author_id) AS saves
         FROM posts po
     )
     SELECT a.author_id AS saler_id,
            COALESCE((SELECT SUM(counted) FROM per_day d WHERE d.author_id = a.author_id), 0)::int AS posts,
            COALESCE(SUM(a.likes), 0)::int AS likes,
            COALESCE(SUM(a.comments), 0)::int AS comments,
            COALESCE(SUM(a.saves), 0)::int AS saves
       FROM engagement a
      GROUP BY a.author_id`,
    [start, end, timezone, maxPostsPerDay]
  );
  return new Map<number, { posts: number; likes: number; comments: number; saves: number }>(
    rows.map((r) => [Number(r.saler_id), { posts: r.posts, likes: r.likes, comments: r.comments, saves: r.saves }])
  );
}

/**
 * Activity: distinct days in the period on which the partner did something we record — signed in or
 * used the app (sessions), posted / commented / liked in the community, made a tracked link, or added
 * a product to their store. Capped by the calendar, so it can never beat the number of days.
 */
export async function activityByPartner(db, { start, end, timezone }: Period) {
  const { rows } = await db.query(
    `WITH days AS (
       SELECT user_id AS uid, (created_at AT TIME ZONE $3)::date AS day FROM sessions
       UNION SELECT user_id, (last_seen_at AT TIME ZONE $3)::date FROM sessions
       UNION SELECT author_id, (created_at AT TIME ZONE $3)::date FROM community_posts
       UNION SELECT author_id, (created_at AT TIME ZONE $3)::date FROM community_post_comments
       UNION SELECT user_id, (created_at AT TIME ZONE $3)::date FROM community_post_likes
       UNION SELECT saler_id, (created_at AT TIME ZONE $3)::date FROM short_links
       UNION SELECT saler_id, (added_at AT TIME ZONE $3)::date FROM saler_store_items
     )
     SELECT uid AS saler_id, COUNT(DISTINCT day)::int AS value
       FROM days
      WHERE day BETWEEN $1::date AND $2::date
      GROUP BY uid`,
    [start, end, timezone]
  );
  return toMap(rows);
}

/**
 * The month's ad revenue: what advertisers paid the treasury (AD_SPEND credits) minus ad refunds
 * (AD_SPEND debits) in the period.
 */
export async function adRevenue(db, treasuryWalletId, { start, end, timezone }: Period): Promise<number> {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(CASE WHEN entry_type = 'CREDIT' THEN amount ELSE -amount END), 0)::text AS net
       FROM ledger_transactions
      WHERE wallet_id = $1 AND category = 'AD_SPEND' AND balance_bucket = 'AVAILABLE'
        AND (created_at AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date`,
    [treasuryWalletId, start, end, timezone]
  );
  return Math.max(0, Number(rows[0]?.net) || 0);
}

export async function getPoolBalances(db, poolWalletId) {
  const { rows } = await db.query(
    `SELECT available_balance, pending_escrow_balance FROM wallets WHERE id = $1`,
    [poolWalletId]
  );
  return {
    available: Number(rows[0]?.available_balance) || 0,
    pending: Number(rows[0]?.pending_escrow_balance) || 0,
  };
}

export async function findRunByPeriod(db, periodStart: string) {
  const { rows } = await db.query(`SELECT * FROM partner_reward_runs WHERE period_start = $1::date`, [periodStart]);
  return rows[0] ?? null;
}

export async function latestRun(db) {
  const { rows } = await db.query(
    `SELECT *, to_char(period_start, 'YYYY-MM-DD') AS period_start_ymd FROM partner_reward_runs ORDER BY period_start DESC LIMIT 1`
  );
  return rows[0] ?? null;
}

export async function insertRun(client, { periodStart, periodEnd, rules, triggeredBy }) {
  const { rows } = await client.query(
    `INSERT INTO partner_reward_runs (period_start, period_end, rules_json, triggered_by)
     VALUES ($1::date, $2::date, $3::jsonb, $4)
     RETURNING id`,
    [periodStart, periodEnd, JSON.stringify(rules), triggeredBy]
  );
  return Number(rows[0].id);
}

export async function finishRun(client, runId, f) {
  await client.query(
    `UPDATE partner_reward_runs
        SET ad_revenue = $2, ad_share = $3, pool_amount = $4, paid_amount = $5, carried_amount = $6,
            partners_scored = $7, totals_json = $8::jsonb, txn_group_id = $9
      WHERE id = $1`,
    [runId, f.adRevenue, f.adShare, f.poolAmount, f.paidAmount, f.carriedAmount, f.partnersScored,
      JSON.stringify(f.totals), f.txnGroupId]
  );
}

export async function insertPayouts(client, runId, rows) {
  for (const r of rows) {
    await client.query(
      `INSERT INTO partner_reward_payouts (run_id, saler_id, metrics_json, points_json, score, share_pct, amount)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7)`,
      [runId, r.salerId, JSON.stringify(r.metrics), JSON.stringify(r.points), r.score, r.sharePct, r.amount]
    );
  }
}

export async function listRuns(db, { limit, offset }) {
  const { rows } = await db.query(
    `SELECT id, to_char(period_start, 'YYYY-MM-DD') AS period_start, to_char(period_end, 'YYYY-MM-DD') AS period_end,
            ad_revenue, ad_share, pool_amount, paid_amount, carried_amount, partners_scored, triggered_by, created_at,
            COUNT(*) OVER()::int AS total
       FROM partner_reward_runs
      ORDER BY period_start DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return { items: rows.map(({ total, ...r }) => r), total: rows[0]?.total ?? 0 };
}

export async function listRunPayouts(db, runId, { limit, offset }) {
  const { rows } = await db.query(
    `SELECT p.saler_id, p.metrics_json, p.points_json, p.score, p.share_pct, p.amount,
            COALESCE(vs.shop_name, up.full_name, u.phone) AS partner_name,
            COUNT(*) OVER()::int AS total
       FROM partner_reward_payouts p
       JOIN users u ON u.id = p.saler_id
       LEFT JOIN user_profiles up ON up.user_id = u.id
       LEFT JOIN LATERAL (SELECT shop_name FROM virtual_stores v WHERE v.saler_id = u.id AND v.deleted_at IS NULL ORDER BY v.id LIMIT 1) vs ON true
      WHERE p.run_id = $1
      ORDER BY p.amount DESC, p.saler_id
      LIMIT $2 OFFSET $3`,
    [runId, limit, offset]
  );
  return { items: rows.map(({ total, ...r }) => r), total: rows[0]?.total ?? 0 };
}

export async function listPayoutsForSaler(db, salerId, limit: number) {
  const { rows } = await db.query(
    `SELECT to_char(r.period_start, 'YYYY-MM-DD') AS period_start, p.amount, p.share_pct, p.points_json
       FROM partner_reward_payouts p
       JOIN partner_reward_runs r ON r.id = p.run_id
      WHERE p.saler_id = $1
      ORDER BY r.period_start DESC
      LIMIT $2`,
    [salerId, limit]
  );
  return rows;
}

/** Display names for a handful of partners (the admin preview's top list). */
export async function partnerNames(db, ids: number[]) {
  if (!ids.length) return new Map();
  const { rows } = await db.query(
    `SELECT u.id, COALESCE(vs.shop_name, up.full_name, u.phone) AS name
       FROM users u
       LEFT JOIN user_profiles up ON up.user_id = u.id
       LEFT JOIN LATERAL (SELECT shop_name FROM virtual_stores v WHERE v.saler_id = u.id AND v.deleted_at IS NULL ORDER BY v.id LIMIT 1) vs ON true
      WHERE u.id = ANY($1::bigint[])`,
    [ids]
  );
  return new Map(rows.map((r) => [Number(r.id), r.name]));
}
