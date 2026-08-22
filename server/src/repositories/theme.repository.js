/**
 * theme.repository.js — Data access for theme_palettes table (Prompt 3.5).
 */

export async function getActiveTheme(db) {
  const { rows } = await db.query(
    `SELECT id, name, preset_key, tokens_json, is_published, created_by, published_by, updated_at
     FROM theme_palettes
     WHERE is_active = true
     LIMIT 1`
  );
  return rows[0] ?? null;
}

export async function listThemePalettes(db) {
  const { rows } = await db.query(
    `SELECT id, name, preset_key, is_active, is_published, tokens_json, created_by, published_by, created_at, updated_at
     FROM theme_palettes
     ORDER BY is_active DESC, updated_at DESC`
  );
  return rows;
}

export async function getThemePaletteById(db, id) {
  const { rows } = await db.query(
    `SELECT id, name, preset_key, is_active, is_published, tokens_json, created_by, published_by, created_at, updated_at
     FROM theme_palettes
     WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function saveThemeDraft(db, { name, presetKey = null, tokensJson, createdBy }) {
  const { rows } = await db.query(
    `INSERT INTO theme_palettes (name, preset_key, tokens_json, created_by, is_active, is_published, updated_at)
     VALUES ($1, $2, $3, $4, false, false, now())
     RETURNING *`,
    [name, presetKey, JSON.stringify(tokensJson), createdBy]
  );
  return rows[0];
}

export async function publishThemePalette(db, id, { publishedBy }) {
  // Deactivate all palettes
  await db.query(`UPDATE theme_palettes SET is_active = false WHERE is_active = true`);

  // Activate and mark target as published
  const { rows } = await db.query(
    `UPDATE theme_palettes
     SET is_active = true, is_published = true, published_by = $2, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, publishedBy]
  );
  return rows[0] ?? null;
}
