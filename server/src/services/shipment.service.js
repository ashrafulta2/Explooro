/**
 * shipment.service.js — Multi-Carrier Logistics & Webhook Engine (Prompt 7.1).
 *
 * Implements:
 * 1. Carrier selection strategy (Supplier pin -> District rule -> Default driver)
 * 2. Consignment booking across 3PL carriers (Steadfast, Pathao, RedX, Mock)
 * 3. Unified webhook handler with HMAC verification, replay deduplication, status normalization
 * 4. Automatic Escrow start on DELIVERED and stock restoration/clawback on RETURNED
 * 5. Full event timeline history tracking and live coordinate streaming
 */

import { randomUUID } from 'node:crypto';
import { withTransaction } from '../config/db.js';
import { getCourierAdapter } from '../integrations/courier/index.js';
import * as vaultService from './vault.service.js';
import * as clawbackService from './clawback.service.js';
import * as warrantyService from './warranty.service.js';
import { writeAudit } from '../lib/audit.js';

/**
 * Resolves the optimal carrier for a sub-order based on routing rules.
 */
export async function resolveCarrierForSubOrder(db, { districtName = null, supplierId = null, client = null } = {}) {
  const runner = client ?? db;

  // 1. Check if supplier has pinned carrier
  if (supplierId) {
    const { rows } = await runner.query(
      `SELECT carrier FROM carrier_routing_rules
       WHERE supplier_id = $1 AND is_active = true
       ORDER BY priority ASC LIMIT 1`,
      [supplierId]
    );
    if (rows.length > 0) return rows[0].carrier;
  }

  // 2. Check if district has pinned carrier
  if (districtName) {
    const { rows } = await runner.query(
      `SELECT carrier FROM carrier_routing_rules
       WHERE district_name ILIKE $1 AND supplier_id IS NULL AND is_active = true
       ORDER BY priority ASC LIMIT 1`,
      [`%${districtName.trim()}%`]
    );
    if (rows.length > 0) return rows[0].carrier;
  }

  // 3. Fallback to default driver
  return (process.env.COURIER_DRIVER || 'MOCK').toUpperCase();
}

/**
 * Creates a new shipment/consignment with the selected 3PL carrier.
 */
