/**
 * orders.js — Mock API handlers for Orders & Checkout (Prompt 5.4).
 *
 * Implements realistic checkout processing, multi-supplier order splitting, and tracking in mock mode.
 */

let mockOrders = [
  {
    id: 1,
    ref: 'ORD-DH-90123',
    customer_id: 1,
    total_amount: '4820.00',
    items_amount: '4700.00',
    shipping_amount: '120.00',
    discount_amount: '0.00',
    currency: 'BDT',
    payment_method: 'COD',
    payment_status: 'PENDING',
    recipient_name: 'Karim Ahmed',
    recipient_phone: '+8801711111111',
    division: 'dhaka',
    district: 'dhaka_city',
    upazila: 'Dhanmondi',
    address_line: 'House 12, Road 4, Dhanmondi R/A',
    placed_at: new Date(Date.now() - 3600000).toISOString(),
    created_at: new Date(Date.now() - 3600000).toISOString(),
    sub_orders: [
      {
        id: 1,
        ref: 'ORD-DH-90123-1',
        order_id: 1,
        supplier_id: 1,
        supplier_name: 'Dhakai Heritage Weavers Ltd.',
        subtotal_base: '2800.00',
        net_retail_margin: '700.00',
        saler_commission: '280.00',
        platform_margin: '420.00',
        shipping_amount: '60.00',
        discount_share: '0.00',
        total_amount: '3560.00',
        status: 'SHIPPED',
        courier_partner: 'Pathao Logistics Express',
        tracking_number: 'PTH-DH-882194',
        items: [
          {
            id: 1,
            product_id: 1,
            title_snapshot: 'Authentic Handloom Dhakai Jamdani Saree',
            qty: 1,
            base_price: '2800.00',
            retail_price: '3500.00',
            line_total: '3500.00',
          },
        ],
      },
      {
        id: 2,
        ref: 'ORD-DH-90123-2',
        order_id: 1,
        supplier_id: 2,
        supplier_name: 'Rajshahi Silk Emporium',
        subtotal_base: '950.00',
        net_retail_margin: '250.00',
        saler_commission: '100.00',
        platform_margin: '150.00',
        shipping_amount: '60.00',
        discount_share: '0.00',
        total_amount: '1260.00',
        status: 'CONFIRMED',
        courier_partner: 'Steadfast Courier',
        tracking_number: 'STF-YK-991204',
        items: [
          {
            id: 2,
            product_id: 2,
            title_snapshot: 'Pure Rajshahi Silk Dupatta / Scarf',
            qty: 1,
            base_price: '950.00',
            retail_price: '1200.00',
            line_total: '1200.00',
          },
        ],
      },
    ],
  },
];

let nextOrderId = 2;

const orderHandlers = [
  {
    method: 'POST',
    path: '/orders/checkout',
    handler({ body }) {
      const b = body || {};
      const orderRef = `ORD-${Date.now().toString().slice(-6)}`;

      const newOrder = {
        id: nextOrderId++,
        ref: orderRef,
        customer_id: 1,
        total_amount: '820.00',
        items_amount: '700.00',
        shipping_amount: '120.00',
        discount_amount: '0.00',
        currency: 'BDT',
        payment_method: b.payment_method || 'COD',
        payment_status: b.payment_method === 'COD' ? 'PENDING' : 'PAID',
        recipient_name: b.recipient_name || 'Valued Customer',
        recipient_phone: b.recipient_phone || '+8801700000000',
        division: b.division || 'dhaka',
        district: b.district || 'dhaka_city',
        upazila: b.upazila || 'Dhanmondi',
        address_line: b.address_line || 'Delivery Address',
        placed_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        sub_orders: [
          {
            id: nextOrderId * 10,
            ref: `${orderRef}-1`,
            order_id: nextOrderId,
            supplier_id: 101,
            supplier_name: 'Dhakai Heritage Weavers Ltd.',
            subtotal_base: '500.00',
            net_retail_margin: '200.00',
            saler_commission: '80.00',
            platform_margin: '120.00',
            shipping_amount: '60.00',
            discount_share: '0.00',
            total_amount: '760.00',
            status: 'PLACED',
            courier_partner: 'Steadfast Courier',
            tracking_number: `STF-${orderRef.slice(-4)}`,
            items: [
              {
                id: 1,
                product_id: 1,
                title_snapshot: 'Handloom Cotton Saree',
                qty: 1,
                base_price: '500.00',
                retail_price: '700.00',
                line_total: '700.00',
              },
            ],
          },
        ],
      };

      mockOrders.unshift(newOrder);
      return { status: 201, body: { data: { order: newOrder } } };
    },
  },
  {
    method: 'GET',
    path: '/orders/my-orders',
    handler() {
      return {
        status: 200,
        body: {
          data: { orders: mockOrders },
          meta: { count: mockOrders.length, cursor: { next: null, has_more: false } },
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/orders/:id',
    handler({ params }) {
      const idOrRef = params.id;
      const order = mockOrders.find((o) => String(o.id) === String(idOrRef) || o.ref === idOrRef) || mockOrders[0];
      return { status: 200, body: { data: { order } } };
    },
  },
  {
    method: 'POST',
    path: '/orders/:id/cancel',
    handler({ params }) {
      const idOrRef = params.id;
      const order = mockOrders.find((o) => String(o.id) === String(idOrRef) || o.ref === idOrRef) || mockOrders[0];
      if (order) {
        order.sub_orders.forEach((so) => {
          so.status = 'CANCELLED';
        });
      }
      return { status: 200, body: { data: { order, message_en: 'Order cancelled successfully' } } };
    },
  },
];

export default orderHandlers;
