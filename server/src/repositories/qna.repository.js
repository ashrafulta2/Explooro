/**
 * qna.repository.js — Data access for product_questions & product_answers (Prompt 4.6).
 */

export async function insertQuestion(db, { productId, userId, body }) {
  const { rows } = await db.query(
    `INSERT INTO product_questions (product_id, user_id, body, status, created_at)
     VALUES ($1, $2, $3, 'PUBLISHED', now())
     RETURNING *`,
    [productId, userId, body]
  );
  return rows[0];
}

export async function insertAnswer(db, { questionId, responderId, body }) {
  const { rows } = await db.query(
    `INSERT INTO product_answers (question_id, responder_id, body, status, created_at)
     VALUES ($1, $2, $3, 'PUBLISHED', now())
     RETURNING *`,
    [questionId, responderId, body]
  );
  return rows[0];
}

export async function getQuestionById(db, id) {
  const { rows } = await db.query(`SELECT * FROM product_questions WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function upvoteQuestion(db, questionId, userId) {
  const { rows } = await db.query(
    `INSERT INTO product_question_upvotes (question_id, user_id, created_at)
     VALUES ($1, $2, now())
     ON CONFLICT (question_id, user_id) DO NOTHING
     RETURNING question_id`,
    [questionId, userId]
  );
  if (rows.length === 0) return null; // already upvoted by this user

  const { rows: updated } = await db.query(
    `UPDATE product_questions SET upvote_count = upvote_count + 1 WHERE id = $1 RETURNING id, upvote_count`,
    [questionId]
  );
  return updated[0] ?? null;
}

export async function listQuestionsByProduct(db, productId, { limit = 10, offset = 0 } = {}) {
  const { rows: questions } = await db.query(
    `SELECT q.*, up.display_name AS asker_name
     FROM product_questions q
     LEFT JOIN user_profiles up ON up.user_id = q.user_id
     WHERE q.product_id = $1 AND q.status = 'PUBLISHED'
     ORDER BY q.upvote_count DESC, q.created_at DESC
     LIMIT $2 OFFSET $3`,
    [productId, limit, offset]
  );

  if (questions.length === 0) return questions;

  const ids = questions.map((q) => q.id);
  const { rows: answers } = await db.query(
    `SELECT a.*, up.display_name AS responder_name
     FROM product_answers a
     LEFT JOIN user_profiles up ON up.user_id = a.responder_id
     WHERE a.question_id = ANY($1::bigint[]) AND a.status = 'PUBLISHED'
     ORDER BY a.created_at ASC`,
    [ids]
  );

  const answersByQuestion = new Map();
  for (const a of answers) {
    if (!answersByQuestion.has(a.question_id)) answersByQuestion.set(a.question_id, []);
    answersByQuestion.get(a.question_id).push(a);
  }

  return questions.map((q) => ({ ...q, answers: answersByQuestion.get(q.id) || [] }));
}

export async function countQuestionsByProduct(db, productId) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS count FROM product_questions WHERE product_id = $1 AND status = 'PUBLISHED'`,
    [productId]
  );
  return rows[0].count;
}
