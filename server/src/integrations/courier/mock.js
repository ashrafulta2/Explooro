/**
 * mock.js — Automated Mock Courier Driver for Local/Testing (Prompt 7.1).
 *
 * Implements:
 * 1. Immediate consignment creation with simulated tracking numbers.
 * 2. Automated status progression simulation without requiring live courier credentials.
 * 3. Synthetic Bangladesh GPS coordinates generator for live map tracking.
 * 4. Printable packing slip & shipping label generator.
 */

import { randomUUID } from 'node:crypto';

// Synthetic Bangladesh GPS coordinate routes
const ROUTE_COORDINATES = [
  { status: 'PICKED_UP', location: 'Dhaka Warehouse Hub (Tejgaon)', lat: 23.7594, lng: 90.3925 },
  { status: 'IN_TRANSIT', location: 'Dhaka-Chittagong Highway Sorting Center (Kanchpur)', lat: 23.7051, lng: 90.5284 },
  { status: 'IN_TRANSIT', location: 'Comilla Transit Hub (Paduar Bazar)', lat: 23.4352, lng: 91.1821 },
  { status: 'OUT_FOR_DELIVERY', location: 'Chittagong Regional Hub (Agrabad)', lat: 22.3304, lng: 91.8156 },
  { status: 'DELIVERED', location: 'Customer Delivery Destination (GEC Circle)', lat: 22.3592, lng: 91.8215 },
];

export class MockCourierAdapter {
  constructor(config = {}) {
    this.name = 'MOCK';
    this.config = config;
  }

  async createConsignment({
    subOrderRef,
    recipientName,
    recipientPhone,
    deliveryAddress,
    codAmount = 0,
    weightKg = 0.5,
    itemDescription = 'Apparel & Goods',
  } = {}) {
    const randomHex = Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, '0');
    const trackingNumber = `TRK-MOCK-${randomHex}`;
    const courierConsignmentId = `MOCK-CN-${randomHex}`;

    return {
      success: true,
      carrier: 'MOCK',
      trackingNumber,
      courierConsignmentId,
      status: 'PENDING',
      codAmount: parseFloat(codAmount || 0).toFixed(2),
      shippingCharge: this.calculateRate({ weightKg, deliveryDistrict: deliveryAddress?.district || 'Dhaka' }).rate,
      labelUrl: `/api/v1/shipments/mock-label/${trackingNumber}`,
      estimatedDeliveryDays: 2,
    };
  }

  async getStatus(trackingNumber) {
    return {
      success: true,
      trackingNumber,
      status: 'IN_TRANSIT',
      location: 'Kanchpur Sorting Center',
      updatedAt: new Date().toISOString(),
    };
  }

  async cancelConsignment(trackingNumber) {
    return {
      success: true,
      trackingNumber,
      status: 'CANCELLED',
      message: 'Consignment cancelled successfully in Mock carrier system.',
    };
  }

  calculateRate({ weightKg = 0.5, deliveryDistrict = 'Dhaka' } = {}) {
    const isInsideDhaka = String(deliveryDistrict).toLowerCase().includes('dhaka');
    const baseRate = isInsideDhaka ? 60.00 : 120.00;
    const extraWeight = Math.max(0, weightKg - 1);
    const rate = baseRate + extraWeight * 20.00;

    return {
      carrier: 'MOCK',
      rate: rate.toFixed(2),
      currency: 'BDT',
      isInsideDhaka,
    };
  }

  async getLabel(trackingNumber, details = {}) {
    return {
      success: true,
      trackingNumber,
      contentType: 'text/html',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: monospace; padding: 20px; border: 2px dashed #000; max-width: 400px; }
            .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 10px; }
            .barcode { font-size: 24px; letter-spacing: 4px; font-weight: bold; text-align: center; margin: 15px 0; }
            .row { display: flex; justify-content: space-between; margin-bottom: 6px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h2>EXPLOORO LOGISTICS</h2>
            <div>Carrier: MOCK COURIER</div>
          </div>
          <div class="barcode">*${trackingNumber}*</div>
          <div class="row"><strong>Tracking:</strong> <span>${trackingNumber}</span></div>
          <div class="row"><strong>Sub-Order:</strong> <span>${details.subOrderRef || 'N/A'}</span></div>
          <div class="row"><strong>Recipient:</strong> <span>${details.recipientName || 'Valued Customer'}</span></div>
          <div class="row"><strong>Phone:</strong> <span>${details.recipientPhone || 'N/A'}</span></div>
          <div class="row"><strong>COD Amount:</strong> <span>৳${details.codAmount || '0.00'}</span></div>
        </body>
        </html>
      `,
    };
  }

  verifyWebhookSignature({ headers, rawBody, secret = 'mock_secret' } = {}) {
    // In mock mode or dev, accept test token or true
    return true;
  }

  normalizeWebhookEvent(payload = {}) {
    const eventId = payload.event_id || payload.eventId || `evt-${randomUUID()}`;
    const trackingNumber = payload.tracking_number || payload.trackingNumber;
    const courierConsignmentId = payload.consignment_id || payload.consignmentId;
    const rawStatus = String(payload.status || 'DELIVERED').toUpperCase();

    let normalizedStatus = 'IN_TRANSIT';
    if (rawStatus.includes('PICK') || rawStatus.includes('CREATED')) normalizedStatus = 'PICKED_UP';
    else if (rawStatus.includes('TRANSIT') || rawStatus.includes('SORT')) normalizedStatus = 'IN_TRANSIT';
    else if (rawStatus.includes('OUT') || rawStatus.includes('RIDER')) normalizedStatus = 'OUT_FOR_DELIVERY';
    else if (rawStatus.includes('DELIVERED')) normalizedStatus = 'DELIVERED';
    else if (rawStatus.includes('RETURN')) normalizedStatus = 'RETURNED';
    else if (rawStatus.includes('CANCEL')) normalizedStatus = 'CANCELLED';
    else if (rawStatus.includes('FAIL')) normalizedStatus = 'FAILED';

    const routePoint = ROUTE_COORDINATES.find((p) => p.status === normalizedStatus) || ROUTE_COORDINATES[1];

    return {
      eventId,
      carrier: 'MOCK',
      trackingNumber,
      courierConsignmentId,
      carrierStatus: rawStatus,
      normalizedStatus,
      location: payload.location || routePoint.location,
      note: payload.note || `Mock courier status updated to ${normalizedStatus}`,
      latitude: payload.latitude ?? routePoint.lat,
      longitude: payload.longitude ?? routePoint.lng,
      rawPayload: payload,
    };
  }

  /**
   * Helper to simulate status progression points.
   */
  getSimulationTimeline() {
    return ROUTE_COORDINATES;
  }
}
