# Journeys per role

> Prompt 13.1 (Phase 13, Guided Experience). Written 2026-11-03.
> The data copy of this map is [`client/src/config/journeys.ts`](../client/src/config/journeys.ts);
> [`client/test/journeys.test.js`](../client/test/journeys.test.js) fails if the two disagree on a step
> or a dead end, if a route is not registered or not reachable by the role, or if a string is missing
> in either locale.

A journey is the ordered list of steps that takes one role from first login to its **first real
success**. The Next-Step engine (Prompt 13.2) answers "what should this user do now?" by walking
the list and returning the first step whose fact is still false.

The server keeps its own copy in
[`server/src/config/journeys.ts`](../server/src/config/journeys.ts), adding each page's permission and
module. Each fact is one SQL statement in `server/src/repositories/nextStep.repository.ts`, and
`server/test/nextStep.test.js` fails if the two copies disagree. The current step is always the
*first* step not done, even when later steps are done. On the seeded local database the dev
customer has orders and a review but no saved address, so their card asks for the address first.

## 1. Rules

**Done is a fact, never a tick.** Every step names one fact (`doneWhen`) that the server checks
against real rows. A fact is **user**-scoped (about the signed-in user) or **platform**-scoped
(about the whole platform: a setting saved, a first category). Platform facts are shared, so the
first admin to complete one completes it for all. Facts are monotonic: once true they stay true
(`customer.cart_started` also counts any placed order, because checkout empties the cart).