export async function createShipmentForSubOrder(db, {
  subOrderId,
  carrierOverride = null,
  requestedBy = null,
  client = null,
} = {}) {
  const runner = async (txClient) => {
    // 1. Fetch sub-order & parent order details
    const { rows: subRows } = await txClient.query(
      `SELECT s.id, s.order_id, s.ref, s.supplier_id, s.saler_id, s.total_amount, s.status, s.shipping_amount,
              o.delivery_address_json, o.recipient_name, o.recipient_phone, o.payment_method
       FROM sub_orders s
       JOIN orders o ON o.id = s.order_id
       WHERE s.id = $1
       FOR UPDATE`,
      [subOrderId]
    );

    if (subRows.length === 0) {
      throw new Error(`SUB_ORDER_NOT_FOUND: Sub-order #${subOrderId} does not exist.`);
    }

    const subOrder = subRows[0];
    const address = typeof subOrder.delivery_address_json === 'string'
      ? JSON.parse(subOrder.delivery_address_json)
      : subOrder.delivery_address_json || {};

    const district = address.district || address.city || 'Dhaka';
    const carrierKey = carrierOverride || (await resolveCarrierForSubOrder(txClient, {
      districtName: district,
      supplierId: subOrder.supplier_id,
      client: txClient,
    }));

    const adapter = getCourierAdapter(carrierKey);
    const isCod = subOrder.payment_method === 'COD';
    const codAmount = isCod ? parseFloat(subOrder.total_amount) : 0.00;

    // 2. Book consignment via carrier adapter
    const consignmentResult = await adapter.createConsignment({
      subOrderRef: subOrder.ref,
      recipientName: subOrder.recipient_name || 'Customer',
      recipientPhone: subOrder.recipient_phone || '+8801700000000',
      deliveryAddress: address,
      codAmount,
      weightKg: 0.5,
    });

    const shipmentRef = `SHP-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`;

    // 3. Save shipment row
    const { rows: shipmentRows } = await txClient.query(
      `INSERT INTO shipments (
         ref, sub_order_id, carrier, tracking_number, courier_consignment_id,
         status, recipient_name, recipient_phone, delivery_address_json,
         cod_amount, shipping_charge, label_url
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::numeric(14,2), $11::numeric(14,2), $12)
       RETURNING *`,
      [
        shipmentRef,
        subOrder.id,
        adapter.name,
        consignmentResult.trackingNumber,
        consignmentResult.courierConsignmentId,
        'PENDING',
        subOrder.recipient_name || 'Customer',
        subOrder.recipient_phone || '+8801700000000',
        JSON.stringify(address),
        codAmount.toFixed(2),
        consignmentResult.shippingCharge || '60.00',
        consignmentResult.labelUrl || null,
      ]
    );

    const shipment = shipmentRows[0];

    // 4. Record initial event in history log
    await txClient.query(
      `INSERT INTO shipment_events (
         shipment_id, event_id, carrier_status, normalized_status, location, note, raw_payload_json
       )
       VALUES ($1, $2, 'CREATED', 'PENDING', 'Origin Hub', 'Shipment created and scheduled for pickup', $3)`,
      [
        shipment.id,
        `init-${randomUUID()}`,
        JSON.stringify(consignmentResult),
      ]
    );

    // 5. Update sub-orders status to SHIPPED if it was CONFIRMED/PLACED
    await txClient.query(
      `UPDATE sub_orders SET status = 'SHIPPED', updated_at = now() WHERE id = $1`,
      [subOrder.id]
    );

    await writeAudit(txClient, {
      actorId: requestedBy,
      actorRole: 'supplier',
      action: 'logistics.shipment.create',
      targetType: 'shipment',
      targetRef: shipment.tracking_number,
      afterJson: { carrier: adapter.name, tracking_number: shipment.tracking_number, cod_amount: codAmount },
      riskTier: 'LOW',
    }).catch(() => {});

    return {
      success: true,
      shipment,
      trackingNumber: shipment.tracking_number,
      carrier: adapter.name,
      labelUrl: shipment.label_url,
    };
  };

  return client ? runner(client) : withTransaction(db, runner);
}

/**
 * Handles incoming courier webhooks with signature verification, replay protection,
 * status normalization, and automated lifecycle hooks (Escrow hold on DELIVERED, Restock & Clawback on RETURNED).
 */
