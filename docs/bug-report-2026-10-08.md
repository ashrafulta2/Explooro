# Bug report — SQL/schema mismatch audit (2026-10-08)

**Status (2026-10-09):** fixed except team-purchase completion and partner order creation — see
"Fix log" at the end. `npm run check:sql --workspace server` now runs the check below in CI.

## How it was found

`npm test` passes (client 806, server 1164), so none of these are caught by the suite — the tests
mock the database. To find them, all migrations (001–066) were applied to a real PostgreSQL 16, then
every static SQL template literal in `server/src` (954 statements; 94 with `${}` interpolation were
skipped) was `PREPARE`d against that schema. A statement that names a table or column that does not
exist fails at prepare time. The same class of bug as commit `f731b05` (`releaseEscrow` selecting a
non-existent `sub_orders.payment_method`).

Real column names, for reference: `order_items.qty` (not `quantity`), `products.stock_qty` (not
`stock_quantity`), `orders` has **no** `status` / `user_id` / `delivery_address_json` (it has
`customer_id`, `payment_status`, `recipient_*`, `division`, `district`, `upazila`, `address_line`),
`sub_orders.saler_id` (not `saler_user_id`), `pending_admin_actions.action_key` (no `action_type` /
`risk_tier`), `user_restrictions` is subject-based (`subject_type`, `subject_ref`, `capability_key`,
`mode`), `notifications` has `template_key` (no `type`), `audit_logs` has `actor_id` / `target_type` /
`before_json` (no `user_id` / `entity_type` / `before_state`).

Caveat: "Throws" below means no enclosing `try` was found near the query — confirm by reading the
call site before fixing. Two prepare-time failures were judged false positives and are omitted
(`order.repository.js` `listUserOrders` GROUP BY, built at runtime; `wallet.repository.js` /
`staff.repository.js` fragments).

## Critical — money / order flow

| # | Where | Problem |
|---|-------|---------|
| 1 | `services/payment.service.js:231` (`executePayment`) | `UPDATE orders SET … status = 'CONFIRMED'` — `orders.status` does not exist. The payment transaction is already marked `SUCCESS` just above, so the gateway has the money but the order stays unpaid and the call throws. Verified directly against the DB. |
| 2 | `services/return.service.js:107` | `SELECT quantity FROM order_items` → column is `qty`. Creating any return request fails. Verified. |
| 3 | `services/return.service.js:432` | `UPDATE products SET stock_quantity …` → `stock_qty`. Refund/restock fails. Verified. |
| 4 | `services/return.service.js:273`, `services/shipment.service.js:64`, `services/warranty.service.js:443` | `o.delivery_address_json` does not exist on `orders`. Return approval, shipment creation and warranty claims fail. |
| 5 | `services/shipment.service.js:327,333` | `order_items.quantity` / `products.stock_quantity` (same as 2–3) — cancelling a shipment fails to restore stock. |
| 6 | `services/payout.service.js:116` | `SELECT can_withdraw … FROM user_restrictions WHERE user_id` — table is subject-based; withdrawal requests throw. |
| 7 | `services/return.service.js:178` | `user_restrictions.user_id` does not exist. |
| 8 | `services/teamPurchase.service.js:213` | `INSERT INTO orders (user_id, order_ref, status, …)` — none of those columns exist (`customer_id`, `ref`, …). Team-purchase completion cannot create orders. Also `:76` selects `name_en` which does not exist. |
| 9 | `services/leaderboard.service.js:30,43` | `sub_orders.saler_user_id` → `saler_id`. Leaderboard aggregation fails. |
| 10 | `services/coupon.service.js:184` | `orders.status != 'CANCELLED'` — no such column; first-order-only coupon validation fails. |

## High — maker-checker / staff actions

`pending_admin_actions` inserts use `action_type` / `risk_tier`; the table has `action_key`:
`services/b2bEscrow.service.js:447`, `services/codReconciliation.service.js:319`,
`services/dispute.service.js:670`, `services/kyc.service.js:397`, `services/payout.service.js:282`.
Also `b2bEscrow.service.js:612` (`disputes` table — real one is `dispute_threads`) and
`codReconciliation.service.js:90` (`consignments` table does not exist).

## High — customer/public surfaces

- `controllers/publicApi.controller.js:26` (`p.retail_price`), `:120` (`saler_stores`), `:172` (`icon_url`)
- `controllers/salerInbox.controller.js:67`, `services/whatsappCommerce.service.js:360` (`base_price` on products)
- `services/content.service.js:143` (`retail_price`, `stock_quantity` on products)
- `controllers/sitemap.controller.js:103` (`is_published`), `:127` (`status`)
- `controllers/supplier.controller.js:82,511,532` (`physical_shop_status` relation)
- `repositories/review.repository.js:57` (`review_media.created_at`) — adding review media fails
- `services/prerender.service.js:87` (`supplier_profiles` relation)
- `services/dispute.service.js:365` (GROUP BY — may be a runtime-built query; verify)

## Silent failures (error swallowed by `try/catch`, feature quietly doesn't work)

These are arguably worse, because nothing is reported:

