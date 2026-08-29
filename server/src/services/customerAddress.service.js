/**
 * customerAddress.service.js — Service for Customer Saved Addresses & Address Book Management.
 *
 * Implements:
 * 1. CRUD for user shipping addresses with administrative hierarchy (division, district, upazila).
 * 2. Strict Bangladeshi phone validation (+88013-9XXXXXXXX).
 * 3. Atomic default-address management — every mutation runs in one transaction and the DB's
 *    partial unique index (ux_user_addresses_single_default) guarantees exactly one default.
 * 4. Idempotent, race-free provisioning from the user's profile address on first read.
 */

import { AppError } from '../plugins/errorHandler.js';
import { withTransaction } from '../config/db.js';
import * as addressRepo from '../repositories/customerAddress.repository.js';

export const MAX_ADDRESSES_PER_USER = addressRepo.MAX_ADDRESSES_PER_USER;

export function normalizeBdPhone(input) {
  if (!input) return '';
  const digits = String(input).replace(/\D/g, '');
  if (digits.startsWith('8801') && digits.length === 13) return `+${digits}`;
  if (digits.startsWith('01') && digits.length === 11) return `+88${digits}`;
  if (digits.startsWith('1') && digits.length === 10) return `+880${digits}`;
  return input.trim();
}

export function isValidBdPhone(phone) {
  const normalized = normalizeBdPhone(phone);
  return /^\+8801[3-9]\d{8}$/.test(normalized);
}

/**
 * Validates and normalizes an address payload. Throws AppError('VALIDATION_FAILED') on any problem.
 */
function validateAddressPayload(payload) {
  const { recipient_name, recipient_phone, division, district, address_line, label } = payload;

  if (!recipient_name || !recipient_name.trim()) {
    throw new AppError('VALIDATION_FAILED', 'Recipient name is required.', 'প্রাপকের নাম আবশ্যক।');
  }

  if (!recipient_phone || !isValidBdPhone(recipient_phone)) {
    throw new AppError(
      'VALIDATION_FAILED',
      'A valid Bangladeshi mobile number (+8801XXXXXXXXX) is required.',
      'সঠিক বাংলাদেশী মোবাইল নম্বর প্রদান করুন।'
    );
  }

  if (!division || !division.trim()) {
    throw new AppError('VALIDATION_FAILED', 'Division is required.', 'বিভাগ নির্বাচন আবশ্যক।');
  }

  if (!district || !district.trim()) {
    throw new AppError('VALIDATION_FAILED', 'District is required.', 'জেলা নির্বাচন আবশ্যক।');
  }

  if (!address_line || !address_line.trim()) {
    throw new AppError('VALIDATION_FAILED', 'Detailed address line is required.', 'বিস্তারিত ঠিকানা আবশ্যক।');
  }

  const validLabels = ['HOME', 'OFFICE', 'OTHER'];
  const formattedLabel = (label || 'HOME').toUpperCase();
  if (!validLabels.includes(formattedLabel)) {
    throw new AppError('VALIDATION_FAILED', 'Address label must be HOME, OFFICE, or OTHER.', 'ঠিকানার ধরন সঠিক নয়।');
  }

  const customLabel = (payload.custom_label || '').trim();
  if (formattedLabel === 'OTHER' && !customLabel) {
    throw new AppError(
      'VALIDATION_FAILED',
      'A custom label is required when the address type is "Other".',
      '"অন্যান্য" ধরন নির্বাচন করলে একটি কাস্টম লেবেল আবশ্যক।'
    );
  }

  return {
    recipient_name: recipient_name.trim(),
    recipient_phone: normalizeBdPhone(recipient_phone),
    division: division.trim().toLowerCase(),
    district: district.trim().toLowerCase(),
    upazila: (payload.upazila || '').trim(),
    address_line: address_line.trim(),
    delivery_notes: (payload.delivery_notes || '').trim(),
    postal_code: (payload.postal_code || '').trim(),
    label: formattedLabel,
    custom_label: formattedLabel === 'OTHER' ? customLabel : '',
    is_default: Boolean(payload.is_default),
  };
}

