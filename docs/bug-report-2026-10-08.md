# Bug report — SQL/schema mismatch audit (2026-10-08)

**Status:** found, NOT fixed. This file only records what was found.

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

## Suggested follow-up

1. Fix each statement against the real schema (most are 1-word renames).
2. Add a CI test that applies migrations to a throwaway Postgres and `PREPARE`s every static SQL
   string (the script used here is ~25 lines) so this class of bug cannot reach `main` again.
3. Stop swallowing errors with bare `catch {}` around restriction/audit queries.