- `services/chat.service.js:138` — `can_chat` restriction check always errors → **restricted users are never blocked from chat**.
- `services/moderation.service.js:479` — shadow-ban insert never succeeds.
- `services/surgePricing.service.js:371` — **audit log for accepting a surge price is never written** (violates CLAUDE.md constraint 11).
- `services/inventory.service.js:189` — batch-expiry notification never created.
- `services/dispute.service.js:465` — courier events never appear in the dispute timeline.
- `services/customerPortal.service.js:140,152` — active warranties and team purchases always show 0.
- `controllers/moderatorDashboard.controller.js:83,104` — dashboard sections empty.

## Correction: the "silent" ones were worse than they looked

A failed statement inside a transaction aborts the transaction, even when JavaScript catches the error.
Every later query then fails with "current transaction is aborted", and a `COMMIT` turns into a
silent `ROLLBACK`. So in practice:

- `chat.service.js` — every message send failed, not just the restriction check.
- `surgePricing.service.js` — accepting a surge price was rolled back. The price never changed.
- `moderation.service.js` — a verdict with "shadow restrict seller" ticked failed outright.

## Suggested follow-up (original)

1. Fix each statement against the real schema (most are 1-word renames).
2. Add a CI test that applies migrations to a throwaway Postgres and `PREPARE`s every static SQL
   string (the script used here is ~25 lines) so this class of bug cannot reach `main` again.
3. Stop swallowing errors with bare `catch {}` around restriction/audit queries.

## Fix log (2026-10-09)

Every item above was fixed against the real schema, except the two listed under "Still open".
`npm test` passes (client 806, server 1164). The tests whose mock database matched the old, wrong
SQL text were updated to the new SQL. The new check prepares 895 statements with no unexpected
failures.

How the less obvious ones were fixed:

- **Order address** (`return`, `shipment`, `warranty`): `orders` stores the address as columns, so
  the query now builds `delivery_address_json` with `jsonb_build_object(division, district, upazila,
  address_line)`.
- **Restrictions** (`chat`, `payout`, `return`, `moderation`): these use `subject_type = 'USER'`,
  `subject_ref IN (users.id::text, users.ref)`, `capability_key` and `mode`, and ignore lifted rows.
  The payout limit reads `max_withdrawal_per_day.limit_value`. The bare `try/catch` around the
  chat and moderation statements was removed, for the reason given in the correction above.
- **Return-abuse auto block**: no system user exists, so `applied_by` is the customer.
  `evidence_json` marks the block as `automated`, and a second block is not inserted while one is
  active. Note that `can_return` is not in `VALID_CAPABILITIES` and nothing enforces it yet.
- **Maker-checker inserts** (`payout`, `cod`, `dispute`, `kyc`, `b2b`): these now use `action_key`,
  `target_type`, `target_ref` and `expires_at`. The risk tier comes from the permission. B2B uses
  the catalog key `finance.escrow.release_manual`, because `b2b_escrow.release` is not a
  permission. Payout, COD and B2B expire after `PENDING_ACTION_EXPIRY_HOURS` (exported from
  `middlewares/requirePermission.js`).
- **B2B dispute**: now creates a `dispute_threads` row, with the evidence as a `dispute_messages`
  row. `dispute_threads.sub_order_id` is NOT NULL, so a deal with no sub-order gets its milestones
  frozen and is marked DISPUTED, but gets no thread.
- **Supplier showroom status**: the `physical_shop_status` table never existed. Migration
  `067_physical_shop_status.sql` creates it.
- **Public API / WhatsApp / inbox / stories / prerender**: products have no image column. Images now
  come from `product_images` → `media_assets`. Prices come from `default_retail_price`, never
  `base_price` (supplier cost), which WhatsApp product cards were about to send to customers.
  `/public/products/:id` and the prerendered product page no longer select `p.*`. The prerendered
  JSON-LD carried an invented "4.8 stars, 14 reviews" for every unrated product; it now carries the
  stored rating, or none.
- **Leaderboard**: uses `sub_orders.saler_id`, skips direct sales (no saler), and values revenue as
  `total_amount - shipping_amount + discount_share`.
- **First-order coupon**: an order counts unless every one of its sub-orders is CANCELLED.

### Still open — needs a product decision

1. **Team-purchase completion** (`teamPurchase.service.js` `joinTeamPurchase`) still inserts into
   non-existent `orders` columns, so no team can complete. Building real orders needs:
   - recipient name, phone, division and district (the client sends only `{ street }`);
   - a shipping rule;
   - a decision on the WALLET payment option, which the UI offers and `orders.payment_method`
     rejects.

   `group_price` is also taken from the request body with no floor. This failure is the one entry
   in `KNOWN_FAILURES` in `server/src/db/checkSql.js`.
2. **Partner orders** (`POST /public/orders`) call `orderService.createOrder`, which does not exist.
   The check cannot see this, because it is a JavaScript error, not SQL.
3. **Maker-checker approval** has no registered executor for `finance.payout.approve`,
   `orders.cod.reconcile`, `orders.dispute.arbitrate`, `users.kyc.approve` or
   `finance.escrow.release_manual`. Submitting now works; what approving does depends on each
   feature's own approve path, which was not reviewed here.
4. The 99 statements built with `${...}` are still not checked.
