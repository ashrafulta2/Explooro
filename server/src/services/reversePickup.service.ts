/**
 * reversePickup.service.ts — parcels a courier collects from a customer (migration 105).
 *
 * Two kinds, both used only while couriers are INTEGRATED (manualOperations.service
 * courierBookingAvailable); with couriers MANUAL the customer sends the product back by hand:
 *   RETURN   — an approved return (return.service reviewReturnRequest), sent to the returns address;
 *   WARRANTY — a product sent in for repair or replacement (warranty.service reviewWarrantyClaim),
 *              sent to the supplier's own warehouse, else to the returns address.
 *
 * WHY its own table and webhook branch: see migration 105. A courier event here only moves the
 * pickup's own status. It never touches the sub-order, escrow, stock or warranty cards, which a
 * reverse parcel stored in `shipments` would have run again on DELIVERED.
 *
 * The returns address is configuration (`operations.return_address` in platform_settings), set by a
 * super admin at /admin/platform/operations. It ships empty and a return pickup is refused until it
 * is filled, so no parcel is ever booked to an invented address.
 */

import { randomUUID } from 'node:crypto';
import * as settingRepo from '../repositories/setting.repository.ts';
import { getCourierAdapter } from '../integrations/courier/index.ts';
import { integrationForCarrier } from '../config/integrations.ts';
import { isIntegrationPaused } from '../integrations/credentialStore.ts';
import { BD_DISTRICTS_BY_DIVISION } from '../config/bdDistricts.ts';
import { normalizeBdPhone, isValidBdPhone } from './customerAddress.service.ts';
import { AppError } from '../plugins/errorHandler.ts';

export const RETURN_ADDRESS_KEY = 'operations.return_address';
export const SETTINGS_GROUP = 'operations';
export const RETURN_ADDRESS_FIELDS = Object.freeze(['name', 'phone', 'division', 'district', 'upazila', 'address_line']);
/** Fields a courier needs to deliver there; upazila is optional, as at checkout. */
export const REQUIRED_RETURN_ADDRESS_FIELDS = Object.freeze(['name', 'phone', 'division', 'district', 'address_line']);
/** Input bounds for what an admin types. Shapes, not business numbers. */
export const RETURN_ADDRESS_LIMITS = Object.freeze({
  name: { min: 2, max: 80 },
  upazila: { max: 60 },
  address_line: { min: 5, max: 200 },
});

/** The statuses a reverse parcel can hold (migration 105's CHECK). */
export const REVERSE_PICKUP_STATUSES = Object.freeze([
  'PENDING', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURNED', 'CANCELLED', 'FAILED',
]);
/** Once here a pickup has finished; a late event is recorded but does not move it back. */
const CLOSED_STATUSES = Object.freeze(['DELIVERED', 'RETURNED', 'CANCELLED', 'FAILED']);

const EMPTY_ADDRESS = Object.freeze({ name: '', phone: '', division: '', district: '', upazila: '', address_line: '' });

const SETTING_META = {
  valueType: 'OBJECT',
  labelEn: 'Where returned products are sent',
  labelBn: 'ফেরত পণ্য যেখানে পাঠানো হয়',
};

