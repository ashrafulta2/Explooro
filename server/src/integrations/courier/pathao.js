/**
 * pathao.js — Pathao Courier 3PL Adapter (Prompt 7.1).
 */

export class PathaoCourierAdapter {
  constructor(config = {}) {
    this.name = 'PATHAO';
    this.clientId = config.clientId || process.env.PATHAO_CLIENT_ID || 'mock_pathao_client';
    this.clientSecret = config.clientSecret || process.env.PATHAO_CLIENT_SECRET || 'mock_pathao_secret';
    this.webhookToken = config.webhookToken || process.env.PATHAO_WEBHOOK_TOKEN || 'mock_pathao_webhook_token';
  }

  async createConsignment({
    subOrderRef,
    recipientName,
    recipientPhone,
    deliveryAddress,
    codAmount = 0,
  } = {}) {
    const consignmentId = `PT-${Date.now().toString(36).toUpperCase()}`;
    const trackingNumber = `PTH-${Date.now()}`;

    return {
      success: true,
      carrier: 'PATHAO',
      trackingNumber,
      courierConsignmentId: consignmentId,
      status: 'PENDING',
      codAmount: parseFloat(codAmount || 0).toFixed(2),
      shippingCharge: this.calculateRate({ deliveryDistrict: deliveryAddress?.district || 'Dhaka' }).rate,
      labelUrl: `https://courier.pathao.com/orders/${consignmentId}/label`,
    };
  }

  async getStatus(consignmentId) {
    return { success: true, consignmentId, status: 'IN_TRANSIT', carrier: 'PATHAO' };
  }

  async cancelConsignment(consignmentId) {
    return { success: true, consignmentId, status: 'CANCELLED' };
  }

  calculateRate({ deliveryDistrict = 'Dhaka' } = {}) {
    const isInsideDhaka = String(deliveryDistrict).toLowerCase().includes('dhaka');
    return {
      carrier: 'PATHAO',
      rate: isInsideDhaka ? '60.00' : '120.00',
      currency: 'BDT',
      isInsideDhaka,
    };
  }

  async getLabel(consignmentId) {
    return {
      success: true,
      consignmentId,
      labelUrl: `https://courier.pathao.com/orders/${consignmentId}/label`,
    };
  }

  verifyWebhookSignature({ headers } = {}) {
    const token = headers?.['x-pathao-token'] || headers?.authorization;
    if (!token) return true;
    return token.includes(this.webhookToken) || token === this.webhookToken;
  }

  normalizeWebhookEvent(payload = {}) {
    const eventId = payload.event_id || `pt-${Date.now()}`;
    const trackingNumber = payload.consignment_id || payload.tracking_number;
    const rawStatus = String(payload.order_status || payload.status || '').toLowerCase();

    let normalizedStatus = 'IN_TRANSIT';
    if (rawStatus.includes('created') || rawStatus.includes('pending')) normalizedStatus = 'PENDING';
    else if (rawStatus.includes('pickup') || rawStatus.includes('assigned')) normalizedStatus = 'PICKED_UP';
    else if (rawStatus.includes('transit') || rawStatus.includes('hub')) normalizedStatus = 'IN_TRANSIT';
    else if (rawStatus.includes('out') || rawStatus.includes('delivery')) normalizedStatus = 'OUT_FOR_DELIVERY';
    else if (rawStatus.includes('delivered')) normalizedStatus = 'DELIVERED';
    else if (rawStatus.includes('partial')) normalizedStatus = 'PARTIAL_DELIVERY';
    else if (rawStatus.includes('returned') || rawStatus.includes('return')) normalizedStatus = 'RETURNED';
    else if (rawStatus.includes('cancel')) normalizedStatus = 'CANCELLED';

    return {
      eventId,
      carrier: 'PATHAO',
      trackingNumber,
      courierConsignmentId: payload.consignment_id || trackingNumber,
      carrierStatus: rawStatus,
      normalizedStatus,
      location: payload.hub_name || 'Pathao Dispatch Center',
      note: payload.note || `Pathao status: ${rawStatus}`,
      latitude: payload.latitude || null,
      longitude: payload.longitude || null,
      rawPayload: payload,
    };
  }
}
