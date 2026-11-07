/**
 * redx.ts — RedX Delivery 3PL Adapter (Prompt 7.1).
 */

import { isLive, safeEqual } from '../webhookSecurity.ts';
import { credential } from '../credentialStore.ts';

export class RedxCourierAdapter {
  name: any;
  token: any;

  constructor(config: Record<string, any> = {}) {
    this.name = 'REDX';
    // A value saved at /admin/platform/integrations first, then .env (credentialStore.ts).
    this.token = config.token || credential('redx_delivery', 'api_token', 'REDX_API_TOKEN') || 'mock_redx_token';
  }

  async createConsignment({
    subOrderRef,
    recipientName,
    recipientPhone,
    deliveryAddress,
    codAmount = 0,
  }) {
    const trackingNumber = `REDX-${Date.now()}`;
    return {
      success: true,
      carrier: 'REDX',
      trackingNumber,
      courierConsignmentId: trackingNumber,
      status: 'PENDING',
      codAmount: parseFloat(String(codAmount || 0)).toFixed(2),
      shippingCharge: this.calculateRate({ deliveryDistrict: deliveryAddress?.district || 'Dhaka' }).rate,
      labelUrl: `https://redx.com.bd/parcels/${trackingNumber}/label`,
    };
  }

  /**
   * Books a pickup FROM the customer TO the given address (a return or a warranty item).
   * WHY its own method: couriers book reverse parcels through a separate return/pickup request, not
   * as a delivery from the merchant's registered pickup point. Until this carrier's live API is
   * wired, it books like a delivery to the destination so the flow can be exercised end to end.
   */
  async createReturnPickup({
    ref,
    pickupName,
    pickupPhone,
    pickupAddress,
    recipientName,
    recipientPhone,
    deliveryAddress,
    weightKg = 0.5,
  }: Record<string, any> = {}) {
    const booked = await this.createConsignment({
      subOrderRef: ref,
      recipientName,
      recipientPhone,
      deliveryAddress,
      codAmount: 0,
      weightKg,
      itemDescription: `Return pickup from ${pickupName || 'customer'} (${pickupPhone || '-'}, ${pickupAddress?.district || '-'})`,
    } as any);
    return { ...booked, pickup: { name: pickupName, phone: pickupPhone, address: pickupAddress } };
  }

  async getStatus(trackingNumber) {
    return { success: true, trackingNumber, status: 'IN_TRANSIT', carrier: 'REDX' };
  }

  async cancelConsignment(trackingNumber) {
    return { success: true, trackingNumber, status: 'CANCELLED' };
  }

  calculateRate({ deliveryDistrict = 'Dhaka' }: Record<string, any> = {}) {
    const isInsideDhaka = String(deliveryDistrict).toLowerCase().includes('dhaka');
    return {
      carrier: 'REDX',
      rate: isInsideDhaka ? '65.00' : '125.00',
      currency: 'BDT',
      isInsideDhaka,
    };
  }

  async getLabel(trackingNumber) {
    return {
      success: true,
      trackingNumber,
      labelUrl: `https://redx.com.bd/parcels/${trackingNumber}/label`,
    };
  }

  verifyWebhookSignature({ headers }: Record<string, any> = {}) {
    // WHY: this used to return true unconditionally. RedX publishes no signature scheme, so a shared
    // token header (REDX_WEBHOOK_TOKEN) is the strongest check available; live mode requires it.
    if (!isLive('COURIER_DRIVER')) return true;
    const expected = credential('redx_delivery', 'webhook_token', 'REDX_WEBHOOK_TOKEN');
    const got = headers?.['x-redx-token'] || headers?.authorization;
    if (!expected || !got) return false;
    return safeEqual(String(got).replace(/^Bearer\s+/i, ''), expected);
  }

  normalizeWebhookEvent(payload: Record<string, any> = {}) {
    const eventId = payload.id || payload.event_id || `rx-${Date.now()}`;
    const trackingNumber = payload.tracking_id || payload.trackingNumber;
    const rawStatus = String(payload.status || '').toLowerCase();

    let normalizedStatus = 'IN_TRANSIT';
    if (rawStatus.includes('ready') || rawStatus.includes('created')) normalizedStatus = 'PENDING';
    else if (rawStatus.includes('pickup') || rawStatus.includes('picked')) normalizedStatus = 'PICKED_UP';
    else if (rawStatus.includes('transit') || rawStatus.includes('sorting')) normalizedStatus = 'IN_TRANSIT';
    else if (rawStatus.includes('out') || rawStatus.includes('delivery')) normalizedStatus = 'OUT_FOR_DELIVERY';
    else if (rawStatus.includes('delivered')) normalizedStatus = 'DELIVERED';
    else if (rawStatus.includes('returned') || rawStatus.includes('return')) normalizedStatus = 'RETURNED';
    else if (rawStatus.includes('cancel')) normalizedStatus = 'CANCELLED';

    return {
      eventId,
      carrier: 'REDX',
      trackingNumber,
      courierConsignmentId: trackingNumber,
      carrierStatus: rawStatus,
      normalizedStatus,
      location: payload.hub || 'RedX Hub',
      note: payload.note || `RedX status: ${rawStatus}`,
      latitude: payload.lat || null,
      longitude: payload.lng || null,
      rawPayload: payload,
    };
  }
}