function readJsonValue(raw) {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** A stored row as a complete address object; unknown keys dropped, missing ones empty. */
export function rowToReturnAddress(row): Record<string, any> {
  const value = readJsonValue(row?.value_json) || {};
  const address: Record<string, any> = { ...EMPTY_ADDRESS };
  for (const field of RETURN_ADDRESS_FIELDS) {
    if (typeof value[field] === 'string') address[field] = value[field];
  }
  return { ...address, updated_at: row?.updated_at ?? null, updated_by: row?.updated_by ?? null };
}

/** The required fields still empty. An empty list means a courier can deliver there. */
export function missingReturnAddressFields(address) {
  return REQUIRED_RETURN_ADDRESS_FIELDS.filter((field) => !String(address?.[field] ?? '').trim());
}

export async function getReturnAddress(db) {
  try {
    return rowToReturnAddress(await settingRepo.getSettingByKey(db, RETURN_ADDRESS_KEY));
  } catch {
    // Before migration 105 has run: empty, so nothing is booked to it.
    return { ...EMPTY_ADDRESS, updated_at: null, updated_by: null };
  }
}

function invalid(field, en, bn, extra = {}) {
  return new AppError('VALIDATION_FAILED', en, bn, { field, ...extra });
}

/**
 * Pure, so the API and the tests assert the same rule. Strict: every required field must be filled
 * and valid. WHY not allow saving half an address: the only reader books a real courier with it.
 */
export function validateReturnAddress(input: Record<string, any> = {}) {
  const text = (v) => (typeof v === 'string' ? v.trim() : '');
  const name = text(input.name);
  if (name.length < RETURN_ADDRESS_LIMITS.name.min || name.length > RETURN_ADDRESS_LIMITS.name.max) {
    throw invalid('name', `The name must be ${RETURN_ADDRESS_LIMITS.name.min}–${RETURN_ADDRESS_LIMITS.name.max} characters.`,
      `নাম ${RETURN_ADDRESS_LIMITS.name.min}–${RETURN_ADDRESS_LIMITS.name.max} অক্ষরের হতে হবে।`);
  }
  const phone = normalizeBdPhone(text(input.phone));
  if (!isValidBdPhone(phone)) {
    throw invalid('phone', 'Enter a valid Bangladeshi mobile number.', 'সঠিক বাংলাদেশি মোবাইল নম্বর দিন।');
  }
  const division = text(input.division);
  const districts = BD_DISTRICTS_BY_DIVISION[division];
  if (!districts) {
    throw invalid('division', 'Choose a division.', 'একটি বিভাগ বাছুন।');
  }
  const district = text(input.district);
  if (!districts.includes(district)) {
    throw invalid('district', 'Choose a district in that division.', 'ওই বিভাগের একটি জেলা বাছুন।');
  }
  const upazila = text(input.upazila);
  if (upazila.length > RETURN_ADDRESS_LIMITS.upazila.max) {
    throw invalid('upazila', `The area must be at most ${RETURN_ADDRESS_LIMITS.upazila.max} characters.`,
      `এলাকা সর্বোচ্চ ${RETURN_ADDRESS_LIMITS.upazila.max} অক্ষরের হতে পারে।`);
  }
  const addressLine = text(input.address_line);
  if (addressLine.length < RETURN_ADDRESS_LIMITS.address_line.min || addressLine.length > RETURN_ADDRESS_LIMITS.address_line.max) {
    throw invalid('address_line',
      `The address must be ${RETURN_ADDRESS_LIMITS.address_line.min}–${RETURN_ADDRESS_LIMITS.address_line.max} characters.`,
      `ঠিকানা ${RETURN_ADDRESS_LIMITS.address_line.min}–${RETURN_ADDRESS_LIMITS.address_line.max} অক্ষরের হতে হবে।`);
  }
  return { name, phone, division, district, upazila, address_line: addressLine };
}

/** Saves the returns address: validated, reasoned, stale-checked, audited (CRITICAL). */
export async function updateReturnAddress(
  db,
  auditService,
  { address, reason, baseUpdatedAt = undefined, userId, actorRole = null, reqContext = ({} as { ip?: string, userAgent?: string, traceId?: string }) }
) {
  const next = validateReturnAddress(address);
  if (typeof reason !== 'string' || reason.trim().length < 10) {
    throw invalid('reason', 'Give a reason of at least 10 characters for this change.',
      'এই পরিবর্তনের জন্য অন্তত ১০ অক্ষরের একটি কারণ লিখুন।');
  }

  const client = db.connect ? await db.connect() : db;
  const isDedicatedClient = Boolean(db.connect);
  let before;
  let after;
  try {
    if (isDedicatedClient) await client.query('BEGIN');
    await settingRepo.lockSettingsGroup(client, SETTINGS_GROUP);
    before = rowToReturnAddress(await settingRepo.getSettingByKey(client, RETURN_ADDRESS_KEY));
    // WHY stale-checked: two admins editing at once would otherwise silently keep the last save.
    if (baseUpdatedAt !== undefined && String(baseUpdatedAt ?? '') !== String(before.updated_at ? new Date(before.updated_at).toISOString() : '')) {
      throw new AppError('PRECONDITION_CHANGED',
        'Someone changed the returns address while you were editing. Reload and try again.',
        'আপনি সম্পাদনা করার সময় অন্য কেউ ফেরতের ঠিকানা বদলেছেন। পাতা আবার খুলে চেষ্টা করুন।');
    }
    await settingRepo.upsertSetting(client, {
      key: RETURN_ADDRESS_KEY,
      valueJson: next,
      groupKey: SETTINGS_GROUP,
      updatedBy: userId ?? null,
      ...SETTING_META,
    });
    after = rowToReturnAddress(await settingRepo.getSettingByKey(client, RETURN_ADDRESS_KEY));
    if (isDedicatedClient) await client.query('COMMIT');
  } catch (err) {
    if (isDedicatedClient) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (isDedicatedClient && client.release) client.release();
  }

  const strip = ({ updated_at, updated_by, ...rest }) => rest;
  if (auditService?.record) {
    await auditService.record(db, {
      action: 'platform.operations.return_address.update',
      targetType: 'platform_settings',
      targetRef: RETURN_ADDRESS_KEY,
      beforeJson: strip(before),
      afterJson: strip(after),
      meta: { reason: reason.trim() },
      riskTier: 'CRITICAL',
      actorId: userId ?? null,
      actorRole,
      ip: reqContext.ip ?? null,
      userAgent: reqContext.userAgent ?? null,
      traceId: reqContext.traceId ?? null,
    });
  }
  return after;
}

/** The returns address as a courier destination, or a refusal naming what is missing. */
export async function requireReturnDestination(db) {
  const address = await getReturnAddress(db);
  const missing = missingReturnAddressFields(address);
  if (missing.length > 0) {
    throw new AppError('CONFLICT',
      'Fill in the returns address at Platform → Operations before a courier can collect returns.',
      'কুরিয়ার ফেরত পণ্য আনার আগে Platform → Operations এ ফেরতের ঠিকানা পূরণ করুন।',
      { reason: 'RETURN_ADDRESS_MISSING', missing });
  }
  return {
    name: address.name,
    phone: address.phone,
    address: { division: address.division, district: address.district, upazila: address.upazila, address_line: address.address_line },
  };
}

/**
 * Adds `send_back` to each of a customer's returns that they must send back themselves: approved
 * (PICKUP_SCHEDULED) with couriers MANUAL (`reverse_carrier = 'MANUAL'`, return.service). It is the
 * returns address, or null while that is empty (the page then says staff will call).
 * WHY only those: a courier-booked return is collected from the customer's own address, and before
 * approval there is nothing to send yet. WHY the phone too: the customer may need to call before
 * dropping the parcel off; it is the business's number, not a person's.
 */
export async function withSendBackAddress(db, returns) {
  const rows = Array.isArray(returns) ? returns : [];
  const needsIt = (r) => r?.status === 'PICKUP_SCHEDULED' && r?.reverse_carrier === 'MANUAL';
  if (!rows.some(needsIt)) return rows;
  const address = await getReturnAddress(db);
  const sendBack = missingReturnAddressFields(address).length === 0
    ? {
      name: address.name,
      phone: address.phone,
      division: address.division,
      district: address.district,
      upazila: address.upazila,
      address_line: address.address_line,
    }
    : null;
  return rows.map((r) => (needsIt(r) ? { ...r, send_back: sendBack } : r));
}

/**
 * Where a warranty item goes: the supplier's own active warehouse (highest priority first), with
 * the supplier's phone, else the returns address. WHY the supplier first: they repair or replace
 * it; routing it through the platform's returns address would mean shipping it twice.
 */
export async function resolveWarrantyDestination(db, supplierId) {
  if (supplierId) {
    const { rows } = await db.query(
      `SELECT wn.name, wn.division, wn.district, wn.upazila, wn.address_line, u.phone
       FROM warehouse_nodes wn
       JOIN users u ON u.id = wn.supplier_id
       WHERE wn.supplier_id = $1 AND wn.is_active = true
       ORDER BY wn.priority DESC, wn.id ASC
       LIMIT 1`,
      [supplierId]
    );
    const node = rows[0];
    if (node?.address_line && node?.phone) {
      return {
        name: node.name,
        phone: node.phone,
        address: { division: node.division, district: node.district, upazila: node.upazila ?? '', address_line: node.address_line },
      };
    }
  }
  return requireReturnDestination(db);
}

/**
 * Books a reverse parcel with the configured courier and stores it. The caller has already checked
 * courierBookingAvailable and holds its parent row FOR UPDATE inside its transaction.
 * WHY no invented fallback numbers: a pickup with a tracking number the courier never issued could
 * never be matched by its webhook, and would look booked when nothing was.
 */
export async function bookReversePickup(txClient, {
  kind,
  returnRequestId = null,
  warrantyClaimId = null,
  parentRef,
  pickup,
  destination,
  weightKg = 0.5,
}) {
  if (kind !== 'RETURN' && kind !== 'WARRANTY') throw new Error(`INVALID_REVERSE_PICKUP_KIND: ${kind}`);
  const adapter = getCourierAdapter(process.env.COURIER_DRIVER || 'MOCK');
  // WHY here too: courierBookingAvailable already says no for a paused courier, but a pause saved on
  // another API node reaches this one only at its next credential reload (credentialStore.ts).
  const pausedAs = integrationForCarrier(adapter.name);
  if (pausedAs && isIntegrationPaused(pausedAs.key)) {
    throw new AppError(
      'CONFLICT',
      `${adapter.name} is paused, so no pickup can be booked with it.`,
      `${adapter.name} পজ করা আছে, তাই এতে পিকআপ বুক করা যাবে না।`,
      { reason: 'COURIER_PAUSED', carrier: adapter.name }
    );
  }
  const ref = `REV-${parentRef}`;

  const booked = await adapter.createReturnPickup({
    ref,
    pickupName: pickup.name,
    pickupPhone: pickup.phone,
    pickupAddress: pickup.address,
    recipientName: destination.name,
    recipientPhone: destination.phone,
    deliveryAddress: destination.address,
    weightKg,
  });
  if (!booked?.trackingNumber) {
    throw new Error(`REVERSE_PICKUP_NOT_BOOKED: ${adapter.name} returned no tracking number for ${ref}.`);
  }

  const { rows } = await txClient.query(
    `INSERT INTO reverse_pickups (
       ref, kind, return_request_id, warranty_claim_id, carrier, tracking_number, courier_consignment_id,
       status, pickup_name, pickup_phone, pickup_address_json,
       destination_name, destination_phone, destination_address_json, label_url, courier_charge, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', $8, $9, $10, $11, $12, $13, $14, $15, now(), now())
     RETURNING id, ref, kind, carrier, tracking_number, courier_consignment_id, status`,
    [
      // WHY a suffix: a cancelled pickup may be booked again for the same parent, and ref is UNIQUE.
      `${ref}-${randomUUID().slice(0, 6).toUpperCase()}`,
      kind,
      returnRequestId,
      warrantyClaimId,
      adapter.name,
      booked.trackingNumber,
      booked.courierConsignmentId ?? null,
      pickup.name,
      pickup.phone,
      JSON.stringify(pickup.address ?? {}),
      destination.name,
      destination.phone,
      JSON.stringify(destination.address ?? {}),
      booked.labelUrl ?? null,
      // The courier's own quote, for the pickup-charge report (migration 107).
      Number.isFinite(Number(booked.shippingCharge)) && Number(booked.shippingCharge) >= 0 ? Number(booked.shippingCharge).toFixed(2) : null,
    ]
  );
  return rows[0];
}

/** The reverse parcel a courier event is about, locked, or null. Matched within that carrier only. */
export async function findReversePickupForEvent(txClient, carrier, normalized) {
  const { rows } = await txClient.query(
    `SELECT id, ref, kind, return_request_id, warranty_claim_id, carrier, tracking_number, status, delivered_at
     FROM reverse_pickups
     WHERE carrier = $1 AND (tracking_number = $2 OR courier_consignment_id = $2 OR courier_consignment_id = $3)
     LIMIT 1
     FOR UPDATE`,
    [String(carrier || '').toUpperCase(), normalized.trackingNumber ?? null, normalized.courierConsignmentId ?? null]
  );
  return rows[0] ?? null;
}

/**
 * Records one courier event on a reverse parcel and moves its status. Nothing else: arriving at
 * the warehouse is not the same as passing inspection, so the return is still received and
 * inspected by staff (return.service receiveAndInspectReturn) and only then is money refunded.
 */
export async function applyReversePickupEvent(txClient, pickup, normalized) {
  if (normalized.eventId) {
    const { rows: dup } = await txClient.query(
      'SELECT id FROM reverse_pickup_events WHERE event_id = $1 LIMIT 1',
      [normalized.eventId]
    );
    if (dup.length > 0) return { duplicate: true, status: pickup.status };
  }

  await txClient.query(
    `INSERT INTO reverse_pickup_events (
       reverse_pickup_id, event_id, carrier_status, normalized_status, location, note, raw_payload_json
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      pickup.id,
      normalized.eventId ?? null,
      normalized.carrierStatus ?? normalized.normalizedStatus,
      normalized.normalizedStatus,
      normalized.location ?? null,
      normalized.note ?? null,
      JSON.stringify(normalized.rawPayload ?? {}),
    ]
  );

  // WHY a finished pickup is not moved: couriers resend old events, and a late IN_TRANSIT must not
  // reopen a parcel that has arrived. PARTIAL_DELIVERY is a forward-parcel notion; it is recorded only.
  const next = normalized.normalizedStatus;
  const moves = !CLOSED_STATUSES.includes(pickup.status) && REVERSE_PICKUP_STATUSES.includes(next) && next !== pickup.status;
  if (moves) {
    await txClient.query(
      `UPDATE reverse_pickups
       SET status = $2,
           delivered_at = CASE WHEN $2 = 'DELIVERED' AND delivered_at IS NULL THEN now() ELSE delivered_at END,
           updated_at = now()
       WHERE id = $1`,
      [pickup.id, next]
    );
  }
  return { duplicate: false, status: moves ? next : pickup.status };
}

// ── Pickup charges vs what couriers bill (migration 107) ─────────────────────

/** Report bounds: shapes, not business numbers. */
export const PICKUP_REPORT_LIMITS = Object.freeze({
  days: Object.freeze({ min: 1, max: 365 }),
  limit: Object.freeze({ min: 1, max: 100 }),
  billed: Object.freeze({ min: 0, max: 100000 }),
});

const money = (v) => (v === null || v === undefined ? null : Number(v));

/**
 * Courier pickups booked in the last `days`: what each collected, what the courier quoted and what
 * its bill said, and the totals. `gap` is collected minus cost, where cost is the bill when staff
 * have recorded one and the quote until then; a negative gap means the pickup charge setting no
 * longer covers what couriers charge.
 */
export async function getPickupCharges(db, { days = 30, limit = 50, offset = 0 } = {}) {
  const d = Math.min(PICKUP_REPORT_LIMITS.days.max, Math.max(PICKUP_REPORT_LIMITS.days.min, parseInt(String(days), 10) || 30));
  const l = Math.min(PICKUP_REPORT_LIMITS.limit.max, Math.max(PICKUP_REPORT_LIMITS.limit.min, parseInt(String(limit), 10) || 50));
  const o = Math.max(0, parseInt(String(offset), 10) || 0);
  const [{ rows }, { rows: totals }] = await Promise.all([
    db.query(
      `SELECT rp.id, rp.ref, rp.kind, rp.carrier, rp.tracking_number, rp.status, rp.created_at,
              rp.courier_charge, rp.fee_charged, rp.fee_charged_from, rp.courier_billed, rp.billed_recorded_at,
              rr.ref AS return_ref, wc.ref AS claim_ref
       FROM reverse_pickups rp
       LEFT JOIN return_requests rr ON rr.id = rp.return_request_id
       LEFT JOIN warranty_claims wc ON wc.id = rp.warranty_claim_id
       WHERE rp.created_at >= now() - make_interval(days => $1)
       ORDER BY rp.created_at DESC
       LIMIT $2 OFFSET $3`,
      [d, l, o]
    ),
    db.query(
      `SELECT COUNT(*)::int AS pickups,
              COALESCE(SUM(fee_charged), 0)::numeric(14,2) AS collected,
              COALESCE(SUM(COALESCE(courier_billed, courier_charge)), 0)::numeric(14,2) AS cost,
              COUNT(*) FILTER (WHERE courier_billed IS NULL)::int AS unbilled
       FROM reverse_pickups
       WHERE created_at >= now() - make_interval(days => $1)`,
      [d]
    ),
  ]);
  const t = totals[0] || {};
  const collected = money(t.collected) ?? 0;
  const cost = money(t.cost) ?? 0;
  return {
    days: d,
    totals: {
      pickups: t.pickups ?? 0,
      unbilled: t.unbilled ?? 0,
      collected: collected.toFixed(2),
      cost: cost.toFixed(2),
      gap: (collected - cost).toFixed(2),
    },
    pickups: rows.map((r) => {
      const c = money(r.courier_billed) ?? money(r.courier_charge);
      const f = money(r.fee_charged);
      return { ...r, gap: c === null || f === null ? null : (f - c).toFixed(2) };
    }),
    limits: PICKUP_REPORT_LIMITS,
  };
}

/** Staff record what a courier's bill said for one pickup: reasoned, audited (CRITICAL). */
export async function recordCourierBill(db, auditService, { pickupId, amount, reason, userId, actorRole = null, reqContext = ({} as { ip?: string, userAgent?: string, traceId?: string }) }) {
  const n = Number(amount);
  const { min, max } = PICKUP_REPORT_LIMITS.billed;
  if (!Number.isFinite(n) || n < min || n > max || Math.round(n * 100) !== n * 100) {
    throw invalid('amount', `The bill must be an amount from ${min} to ${max} Taka.`, `বিলের টাকা ${min} থেকে ${max} এর মধ্যে হতে হবে।`);
  }
  if (typeof reason !== 'string' || reason.trim().length < 10) {
    throw invalid('reason', 'Give a reason of at least 10 characters for this change.', 'এই পরিবর্তনের জন্য অন্তত ১০ অক্ষরের একটি কারণ লিখুন।');
  }
  const { rows: before } = await db.query('SELECT id, ref, courier_billed FROM reverse_pickups WHERE id = $1', [pickupId]);
  if (!before[0]) throw new AppError('NOT_FOUND', 'No such pickup.', 'এমন কোনো পিকআপ নেই।');
  const { rows } = await db.query(
    `UPDATE reverse_pickups
     SET courier_billed = $2::numeric(14,2), billed_recorded_by = $3, billed_recorded_at = now(), updated_at = now()
     WHERE id = $1
     RETURNING id, ref, courier_billed, billed_recorded_at`,
    [pickupId, n.toFixed(2), userId ?? null]
  );
  if (auditService?.record) {
    await auditService.record(db, {
      action: 'platform.operations.pickup_bill.record',
      targetType: 'reverse_pickup',
      targetRef: before[0].ref,
      beforeJson: { courier_billed: before[0].courier_billed ?? null },
      afterJson: { courier_billed: rows[0].courier_billed },
      meta: { reason: reason.trim() },
      riskTier: 'CRITICAL',
      actorId: userId ?? null,
      actorRole,
      ip: reqContext.ip ?? null,
      userAgent: reqContext.userAgent ?? null,
      traceId: reqContext.traceId ?? null,
    });
  }
  return rows[0];
}
