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

1. ~~**Team-purchase completion**~~ — **fixed 2026-10-09**, see below.
2. **Partner orders** (`POST /public/orders`) call `orderService.createOrder`, which does not exist.
   The check cannot see this, because it is a JavaScript error, not SQL.
3. **Maker-checker approval** has no registered executor for `finance.payout.approve`,
   `orders.cod.reconcile`, `orders.dispute.arbitrate`, `users.kyc.approve` or
   `finance.escrow.release_manual`. Submitting now works; what approving does depends on each
   feature's own approve path, which was not reviewed here.
4. The 99 statements built with `${...}` are still not checked.

## Fix log (2026-10-09, team purchase)

Decisions from the product owner: the form asks for the recipient's name and an address only; a
super admin sets the shipping charge; Wallet stays as a payment option.

- **Completion works.** When the last member joins, every member gets a real order
  (`orders` → `sub_orders` → `order_items`) of one unit at the group price plus the shipping charge,
  in the join's transaction. Stock is deducted then (FEFO batch first). If the product ran out or
  was paused, the join is refused whole. Verified against a migrated, seeded database: two orders,
  stock 120 → 118, escrow of ৳1,310 (supplier) + ৳153 (platform) = the ৳1,463 order total, and zero
  drift between `wallets` and `ledger_transactions`.
- **Form: name + address only.** The phone on the order is the buyer's account phone. Division and
  district are read from the address text (`server/src/lib/bdDistricts.js`, English or Bangla
  names). If no district is named they are left empty; the full address is in `address_line`
  either way.
- **Shipping charge is a setting.** `shipping_charge` (and one discount per team size, and the
  window) live in the `group_buying` module's `settings_json`. A super admin edits them at
  `/admin/growth/group-buy`. The page used to be hard-coded demo numbers and a sweep button that
  only showed a toast. Each team snapshots the charge when it starts (`team_purchases.shipping_charge`).
- **Wallet.** Joining with Wallet moves group price + shipping from AVAILABLE to HELD in the
  member's own wallet (`TEAM_PURCHASE_HOLD`). On completion the hold is released and the order's
  escrow deposit spends it, and the order is PAID. On expiry the hold goes back
  (`TEAM_PURCHASE_RELEASE`). `orders.payment_method` now accepts `WALLET` (migration 068).
- **Price.** The group price is computed on the server from settings. It is floored at the
  supplier's wholesale cost (base cost + wholesale margin) and never read from the request.
- **bKash/Nagad "authorization hold"** was removed from the team form. No such hold existed, and the
  client never calls the payment endpoints. Only COD and Wallet are offered.
- **Smaller fixes found on the way:**
  - The public team detail no longer returns each member's address.
  - `GET /team-purchases` (the open-teams list the modal reads) now exists on the server.
  - Error codes are documented ones: `TEAM_NOT_FOUND` and the others used to answer HTTP 500.
  - Start and join now check `can_place_order`.
- **Not team-purchase, found while taking screenshots:**
  - Product gallery images that 404'd re-requested themselves in a tight loop (6,600 requests in a
    few seconds). This used up the API's rate limit and locked the visitor out of signing in. Fixed
    in `ImageGallery.js`. Three `onerror` handlers pointed at a missing `/placeholder.svg` and had
    the same loop.
  - A rate-limited request answered HTTP 500 instead of 429. Fixed in `app.js`.

### Found, not fixed (outside this change)

All three were fixed the same day — see the next section.

## Fix log (2026-10-09, payments, delivery charge, COD gate)

Screenshots: `docs/screenshots/fixes-2026-10-09/`.

- **Paid orders now lock escrow.**
  - `payment.service.js` passed `cache` where depositToEscrow expects its params and hid the throw.
    It also called `orderRepo.findSubOrdersByOrderId`, which does not exist.
  - Found while verifying: every payment endpoint answered 500. The controllers read
    `req.server.pg`, which is undefined (the pool is `req.server.db`). `paymentGateway.test.js`
    decorated `pg`, so it passed anyway.
  - Found while verifying: an order with no saler still has a `saler_commission`. That share was
    debited from the buyer and credited to nobody, so the ledger refused the group. With no saler
    wallet, the platform now keeps that share (`vault.service.js`).
  - The deposit is funded by the platform treasury wallet, not the shopper's wallet. The money came
    from bKash/Nagad/card, so the shopper's Explooro balance must not drop. COD orders, deposited at
    delivery by `shipment.service.js`, do the same; before this, every delivered COD order pushed
    the customer's wallet below zero.
  - A retry (execute again, webhook replay, reconcile sweep) now locks escrow for a paid order that
    has none. It never re-locks a refunded or already-escrowed sub-order.
  - Verified on the database: orders 26 and 27 (bKash via the mock gateway, ৳1,730 each) hold ৳1,330
    supplier + ৳400 platform = ৳1,730 escrow. The customer's wallet is unchanged, with zero drift.