export async function handleCourierWebhook(db, cache, {
  carrier,
  headers = {},
  rawBody = '',
  payload = {},
  client = null,
} = {}) {
  const runner = async (txClient) => {
    const adapter = getCourierAdapter(carrier);

    // 1. Signature check
    const isValidSignature = adapter.verifyWebhookSignature({ headers, rawBody });
    if (!isValidSignature) {
      throw new Error(`INVALID_WEBHOOK_SIGNATURE: Courier signature verification failed for ${carrier}.`);
    }

    // 2. Normalize event
    const normalized = adapter.normalizeWebhookEvent(payload);
    if (!normalized.trackingNumber && !normalized.courierConsignmentId) {
      throw new Error('MISSING_IDENTIFIER: Webhook payload missing tracking number or consignment ID.');
    }

    // 3. Replay protection (Deduplication)
    const eventKey = `courier_evt:${carrier}:${normalized.eventId}`;
    if (cache && typeof cache.setNX === 'function') {
      const isNew = await cache.setNX(eventKey, '1', 86400);
      if (!isNew) {
        return { duplicate: true, alreadyProcessed: true, event: normalized };
      }
    }

    // Secondary DB replay protection
    if (normalized.eventId) {
      const { rows: dupRows } = await txClient.query(
        `SELECT id FROM shipment_events WHERE event_id = $1 LIMIT 1`,
        [normalized.eventId]
      );
      if (dupRows.length > 0) {
        return { duplicate: true, alreadyProcessed: true, event: normalized };
      }
    }

    // 4. Find matching shipment
    const { rows: shipmentRows } = await txClient.query(
      `SELECT s.id, s.sub_order_id, s.carrier, s.tracking_number, s.status, s.delivered_at,
              so.ref AS sub_order_ref, so.status AS sub_order_status
       FROM shipments s
       JOIN sub_orders so ON so.id = s.sub_order_id
       WHERE s.tracking_number = $1 OR s.courier_consignment_id = $1 OR s.courier_consignment_id = $2
       LIMIT 1
       FOR UPDATE`,
      [normalized.trackingNumber, normalized.courierConsignmentId]
    );

    if (shipmentRows.length === 0) {
      return {
        success: false,
        unmatched: true,
        message: `No active shipment found matching tracking number ${normalized.trackingNumber}`,
        event: normalized,
      };
    }

    const shipment = shipmentRows[0];

    // 5. Insert history event
    await txClient.query(
      `INSERT INTO shipment_events (
         shipment_id, event_id, carrier_status, normalized_status, location, note, latitude, longitude, raw_payload_json
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        shipment.id,
        normalized.eventId,
        normalized.carrierStatus,
        normalized.normalizedStatus,
        normalized.location,
        normalized.note,
        normalized.latitude,
        normalized.longitude,
        JSON.stringify(normalized.rawPayload),
      ]
    );

    // 6. Update shipment status and coordinates
    const isDelivered = normalized.normalizedStatus === 'DELIVERED';
    const isReturned = normalized.normalizedStatus === 'RETURNED' || normalized.normalizedStatus === 'CANCELLED';

    await txClient.query(
      `UPDATE shipments
       SET status = $2,
           current_latitude = COALESCE($3, current_latitude),
           current_longitude = COALESCE($4, current_longitude),
           delivered_at = CASE WHEN $2 = 'DELIVERED' AND delivered_at IS NULL THEN now() ELSE delivered_at END,
           returned_at = CASE WHEN $2 IN ('RETURNED','CANCELLED') AND returned_at IS NULL THEN now() ELSE returned_at END,
           updated_at = now()
       WHERE id = $1`,
      [
        shipment.id,
        normalized.normalizedStatus,
        normalized.latitude,
        normalized.longitude,
      ]
    );

    // 7. LIFECYCLE HOOK: On DELIVERED -> Set sub_orders status and trigger Escrow deposit exactly once
    if (isDelivered) {
      await txClient.query(
        `UPDATE sub_orders
         SET status = 'DELIVERED', updated_at = now()
         WHERE id = $1`,
        [shipment.sub_order_id]
      );

      // Start escrow hold (idempotent)
      try {
        await vaultService.depositToEscrow(txClient, {
          subOrderId: shipment.sub_order_id,
          idempotencyKey: `escrow_deposit_delivered:${shipment.sub_order_id}`,
          client: txClient,
        });
      } catch (err) {
        // Safe if already deposited
        if (!err.message?.includes('already') && !err.message?.includes('duplicate')) {
          console.warn(`[CourierWebhook] Escrow deposit notice for sub-order #${shipment.sub_order_id}: ${err.message}`);
        }
      }

      // Auto-issue digital warranty cards for eligible items (Prompt 10.4)
      try {
        await warrantyService.issueWarrantiesForSubOrder(txClient, {
          subOrderId: shipment.sub_order_id,
          client: txClient,
        });
      } catch (err) {
        console.warn(`[CourierWebhook] Warranty issuance notice for sub-order #${shipment.sub_order_id}: ${err.message}`);
      }
    }

    // 8. LIFECYCLE HOOK: On RETURNED / CANCELLED -> Set sub_orders status, restore stock & trigger clawback
    if (isReturned) {
      await txClient.query(
        `UPDATE sub_orders
         SET status = 'RETURNED', updated_at = now()
         WHERE id = $1`,
        [shipment.sub_order_id]
      );

      // Restore inventory items
      const { rows: items } = await txClient.query(
        `SELECT product_id, quantity FROM order_items WHERE sub_order_id = $1`,
        [shipment.sub_order_id]
      );

      for (const item of items) {
        await txClient.query(
          `UPDATE products SET stock_quantity = stock_quantity + $2, updated_at = now() WHERE id = $1`,
          [item.product_id, item.quantity]
        );
      }

      // Execute clawback if escrow was partially/fully processed
      try {
        await clawbackService.executeClawback(txClient, {
          subOrderId: shipment.sub_order_id,
          reason: `Consignment returned by carrier (${normalized.note || 'Returned to origin'})`,
          refundCustomer: true,
          client: txClient,
        });
      } catch (err) {
        console.warn(`[CourierWebhook] Clawback notice for sub-order #${shipment.sub_order_id}: ${err.message}`);
      }
    }

    return {
      success: true,
      shipmentId: shipment.id,
      trackingNumber: shipment.tracking_number,
      previousStatus: shipment.status,
      currentStatus: normalized.normalizedStatus,
      isDelivered,
      isReturned,
      event: normalized,
    };
  };

  return client ? runner(client) : withTransaction(db, runner);
}

