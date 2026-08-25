/**
 * content.service.js — Content Commerce, Shoppable Reels, Academy & Translation Manager (Prompt 10.8).
 *
 * Implements idea proposition.md §A, §T, §AL.6:
 * 1. UGC Storytelling Posts with embedded buyable product cards.
 * 2. Shoppable Video Reels with pinned products and 1-tap checkout.
 * 3. Seller Academy micro-courses, lesson progress tracking, and certificates.
 * 4. Zero-deploy Homepage Banners and Hero Slider management.
 * 5. Dynamic Translation Manager with completeness gauges and zero-deploy new locale addition.
 */

import { AppError } from '../plugins/errorHandler.js';
import { generateRef } from '../lib/ref.js';
import { writeAudit } from '../lib/audit.js';

// -----------------------------------------------------------------------------
// 1. STORIES (UGC CONTENT COMMERCE)
// -----------------------------------------------------------------------------

export async function createStory(db, {
  authorId,
  authorRole,
  titleEn,
  titleBn,
  contentEn,
  contentBn,
  coverImageUrl = null,
  embeddedProductIds = [],
  autoPublish = false,
}) {
  if (!titleEn || !titleBn) {
    throw new AppError('VALIDATION_FAILED', 'Both English and Bengali story titles are required.', 400);
  }

  const baseSlug = titleEn.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 7)}`;
  const ref = generateRef('STR');
  const status = autoPublish ? 'PUBLISHED' : 'PENDING_REVIEW';
  const publishedAt = autoPublish ? new Date().toISOString() : null;

  const sql = `
    INSERT INTO stories (
      ref, author_id, author_role, title_en, title_bn, slug,
      content_en, content_bn, cover_image_url, embedded_product_ids,
      status, published_at, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), now())
    RETURNING *;
  `;

  const { rows } = await db.query(sql, [
    ref,
    authorId,
    authorRole || 'saler',
    titleEn.trim(),
    titleBn.trim(),
    slug,
    contentEn,
    contentBn,
    coverImageUrl,
    JSON.stringify(embeddedProductIds),
    status,
    publishedAt,
  ]);

  return rows[0];
}

export async function listStories(db, {
  status = 'PUBLISHED',
  authorId = null,
  limit = 20,
  offset = 0,
} = {}) {
  let sql = `
    SELECT s.*,
           COALESCE(up.display_name, up.full_name) as author_name,
           (SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id
            WHERE ur.user_id = u.id ORDER BY r.id LIMIT 1) as author_user_role
    FROM stories s
    JOIN users u ON s.author_id = u.id
    LEFT JOIN user_profiles up ON up.user_id = u.id
  `;
  const params = [];
  const conditions = [];

  if (status) {
    params.push(status);
    conditions.push(`s.status = $${params.length}`);
  }
  if (authorId) {
    params.push(authorId);
    conditions.push(`s.author_id = $${params.length}`);
  }

  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }

  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  sql += ` ORDER BY s.created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx};`;

  const { rows } = await db.query(sql, params);
  return rows.map((r) => ({
    ...r,
    embedded_product_ids: Array.isArray(r.embedded_product_ids)
      ? r.embedded_product_ids
      : JSON.parse(r.embedded_product_ids || '[]'),
  }));
}

export async function getStoryBySlugOrId(db, idOrSlug) {
  const isNumeric = /^\d+$/.test(String(idOrSlug));
  const whereClause = isNumeric ? 's.id = $1' : 's.slug = $1';

  const sql = `
    SELECT s.*,
           COALESCE(up.display_name, up.full_name) as author_name,
           (SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id
            WHERE ur.user_id = u.id ORDER BY r.id LIMIT 1) as author_user_role
    FROM stories s
    JOIN users u ON s.author_id = u.id
    LEFT JOIN user_profiles up ON up.user_id = u.id
    WHERE ${whereClause};
  `;

  const { rows } = await db.query(sql, [idOrSlug]);
  if (!rows.length) {
    throw new AppError('NOT_FOUND', `Story "${idOrSlug}" not found.`, 404);
  }

  const story = rows[0];
  const prodIds = Array.isArray(story.embedded_product_ids)
    ? story.embedded_product_ids
    : JSON.parse(story.embedded_product_ids || '[]');

  let products = [];
  if (prodIds.length > 0) {
    const { rows: prodRows } = await db.query(
      `SELECT id, ref, slug, title_en, title_bn, retail_price, media_json, stock_quantity
       FROM products
       WHERE id = ANY($1::bigint[]);`,
      [prodIds]
    );
    products = prodRows.map((p) => ({
      ...p,
      retail_price: parseFloat(p.retail_price),
      media: Array.isArray(p.media_json) ? p.media_json : JSON.parse(p.media_json || '[]'),
    }));
  }

  // Increment views
  db.query('UPDATE stories SET view_count = view_count + 1 WHERE id = $1;', [story.id]).catch(() => {});

  return {
    ...story,
    view_count: (story.view_count || 0) + 1,
    embedded_product_ids: prodIds,
    embedded_products: products,
  };
}

export async function reviewStory(db, { storyId, editorId, action, notes = '' }) {
  const { rows } = await db.query('SELECT * FROM stories WHERE id = $1;', [storyId]);
  if (!rows.length) {
    throw new AppError('NOT_FOUND', `Story #${storyId} not found.`, 404);
  }

  const current = rows[0];
  const newStatus = action === 'PUBLISH' ? 'PUBLISHED' : 'REJECTED';
  const publishedAt = action === 'PUBLISH' ? new Date().toISOString() : null;

  const { rows: updated } = await db.query(
    `UPDATE stories
     SET status = $1,
         published_at = COALESCE($2, published_at),
         updated_at = now()
     WHERE id = $3
     RETURNING *;`,
    [newStatus, publishedAt, storyId]
  );

  await writeAudit(db, {
    userId: editorId,
    action: `story.${action.toLowerCase()}`,
    entityType: 'story',
    entityId: storyId,
    beforeJson: { status: current.status },
    afterJson: { status: newStatus, notes },
    notes,
  });

  return updated[0];
}

