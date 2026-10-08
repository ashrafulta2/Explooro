/**
 * sampleKit.js — Mock handlers for Sample Requests and Marketing Kits (supplier attraction, step 4).
 *
 * Same shapes as the real endpoints (services/sampleKit.service.js). The state machine is mirrored so
 * the pages behave like the finished feature in mock mode: a request only moves along the legal
 * transitions, and a saler cannot request the same product twice. It does NOT move money - the mock
 * has no ledger - so the saler's balance never changes here.
 */

const RULES = {
  platform_fee_pct: 10, min_price: 10, max_price: 5000, max_shipping_fee: 300, response_days: 3,
  auto_confirm_days: 10, max_open_per_saler: 3, blocked_grades: ['D'], max_hashtags: 15, max_selling_points: 8, caption_max_chars: 1000,
};

const iso = (daysAgo = 0) => new Date(Date.now() - daysAgo * 86400000).toISOString();
const bad = (code, message_en) => ({ status: code === 'NOT_FOUND' ? 404 : code === 'VALIDATION_FAILED' ? 400 : 409, body: { error: { code, message_en, message_bn: message_en } } });

const state = {
  products: [
    { product_id: 11, title_en: 'Cotton Panjabi - Eid Collection', title_bn: 'কটন পাঞ্জাবি - ঈদ কালেকশন', status: 'ACTIVE', sample_price: 250, sample_shipping_fee: 60, sample_active: true,
      kit_id: 1, caption_en: 'Fresh from the loom: breathable cotton panjabi, ready for Eid.', caption_bn: 'তাঁত থেকে সরাসরি: আরামদায়ক কটন পাঞ্জাবি, ঈদের জন্য তৈরি।',
      hashtags: ['#eid', '#panjabi', '#cotton'], selling_points: ['100% cotton', 'Colour-fast', 'Sizes M to XXL'], video_url: 'https://example.com/panjabi', is_published: true },
    { product_id: 12, title_en: 'Jute Shopping Bag', title_bn: 'পাটের শপিং ব্যাগ', status: 'ACTIVE', sample_price: null, sample_shipping_fee: null, sample_active: null,
      kit_id: null, caption_en: null, caption_bn: null, hashtags: [], selling_points: [], video_url: null, is_published: null },
    { product_id: 13, title_en: 'Handmade Nakshi Kantha', title_bn: 'হাতে তৈরি নকশি কাঁথা', status: 'ACTIVE', sample_price: 900, sample_shipping_fee: 100, sample_active: true,
      kit_id: 2, caption_en: 'A story stitched by hand.', caption_bn: null, hashtags: ['#kantha'], selling_points: ['Hand stitched'], video_url: null, is_published: false },
  ],
  requests: [
    { id: 1, product_id: 11, title_en: 'Cotton Panjabi - Eid Collection', title_bn: 'কটন পাঞ্জাবি - ঈদ কালেকশন', price: '250.00', shipping_fee: '60.00', platform_fee: '25.00', status: 'REQUESTED',
      saler_name: 'Dev Saler', supplier_name: 'Rahman Traders', ship_to_name: 'Rahim', ship_to_phone: '01712-345678', ship_to_address: 'House 12, Road 3, Mirpur, Dhaka', note: 'Size L please',
      tracking_note: null, decline_reason: null, requested_at: iso(1) },
    { id: 2, product_id: 13, title_en: 'Handmade Nakshi Kantha', title_bn: 'হাতে তৈরি নকশি কাঁথা', price: '900.00', shipping_fee: '100.00', platform_fee: '90.00', status: 'SHIPPED',
      saler_name: 'Dev Saler', supplier_name: 'Rahman Traders', ship_to_name: 'Karim', ship_to_phone: '01898-765432', ship_to_address: 'Flat 4B, Agrabad, Chattogram', note: null,
      tracking_note: 'Pathao #PT-88121', decline_reason: null, requested_at: iso(4) },
  ],
  nextId: 3,
};

