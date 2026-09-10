/**
 * me.js — Mock GET/PUT /me/profile, so the account menu's "My Profile" page is fully usable
 * with VITE_API_MODE=mock.
 *
 * Seeded from handlers/auth.js's mock session (whoever "logged in"), then persisted per tab so an
 * edit survives a reload the same way the mock session does.
 *
 * Deliberately mirrors the three rules server/src/services/profile.service.js enforces, because a
 * mock that is more permissive than the API teaches the UI habits the live backend then rejects:
 *   1. `phone` in the payload is ignored — it is the login identifier.
 *   2. Changing `email` clears `is_email_verified`.
 *   3. `full_name` is required.
 */

import { getMockSessionUser } from './auth.js';
import { resolveMockMediaUrl } from './media.js';

const PROFILE_KEY = 'explooro.mock.profile';

const GENDERS = ['MALE', 'FEMALE', 'OTHER', 'UNSPECIFIED'];

// Editable columns, matching profile.service.js's whitelist. Anything else in the body is dropped.
const PROFILE_FIELDS = [
  'full_name',
  'display_name',
  'avatar_media_id',
  'date_of_birth',
  'gender',
  'division',
  'district',
  'upazila',
  'address_line',
  'postal_code',
  'bio',
  'timezone',
  'use_bengali_numerals',
];

function loadStored() {
  try {
    const raw = sessionStorage.getItem(PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persist(profile) {
  try {
    sessionStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    /* sessionStorage unavailable — in-memory only for this page view */
  }
}

/** A believable Bangladeshi starting profile for whoever the mock session says is signed in. */
function seedProfile() {
  const user = getMockSessionUser();
  const roles = user?.roles?.length ? user.roles : ['customer'];
  const name = user?.name || 'Explooro User';

  return {
    id: user?.id || 'usr-mock-self',
    ref: user?.ref || 'USR-MOCK-SELF',
    roles,
    phone: user?.phone || '+8801700000007',
    email: user?.email || 'user@explooro.local',
    is_phone_verified: true,
    is_email_verified: Boolean(user?.email),
    status: 'ACTIVE',
    locale: 'en',
    ui_mode: 'simple',
    last_login_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 214 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: null,
    full_name: name,
    display_name: name,
    avatar_media_id: null,
    avatar_url: null,
    date_of_birth: null,
    gender: 'UNSPECIFIED',
    division: 'dhaka',
    district: 'dhaka_city',
    upazila: 'Dhanmondi',
    address_line: '',
    postal_code: '',
    bio: '',
    timezone: 'Asia/Dhaka',
    use_bengali_numerals: false,
  };
}

let profile = null;

/**
 * The stored profile belongs to whoever was signed in when it was written. Switching mock users
 * (log out, log in as the Dev Supplier) must not show the previous account's name and phone.
 */
function currentProfile() {
  const sessionUser = getMockSessionUser();
  const stored = profile || loadStored();
  if (stored && (!sessionUser || stored.id === sessionUser.id)) {
    profile = stored;
    return profile;
  }
  profile = seedProfile();
  persist(profile);
  return profile;
}

function present(row) {
  return {
    ...row,
    display_name: row.display_name || row.full_name,
    avatar_url: resolveMockMediaUrl(row.avatar_media_id) ?? row.avatar_url ?? null,
  };
}

function validationError(messageEn, messageBn, field) {
  return {
    status: 400,
    body: {
      error: {
        code: 'VALIDATION_FAILED',
        message_en: messageEn,
        message_bn: messageBn,
        details: { field },
      },
    },
  };
}

export default [
  {
    method: 'GET',
    path: '/me/profile',
    handler() {
      return { status: 200, body: { data: present(currentProfile()) } };
    },
  },

  {
    method: 'PUT',
    path: '/me/profile',
    handler({ body }) {
      const current = currentProfile();
      const payload = body || {};

      const fullName = String(payload.full_name ?? '').replace(/\s+/g, ' ').trim();
      if (!fullName) {
        return validationError('Your full name is required.', 'আপনার পুরো নাম আবশ্যক।', 'full_name');
      }

      if (payload.gender && !GENDERS.includes(String(payload.gender).toUpperCase())) {
        return validationError('Select a valid gender option.', 'সঠিক লিঙ্গ নির্বাচন করুন।', 'gender');
      }

      const email = payload.email ? String(payload.email).trim().toLowerCase() : null;
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        return validationError('Enter a valid email address.', 'সঠিক ইমেইল ঠিকানা দিন।', 'email');
      }

      const postalCode = String(payload.postal_code ?? '').trim();
      if (postalCode && !/^\d{4}$/.test(postalCode)) {
        return validationError(
          'A Bangladeshi postal code is 4 digits.',
          'বাংলাদেশি পোস্টাল কোড ৪ সংখ্যার হয়।',
          'postal_code'
        );
      }

      const next = { ...current };
      for (const field of PROFILE_FIELDS) {
        // `payload[field] !== undefined`, not `field in payload`: core/api.js hands the mock the
        // caller's object verbatim (no JSON round trip), so a key set to undefined is still "in"
        // it — and would overwrite a real value with nothing, which a live PUT would never do.
        if (payload[field] !== undefined) next[field] = payload[field];
      }
      next.full_name = fullName;
      next.display_name = String(payload.display_name ?? '').trim() || fullName;
      next.gender = payload.gender ? String(payload.gender).toUpperCase() : null;
      next.postal_code = postalCode;
      next.use_bengali_numerals = Boolean(payload.use_bengali_numerals);
      if (payload.locale) next.locale = String(payload.locale).toLowerCase();
      if (payload.ui_mode) next.ui_mode = String(payload.ui_mode).toLowerCase();

      // Rule 2 — a new address starts unverified.
      if (email !== (current.email || null)) {
        next.email = email;
        next.is_email_verified = false;
      }

      // Rule 1 — phone is the login identifier, never writable here.
      next.phone = current.phone;
      next.updated_at = new Date().toISOString();

      profile = next;
      persist(profile);

      return { status: 200, body: { data: present(profile) } };
    },
  },
];
