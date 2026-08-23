/**
 * ai.repository.js — Data access for AI conversations, messages, usage & safety (Prompt 10.2).
 */

export async function insertConversation(db, { ref, userId, agentType, title = null }) {
  const { rows } = await db.query(
    `INSERT INTO ai_conversations (ref, user_id, agent_type, title, last_message_at)
     VALUES ($1, $2, $3, $4, now())
     RETURNING *`,
    [ref, userId, agentType, title]
  );
  return rows[0];
}

export async function getConversationById(db, id, userId) {
  const { rows } = await db.query(
    `SELECT * FROM ai_conversations WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  return rows[0] || null;
}

export async function listConversations(db, { userId, agentType, limit = 20 }) {
  const { rows } = await db.query(
    `SELECT * FROM ai_conversations
     WHERE user_id = $1 AND agent_type = $2
     ORDER BY last_message_at DESC NULLS LAST, created_at DESC
     LIMIT $3`,
    [userId, agentType, limit]
  );
  return rows;
}

export async function touchConversation(db, id, { preview }) {
  await db.query(
    `UPDATE ai_conversations
     SET last_message_at = now(), last_message_preview = $2, updated_at = now()
     WHERE id = $1`,
    [id, preview]
  );
}

export async function insertMessage(db, { conversationId, role, content, productRefs = [], degraded = false }) {
  const { rows } = await db.query(
    `INSERT INTO ai_messages (conversation_id, role, content, product_refs_json, degraded)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING *`,
    [conversationId, role, content, JSON.stringify(productRefs), degraded]
  );
  return rows[0];
}

export async function listMessages(db, conversationId, { limit = 50 } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM ai_messages WHERE conversation_id = $1 ORDER BY id ASC LIMIT $2`,
    [conversationId, limit]
  );
  return rows;
}

export async function insertUsageEvent(
  db,
  { userId, conversationId = null, featureKey, model, driver, inputTokens = 0, outputTokens = 0, costUsd = 0, degraded = false }
) {
  const { rows } = await db.query(
    `INSERT INTO ai_usage_events
       (user_id, conversation_id, feature_key, model, driver, input_tokens, output_tokens, cost_usd, degraded)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [userId, conversationId, featureKey, model, driver, inputTokens, outputTokens, costUsd, degraded]
  );
  return rows[0];
}

/** Sums cost_usd for the current calendar month, optionally scoped to one feature. */
export async function getMonthSpend(db, { featureKey = null } = {}) {
  const params = [];
  let where = `created_at >= date_trunc('month', now())`;
  if (featureKey) {
    params.push(featureKey);
    where += ` AND feature_key = $${params.length}`;
  }
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(cost_usd), 0) AS total, COUNT(*) AS event_count
     FROM ai_usage_events WHERE ${where}`,
    params
  );
  return { totalUsd: parseFloat(rows[0].total), eventCount: parseInt(rows[0].event_count, 10) };
}

export async function getMonthSpendByFeature(db) {
  const { rows } = await db.query(
    `SELECT feature_key, COALESCE(SUM(cost_usd), 0) AS total, COUNT(*) AS event_count
     FROM ai_usage_events
     WHERE created_at >= date_trunc('month', now())
     GROUP BY feature_key`
  );
  return rows.map((r) => ({ featureKey: r.feature_key, totalUsd: parseFloat(r.total), eventCount: parseInt(r.event_count, 10) }));
}

export async function insertSafetyIncident(db, { conversationId = null, messageId = null, incidentType, source, detail = {} }) {
  const { rows } = await db.query(
    `INSERT INTO ai_safety_incidents (conversation_id, message_id, incident_type, source, detail_json)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING *`,
    [conversationId, messageId, incidentType, source, JSON.stringify(detail)]
  );
  return rows[0];
}

export async function getPlatformSetting(db, key) {
  const { rows } = await db.query(`SELECT value_json FROM platform_settings WHERE key = $1`, [key]);
  return rows[0]?.value_json ?? null;
}

export async function upsertPlatformSetting(db, key, valueJson) {
  const { rows } = await db.query(
    `INSERT INTO platform_settings (key, value_json, value_type, label_en, label_bn, group_key, is_sensitive)
     VALUES ($1, $2::jsonb, 'NUMBER', 'AI Monthly Spend Cap (USD)', 'এআই মাসিক খরচ সীমা (ডলার)', 'ai', false)
     ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json
     RETURNING *`,
    [key, JSON.stringify(valueJson)]
  );
  return rows[0];
}
