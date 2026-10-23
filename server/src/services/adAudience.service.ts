/**
 * adAudience.service.ts — who an ad is shown to (Phase C, migration 087).
 *
 * An advertiser picks an audience in plain terms: which account types, where they live, gender, and
 * what they are interested in. It is stored as `targeting_json.audience` on the campaign and, unlike
 * the older keyword/category/district targeting (a soft relevance boost in adAuction.service.ts), it
 * is a HARD filter: an ad is served only to viewers who match every condition the advertiser set.
 *
 * What we know about a viewer, and nothing more:
 *   roles      their account types
 *   gender     user_profiles.gender (an UNSPECIFIED or missing gender matches only "everyone")
 *   location   user_profiles division/district, else their default delivery address
 *   interests  categories they viewed, carted, wishlisted or bought within `interest_window_days`
 *
 * WHY no age: the birth date is an encrypted column read only by its owner (profile.service.ts), and
 * decrypting every viewer's birth date to place an ad would break that promise.
 *
 * WHY a minimum audience size: "female suppliers in one district interested in one category" can be
 * one person. A narrowed audience smaller than `min_audience_size` is refused, so an ad can never
 * single out an identifiable individual.
 */

import { AppError } from '../plugins/errorHandler.ts';

export const DIVISIONS = Object.freeze(['Barishal', 'Chattogram', 'Dhaka', 'Khulna', 'Mymensingh', 'Rajshahi', 'Rangpur', 'Sylhet']);
export const AUDIENCE_ROLES = Object.freeze(['customer', 'saler', 'supplier']);
export const GENDERS = Object.freeze(['ALL', 'MALE', 'FEMALE']);

const LIMITS = Object.freeze({ districts: 64, interests: 20, textLength: 60 });
export const RULES_KEY = 'ads.audience';
export const RULE_LIMITS = Object.freeze({
  min_audience_size: { min: 1, max: 100000 },
  interest_window_days: { min: 7, max: 365 },
});
export const DEFAULT_RULES = Object.freeze({ min_audience_size: 20, interest_window_days: 90 });

export type Audience = { roles: string[]; gender: string; divisions: string[]; districts: string[]; interests: number[] };
export const EVERYONE: Audience = Object.freeze({ roles: [], gender: 'ALL', divisions: [], districts: [], interests: [] }) as Audience;

const lower = (s) => String(s ?? '').trim().toLowerCase();