/**
 * Retrieves full tracking details and event timeline.
 */
export async function getShipmentTracking(db, trackingNumberOrSubOrderId, { client = null } = {}) {
  const runner = client ?? db;

  const { rows: shipmentRows } = await runner.query(
    `SELECT s.id, s.ref, s.sub_order_id, s.carrier, s.tracking_number, s.courier_consignment_id,
            s.status, s.recipient_name, s.recipient_phone, s.delivery_address_json,
            s.cod_amount, s.shipping_charge, s.label_url, s.current_latitude, s.current_longitude,
            s.delivered_at, s.created_at,
            so.ref AS sub_order_ref, so.status AS sub_order_status
     FROM shipments s
     JOIN sub_orders so ON so.id = s.sub_order_id
     WHERE s.tracking_number = $1 OR s.courier_consignment_id = $1 OR s.sub_order_id = $2
     ORDER BY s.id DESC LIMIT 1`,
    [
      String(trackingNumberOrSubOrderId),
      parseInt(trackingNumberOrSubOrderId, 10) || 0,
    ]
  );

  if (shipmentRows.length === 0) return null;

  const shipment = shipmentRows[0];

  const { rows: events } = await runner.query(
    `SELECT id, event_id, carrier_status, normalized_status, location, note, latitude, longitude, created_at
     FROM shipment_events
     WHERE shipment_id = $1
     ORDER BY created_at ASC`,
    [shipment.id]
  );

  return {
    shipment,
    events,
    currentLocation: {
      latitude: shipment.current_latitude ? parseFloat(shipment.current_latitude) : null,
      longitude: shipment.current_longitude ? parseFloat(shipment.current_longitude) : null,
      lastEvent: events[events.length - 1] || null,
    },
  };
}

/**
 * Generates printable packing slip & shipping label HTML.
 */
export async function generateShippingLabel(db, shipmentId, { client = null } = {}) {
  const runner = client ?? db;

  const { rows } = await runner.query(
    `SELECT s.*, so.ref AS sub_order_ref, so.total_amount
     FROM shipments s
     JOIN sub_orders so ON so.id = s.sub_order_id
     WHERE s.id = $1`,
    [shipmentId]
  );

  if (rows.length === 0) {
    throw new Error(`SHIPMENT_NOT_FOUND: Shipment #${shipmentId} does not exist.`);
  }

  const shipment = rows[0];
  const adapter = getCourierAdapter(shipment.carrier);
  return adapter.getLabel(shipment.tracking_number, {
    subOrderRef: shipment.sub_order_ref,
    recipientName: shipment.recipient_name,
    recipientPhone: shipment.recipient_phone,
    codAmount: shipment.cod_amount,
  });
}