- **Delivery charge is a setting.**
  - A super admin sets it at `/admin/platform/delivery`. The permission is `platform.delivery.update`
    (CRITICAL). It is stored in `platform_settings` as `delivery.per_parcel_charge` (migration 069).
  - Checkout, the server cart, the local cart estimate, Quick Buy and the mock cart all read it. Each
    change writes an audit row and is listed on the page.
  - Verified: after setting ৳80, a two-supplier cart shows ৳160, and checkout charged ৳80 on a
    one-parcel order.
- **COD trust / OTP gate, shared.**
  - `services/codGate.service.js` is used by checkout and by team-purchase start/join.
  - Checkout's gate never worked:
    - its SMS sender was a no-op;
    - the OTP row was written on the transaction that the COD_OTP_REQUIRED throw then rolled back;
    - wrong-code attempts were rolled back too, so the 5-attempt limit never held.
  - The OTP is now written and checked on the pool.
  - Team-purchase members keep `is_otp_verified` / `trust_score_at_join`, and they are copied onto
    the order.
  - Verified: a customer with trust 10 joining with COD was asked for the code (screenshot 04).
    After entering it, their order has `is_otp_verified = true` and `trust_score_at_order = 10`.

### Found, not fixed

The two items first listed here were fixed in the next round (below).

## Fix log — 2026-10-09 (second round)

Screenshots: `docs/screenshots/fixes-2026-10-09-b/`.

- **The Escrow admin page shows real escrow.**
  - `/admin/finance/escrow` read `holdings` from a response that only carried `escrow_entries`. It
    fell back to four made-up orders (SO-99820-1 …). The sweep and "Release now" buttons only
    changed those rows in the browser.
  - `services/escrowAdmin.service.js` now returns one row per sub-order with:
    - the customer, supplier and saler names;
    - the supplier/saler/platform split;
    - the status and the time left.
  - The summary covers all held escrow, not just the page. The return window comes from the
    `returns_engine` module. The list is paged and has a status filter and search.
    `escrow_entries` is still sent for older callers.
  - The sweep calls the real job. "Release now" calls the new
    `POST /admin/finance/escrow/:subOrderId/release`. Both need `finance.escrow.release_manual`
    (CRITICAL). Both write an audit row, and a single release needs a reason.
  - A COD row is not offered for release until the courier's cash is reconciled, because
    `releaseEscrow` refuses it.
  - Verified: the page lists the six held orders from the database. Releasing ORD-STNHSY7Q-1 (৳1,463) moved
    ৳1,310 to the supplier and ৳153 to the treasury. An audit row was written with the reason. The
    ledger is HEALTHY with zero drift.
- **Outside money has its own account; the treasury shows profit.**
  - Migration 070 adds an `EXTERNAL_CLEARING` system wallet. `wallets.user_id` may now be NULL
    when `system_key` is set, and a CHECK requires exactly one of the two.
  - Gateway payments (`payment.service.js`) and delivered COD orders (`shipment.service.js`) fund
    escrow from it. A completed payout (`payout.service.js`) credits it. Before this, all three used
    the treasury, which showed −৳13,460 on the dev database while the platform was in profit.
  - The migration moves what the treasury already carried for outside money onto the clearing
    wallet. It does this as one balanced, append-only ADJUSTMENT group that cannot run twice.
  - The dispute subsidy now uses the real treasury, not a hard-coded user 1.
  - The finance overview shows two new cards:
    - "Platform treasury" shows the treasury's spendable balance and its share still in escrow;
    - "Outside money owed to people" shows the clearing balance, sign flipped.
  - Verified: a new bKash order (৳1,730) took ৳1,730 from the clearing wallet. ৳400 went to the
    treasury's escrow, and its spendable balance stayed ৳0 instead of going negative. The customer's
    wallet did not change.
  - Local data only: two manual "test funding" adjustments from earlier sessions were also moved to
    the clearing wallet. They were outside money too.

### Found, not fixed

- `/admin/finance/overview` "Total escrow liability" sums wallets with `user_id <> 1`. That leaves
  out the treasury's own escrow share, and it assumes the treasury is user 1.
- The Bangla escrow page shows counts in Latin digits ("7 দিন"), because `t()` does not localise
  numbers. The money amounts are localised.
- Earlier entries: partner orders, maker-checker executors (see above).
