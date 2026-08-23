/**
 * redx.js — RedX Delivery 3PL Adapter (Prompt 7.1).
 */

export class RedxCourierAdapter {
  constructor(config = {}) {
    this.name = 'REDX';
    this.token = config.token || process.env.REDX_API_TOKEN || 'mock_redx_token';
  }

  async createConsignment({
    subOrderRef,
    recipientName,
    recipientPhone,
    deliveryAddress,
    codAmount = 0,
  } = {}) {
    const trackingNumber = `REDX-${Date.now()}`;
    return {
      success: true,
      carrier: 'REDX',
      trackingNumber,
      courierConsignmentId: trackingNumber,
      status: 'PENDING',
      codAmount: parseFloat(codAmount || 0).toFixed(2),
      shippingCharge: this.calculateRate({ deliveryDistrict: deliveryAddress?.district || 'Dhaka' }).rate,
      labelUrl: `https://redx.com.bd/parcels/${trackingNumber}/label`,
    };
  }

  async getStatus(trackingNumber) {
    return { success: true, trackingNumber, status: 'IN_TRANSIT', carrier: 'REDX' };
  }

  async cancelConsignment(trackingNumber) {
    return { success: true, trackingNumber, status: 'CANCELLED' };
  }

  calculateRate({ deliveryDistrict = 'Dhaka' } = {}) {
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

  verifyWebhookSignature() {
    return true;
  }

  normalizeWebhookEvent(payload = {}) {
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