// -----------------------------------------------------------------------------
// 2. SHOPPABLE REELS
// -----------------------------------------------------------------------------

export async function listReels(db, { limit = 20, offset = 0 } = {}) {
  const sql = `
    SELECT r.*,
           COALESCE(up.display_name, up.full_name) as author_name,
           p.title_en as product_title_en,
           p.title_bn as product_title_bn,
           p.default_retail_price as product_retail_price,
           (SELECT json_agg(json_build_object('storage_key', m.storage_key, 'mime_type', m.mime_type)
                            ORDER BY pi2.is_primary DESC, pi2.display_order ASC)
            FROM product_images pi2 JOIN media_assets m ON m.id = pi2.media_id
            WHERE pi2.product_id = p.id) as product_media_json,
           p.stock_qty as product_stock_quantity
    FROM reels r
    JOIN users u ON r.author_id = u.id
    LEFT JOIN user_profiles up ON up.user_id = u.id
    LEFT JOIN products p ON r.pinned_product_id = p.id
    WHERE r.status = 'PUBLISHED'
    ORDER BY r.created_at DESC
    LIMIT $1 OFFSET $2;
  `;

  const { rows } = await db.query(sql, [limit, offset]);
  return rows.map((r) => ({
    ...r,
    product: r.pinned_product_id ? {
      id: r.pinned_product_id,
      title_en: r.product_title_en,
      title_bn: r.product_title_bn,
      retail_price: parseFloat(r.product_retail_price || 0),
      media: Array.isArray(r.product_media_json) ? r.product_media_json : JSON.parse(r.product_media_json || '[]'),
      is_in_stock: (r.product_stock_quantity || 0) > 0,
    } : null,
  }));
}