**One page per step.** Each step has exactly one `route`, the page that completes it. Two steps
may share a page (the moderator's claim and decide both happen in the queue).

**Blocked is not skipped.** `blockedBy` names who the user is waiting on. 13.2 reports the reason
and what the user can do meanwhile; it never offers a button that will fail.

| Block | Meaning |
| :--- | :--- |
| `kyc_review` | An admin must approve the KYC first |
| `product_review` | A moderator must approve the product first |
| `waiting_for_buyer` | Only a shopper can complete it; the user can promote meanwhile |
| `waiting_for_delivery` | The supplier and courier must deliver first |
| `balance_empty` | Nothing to withdraw until money reaches the vault |

**A step is skipped only under a documented rule** (13.1 REQUIREMENT 3):

| Rule | Meaning |
| :--- | :--- |
| `module_off` | The step's page belongs to a module that is switched off. The test requires this rule on every step whose sidebar item has a non-`core` module |
| `not_delegated` | Staff only (moderator, editor, admin). The user was never given the permission the step's page needs. Staff permissions are delegated person by person, so a moderator without disputes has no dispute step |

A step that does not apply to a role is simply absent from that role's journey. Customers have no
KYC step: shoppers are never asked to verify identity.

## 2. The journeys

Columns: **Step** (`role.id`), **Page**, **Done when** (fact → what the server checks), **What happens
next** (the `next` sentence, in short), **Waits on** (blocks and skip rules).

### 2.1 Customer: first delivered and reviewed order

| # | Step | Page | Done when | What happens next | Waits on |
| :- | :--- | :--- | :--- | :--- | :--- |
| 1 | `customer.verify_phone` | `/auth/otp` | `user.phone_verified`: `users.is_phone_verified` | Order updates and delivery calls go to this number | |
| 2 | `customer.add_address` | `/account/addresses` | `user.address_saved`: a `user_addresses` row | Checkout fills it in next time | |
| 3 | `customer.fill_cart` | `/` | `customer.cart_started`: a cart item, or any order | Find a product and tap Add to cart | |
| 4 | `customer.place_order` | `/checkout` | `customer.order_placed`: any `orders` row | Choose COD or online payment and confirm | |
| 5 | `customer.receive_order` | `/account/orders` | `customer.order_delivered`: a `DELIVERED` sub-order on their order | Supplier packs it, courier brings it | `waiting_for_delivery` |
| 6 | `customer.write_review` | `/account/reviews` | `customer.review_written`: a `reviews` row | The review helps other shoppers | `module_off` |

### 2.2 Shop Partner: first withdrawal

| # | Step | Page | Done when | What happens next | Waits on |
| :- | :--- | :--- | :--- | :--- | :--- |
| 1 | `saler.verify_phone` | `/auth/otp` | `user.phone_verified` | Shoppers and suppliers reach them on it | |
| 2 | `saler.submit_kyc` | `/seller/kyc` | `kyc.submitted`: a `kyc_verifications` row in any status | An admin checks it; they set up the store meanwhile | `module_off` |
| 3 | `saler.name_store` | `/saler/store-builder` | `saler.store_named`: `virtual_stores` has slug and shop name | Shoppers can find the store | `module_off` |
| 4 | `saler.add_products` | `/saler/sourcing` | `saler.three_products`: ≥ 3 active `saler_store_items` | Suppliers hold the stock and ship | `module_off` |
| 5 | `saler.share_store` | `/saler/social-kit` | `saler.link_created`: a `short_links` row | Post the link or flyer on Facebook / WhatsApp | `module_off` |
| 6 | `saler.first_order` | `/saler/orders` | `saler.order_received`: a sub-order as `saler_id` | Keep sharing; orders show up here | `waiting_for_buyer` |
| 7 | `saler.first_withdrawal` | `/saler/vault/payouts` | `wallet.payout_requested`: a `payout_requests` row | Send vault money to bKash or Nagad | `balance_empty` |

The Shop Partner copy says nothing about how partners are paid. Partners are shown no reward
mechanics (owner decision, 2026-11-02).

### 2.3 Supplier: first withdrawal from a shipped order

| # | Step | Page | Done when | What happens next | Waits on |
| :- | :--- | :--- | :--- | :--- | :--- |
| 1 | `supplier.verify_phone` | `/auth/otp` | `user.phone_verified` | Shop partners and couriers reach them on it | |
| 2 | `supplier.submit_kyc` | `/seller/kyc` | `kyc.submitted` | Listing opens once an admin approves | `module_off` |
| 3 | `supplier.add_product` | `/supplier/products` | `supplier.product_listed`: a product not `ARCHIVED` | Add photos, price and stock | `kyc_review` (product.service answers `KYC_REQUIRED` until the KYC is `VERIFIED`) |
| 4 | `supplier.stock_product` | `/supplier/inventory` | `supplier.product_live`: an `ACTIVE` product with `stock_qty > 0` | A moderator checks each new product | `product_review` |
| 5 | `supplier.first_order` | `/supplier/orders` | `supplier.order_received`: a sub-order as `supplier_id` | Shop partners sell it; orders show up here | `waiting_for_buyer` |
| 6 | `supplier.ship_order` | `/supplier/fulfilment` | `supplier.order_shipped`: a `shipments` row on their sub-order | Book a courier, or record a hand delivery | `module_off` |
| 7 | `supplier.first_withdrawal` | `/supplier/vault` | `wallet.payout_requested` | Withdraw once the order is delivered and settled | `balance_empty` |

### 2.4 Moderator: first decided item

| # | Step | Page | Done when | What happens next | Waits on |
| :- | :--- | :--- | :--- | :--- | :--- |
| 1 | `moderator.enable_2fa` | `/auth/2fa` | `staff.two_factor_enrolled`: `staff_2fa.enrolled_at` set | Sign-in asks for a code from the phone app | |
| 2 | `moderator.claim_item` | `/moderator/queue` | `moderation.item_claimed`: `moderation_queue.claimed_by` or `decided_by` is them | No one else works the same item | `module_off`, `not_delegated` |
| 3 | `moderator.decide_item` | `/moderator/queue` | `moderation.item_decided`: `decided_by` is them | Give a reason on reject | `module_off`, `not_delegated` |
| 4 | `moderator.decide_dispute` | `/moderator/disputes` | `moderation.dispute_decided`: audit `orders.dispute.arbitrate*` by them | Decide who gets the money | `module_off`, `not_delegated` |
| 5 | `moderator.decide_return` | `/moderator/returns` | `staff.return_decided`: audit `returns.request.approve/reject` by them | Check photos and reason | `module_off`, `not_delegated` |

### 2.5 Editor: first published content

| # | Step | Page | Done when | What happens next | Waits on |
| :- | :--- | :--- | :--- | :--- | :--- |
| 1 | `editor.enable_2fa` | `/auth/2fa` | `staff.two_factor_enrolled` | Sign-in asks for a code | |
| 2 | `editor.publish_banner` | `/editor/banners` | `content.banner_live` (platform): an active `banners` row | Every shopper sees it on the home page | `not_delegated` |
| 3 | `editor.publish_story` | `/editor/stories` | `content.story_published`: a `PUBLISHED` story as `author_id` | Stories link straight to products | `module_off`, `not_delegated` |
| 4 | `editor.publish_whats_new` | `/editor/whats-new` | `content.release_note_published` (platform): `release_notes.published_at` set | Tell users what changed | `module_off`, `not_delegated` |
| 5 | `editor.save_translation` | `/editor/translations` | `content.translation_saved`: audit `translation.upsert` by them | Bangla and English say the same thing | `module_off`, `not_delegated` |

### 2.6 Admin: queues that hold sellers back

| # | Step | Page | Done when | What happens next | Waits on |
| :- | :--- | :--- | :--- | :--- | :--- |
| 1 | `admin.enable_2fa` | `/auth/2fa` | `staff.two_factor_enrolled` | Sign-in asks for a code | |
| 2 | `admin.review_kyc` | `/admin/verification` | `admin.kyc_reviewed`: `kyc_verifications.reviewed_by` is them | Suppliers cannot list until approved | `module_off`, `not_delegated` |
| 3 | `admin.review_product` | `/admin/catalog/moderation` | `admin.product_reviewed`: a `PRODUCT_NEW`/`PRODUCT_EDIT` queue row decided by them | Approved products go live | `module_off`, `not_delegated` |
| 4 | `admin.review_payout` | `/admin/finance/payouts` | `admin.payout_reviewed`: audit `finance.payout.approve_request/reject` by them | Sellers wait on this for their money | `not_delegated` |
| 5 | `admin.decide_return` | `/admin/returns` | `staff.return_decided`: audit `returns.request.approve/reject` by them | Check photos and reason | `module_off`, `not_delegated` |

### 2.7 Super Admin: platform set-up, then the first live product

| # | Step | Page | Done when | What happens next | Waits on |
| :- | :--- | :--- | :--- | :--- | :--- |
| 1 | `super_admin.enable_2fa` | `/auth/2fa` | `staff.two_factor_enrolled` | Protect the owner account first | |
| 2 | `super_admin.choose_language` | `/admin/platform/language` | `platform.language_chosen`: audit `platform.localization.update` | New visitors see this language first | |
| 3 | `super_admin.set_delivery` | `/admin/platform/delivery` | `platform.delivery_set`: audit `platform.delivery.update` | Shoppers see the zone charge at checkout | |
| 4 | `super_admin.set_operations` | `/admin/platform/operations` | `platform.operations_set`: audit `platform.operations.update` | Start by hand, go automatic later | |
| 5 | `super_admin.add_category` | `/admin/catalog/categories` | `platform.category_exists`: a `categories` row | Suppliers file products under it | |
| 6 | `super_admin.invite_staff` | `/admin/staff` | `platform.staff_invited`: audit `staff.account.create` | Hand day-to-day reviews to staff | |
| 7 | `super_admin.verify_supplier` | `/admin/verification` | `platform.supplier_verified`: a `VERIFIED` `SUPPLIER` KYC | The supplier can start listing | `module_off` |
| 8 | `super_admin.first_product_live` | `/admin/catalog/moderation` | `platform.product_live`: an `ACTIVE` product | Shoppers can start buying | `module_off` |

Settings steps use an audit row, not the settings row, because migrations seed defaults and the row
always exists. An audit row proves someone actually chose the value.

## 3. Dead-end backlog

Actions that today finish on a bare toast or a plain list, with no suggested next action. Prompt
13.3 must clear every one. Until a journey step says otherwise, its result panel offers the
follow-up below. Each row is also data (`DEAD_ENDS` in `journeys.ts`, hint `journey.dead_end.<id>`).

| # | Id | Role | Action | Ends today in | Today | Intended follow-up |
| :- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `checkout` | Customer | Order placed | `pages/CheckoutPage.ts` | Toast, then the order page with nothing on what happens next | `/account/orders`: "we will tell you when it ships" |
| 2 | `address_saved` | Customer | Address saved | `pages/customer/AddressesPage.ts` | Toast; stays on the list | `/`: find something to buy |
| 3 | `become_saler` | Shop Partner (was a customer) | Became a Shop Partner | `pages/customer/BecomeSalerPage.ts` | Toast "your digital store is active"; stays on the upgrade page | `/saler/store-builder`: name the store |
| 4 | `kyc_saler` | Shop Partner | KYC submitted | `pages/seller/KycSubmissionPage.ts` | Toast; stays on the form | `/saler/store-builder`: set up the store while the admin checks |
| 5 | `kyc_supplier` | Supplier | KYC submitted | `pages/seller/KycSubmissionPage.ts` | Toast; nothing says listing waits on approval | `/supplier/store-status`: shop details while waiting |
| 6 | `product_added_saler` | Shop Partner | Product added to store | `components/saler/AddToStoreDrawer.ts` | Toast; drawer closes on the sourcing list | `/saler/social-kit`: share it |
| 7 | `product_added_supplier` | Supplier | Product added | `pages/admin/CatalogProductsPage.ts` | Toast "Product registered in catalog!"; nothing says it waits on review | `/supplier/inventory`: check stock while it is reviewed |
| 8 | `withdrawal_requested` | Shop Partner | Withdrawal requested | `pages/saler/WithdrawalsPage.ts` | Toast; stays on the form | `/saler/vault`: follow the request |
| 9 | `order_shipped` | Supplier | Order shipped | `pages/supplier/FulfilmentPage.ts` | Toast "consignment booked"; stays on the list | `/supplier/shipments`: follow the parcel |

Not yet inspected, and 13.3 must check them before applying `ActionResult`: store published, return
approved, sample requested, ad campaign created (the other four of 13.3's nine actions).

## 4. Findings

Things found while mapping. None is fixed in 13.1; each names the prompt that should.

- **F1. KYC is hard to find.** `/seller/kyc` and `/account/kyc` are registered routes but not sidebar
  items. The only link is on the profile page. The Next-Step card (13.2) becomes the main way in;
  13.5 should decide whether it earns a `core` slot for suppliers.
- **F2. A Shop Partner's KYC gates nothing today.** `product.service` refuses a supplier listing with
  `KYC_REQUIRED`, but no Shop Partner action checks KYC, payouts included. The step stays in the
  journey (the owner's own example lists it), with no `kyc_review` block on later Shop Partner
  steps. If partner payouts should wait on KYC, that is a server change, not a journey change.
- **F3. Banners and What's New notes have no author.** `banners` has no `created_by` and banner
  creation writes no audit row (only `banner.delete` does); `release_notes` has no author either. So
  `content.banner_live` and `content.release_note_published` are platform facts: once any editor
  publishes one, every editor's step is done.
- **F4. Payment gateway set-up has no data fact.** 13.4 lists "payment gateways" among the admin
  set-up items, but gateways are configured through `.env`, and `/admin/platform/integrations`
  writes nothing to check. No step is invented for it. 13.4 should either read the integration
  status the server already reports or leave it out.
- **F5. The old Shop Partner checklist disagrees on "shared".** `GET /saler/onboarding`
  (`salerDashboard.service.ts`) counts sharing as done only after a link is *clicked*, which the
  partner does not control. The journey counts the partner's own act: a link created. 13.2 replaces
  that logic and keeps the endpoint answering from this map.
- **F6. File names in the prompts are out of date.** Phase 13 was specified when the client was
  `.js`; the files are now `.ts` (`journeys.ts`, `navigation.ts`). The test file stays `.js` like
  every other client test.
