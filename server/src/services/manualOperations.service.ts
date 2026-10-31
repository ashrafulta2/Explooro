/**
 * manualOperations.service.ts — running payouts and parcels by hand (migration 097).
 *
 * At launch no MFS merchant, card gateway or courier API signs with a new platform, so the owner:
 *   * sends each withdrawal from their own bKash/Nagad and records the TrxID here
 *     (completePayoutManually), instead of the B2C driver sending it;
 *   * hands each parcel to a contracted courier and records its name and tracking number
 *     (bookManualShipment), then marks it delivered or returned (updateManualShipmentStatus),
 *     instead of a courier API booking it and a webhook reporting back.
 *
 * Nothing about the money changes. A hand-sent payout settles through payout.service
 * settleDisbursedPayout and a hand-marked delivery through shipment.service applyShipmentEvent, the
 * same functions the gateway and the webhook use, so escrow, the profit split and the ledger cannot
 * tell the two paths apart.
 *
 * The two switches (payout_mode, courier_mode) live in platform_settings `operations.modes` and a
 * super admin sets them at /admin/platform/operations. Shaped like deliveryCharge.service.ts:
 * validated here, written in one transaction, audited with before/after, cached briefly.
 */

import { randomUUID } from 'node:crypto';
import { withTransaction } from '../config/db.ts';
import * as settingRepo from '../repositories/setting.repository.ts';
import * as walletRepo from '../repositories/wallet.repository.ts';
import { settleDisbursedPayout } from './payout.service.ts';
import { applyShipmentEvent, creditReferralOnDelivery } from './shipment.service.ts';
import { writeAudit } from '../lib/audit.ts';
import { AppError } from '../plugins/errorHandler.ts';

export const SETTINGS_GROUP = 'operations';
export const SETTING_KEY = 'operations.modes';
export const PAYOUT_MODES = Object.freeze(['MANUAL', 'GATEWAY']);
export const COURIER_MODES = Object.freeze(['MANUAL', 'INTEGRATED']);
// WHY MANUAL by default: see migration 097. In GATEWAY mode the mock B2C driver "pays" with a
// made-up TrxID, so a default of GATEWAY would mark payouts paid that nobody sent.
export const DEFAULT_MODES = Object.freeze({ payout_mode: 'MANUAL', courier_mode: 'MANUAL' });

/** Input bounds for what an admin or supplier types. Shapes, not business numbers. */
export const FIELD_LIMITS = Object.freeze({
  trxId: { min: 4, max: 40 },
  courierName: { min: 2, max: 60 },
  trackingNumber: { min: 3, max: 60 },
  note: { max: 300 },
});

/** Sub-order statuses a parcel can be handed over from (008_orders_minimal.sql). */
const SHIPPABLE_SUB_ORDER_STATUSES = Object.freeze(['PLACED', 'CONFIRMED', 'PACKED']);
/** What a supplier may mark a hand-sent parcel as. */
export const MANUAL_FINAL_STATUSES = Object.freeze(['DELIVERED', 'RETURNED']);
/** A parcel in one of these has finished; DELIVERED → RETURNED goes through the returns engine. */
const CLOSED_SHIPMENT_STATUSES = Object.freeze(['DELIVERED', 'RETURNED', 'CANCELLED']);

const SETTING_META = {
  valueType: 'OBJECT',
  labelEn: 'Payout and courier mode (manual or automatic)',
  labelBn: 'পেআউট ও কুরিয়ার মোড (ম্যানুয়াল বা স্বয়ংক্রিয়)',
};

const CACHE_KEY = 'operations:modes';
const CACHE_TTL_SECONDS = 60;