export async function createReel(db, {
  authorId,
  videoUrl,
  thumbnailUrl,
  durationSeconds = 15,
  captionEn,
  captionBn,
  pinnedProductId = null,
}) {
  const ref = generateRef('REL');
  const sql = `
    INSERT INTO reels (
      ref, author_id, video_url, thumbnail_url, duration_seconds,
      caption_en, caption_bn, pinned_product_id, status, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PUBLISHED', now())
    RETURNING *;
  `;

  const { rows } = await db.query(sql, [
    ref,
    authorId,
    videoUrl,
    thumbnailUrl,
    durationSeconds,
    captionEn,
    captionBn,
    pinnedProductId,
  ]);

  return rows[0];
}

export async function likeReel(db, reelId) {
  const { rows } = await db.query(
    'UPDATE reels SET likes_count = likes_count + 1 WHERE id = $1 RETURNING id, likes_count;',
    [reelId]
  );
  return rows[0];
}

// -----------------------------------------------------------------------------
// 3. SELLER ACADEMY (MICRO-LEARNING & CERTIFICATES)
// -----------------------------------------------------------------------------

export async function listCourses(db, { role = null, category = null, userId = null } = {}) {
  let sql = `
    SELECT c.*,
           (SELECT COUNT(*) FROM academy_lessons l WHERE l.course_id = c.id) as lessons_count
    FROM academy_courses c
    WHERE c.is_published = true
  `;
  const params = [];

  if (category) {
    params.push(category);
    sql += ` AND c.category = $${params.length}`;
  }
  if (role) {
    params.push(role);
    sql += ` AND (c.target_role = $${params.length} OR c.target_role = 'all')`;
  }

  sql += ` ORDER BY c.created_at ASC;`;

  const { rows: courses } = await db.query(sql, params);

  // If userId provided, calculate completed lessons
  if (userId) {
    const { rows: completedRows } = await db.query(
      `SELECT course_id, COUNT(*) as completed_count
       FROM academy_progress
       WHERE user_id = $1 AND is_completed = true
       GROUP BY course_id;`,
      [userId]
    );

    const completedMap = new Map(completedRows.map((r) => [Number(r.course_id), parseInt(r.completed_count, 10)]));

    return courses.map((c) => {
      const total = parseInt(c.lessons_count, 10) || 1;
      const completed = completedMap.get(Number(c.id)) || 0;
      const progressPct = Math.min(100, Math.round((completed / total) * 100));
      return {
        ...c,
        completed_lessons: completed,
        progress_pct: progressPct,
        is_completed: progressPct >= 100,
      };
    });
  }

  return courses;
}

export async function getCourseDetail(db, courseIdOrRef, userId = null) {
  const isNumeric = /^\d+$/.test(String(courseIdOrRef));
  const whereClause = isNumeric ? 'id = $1' : 'ref = $1';

  const { rows: courses } = await db.query(`SELECT * FROM academy_courses WHERE ${whereClause};`, [courseIdOrRef]);
  if (!courses.length) {
    throw new AppError('NOT_FOUND', `Course "${courseIdOrRef}" not found.`, 404);
  }

  const course = courses[0];

  const { rows: lessons } = await db.query(
    `SELECT * FROM academy_lessons WHERE course_id = $1 ORDER BY sequence_no ASC;`,
    [course.id]
  );

  let completedLessonIds = new Set();
  if (userId) {
    const { rows: pRows } = await db.query(
      `SELECT lesson_id FROM academy_progress WHERE user_id = $1 AND course_id = $2 AND is_completed = true;`,
      [userId, course.id]
    );
    completedLessonIds = new Set(pRows.map((r) => Number(r.lesson_id)));
  }

  const enrichedLessons = lessons.map((l) => ({
    ...l,
    is_completed: completedLessonIds.has(Number(l.id)),
  }));

  const completedCount = enrichedLessons.filter((l) => l.is_completed).length;
  const progressPct = lessons.length > 0 ? Math.round((completedCount / lessons.length) * 100) : 0;

  return {
    ...course,
    lessons: enrichedLessons,
    lessons_count: lessons.length,
    completed_lessons: completedCount,
    progress_pct: progressPct,
    is_completed: progressPct >= 100,
  };
}