/** Pure. A client's audience cut down to known values, capped and de-duplicated. Unknown values are dropped. */
export function normalizeAudience(raw): Audience {
  const a = raw && typeof raw === 'object' ? raw : {};
  const list = (v) => (Array.isArray(v) ? v : []);
  const divisionByLower = new Map(DIVISIONS.map((d) => [d.toLowerCase(), d]));
  return {
    roles: [...new Set(list(a.roles).map(lower).filter((r) => AUDIENCE_ROLES.includes(r)))],
    gender: GENDERS.includes(String(a.gender).toUpperCase()) ? String(a.gender).toUpperCase() : 'ALL',
    divisions: [...new Set(list(a.divisions).map((d) => divisionByLower.get(lower(d))).filter(Boolean))],
    districts: [...new Set(list(a.districts).filter((d) => typeof d === 'string').map((d) => d.trim().slice(0, LIMITS.textLength)).filter(Boolean))].slice(0, LIMITS.districts),
    interests: [...new Set(list(a.interests).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, LIMITS.interests),
  };
}

/** Pure. Whether the audience narrows anything at all ("everyone" does not). */
export function isNarrowed(a: Audience) {
  return Boolean(a && (a.roles.length || a.gender !== 'ALL' || a.divisions.length || a.districts.length || a.interests.length));
}

/**
 * Pure. Whether one viewer may be shown an ad with this audience.
 *
 * @param {Audience} a
 * @param {null|{ roles: string[], gender: string|null, division: string|null, district: string|null, interests: number[] }} viewer
 *   null for a signed-out visitor
 * @param {{ district?: string, categoryId?: number|string }} context  what the page itself says
 */
export function matchesAudience(a: Audience, viewer, context: { district?: string; categoryId?: number | string | null } = {}) {
  if (!a || !isNarrowed(a)) return true;
  // Account type and gender are facts about a person; a signed-out visitor matches neither.
  if (a.roles.length && !(viewer && viewer.roles.some((r) => a.roles.includes(r)))) return false;
  if (a.gender !== 'ALL' && !(viewer && viewer.gender === a.gender)) return false;

  if (a.divisions.length || a.districts.length) {
    const district = lower(viewer?.district || context.district);
    const division = lower(viewer?.division);
    const inDistrict = district && a.districts.some((d) => lower(d) === district);
    const inDivision = division && a.divisions.some((d) => lower(d) === division);
    if (!inDistrict && !inDivision) return false;
  }

  if (a.interests.length) {
    const fromPage = context.categoryId != null && a.interests.includes(Number(context.categoryId));
    const fromHistory = Boolean(viewer?.interests?.some((c) => a.interests.includes(Number(c))));
    if (!fromPage && !fromHistory) return false;
  }
  return true;
}

export function resolveRules(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const ok = (v, { min, max }) => Number.isInteger(v) && v >= min && v <= max;
  return {
    min_audience_size: ok(r.min_audience_size, RULE_LIMITS.min_audience_size) ? r.min_audience_size : DEFAULT_RULES.min_audience_size,
    interest_window_days: ok(r.interest_window_days, RULE_LIMITS.interest_window_days) ? r.interest_window_days : DEFAULT_RULES.interest_window_days,
  };
}

export async function loadRules(db) {
  try {
    const { rows } = await db.query(`SELECT value_json FROM platform_settings WHERE key = $1`, [RULES_KEY]);
    return resolveRules(rows[0]?.value_json);
  } catch {
    return { ...DEFAULT_RULES };
  }
}

/**
 * What we know about one signed-in viewer (one query each for profile/roles and interests), or null.
 * Only called when at least one candidate ad has a narrowed audience.
 */
export async function loadViewer(db, viewerId, rules) {
  if (!viewerId) return null;
  const { rows } = await db.query(
    `SELECT COALESCE(array_agg(DISTINCT r.key) FILTER (WHERE r.key IS NOT NULL), '{}') AS roles,
            up.gender,
            COALESCE(NULLIF(up.division, ''), ua.division) AS division,
            COALESCE(NULLIF(up.district, ''), ua.district) AS district
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       LEFT JOIN user_profiles up ON up.user_id = u.id
       LEFT JOIN user_addresses ua ON ua.user_id = u.id AND ua.is_default
      WHERE u.id = $1
      GROUP BY up.gender, up.division, up.district, ua.division, ua.district`,
    [viewerId]
  );
  if (!rows[0]) return null;
  const { rows: interestRows } = await db.query(
    `SELECT DISTINCT category_id FROM product_interaction_events
      WHERE user_id = $1 AND category_id IS NOT NULL
        AND created_at >= now() - ($2::int * INTERVAL '1 day')`,
    [viewerId, rules.interest_window_days]
  );
  return {
    roles: rows[0].roles || [],
    gender: rows[0].gender || null,
    division: rows[0].division || null,
    district: rows[0].district || null,
    interests: interestRows.map((r) => Number(r.category_id)),
  };
}

/**
 * How many active accounts match the audience — the "about N people" the wizard shows. The same
 * conditions as matchesAudience, counted in SQL over every account.
 */
export async function estimateAudience(db, audience: Audience, rules) {
  const a = normalizeAudience(audience);
  const roles = a.roles.length ? a.roles : [...AUDIENCE_ROLES];
  const { rows } = await db.query(
    `SELECT COUNT(DISTINCT u.id)::int AS people
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id AND r.key = ANY($1::text[])
       LEFT JOIN user_profiles up ON up.user_id = u.id
       LEFT JOIN user_addresses ua ON ua.user_id = u.id AND ua.is_default
      WHERE u.status = 'ACTIVE' AND u.deleted_at IS NULL
        AND ($2::text = 'ALL' OR up.gender = $2::text)
        AND (
          (cardinality($3::text[]) = 0 AND cardinality($4::text[]) = 0)
          OR lower(COALESCE(NULLIF(up.division, ''), ua.division)) = ANY($3::text[])
          OR lower(COALESCE(NULLIF(up.district, ''), ua.district)) = ANY($4::text[])
        )
        AND (
          cardinality($5::bigint[]) = 0
          OR EXISTS (SELECT 1 FROM product_interaction_events e
                      WHERE e.user_id = u.id AND e.category_id = ANY($5::bigint[])
                        AND e.created_at >= now() - ($6::int * INTERVAL '1 day'))
        )`,
    [roles, a.gender, a.divisions.map(lower), a.districts.map(lower), a.interests, rules.interest_window_days]
  );
  const people = rows[0]?.people ?? 0;
  return { people, narrowed: isNarrowed(a), min_audience_size: rules.min_audience_size, too_small: isNarrowed(a) && people < rules.min_audience_size };
}

/** Refuses a narrowed audience smaller than the minimum (see the WHY at the top of this file). */
export async function assertAudienceAllowed(db, audience: Audience) {
  if (!isNarrowed(audience)) return;
  const rules = await loadRules(db);
  const { people, too_small } = await estimateAudience(db, audience, rules);
  if (too_small) {
    throw new AppError(
      'AUDIENCE_TOO_SMALL',
      `This audience is about ${people} people. Widen it to at least ${rules.min_audience_size} so an ad never singles anyone out.`,
      `এই দর্শক প্রায় ${people} জন। অন্তত ${rules.min_audience_size} জন করতে দর্শক বড় করুন, যাতে বিজ্ঞাপন কাউকে আলাদা করে লক্ষ্য না করে।`,
      { people, min_audience_size: rules.min_audience_size }
    );
  }
}
