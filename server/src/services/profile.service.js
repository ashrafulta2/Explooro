/**
 * profile.service.js — the signed-in user's own profile (GET/PUT /api/v1/me/profile).
 *
 * Distinct from the admin user surfaces: this one is scoped to `req.user.id` and never takes a
 * target id, so there is no object to authorize against beyond "you are logged in". Everything a
 * user may say about themselves is validated here; the repository only writes whitelisted columns.
 *
 * Three rules the UI cannot be trusted to enforce, so they live here:
 *  1. Phone is never writable — it is the login identifier and only the OTP flow (auth.service)
 *     may change it. A `phone` in the payload is silently ignored, not honoured.
 *  2. Changing the email drops `is_email_verified`. Otherwise anyone could inherit a verified
 *     badge for an address they have never proven they control.
 *  3. `date_of_birth` is a 🔐 column (docs/erd.md §0.6) — stored as AES-256-GCM ciphertext through
 *     lib/encryption.js, decrypted only on read for its own owner.
 */

import { AppError } from '../plugins/errorHandler.js';
import { withTransaction } from '../config/db.js';
import { encryptField, decryptField } from '../lib/encryption.js';
import { getStorageDriver } from '../integrations/storage/index.js';
import * as userRepo from '../repositories/user.repository.js';
import * as auditService from './audit.service.js';

export const GENDERS = ['MALE', 'FEMALE', 'OTHER', 'UNSPECIFIED'];
export const LOCALES = ['bn', 'en'];
export const UI_MODES = ['simple', 'advanced'];

// Bangladesh's own minimum for an independent commercial account. Enforced here rather than in the
// browser because the birth date drives age-gated campaigns later.
export const MIN_AGE_YEARS = 13;
export const MAX_AGE_YEARS = 120;

export const MAX_LENGTHS = {
  full_name: 120,
  display_name: 60,
  address_line: 255,
  postal_code: 10,
  bio: 500,
  division: 60,
  district: 60,
  upazila: 60,
  timezone: 60,
};

function fail(messageEn, messageBn, field) {
  throw new AppError('VALIDATION_FAILED', messageEn, messageBn, field ? { field } : undefined);
}

/** Trims, collapses runs of whitespace, and enforces the column's length budget. */
function cleanText(value, field, max = 255) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  if (trimmed.length > max) {
    fail(
      `${field.replace(/_/g, ' ')} must be ${max} characters or fewer.`,
      `${max} অক্ষরের মধ্যে লিখুন।`,
      field
    );
  }
  return trimmed;
}

/** Bio keeps its line breaks — it is the only free-form paragraph on the profile. */
function cleanParagraph(value, field, max) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).replace(/[ \t]+/g, ' ').trim();
  if (!trimmed) return null;
  if (trimmed.length > max) {
    fail(`Bio must be ${max} characters or fewer.`, `পরিচিতি ${max} অক্ষরের মধ্যে লিখুন।`, field);
  }
  return trimmed;
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/**
 * Validates a `YYYY-MM-DD` birth date and returns it normalized, or null for "cleared".
 * Rejects calendar-invalid dates (2025-02-30) that `new Date()` would silently roll over.
 */
export function normalizeDateOfBirth(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const raw = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    fail('Date of birth must be in YYYY-MM-DD format.', 'জন্মতারিখ YYYY-MM-DD ফরম্যাটে দিন।', 'date_of_birth');
  }

  const [year, month, day] = raw.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  if (!isRealDate) {
    fail('That date does not exist on the calendar.', 'এই তারিখটি বাস্তবে নেই।', 'date_of_birth');
  }

  const ageYears = (Date.now() - parsed.getTime()) / (365.2425 * 24 * 60 * 60 * 1000);
  if (ageYears < MIN_AGE_YEARS) {
    fail(
      `You must be at least ${MIN_AGE_YEARS} years old to use Explooro.`,
      `এক্সপ্লুরো ব্যবহারের জন্য কমপক্ষে ${MIN_AGE_YEARS} বছর বয়স হতে হবে।`,
      'date_of_birth'
    );
  }
  if (ageYears > MAX_AGE_YEARS) {
    fail('Please check the birth year.', 'জন্মসাল যাচাই করুন।', 'date_of_birth');
  }

  return raw;
}