const TRANSITIONS = {
  accept: ['REQUESTED', 'ACCEPTED'],
  ship: ['REQUESTED', 'ACCEPTED', 'SHIPPED'],
  decline: ['REQUESTED', 'ACCEPTED', 'DECLINED'],
  cancel: ['REQUESTED', 'CANCELLED'],
  confirm: ['SHIPPED', 'DELIVERED'],
};
const LIVE = ['REQUESTED', 'ACCEPTED', 'SHIPPED', 'DELIVERED'];

function move(id, action) {
  const r = state.requests.find((x) => String(x.id) === String(id));
  if (!r) return { error: bad('NOT_FOUND', 'Sample request not found.') };
  const [from, to] = [TRANSITIONS[action].slice(0, -1), TRANSITIONS[action].at(-1)];
  if (!from.includes(r.status)) return { error: bad('SAMPLE_STATE_INVALID', `This sample is already ${r.status.toLowerCase()}.`) };
  r.status = to;
  return { row: r };
}

const clean = (list, max) => [...new Set((Array.isArray(list) ? list : []).map((s) => String(s).trim()).filter(Boolean))].slice(0, max);

export const sampleKitHandlers = [
  { method: 'GET', path: '/supplier/samples', handler: () => ({ status: 200, body: { data: { rules: RULES, grade: 'B', blocked: false, products: state.products, requests: state.requests } } }) },
  { method: 'GET', path: '/supplier/marketing-kits', handler: () => ({ status: 200, body: { data: { rules: RULES, grade: 'B', blocked: false, products: state.products, requests: [] } } }) },

  {
    method: 'PUT',
    path: '/supplier/samples/:productId/offer',
    handler: ({ params, body }) => {
      const p = state.products.find((x) => String(x.product_id) === String(params.productId));
      if (!p) return bad('NOT_FOUND', 'Product not found.');
      const price = Number(body?.price);
      const shipping = Number(body?.shipping_fee ?? 0);
      if (!(price >= RULES.min_price && price <= RULES.max_price)) return bad('VALIDATION_FAILED', `Sample price must be between ${RULES.min_price} and ${RULES.max_price}.`);
      if (!(shipping >= 0 && shipping <= RULES.max_shipping_fee)) return bad('VALIDATION_FAILED', `Shipping fee must be between 0 and ${RULES.max_shipping_fee}.`);
      Object.assign(p, { sample_price: price, sample_shipping_fee: shipping, sample_active: body?.is_active !== false });
      return { status: 200, body: { data: { product_id: p.product_id, price, shipping_fee: shipping, is_active: p.sample_active } } };
    },
  },
  {
    method: 'POST',
    path: '/supplier/samples/requests/:id/:action',
    handler: ({ params, body }) => {
      if (!['accept', 'ship', 'decline'].includes(params.action)) return bad('NOT_FOUND', 'Unknown action.');
      const { row, error } = move(params.id, params.action);
      if (error) return error;
      if (params.action === 'ship' && body?.tracking_note) row.tracking_note = body.tracking_note;
      if (params.action === 'decline' && body?.reason) row.decline_reason = body.reason;
      return { status: 200, body: { data: row } };
    },
  },
  {
    method: 'PUT',
    path: '/supplier/marketing-kits/:productId',
    handler: ({ params, body }) => {
      const p = state.products.find((x) => String(x.product_id) === String(params.productId));
      if (!p) return bad('NOT_FOUND', 'Product not found.');
      const hashtags = clean(body?.hashtags, RULES.max_hashtags).map((h) => `#${h.replace(/^#+/, '')}`);
      const points = clean(body?.selling_points, RULES.max_selling_points);
      const caption_en = String(body?.caption_en || '').trim() || null;
      const caption_bn = String(body?.caption_bn || '').trim() || null;
      const video_url = String(body?.video_url || '').trim() || null;
      if (video_url && !/^https?:\/\//i.test(video_url)) return bad('VALIDATION_FAILED', 'The video link must be a web address starting with http:// or https://.');
      if (!caption_en && !caption_bn && !hashtags.length && !points.length && !video_url) return bad('VALIDATION_FAILED', 'A kit needs at least a caption, hashtags, selling points or a video.');
      Object.assign(p, { kit_id: p.kit_id || Date.now(), caption_en, caption_bn, hashtags, selling_points: points, video_url, is_published: body?.is_published !== false });
      return { status: 200, body: { data: { product_id: p.product_id } } };
    },
  },

  // ---- saler ----
  {
    method: 'GET',
    path: '/sourcing/samples',
    handler: () => {
      const open = state.requests.filter((r) => ['REQUESTED', 'ACCEPTED', 'SHIPPED'].includes(r.status)).length;
      const offers = state.products
        .filter((p) => p.sample_active)
        .map((p) => {
          const live = state.requests.find((r) => r.product_id === p.product_id && LIVE.includes(r.status));
          return {
            product_id: p.product_id, supplier_id: 7, supplier_name: 'Rahman Traders', title_en: p.title_en, title_bn: p.title_bn,
            price: Number(p.sample_price).toFixed(2), shipping_fee: Number(p.sample_shipping_fee).toFixed(2),
            total: (Number(p.sample_price) + Number(p.sample_shipping_fee)).toFixed(2), image_url: null,
            request_id: live?.id ?? null, request_status: live?.status ?? null,
          };
        });
      return { status: 200, body: { data: { rules: RULES, open_count: open, slots_left: Math.max(0, RULES.max_open_per_saler - open), offers, requests: state.requests } } };
    },
  },
  {
    method: 'POST',
    path: '/sourcing/samples',
    handler: ({ body }) => {
      const p = state.products.find((x) => String(x.product_id) === String(body?.product_id) && x.sample_active);
      if (!p) return bad('NOT_FOUND', 'This product is not offering samples right now.');
      const to = body?.ship_to || {};
      if (!String(to.name || '').trim() || !String(to.address || '').trim() || !/^\+?[0-9][0-9 \-]{5,18}[0-9]$/.test(String(to.phone || '').trim())) {
        return bad('VALIDATION_FAILED', 'Enter your name, a valid phone number and a delivery address.');
      }
      if (state.requests.some((r) => r.product_id === p.product_id && LIVE.includes(r.status))) return bad('SAMPLE_ALREADY_REQUESTED', 'You already have a sample of this product.');
      if (state.requests.filter((r) => ['REQUESTED', 'ACCEPTED', 'SHIPPED'].includes(r.status)).length >= RULES.max_open_per_saler) {
        return bad('SAMPLE_LIMIT_REACHED', `You can have at most ${RULES.max_open_per_saler} samples in progress at once.`);
      }
      const row = {
        id: state.nextId++, product_id: p.product_id, title_en: p.title_en, title_bn: p.title_bn,
        price: Number(p.sample_price).toFixed(2), shipping_fee: Number(p.sample_shipping_fee).toFixed(2),
        platform_fee: (Math.round(Number(p.sample_price) * RULES.platform_fee_pct) / 100).toFixed(2), status: 'REQUESTED',
        saler_name: 'Dev Saler', supplier_name: 'Rahman Traders', ship_to_name: to.name.trim(), ship_to_phone: to.phone.trim(), ship_to_address: to.address.trim(),
        note: String(body?.note || '').trim() || null, tracking_note: null, decline_reason: null, requested_at: iso(0),
      };
      state.requests.unshift(row);
      return { status: 201, body: { data: row } };
    },
  },
  {
    method: 'POST',
    path: '/sourcing/samples/:id/:action',
    handler: ({ params }) => {
      if (!['cancel', 'confirm'].includes(params.action)) return bad('NOT_FOUND', 'Unknown action.');
      const { row, error } = move(params.id, params.action);
      return error || { status: 200, body: { data: row } };
    },
  },
  {
    method: 'GET',
    path: '/sourcing/marketing-kits',
    handler: () => ({
      status: 200,
      body: {
        data: {
          kits: state.products
            .filter((p) => p.kit_id && p.is_published)
            .map((p) => ({
              product_id: p.product_id, supplier_id: 7, supplier_name: 'Rahman Traders', title_en: p.title_en, title_bn: p.title_bn,
              caption_en: p.caption_en, caption_bn: p.caption_bn, hashtags: p.hashtags, selling_points: p.selling_points, video_url: p.video_url,
              updated_at: iso(2), images: [],
            })),
        },
      },
    }),
  },
];

export default sampleKitHandlers;