function formatAddressRow(row) {
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    label: row.label,
    custom_label: row.custom_label || '',
    recipient_name: row.recipient_name,
    recipient_phone: row.recipient_phone,
    division: row.division,
    district: row.district,
    upazila: row.upazila || '',
    address_line: row.address_line,
    delivery_notes: row.delivery_notes || '',
    postal_code: row.postal_code || '',
    is_default: Boolean(row.is_default),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function requireUserId(userId) {
  const parsed = Number(userId);
  if (!parsed) {
    throw new AppError('AUTH_REQUIRED', 'Customer authentication required.', 'গ্রাহক প্রমাণীকরণ প্রয়োজন।');
  }
  return parsed;
}

function requireAddressId(addressId) {
  const parsed = Number(addressId);
  if (!parsed) {
    throw new AppError('VALIDATION_FAILED', 'Valid address ID is required.', 'ঠিকানা আইডি আবশ্যক।');
  }
  return parsed;
}

/**
 * Retrieves all saved addresses for a customer, provisioning one from the profile address on the
 * first call. The seed is a single atomic `INSERT … WHERE NOT EXISTS` (see the repository), so this
 * read stays safe under concurrency and mirrors the getOrCreate pattern already used for carts and
 * wallets.
 */
export async function getCustomerAddresses(db, userId) {
  const uid = requireUserId(userId);

  let rows = await addressRepo.listByUser(db, uid);
  if (rows.length === 0) {
    try {
      const seeded = await addressRepo.seedFromProfileIfEmpty(db, uid);
      if (seeded) rows = [seeded];
    } catch {
      // A concurrent seed or a profile without a usable address — fall through to the empty list.
    }
  }

  return rows.map(formatAddressRow);
}

/**
 * Creates a new saved address. The first address a customer saves is always the default; a later
 * address becomes default only when explicitly requested, and the previous default is demoted in
 * the same transaction.
 */
export async function createCustomerAddress(db, userId, payload) {
  const uid = requireUserId(userId);
  const validated = validateAddressPayload(payload);

  return withTransaction(db, async (client) => {
    const existing = await addressRepo.countByUser(client, uid);
    if (existing >= MAX_ADDRESSES_PER_USER) {
      throw new AppError(
        'VALIDATION_FAILED',
        `You can save at most ${MAX_ADDRESSES_PER_USER} delivery addresses.`,
        `আপনি সর্বোচ্চ ${MAX_ADDRESSES_PER_USER}টি ঠিকানা সংরক্ষণ করতে পারবেন।`
      );
    }

    const shouldBeDefault = validated.is_default || existing === 0;
    if (shouldBeDefault && existing > 0) {
      await addressRepo.clearDefaultForUser(client, uid);
    }

    const row = await addressRepo.insert(client, uid, { ...validated, is_default: shouldBeDefault });
    return formatAddressRow(row);
  });
}

/**
 * Updates an existing address the customer owns. A default transition demotes the old default in
 * the same transaction; the DB index rejects any state with two defaults.
 */
export async function updateCustomerAddress(db, userId, addressId, payload) {
  const uid = requireUserId(userId);
  const aid = requireAddressId(addressId);
  const validated = validateAddressPayload(payload);

  return withTransaction(db, async (client) => {
    const existing = await addressRepo.findByIdForUser(client, aid, uid);
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Address not found or unauthorized.', 'ঠিকানা পাওয়া যায়নি।');
    }

    // An address can never be un-defaulted directly — you promote a different one instead.
    const nextDefault = validated.is_default || existing.is_default;
    if (nextDefault && !existing.is_default) {
      await addressRepo.clearDefaultForUser(client, uid);
    }

    const row = await addressRepo.update(client, aid, uid, { ...validated, is_default: nextDefault });
    return formatAddressRow(row);
  });
}

/**
 * Deletes an address the customer owns. If it was the default and other addresses remain, the most
 * recently touched one is promoted so the customer is never left without a default.
 */
export async function deleteCustomerAddress(db, userId, addressId) {
  const uid = requireUserId(userId);
  const aid = requireAddressId(addressId);

  return withTransaction(db, async (client) => {
    const existing = await addressRepo.findByIdForUser(client, aid, uid);
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Address not found or unauthorized.', 'ঠিকানা পাওয়া যায়নি।');
    }

    await addressRepo.remove(client, aid, uid);

    if (existing.is_default) {
      const next = await addressRepo.findMostRecentForUser(client, uid);
      if (next) await addressRepo.promoteDefault(client, next.id, uid);
    }

    return { success: true, deleted_id: aid };
  });
}

/**
 * Promotes an address the customer owns to be their sole default shipping address.
 */
export async function setDefaultCustomerAddress(db, userId, addressId) {
  const uid = requireUserId(userId);
  const aid = requireAddressId(addressId);

  return withTransaction(db, async (client) => {
    const existing = await addressRepo.findByIdForUser(client, aid, uid);
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Address not found or unauthorized.', 'ঠিকানা পাওয়া যায়নি।');
    }

    if (!existing.is_default) {
      await addressRepo.clearDefaultForUser(client, uid);
      const row = await addressRepo.promoteDefault(client, aid, uid);
      return formatAddressRow(row);
    }

    return formatAddressRow(existing);
  });
}