export async function markLessonCompleted(db, { userId, courseId, lessonId }) {
  const sql = `
    INSERT INTO academy_progress (user_id, course_id, lesson_id, is_completed, completed_at, created_at)
    VALUES ($1, $2, $3, true, now(), now())
    ON CONFLICT (user_id, lesson_id) DO UPDATE SET is_completed = true, completed_at = now()
    RETURNING *;
  `;

  const { rows } = await db.query(sql, [userId, courseId, lessonId]);
  return rows[0];
}

// -----------------------------------------------------------------------------
// 4. HOMEPAGE BANNERS (ZERO-DEPLOY DYNAMIC EDITING)
// -----------------------------------------------------------------------------

export async function listBanners(db, { slot = null, activeOnly = true } = {}) {
  let sql = `SELECT * FROM banners`;
  const params = [];
  const conditions = [];

  if (activeOnly) {
    conditions.push('is_active = true');
  }
  if (slot) {
    params.push(slot);
    conditions.push(`slot = $${params.length}`);
  }

  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }

  sql += ` ORDER BY display_order ASC, created_at DESC;`;

  const { rows } = await db.query(sql, params);
  return rows;
}

export async function upsertBanner(db, {
  id = null,
  slot = 'HOMEPAGE_HERO',
  titleEn,
  title_en,
  titleBn,
  title_bn,
  imageUrlDesktop,
  image_url_desktop,
  imageUrlMobile = null,
  image_url_mobile = null,
  targetLink,
  target_link,
  displayOrder = 0,
  display_order = 0,
  isActive = true,
  is_active = true,
  editorId = null,
}) {
  const tEn = titleEn || title_en;
  const tBn = titleBn || title_bn || tEn;
  const imgD = imageUrlDesktop || image_url_desktop;
  const imgM = imageUrlMobile || image_url_mobile;
  const link = targetLink || target_link;
  const order = displayOrder !== undefined ? displayOrder : (display_order !== undefined ? display_order : 0);
  const active = isActive !== undefined ? isActive : (is_active !== undefined ? is_active : true);

  if (!tEn || !imgD || !link) {
    throw new AppError('VALIDATION_FAILED', 'Title, desktop image URL, and target link are required.', 'শিরোনাম, ডেক্সটপ ছবির লিঙ্ক এবং টার্গেট লিঙ্ক প্রয়োজন।', null, 400);
  }

  let banner;
  if (id) {
    const updateSql = `
      UPDATE banners
      SET slot = $1,
          title_en = $2,
          title_bn = $3,
          image_url_desktop = $4,
          image_url_mobile = $5,
          target_link = $6,
          display_order = $7,
          is_active = $8,
          updated_at = now()
      WHERE id = $9
      RETURNING *;
    `;
    const { rows } = await db.query(updateSql, [
      slot,
      tEn,
      tBn,
      imgD,
      imgM,
      link,
      order,
      active,
      id,
    ]);
    banner = rows[0];
  } else {
    const insertSql = `
      INSERT INTO banners (
        slot, title_en, title_bn, image_url_desktop,
        image_url_mobile, target_link, display_order, is_active,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
      RETURNING *;
    `;
    const { rows } = await db.query(insertSql, [
      slot,
      tEn,
      tBn,
      imgD,
      imgM,
      link,
      order,
      active,
    ]);
    banner = rows[0];
  }

  await writeAudit(db, {
    userId: editorId,
    action: id ? 'banner.update' : 'banner.create',
    entityType: 'banner',
    entityId: banner.id,
    afterJson: banner,
    notes: `Editor updated banner ${banner.title_en} live without deploy`,
  });

  return banner;
}