/**
 * Turns an arbitrary request body into exactly the two column sets the repository may write.
 * Anything not named here (phone, status, roles, id) is dropped rather than rejected, so a client
 * that echoes back the whole GET payload still gets a correct PUT.
 */
export function buildProfileUpdate(payload = {}) {
  const profile = {};
  const account = {};

  const fullName = cleanText(payload.full_name, 'full_name', MAX_LENGTHS.full_name);
  if (!fullName) fail('Your full name is required.', 'আপনার পুরো নাম আবশ্যক।', 'full_name');
  profile.full_name = fullName;

  // An empty display name falls back to the legal name rather than rendering a blank avatar menu.
  profile.display_name = cleanText(payload.display_name, 'display_name', MAX_LENGTHS.display_name) || fullName;

  if ('gender' in payload) {
    const gender = payload.gender ? String(payload.gender).toUpperCase() : null;
    if (gender && !GENDERS.includes(gender)) {
      fail('Select a valid gender option.', 'সঠিক লিঙ্গ নির্বাচন করুন।', 'gender');
    }
    profile.gender = gender;
  }

  if ('date_of_birth' in payload) {
    profile.date_of_birth = normalizeDateOfBirth(payload.date_of_birth);
  }

  for (const field of ['division', 'district', 'upazila', 'address_line', 'postal_code']) {
    if (field in payload) profile[field] = cleanText(payload[field], field, MAX_LENGTHS[field]);
  }

  if (profile.postal_code && !/^\d{4}$/.test(profile.postal_code)) {
    fail('A Bangladeshi postal code is 4 digits.', 'বাংলাদেশি পোস্টাল কোড ৪ সংখ্যার হয়।', 'postal_code');
  }

  if ('bio' in payload) profile.bio = cleanParagraph(payload.bio, 'bio', MAX_LENGTHS.bio);

  if ('timezone' in payload) {
    profile.timezone = cleanText(payload.timezone, 'timezone', MAX_LENGTHS.timezone) || 'Asia/Dhaka';
  }

  if ('use_bengali_numerals' in payload) {
    profile.use_bengali_numerals = Boolean(payload.use_bengali_numerals);
  }

  if ('avatar_media_id' in payload) {
    const raw = payload.avatar_media_id;
    if (raw === null || raw === '' || raw === undefined) {
      profile.avatar_media_id = null;
    } else if (!/^\d+$/.test(String(raw))) {
      fail('Invalid avatar reference.', 'প্রোফাইল ছবির রেফারেন্স সঠিক নয়।', 'avatar_media_id');
    } else {
      profile.avatar_media_id = Number(raw);
    }
  }

  if ('locale' in payload && payload.locale) {
    const locale = String(payload.locale).toLowerCase();
    if (!LOCALES.includes(locale)) fail('Unsupported language.', 'ভাষাটি সমর্থিত নয়।', 'locale');
    account.locale = locale;
  }

  if ('ui_mode' in payload && payload.ui_mode) {
    const uiMode = String(payload.ui_mode).toLowerCase();
    if (!UI_MODES.includes(uiMode)) fail('Unsupported interface mode.', 'ইন্টারফেস মোডটি সমর্থিত নয়।', 'ui_mode');
    account.ui_mode = uiMode;
  }

  if ('email' in payload) {
    const email = payload.email ? String(payload.email).trim().toLowerCase() : null;
    if (email && !isValidEmail(email)) {
      fail('Enter a valid email address.', 'সঠিক ইমেইল ঠিকানা দিন।', 'email');
    }
    account.email = email;
  }

  return { profile, account };
}

