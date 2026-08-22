/**
 * media.repository.js — Data access for media_assets table (Prompt 4.2).
 */

export async function insertMediaAsset(
  db,
  {
    ref,
    ownerId = null,
    purpose,
    storageDriver = 'LOCAL',
    storageKey,
    mimeType,
    sizeBytes,
    width = null,
    height = null,
    durationSeconds = null,
    derivativesJson = {},
    posterMediaId = null,
    qualityScore = 100,
    moderationStatus = 'APPROVED',
  }
) {
  const { rows } = await db.query(
    `INSERT INTO media_assets
       (ref, owner_id, purpose, storage_driver, storage_key, mime_type,
        size_bytes, width, height, duration_seconds, derivatives_json,
        poster_media_id, quality_score, moderation_status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
     RETURNING *`,
    [
      ref,
      ownerId,
      purpose,
      storageDriver.toUpperCase(),
      storageKey,
      mimeType,
      sizeBytes,
      width,
      height,
      durationSeconds,
      JSON.stringify(derivativesJson),
      posterMediaId,
      qualityScore,
      moderationStatus,
    ]
  );
  return rows[0];
}

export async function getMediaAssetById(db, id) {
  const { rows } = await db.query(
    `SELECT * FROM media_assets WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  return rows[0] ?? null;
}

export async function getMediaAssetByRef(db, ref) {
  const { rows } = await db.query(
    `SELECT * FROM media_assets WHERE ref = $1 AND deleted_at IS NULL`,
    [ref]
  );
  return rows[0] ?? null;
}

export async function listMediaAssets(db, { ownerId, purpose, limit = 50, offset = 0 } = {}) {
  const conditions = ['deleted_at IS NULL'];
  const params = [];

  if (ownerId) {
    params.push(ownerId);
    conditions.push(`owner_id = $${params.length}`);
  }

  if (purpose) {
    params.push(purpose);
    conditions.push(`purpose = $${params.length}`);
  }

  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const { rows } = await db.query(
    `SELECT * FROM media_assets
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );
  return rows;
}