function readJsonValue(raw) {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function rowToModes(row) {
  const value = readJsonValue(row?.value_json) || {};
  return {
    payout_mode: PAYOUT_MODES.includes(value.payout_mode) ? value.payout_mode : DEFAULT_MODES.payout_mode,
    courier_mode: COURIER_MODES.includes(value.courier_mode) ? value.courier_mode : DEFAULT_MODES.courier_mode,
    updated_at: row?.updated_at ?? null,
    updated_by: row?.updated_by ?? null,
  };
}

/** Pure, so the API and the tests assert the same rule. Strict: an unknown mode is refused. */
export function validateModes(input: Record<string, any> = {}) {
  if (!PAYOUT_MODES.includes(input.payout_mode)) {
    throw new AppError('VALIDATION_FAILED', `Payout mode must be one of ${PAYOUT_MODES.join(', ')}.`,
      `পেআউট মোড ${PAYOUT_MODES.join(', ')} এর একটি হতে হবে।`, { field: 'payout_mode' });
  }
  if (!COURIER_MODES.includes(input.courier_mode)) {
    throw new AppError('VALIDATION_FAILED', `Courier mode must be one of ${COURIER_MODES.join(', ')}.`,
      `কুরিয়ার মোড ${COURIER_MODES.join(', ')} এর একটি হতে হবে।`, { field: 'courier_mode' });
  }
  return { payout_mode: input.payout_mode, courier_mode: input.courier_mode };
}

/** The live modes. `{ fresh: true }` reads past the cache, for decisions that move money. */
export async function getModes(db, cache, { fresh = false } = {}) {
  if (cache && !fresh) {
    try {
      const cached = await cache.get(CACHE_KEY);
      if (cached) {
        const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
        if (PAYOUT_MODES.includes(parsed?.payout_mode) && COURIER_MODES.includes(parsed?.courier_mode)) return parsed;
      }
    } catch {
      // A miss or a malformed entry falls through to the database.
    }
  }

  let modes: { payout_mode: string; courier_mode: string; updated_at: any; updated_by: any } =
    { ...DEFAULT_MODES, updated_at: null, updated_by: null };
  try {
    modes = rowToModes(await settingRepo.getSettingByKey(db, SETTING_KEY));
  } catch {
    // Before migration 097 has run, MANUAL is the safe answer (see DEFAULT_MODES).
  }

  if (cache && !fresh) {
    try {
      await cache.set(CACHE_KEY, JSON.stringify(modes), CACHE_TTL_SECONDS);
    } catch {
      // Caching is an optimisation.
    }
  }
  return modes;
}

export async function updateModes(
  db,
  cache,
  auditService,
  { modes, reason, userId, actorRole = null, reqContext = ({} as { ip?: string, userAgent?: string, traceId?: string }) }
) {
  const next = validateModes(modes);

  if (typeof reason !== 'string' || reason.trim().length < 10) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Give a reason of at least 10 characters for this change.',
      'এই পরিবর্তনের জন্য অন্তত ১০ অক্ষরের একটি কারণ লিখুন।',
      { field: 'reason' }
    );
  }

  const client = db.connect ? await db.connect() : db;
  const isDedicatedClient = Boolean(db.connect);

  let before;
  let after;
  try {
    if (isDedicatedClient) await client.query('BEGIN');
    await settingRepo.lockSettingsGroup(client, SETTINGS_GROUP);
    before = rowToModes(await settingRepo.getSettingByKey(client, SETTING_KEY));
    await settingRepo.upsertSetting(client, {
      key: SETTING_KEY,
      valueJson: next,
      groupKey: SETTINGS_GROUP,
      updatedBy: userId ?? null,
      ...SETTING_META,
    });
    after = rowToModes(await settingRepo.getSettingByKey(client, SETTING_KEY));
    if (isDedicatedClient) await client.query('COMMIT');
  } catch (err) {
    if (isDedicatedClient) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (isDedicatedClient && client.release) client.release();
  }

  if (cache) {
    try {
      await cache.del(CACHE_KEY);
    } catch {
      // Worst case the old value serves for up to CACHE_TTL_SECONDS.
    }
  }

  if (auditService?.record) {
    await auditService.record(db, {
      action: 'platform.operations.update',
      targetType: 'platform_settings',
      targetRef: SETTING_KEY,
      beforeJson: { payout_mode: before.payout_mode, courier_mode: before.courier_mode },
      afterJson: { payout_mode: after.payout_mode, courier_mode: after.courier_mode },
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

/**
 * Refuses the gateway payout routes (approve, batch-disburse) while payouts are manual.
 * WHY a hard refusal and not a warning: approve calls the B2C driver, which in mock mode reports a
 * success, so a click would mark the partner paid and take the money out of their vault for good.
 */
export async function assertGatewayPayoutsAllowed(db, cache) {
  const { payout_mode } = await getModes(db, cache, { fresh: true });
  if (payout_mode === 'MANUAL') {
    throw new AppError(
      'MANUAL_PAYOUT_MODE',
      'Payouts are manual. Send the money yourself, then record it with "Mark as paid" and the TrxID.',
      'পেআউট এখন ম্যানুয়াল। নিজে টাকা পাঠিয়ে "পরিশোধিত হিসেবে চিহ্নিত করুন" দিয়ে TrxID লিখুন।'
    );
  }
}

/** Trimmed text within bounds, else VALIDATION_FAILED naming the field. */
function requireText(value, field, { min = 0, max }, labelEn, labelBn) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < min || text.length > max) {
    throw new AppError('VALIDATION_FAILED',
      `${labelEn} must be ${min}–${max} characters.`,
      `${labelBn} ${min}–${max} অক্ষরের হতে হবে।`,
      { field, min, max });
  }
  return text;
}

function optionalNote(value) {
  if (value === undefined || value === null || value === '') return null;
  return requireText(value, 'note', { min: 0, max: FIELD_LIMITS.note.max }, 'The note', 'নোট');
}

/**
 * Pure: the TrxID an admin typed, normalised. MFS TrxIDs are letters and digits; a hyphen is let
 * through for bank references. Uppercased, because bKash prints them uppercase and a lowercase copy
 * would slip past the duplicate check.
 */
export function normaliseTrxId(value) {
  const text = requireText(value, 'trx_id', FIELD_LIMITS.trxId, 'The TrxID', 'TrxID').toUpperCase();
  if (!/^[A-Z0-9-]+$/.test(text)) {
    throw new AppError('VALIDATION_FAILED', 'The TrxID may only contain letters, digits and hyphens.',
      'TrxID তে শুধু অক্ষর, সংখ্যা ও হাইফেন থাকতে পারে।', { field: 'trx_id' });
  }
  return text;
}

/**
 * Records a withdrawal the owner sent by hand: HELD → clearing, status COMPLETED, TrxID kept as the
 * gateway reference. A payout already COMPLETED with the same TrxID returns as a no-op, so a double
 * click never books it twice.
 */
export async function completePayoutManually(db, {
  payoutId,
  trxId,
  note = null,
  executedBy,
  actorRole = 'super_admin',
}: { payoutId: number; trxId: string; note?: string|null; executedBy: number|string; actorRole?: string }) {
  const cleanTrxId = normaliseTrxId(trxId);
  const cleanNote = optionalNote(note);

  return withTransaction(db, async (txClient) => {
    const { rows: payoutRows } = await txClient.query(
      `SELECT id, ref, wallet_id, user_id, method, account_number, account_name, bank_name,
              amount, fee_amount, net_amount, status, gateway_ref
       FROM payout_requests
       WHERE id = $1
       FOR UPDATE`,
      [payoutId]
    );
    const payout = payoutRows[0];
    if (!payout) {
      throw new AppError('NOT_FOUND', `Payout #${payoutId} does not exist.`, `পেআউট #${payoutId} পাওয়া যায়নি।`);
    }
    if (payout.status === 'COMPLETED') {
      if (payout.gateway_ref === cleanTrxId) return { alreadyCompleted: true, success: true, payout };
      throw new AppError('PAYOUT_NOT_OPEN', `Payout ${payout.ref} is already paid (TrxID ${payout.gateway_ref}).`,
        `পেআউট ${payout.ref} আগেই পরিশোধিত (TrxID ${payout.gateway_ref})।`);
    }
    if (!['REQUESTED', 'HELD', 'APPROVED'].includes(payout.status)) {
      throw new AppError('PAYOUT_NOT_OPEN', `Payout ${payout.ref} is ${payout.status} and cannot be paid.`,
        `পেআউট ${payout.ref} এর অবস্থা ${payout.status}, তাই পরিশোধ করা যাবে না।`);
    }

    // WHY: one bKash transfer pays one withdrawal. The same TrxID on a second payout is a typo or a
    // second claim on money sent once, and either way the books would show a payment that never left.
    const { rows: dupRows } = await txClient.query(
      `SELECT ref FROM payout_requests WHERE gateway_ref = $1 AND id <> $2 LIMIT 1`,
      [cleanTrxId, payout.id]
    );
    if (dupRows.length > 0) {
      throw new AppError('TRX_ID_TAKEN', `TrxID ${cleanTrxId} is already recorded on payout ${dupRows[0].ref}.`,
        `TrxID ${cleanTrxId} আগেই পেআউট ${dupRows[0].ref} এ লেখা আছে।`);
    }

    const wallet = await walletRepo.getWalletByIdForUpdate(txClient, payout.wallet_id);
    if (Math.round(parseFloat(wallet.held_balance) * 100) < Math.round(parseFloat(payout.amount) * 100)) {
      throw new AppError('CONFLICT', `The wallet's held balance is below ৳${payout.amount}.`,
        `ওয়ালেটের আটকে রাখা ব্যালেন্স ৳${payout.amount} এর কম।`);
    }

    const updated = await settleDisbursedPayout(txClient, {
      payout,
      walletId: wallet.id,
      trxId: cleanTrxId,
      receipt: { mode: 'MANUAL', trx_id: cleanTrxId, method: payout.method, note: cleanNote, recorded_by: executedBy },
      executedBy,
      actorRole,
      auditAction: 'finance.payout.complete_manual',
      auditExtra: { mode: 'MANUAL', note: cleanNote },
    });

    return { success: true, payout: updated };
  });
}

/** Postgres unique violation on the tracking number → a message the supplier can act on. */
function isTrackingNumberClash(err) {
  return err?.code === '23505' && String(err?.constraint ?? err?.detail ?? '').includes('tracking_number');
}

/**
 * Records a parcel the supplier handed to a courier themselves. The shipment is carrier MANUAL,
 * IN_TRANSIT; the sub-order becomes SHIPPED. Pass `supplierId` to limit it to that supplier's own
 * parcels; null is for staff acting on any supplier's parcel.
 */
export async function bookManualShipment(db, {
  subOrderId,
  supplierId = null,
  courierName,
  trackingNumber,
  note = null,
  actorId,
  actorRole = 'supplier',
}: { subOrderId: number; supplierId?: number|string|null; courierName: string; trackingNumber: string; note?: string|null; actorId: number|string; actorRole?: string }) {
  const cleanCourier = requireText(courierName, 'courier_name', FIELD_LIMITS.courierName, 'The courier name', 'কুরিয়ারের নাম');
  const cleanTracking = requireText(trackingNumber, 'tracking_number', FIELD_LIMITS.trackingNumber, 'The tracking number', 'ট্র্যাকিং নম্বর');
  const cleanNote = optionalNote(note);

  try {
    return await withTransaction(db, async (txClient) => {
      const { rows: subRows } = await txClient.query(
        `SELECT s.id, s.ref, s.supplier_id, s.status, s.total_amount, s.shipping_amount,
                o.recipient_name, o.recipient_phone, o.payment_method,
                jsonb_build_object('division', o.division, 'district', o.district,
                                   'upazila', o.upazila, 'address_line', o.address_line) AS delivery_address_json
         FROM sub_orders s
         JOIN orders o ON o.id = s.order_id
         WHERE s.id = $1 AND ($2::bigint IS NULL OR s.supplier_id = $2::bigint)
         FOR UPDATE OF s`,
        [subOrderId, supplierId]
      );
      const subOrder = subRows[0];
      // WHY NOT_FOUND for another supplier's parcel too: saying "not yours" would confirm it exists.
      if (!subOrder) {
        throw new AppError('NOT_FOUND', 'Order not found.', 'অর্ডার পাওয়া যায়নি।');
      }

      const { rows: existing } = await txClient.query(
        `SELECT tracking_number FROM shipments WHERE sub_order_id = $1 LIMIT 1`,
        [subOrder.id]
      );
      if (existing.length > 0 || !SHIPPABLE_SUB_ORDER_STATUSES.includes(subOrder.status)) {
        throw new AppError('ALREADY_SHIPPED', `Order ${subOrder.ref} has already been sent (${existing[0]?.tracking_number ?? subOrder.status}).`,
          `অর্ডার ${subOrder.ref} আগেই পাঠানো হয়েছে (${existing[0]?.tracking_number ?? subOrder.status})।`);
      }

      const codAmount = subOrder.payment_method === 'COD' ? Number(subOrder.total_amount) : 0;
      const shipmentRef = `SHP-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`;

      const { rows: shipmentRows } = await txClient.query(
        `INSERT INTO shipments (
           ref, sub_order_id, carrier, courier_name, tracking_number, status,
           recipient_name, recipient_phone, delivery_address_json, cod_amount, shipping_charge
         )
         VALUES ($1, $2, 'MANUAL', $3, $4, 'IN_TRANSIT', $5, $6, $7, $8::numeric(14,2), $9::numeric(14,2))
         RETURNING *`,
        [
          shipmentRef,
          subOrder.id,
          cleanCourier,
          cleanTracking,
          subOrder.recipient_name || 'Customer',
          subOrder.recipient_phone || '',
          JSON.stringify(subOrder.delivery_address_json || {}),
          codAmount.toFixed(2),
          Number(subOrder.shipping_amount || 0).toFixed(2),
        ]
      );
      const shipment = shipmentRows[0];

      await txClient.query(
        `INSERT INTO shipment_events (shipment_id, event_id, carrier_status, normalized_status, note, raw_payload_json)
         VALUES ($1, $2, 'HANDED_TO_COURIER', 'IN_TRANSIT', $3, $4)`,
        [
          shipment.id,
          `manual-${randomUUID()}`,
          cleanNote ?? `Handed to ${cleanCourier}`,
          JSON.stringify({ source: 'MANUAL', actor_id: actorId }),
        ]
      );

      await txClient.query(`UPDATE sub_orders SET status = 'SHIPPED', updated_at = now() WHERE id = $1`, [subOrder.id]);

      await writeAudit(txClient, {
        actorId,
        actorRole,
        action: 'logistics.shipment.manual_create',
        targetType: 'shipment',
        targetRef: shipment.ref,
        beforeJson: { sub_order_status: subOrder.status },
        afterJson: { sub_order_status: 'SHIPPED', courier_name: cleanCourier, tracking_number: cleanTracking, cod_amount: codAmount },
        riskTier: 'LOW',
      }).catch(() => {});

      return { success: true, shipment };
    });
  } catch (err) {
    if (isTrackingNumberClash(err)) {
      throw new AppError('TRACKING_NUMBER_TAKEN', `Tracking number ${cleanTracking} is already used by another parcel.`,
        `ট্র্যাকিং নম্বর ${cleanTracking} অন্য একটি পার্সেলে ব্যবহার হয়েছে।`);
    }
    throw err;
  }
}

/**
 * Marks a hand-sent parcel DELIVERED or RETURNED. Runs the same lifecycle as a courier webhook
 * (applyShipmentEvent): on DELIVERED escrow is deposited from the clearing wallet and the profit
 * split starts its hold; on RETURNED stock is restored. Only MANUAL parcels: a courier-booked one is
 * moved by its courier's webhook, and two writers would disagree.
 */
export async function updateManualShipmentStatus(db, cache, {
  shipmentId,
  supplierId = null,
  status,
  note = null,
  actorId,
  actorRole = 'supplier',
}: { shipmentId: number; supplierId?: number|string|null; status: string; note?: string|null; actorId: number|string; actorRole?: string }) {
  if (!MANUAL_FINAL_STATUSES.includes(status)) {
    throw new AppError('VALIDATION_FAILED', `Status must be one of ${MANUAL_FINAL_STATUSES.join(', ')}.`,
      `অবস্থা ${MANUAL_FINAL_STATUSES.join(', ')} এর একটি হতে হবে।`, { field: 'status' });
  }
  const cleanNote = optionalNote(note);

  const result = await withTransaction(db, async (txClient) => {
    const { rows } = await txClient.query(
      `SELECT s.id, s.ref, s.sub_order_id, s.carrier, s.tracking_number, s.status, s.delivered_at,
              so.ref AS sub_order_ref, so.status AS sub_order_status
       FROM shipments s
       JOIN sub_orders so ON so.id = s.sub_order_id
       WHERE s.id = $1 AND ($2::bigint IS NULL OR so.supplier_id = $2::bigint)
       FOR UPDATE OF s`,
      [shipmentId, supplierId]
    );
    const shipment = rows[0];
    if (!shipment) {
      throw new AppError('NOT_FOUND', 'Shipment not found.', 'শিপমেন্ট পাওয়া যায়নি।');
    }
    if (shipment.carrier !== 'MANUAL') {
      throw new AppError('CONFLICT', 'This parcel was booked with a courier; its courier reports the status.',
        'এই পার্সেল কুরিয়ারের মাধ্যমে বুক করা; এর অবস্থা কুরিয়ারই জানায়।');
    }
    if (CLOSED_SHIPMENT_STATUSES.includes(shipment.status)) {
      throw new AppError('SHIPMENT_CLOSED', `This parcel is already ${shipment.status}.`,
        `এই পার্সেল আগেই ${shipment.status}।`);
    }

    const { isDelivered, isReturned } = await applyShipmentEvent(txClient, shipment, {
      eventId: `manual-${randomUUID()}`,
      carrierStatus: status,
      normalizedStatus: status,
      location: null,
      note: cleanNote,
      latitude: null,
      longitude: null,
      rawPayload: { source: 'MANUAL', actor_id: actorId },
    });

    await writeAudit(txClient, {
      actorId,
      actorRole,
      action: 'logistics.shipment.manual_status',
      targetType: 'shipment',
      targetRef: shipment.ref,
      beforeJson: { status: shipment.status, sub_order_status: shipment.sub_order_status },
      afterJson: { status, note: cleanNote },
      riskTier: 'MEDIUM',
    }).catch(() => {});

    return { success: true, shipmentId: shipment.id, subOrderId: shipment.sub_order_id, status, isDelivered, isReturned };
  });

  // Same as the webhook: the referral engine opens its own transactions, so it runs after commit.
  if (result.isDelivered) await creditReferralOnDelivery(db, cache, result.subOrderId);
  return result;
}

/** One supplier's parcels, newest first, keyset-paginated by id. */
export async function listSupplierShipments(db, { supplierId, status = null, limit = 20, cursor = null }) {
  const safeLimit = Math.min(Math.max(parseInt(String(limit), 10) || 20, 1), 100);
  const params: unknown[] = [supplierId];
  let where = 'so.supplier_id = $1';
  if (status) {
    params.push(status);
    where += ` AND s.status = $${params.length}`;
  }
  if (cursor) {
    params.push(cursor);
    where += ` AND s.id < $${params.length}`;
  }
  params.push(safeLimit + 1);

  const { rows } = await db.query(
    `SELECT s.id, s.ref, s.sub_order_id, s.carrier, s.courier_name, s.tracking_number, s.status,
            s.recipient_name, s.recipient_phone, s.delivery_address_json, s.cod_amount,
            s.delivered_at, s.returned_at, s.created_at,
            so.ref AS sub_order_ref, so.total_amount, o.payment_method
     FROM shipments s
     JOIN sub_orders so ON so.id = s.sub_order_id
     JOIN orders o ON o.id = so.order_id
     WHERE ${where}
     ORDER BY s.id DESC
     LIMIT $${params.length}`,
    params
  );

  const hasMore = rows.length > safeLimit;
  const items = hasMore ? rows.slice(0, safeLimit) : rows;
  return { items, next_cursor: hasMore ? items[items.length - 1].id : null };
}