/** Maps a repository row onto the API's profile shape, decrypting the 🔐 birth date. */
function presentProfile(row, piiKey) {
  let dateOfBirth = null;
  if (row.date_of_birth) {
    try {
      dateOfBirth = decryptField(row.date_of_birth, piiKey);
    } catch {
      // WHY swallow: a row encrypted under a rotated key must not make the whole profile page
      // 500. The field reads as "not set" and the next save re-encrypts it under the current key.
      dateOfBirth = null;
    }
  }

  return {
    id: row.id,
    ref: row.ref,
    phone: row.phone,
    email: row.email,
    is_phone_verified: row.is_phone_verified,
    is_email_verified: row.is_email_verified,
    status: row.status,
    locale: row.locale,
    ui_mode: row.ui_mode,
    last_login_at: row.last_login_at,
    created_at: row.created_at,
    updated_at: row.profile_updated_at,
    full_name: row.full_name,
    display_name: row.display_name || row.full_name,
    avatar_media_id: row.avatar_media_id,
    avatar_url: row.avatar_storage_key ? getStorageDriver().getPublicUrl(row.avatar_storage_key) : null,
    date_of_birth: dateOfBirth,
    gender: row.gender,
    division: row.division,
    district: row.district,
    upazila: row.upazila,
    address_line: row.address_line,
    postal_code: row.postal_code,
    bio: row.bio,
    timezone: row.timezone || 'Asia/Dhaka',
    use_bengali_numerals: Boolean(row.use_bengali_numerals),
  };
}

export async function getMyProfile(db, config, userId) {
  const row = await userRepo.getSelfProfile(db, userId);
  if (!row) throw new AppError('NOT_FOUND', 'Account not found.', 'অ্যাকাউন্ট পাওয়া যায়নি।');

  const roles = await userRepo.getRolesForUser(db, userId);
  return { ...presentProfile(row, config.auth.piiEncryptionKey), roles };
}

export async function updateMyProfile(db, config, userId, payload = {}) {
  const current = await userRepo.getSelfProfile(db, userId);
  if (!current) throw new AppError('NOT_FOUND', 'Account not found.', 'অ্যাকাউন্ট পাওয়া যায়নি।');

  const { profile, account } = buildProfileUpdate(payload);

  if (account.email && account.email !== String(current.email || '').toLowerCase()) {
    if (await userRepo.isEmailTakenByAnotherUser(db, account.email, userId)) {
      throw new AppError(
        'CONFLICT',
        'That email address is already registered to another account.',
        'এই ইমেইল ঠিকানাটি অন্য একটি অ্যাকাউন্টে ব্যবহৃত হচ্ছে।',
        { field: 'email' }
      );
    }
    // Rule 2 — a new address starts unverified, always.
    account.is_email_verified = false;
  } else {
    delete account.email;
  }

  if (profile.avatar_media_id) {
    const asset = await userRepo.findOwnedAvatarAsset(db, profile.avatar_media_id, userId);
    if (!asset) {
      throw new AppError(
        'VALIDATION_FAILED',
        'That image is not an avatar you uploaded.',
        'ছবিটি আপনার আপলোড করা প্রোফাইল ছবি নয়।',
        { field: 'avatar_media_id' }
      );
    }
  }

  const before = presentProfile(current, config.auth.piiEncryptionKey);

  // Encrypt only after validation, so a rejected payload never reaches the cipher.
  const persistable = { ...profile };
  if ('date_of_birth' in persistable) {
    persistable.date_of_birth = persistable.date_of_birth
      ? encryptField(persistable.date_of_birth, config.auth.piiEncryptionKey)
      : null;
  }

  await withTransaction(db, async (tx) => {
    await userRepo.upsertSelfProfile(tx, userId, persistable);
    await userRepo.updateSelfAccount(tx, userId, account);
  });

  const after = await getMyProfile(db, config, userId);

  await auditService.record(db, {
    action: 'user.profile.update',
    targetType: 'user',
    targetRef: current.ref,
    actorId: userId,
    before,
    after,
    riskTier: 'LOW',
  });

  return after;
}
