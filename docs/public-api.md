# Explooro Open Marketplace REST API & Webhooks Specification (OpenAPI 3.0)

> **Version:** `1.0.0`  
> **Base URL:** `https://api.explooro.com/api/v1` or `http://localhost:3000/api/v1`  
> **Authentication:** API Key (`X-Api-Key: exp_live_...` or `Authorization: Bearer exp_live_...`) / Session JWT  
> **Module Key:** `open_developer_api`

---

## 1. Overview & Architecture

Explooro's Open Developer API transforms the multi-tier commerce engine into an extensible developer platform. Third-party developers, bloggers, Facebook group communities, and affiliate merchants can:
1. Query public products, category hierarchies, and storefront catalogs in real time.
2. Embed lightweight, responsive product grids (<15KB) on external websites with instant checkout.
3. Place direct partner orders using scoped API keys (`orders.create`).
4. Subscribe to outbound webhook events signed with HMAC-SHA256 (`X-Explooro-Signature`).

---

## 2. Authentication & Scopes

### Authentication Headers
Authenticate requests using either of the following HTTP headers:
- `X-Api-Key: exp_live_xxxxxxxxxxxxxxxxxxxxxxxx`
- `Authorization: Bearer exp_live_xxxxxxxxxxxxxxxxxxxxxxxx`

### Scopes Catalog (Phase 2 RBAC Alignment)
| Scope | Description |
|---|---|
| `catalog.products.read` | Read-only access to products, variants, and stock availability |
| `catalog.stores.read` | Read-only access to published shop partner stores and curated items |
| `catalog.categories.read` | Read-only access to categories and navigation trees |
| `orders.create` | Write permission to inject partner orders on behalf of customers |
| `webhooks.manage` | Permission to register, update, and inspect webhook endpoints |

### Placing a partner order (`POST /public/orders`)
A partner places a **Cash on Delivery** order for one of their customers. The order goes through the same checkout as the website (stock locks, pricing, supplier parcels, escrow on delivery); the partner never sets a price.

- **The buyer is the customer, not the partner.** `customer.phone` finds the customer's Explooro account, or creates a bare one they can claim later by signing up with that phone. The order appears in the customer's own order history.
- **The partner is credited as the shop partner** on every line whose product is active in their storefront, exactly as if the customer had bought from that storefront. Lines they do not carry, or an order placed for the partner's own phone, earn nothing.
- **COD only.** `payment_method` may be omitted or `COD`; anything else is `400`. When the customer's trust score makes the order risky, the answer is `422 COD_OTP_REQUIRED` and the customer receives an SMS code. Repeat the same request, with the same `Idempotency-Key`, adding `otp_code`.
- **`Idempotency-Key` header is required** (at most 200 characters) and belongs to your API key, so two partners can never collide on the same value. Repeating a key with the same customer and items returns the original order with `200` and `Idempotency-Replayed: true`; reusing it for a different order is `409 IDEMPOTENCY_MISMATCH`. Always retry a timed-out call with the same key.

```bash
curl -X POST http://localhost:3000/api/v1/public/orders \
  -H "X-Api-Key: exp_live_..." \
  -H "Idempotency-Key: 6f1c2a9e-order-1042" \
  -H "Content-Type: application/json" \
  -d '{"customer":{"name":"Rahim Uddin","phone":"01712345678"},
       "shipping_address":{"division":"Dhaka","district":"Dhaka","upazila":"Dhanmondi","address_line":"House 12, Road 4"},
       "items":[{"product_id":12,"quantity":2}]}'
```


---

## 3. OpenAPI 3.0 Specification

