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
| `catalog.stores.read` | Read-only access to published seller stores and curated items |
| `catalog.categories.read` | Read-only access to categories and navigation trees |
| `orders.create` | Write permission to inject partner orders on behalf of customers |
| `webhooks.manage` | Permission to register, update, and inspect webhook endpoints |

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
          description: List of active seller stores

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
      summary: Place a partner order (requires orders.create scope)
      tags:
        - Orders
      security:
        - ApiKeyAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/PartnerOrderRequest'
      responses:
        '201':
          description: Order created successfully
          content:
            application/json:
              schema:
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
                          total_amount:
                            type: number
                          status:
                            type: string
        '400':
          description: Invalid request payload
        '403':
          description: Missing required scope orders.create

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
        - items
        - shipping_address
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
            email:
              type: string
        items:
          type: array
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
        shipping_address:
          type: object
          required:
            - address_line
            - city
          properties:
            address_line:
              type: string
            city:
              type: string
            district:
              type: string
            postal_code:
              type: string
        payment_method:
          type: string
          enum: [COD, PREPAID]
          default: COD
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