export async function deleteBanner(db, { bannerId, editorId }) {
  const { rows } = await db.query('DELETE FROM banners WHERE id = $1 RETURNING *;', [bannerId]);
  if (!rows.length) {
    throw new AppError('NOT_FOUND', `Banner #${bannerId} not found.`, 404);
  }

  await writeAudit(db, {
    userId: editorId,
    action: 'banner.delete',
    entityType: 'banner',
    entityId: bannerId,
    notes: `Editor deleted banner #${bannerId}`,
  });

  return { id: bannerId, deleted: true };
}

// -----------------------------------------------------------------------------
// 5. DYNAMIC TRANSLATION MANAGER (ZERO-DEPLOY MULTI-LOCALE)
// -----------------------------------------------------------------------------

export async function getTranslationsForLocale(db, locale) {
  const { rows } = await db.query(
    'SELECT namespace, key, value FROM i18n_translations WHERE locale = $1;',
    [locale]
  );

  const result = {};
  for (const r of rows) {
    if (!result[r.namespace]) result[r.namespace] = {};
    result[r.namespace][r.key] = r.value;
  }
  return result;
}

export async function upsertTranslationKey(db, {
  namespace = 'common',
  key,
  locale,
  value,
  editorId = null,
}) {
  if (!key || !locale || value === undefined) {
    throw new AppError('VALIDATION_FAILED', 'Key, locale, and value are required.', 400);
  }

  const sql = `
    INSERT INTO i18n_translations (namespace, key, locale, value, created_at, updated_at)
    VALUES ($1, $2, $3, $4, now(), now())
    ON CONFLICT (namespace, key, locale) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    RETURNING *;
  `;

  const { rows } = await db.query(sql, [namespace, key, locale, value]);

  if (editorId) {
    await writeAudit(db, {
      userId: editorId,
      action: 'translation.upsert',
      entityType: 'i18n_translation',
      entityId: rows[0].id,
      afterJson: { namespace, key, locale, value },
      notes: `Updated translation for [${locale}] ${namespace}.${key}`,
    });
  }

  return rows[0];
}

export async function listTranslationCompleteness(db) {
  // Count base keys in English ('en')
  const { rows: baseRows } = await db.query(
    `SELECT DISTINCT namespace, key FROM i18n_translations WHERE locale = 'en';`
  );
  const baseKeySet = new Set(baseRows.map((r) => `${r.namespace}.${r.key}`));
  const baseTotal = Math.max(1, baseKeySet.size);

  // Group count by locale
  const { rows: localeCounts } = await db.query(
    `SELECT locale, COUNT(DISTINCT namespace || '.' || key) as key_count
     FROM i18n_translations
     GROUP BY locale;`
  );

  const locales = localeCounts.map((r) => {
    const count = parseInt(r.key_count, 10);
    const pct = Math.min(100, Math.round((count / baseTotal) * 100));
    return {
      locale: r.locale,
      total_keys: count,
      completeness_pct: pct,
    };
  });

  return {
    base_locale: 'en',
    base_total_keys: baseTotal,
    locales,
  };
}

export async function exportTranslationsJson(db, locale) {
  const map = await getTranslationsForLocale(db, locale);
  return map;
}

export async function importTranslationsJson(db, { locale, data, editorId = null }) {
  if (!data || typeof data !== 'object') {
    throw new AppError('VALIDATION_FAILED', 'Invalid translations object.', 400);
  }

  let importedCount = 0;
  for (const [namespace, keysObj] of Object.entries(data)) {
    if (typeof keysObj === 'object' && keysObj !== null) {
      for (const [k, val] of Object.entries(keysObj)) {
        if (typeof val === 'string') {
          await upsertTranslationKey(db, {
            namespace,
            key: k,
            locale,
            value: val,
            editorId,
          });
          importedCount++;
        }
      }
    }
  }

  return { locale, imported_keys: importedCount };
}