```yaml
openapi: 3.0.3
info:
  title: Explooro Open Marketplace REST API
  description: Public catalog querying, partner order placement, and developer webhooks.
  version: 1.0.0
servers:
  - url: http://localhost:3000/api/v1
    description: Local Development Server
  - url: https://api.explooro.com/api/v1
    description: Production API Gateway

paths:
  /public/products:
    get:
      summary: List active public products
      tags:
        - Catalog
      parameters:
        - name: category_id
          in: query
          schema:
            type: integer
          description: Filter by category ID
        - name: search
          in: query
          schema:
            type: string
          description: Keyword search across English and Bengali titles
        - name: min_price
          in: query
          schema:
            type: number
          description: Minimum retail price in BDT
        - name: max_price
          in: query
          schema:
            type: number
          description: Maximum retail price in BDT
        - name: in_stock
          in: query
          schema:
            type: boolean
          description: Filter products with available inventory
        - name: limit
          in: query
          schema:
            type: integer
            default: 20
        - name: offset
          in: query
          schema:
            type: integer
            default: 0
      responses:
        '200':
          description: Array of active public products
          content:
            application/json:
              schema:
                type: object
                properties:
                  success:
                    type: boolean
                    example: true
                  data:
                    type: array
                    items:
                      $ref: '#/components/schemas/Product'
                  count:
                    type: integer
                  limit:
                    type: integer
                  offset:
                    type: integer

  /public/products/{idOrSlug}:
    get:
      summary: Get single product detail
      tags:
        - Catalog
      parameters:
        - name: idOrSlug
          in: path
          required: true
          schema:
            type: string
          description: Numeric product ID or unique slug
      responses:
        '200':
          description: Product details with variants and supplier
          content:
            application/json:
              schema:
                type: object
                properties:
                  success:
                    type: boolean
                  data:
                    $ref: '#/components/schemas/ProductDetail'
        '404':
          description: Product not found

  /public/stores:
    get:
      summary: List published storefronts
      tags:
        - Stores
      responses:
        '200':
          description: List of active shop partner stores

  /public/stores/{idOrSlug}:
    get:
      summary: Get published storefront and items
      tags:
        - Stores
      parameters:
        - name: idOrSlug
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Store detail with published items

  /public/categories:
    get:
      summary: Get category hierarchy tree
      tags:
        - Categories
      responses:
        '200':
          description: Category list

  /public/orders:
    post:
      summary: Place a Cash on Delivery order for a customer (requires orders.create scope)
      tags:
        - Orders
      security:
        - ApiKeyAuth: []
      parameters:
        - name: Idempotency-Key
          in: header
          required: true
          description: Your unique id for this order, at most 200 characters, scoped to your API key. Retry with the same value.
          schema:
            type: string
            maxLength: 200
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/PartnerOrderRequest'
      responses:
        '201':
          description: Order created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PartnerOrderResponse'
        '200':
          description: Replay of an order already placed with this Idempotency-Key (header Idempotency-Replayed true)
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PartnerOrderResponse'
        '400':
          description: Invalid payload (VALIDATION_FAILED, details.field names the field), a payment method other than COD, or a missing Idempotency-Key (IDEMPOTENCY_KEY_REQUIRED)
        '401':
          description: Missing or invalid API key
        '403':
          description: Missing required scope orders.create
        '404':
          description: A product or variant does not exist or is not on sale (details.product_id / details.variant_id)
        '409':
          description: IDEMPOTENCY_MISMATCH — the key was already used for a different order (details.order_ref), or INSUFFICIENT_STOCK (details.product_ref, requested, available)
        '422':
          description: COD_OTP_REQUIRED — an SMS code was sent to the customer; repeat the same request with otp_code

components:
  securitySchemes:
    ApiKeyAuth:
      type: apiKey
      in: header
      name: X-Api-Key

  schemas:
    Product:
      type: object
      properties:
        id:
          type: integer
        ref:
          type: string
        slug:
          type: string
        title_en:
          type: string
        title_bn:
          type: string
        retail_price:
          type: number
        stock_quantity:
          type: integer
        is_in_stock:
          type: boolean
        category_name_en:
          type: string

    ProductDetail:
      allOf:
        - $ref: '#/components/schemas/Product'
        - type: object
          properties:
            description_en:
              type: string
            description_bn:
              type: string
            supplier_name:
              type: string
            variants:
              type: array
              items:
                type: object

    PartnerOrderRequest:
      type: object
      required:
        - customer
        - shipping_address
        - items
      properties:
        customer:
          type: object
          required:
            - name
            - phone
          properties:
            name:
              type: string
            phone:
              type: string
              description: Bangladeshi mobile number (01XXXXXXXXX, 8801XXXXXXXXX or +8801XXXXXXXXX). Identifies the buyer.
        shipping_address:
          type: object
          required:
            - division
            - district
            - address_line
          properties:
            division:
              type: string
            district:
              type: string
            upazila:
              type: string
            address_line:
              type: string
        items:
          type: array
          minItems: 1
          description: Lines for the same product and variant are added together.
          items:
            type: object
            required:
              - product_id
              - quantity
            properties:
              product_id:
                type: integer
              variant_id:
                type: integer
              quantity:
                type: integer
                minimum: 1
        payment_method:
          type: string
          enum: [COD]
          default: COD
        otp_code:
          type: string
          description: Only after a 422 COD_OTP_REQUIRED, the code the customer received by SMS.

    PartnerOrderResponse:
      type: object
      properties:
        success:
          type: boolean
        data:
          type: object
          properties:
            order:
              type: object
              properties:
                id:
                  type: integer
                ref:
                  type: string
                  example: ORD-8F2K1Q
                items_amount:
                  type: number
                shipping_amount:
                  type: number
                  description: The delivery charge per supplier parcel, times the number of parcels
                discount_amount:
                  type: number
                total_amount:
                  type: number
                  description: What the courier collects on delivery
                currency:
                  type: string
                  example: BDT
                payment_method:
                  type: string
                  example: COD
                payment_status:
                  type: string
                  example: PENDING
                is_otp_verified:
                  type: boolean
                recipient:
                  type: object
                  properties:
                    name:
                      type: string
                    phone:
                      type: string
                    division:
                      type: string
                    district:
                      type: string
                    upazila:
                      type: string
                      nullable: true
                    address_line:
                      type: string
                placed_at:
                  type: string
                  format: date-time
                sub_orders:
                  type: array
                  description: One parcel per supplier
                  items:
                    type: object
                    properties:
                      ref:
                        type: string
                      status:
                        type: string
                        example: PLACED
                      supplier_name:
                        type: string
                      shipping_amount:
                        type: number
                      total_amount:
                        type: number
                      items:
                        type: array
                        items:
                          type: object
                          properties:
                            product_id:
                              type: integer
                            product_ref:
                              type: string
                            variant_id:
                              type: integer
                              nullable: true
                            variant_sku:
                              type: string
                              nullable: true
                            title:
                              type: string
                            quantity:
                              type: integer
                            unit_price:
                              type: number
                            line_total:
                              type: number
```

---

## 4. Outbound Webhooks & HMAC Verification

### Webhook Headers
When Explooro dispatches a webhook event to your endpoint, the HTTP request includes:
- `X-Explooro-Event`: Name of the triggered event (e.g. `order.created`, `order.delivered`, `product.updated`, `payout.completed`).
- `X-Explooro-Delivery`: Unique Delivery UUID or ID.
- `X-Explooro-Signature`: `sha256=<hex_hmac_signature>`.
- `X-Explooro-Timestamp`: Epoch timestamp of dispatch.

### Signature Verification Example (Node.js)
```javascript
import crypto from 'node:crypto';

function verifyExplooroWebhook(rawBodyString, signatureHeader, secret) {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(rawBodyString)
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
}
```

---

## 5. Embeddable Product Widget Integration

Include Explooro's lightweight (<15KB) embeddable widget on any external website, blog, or CMS:

```html
<!-- Explooro Embeddable Product Showcase -->
<div id="explooro-widget-container"></div>
<script
  src="https://cdn.explooro.com/widget.js"
  data-container="#explooro-widget-container"
  data-store="apex-store"
  data-limit="4"
  data-theme="light"
  async>
</script>
```
