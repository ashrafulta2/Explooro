# Warranty REFUND over-refunds the whole sub-order

Status: **fixed 2026-10-15 with Option B** (supplier bears the warranty). §1–§4 below are the
original investigation, kept for the reasoning. What changed and what is still open is in §5.
Evidence: `server/test/warrantyRefundScope.test.js` (7 tests; 6 fail against the old code).

## 1. What happens

| Step | Code | Scope |
| :--- | :--- | :--- |
| Card | `030_warranty.sql` — `warranty_cards.order_item_id` `UNIQUE` | one **order item** |
| Claim | `warranty_claims.warranty_card_id` — no amount, no qty column | one card |
| Approve REFUND | `warranty.service.ts` `reviewWarrantyClaim` → `clawbackService.executeClawback(txClient, { subOrderId })` | passes only the **sub-order** |
| Clawback | `clawback.service.ts` `processReturnClawback` — debits every `escrow_entries` row of the sub-order and credits the customer the sum | whole **sub-order** |

Nothing between the claim and the ledger caps the amount. The claim query even selects
`oi.line_total`, then never uses it.

Reproduced: sub-order with a ৳1,000 TV and a ৳200 cable (escrow ৳1,260 incl. ৳60 shipping), claim on
the cable approved as REFUND → customer credited **৳1,260**, all three escrow rows (supplier, shop
partner, platform) marked `CLAWED_BACK`.

## 2. Related defects on the same path

1. **Second claim refunds nothing.** After one item's REFUND, every escrow row is `CLAWED_BACK`, so a
   later REFUND on another item of that sub-order returns `alreadyClawedBack` and credits ৳0 — yet
   the claim is still marked `APPROVED`. A later return on the sub-order hits the same early exit.
2. **Failures are swallowed.** The `executeClawback` call is wrapped in `try { } catch { console.warn }`,
   so a failed refund (e.g. `ESCROW_NOT_FOUND`) still marks the claim `APPROVED` with no money moved.
   The refund and the status change should succeed or fail together.
3. **Audit is mis-attributed.** No `approvedBy` is passed, so the `finance.clawback.execute` audit row
   has a null actor and `actorRole: 'admin'` even when a supplier approved it.
4. `refundCustomer: true` is ignored (harmless — the clawback always refunds).
5. **Released escrow is the normal case here, not the edge case.** Warranty runs for months; the
   return window is days. So a warranty REFUND almost always takes the "Post-Release" branch: it
   debits `AVAILABLE` and creates `negative_balance_recoveries` deficits for anyone who already
   withdrew — today that includes the shop partner and platform for items nobody claimed.

## 3. Fix options

All options: one transaction, `SELECT … FOR UPDATE` on the escrow rows and wallets (already done by
`ledgerService.recordTransactionGroup`), arithmetic in paisa via `pricing.service.ts`
`toPaisa`/`toBdtString`, `NUMERIC(14,2)` columns, an idempotency guard keyed on the claim id, and an
`audit_logs` row with before/after carrying the real actor. Remove the `try/catch` so a failed refund
rolls back the approval.

**Shared prerequisite — escrow can be partly clawed back.** `escrow_entries` is one row per
`(sub_order_id, wallet_id, beneficiary_role)` and its status is all-or-nothing. A partial refund needs
a migration: either a `clawed_back_amount NUMERIC(14,2) NOT NULL DEFAULT 0` column (status flips to
`CLAWED_BACK` only when it reaches `amount`), or a separate `escrow_adjustments` ledger
(`escrow_entry_id`, `amount`, `source_type`, `source_id`, `UNIQUE (source_type, source_id, escrow_entry_id)`).
The second gives idempotency for free and keeps `escrow_entries` immutable; it is the recommendation.
`processReturnClawback` must then claw back only the remaining amount, which also fixes defect 1.

### Option A — pro-rata partial clawback (mirrors a return)

New `processItemClawback(db, { subOrderId, orderItemId, sourceType, sourceId, approvedBy, client })`
in `clawback.service.ts`. Refund = the item's `line_total`. Each escrow row's share =
`row.amount × line_total / Σ line_total` in paisa, rounded with largest-remainder so the shares sum to
the refund exactly. Shipping is excluded from the base (it stays with the supplier) unless §4 Q3 says
otherwise.

- Plus: same economics as a return; every party loses exactly its cut of that item.
- Minus: needs the escrow-adjustment migration; the shop partner and platform lose margin for a
  product defect they did not cause.

### Option B — supplier bears the warranty

Refund = `line_total`, debited entirely from the **supplier** (its escrow row while LOCKED, else its
AVAILABLE balance with the existing deficit-recovery path). Shop partner and platform keep their cut.

- Plus: matches who issues the warranty (`warranty_cards.supplier_id`); simplest arithmetic (no
  split); a warranty claim never touches a shop partner's wallet.
- Minus: the supplier funds the retail price, i.e. more than it was paid for the item; a deficit is
  likelier.

### Option C — supplier bears its share, platform absorbs the rest

Supplier pays back its own per-item amount (`base_price × qty` + its wholesale margin); the platform
treasury covers the shop partner's and platform's slice. The customer still gets `line_total`.

- Plus: shop partner protected, supplier not over-charged.
- Minus: the platform pays for supplier defects; needs a setting/limit so it is not open-ended.

Recommendation: **Option A mechanics behind a module setting** that names who bears the
non-supplier slice (`pro_rata` | `supplier` | `platform`) — the business number lives in settings,
and A, B and C become one code path with three allocation rules. If a single answer is wanted now,
B is the smallest safe change.

## 4. Open business questions

1. On a warranty REFUND, does the **platform keep its margin**? Does the **shop partner keep its
   commission**? (Chooses A / B / C.)
2. If escrow was **already released** and the bearer has withdrawn, is a negative balance / deficit
   recovery acceptable, or should the platform front the refund and recover later?
3. Is **shipping** refunded on a warranty refund? (Today it is, for the whole sub-order.)
4. Is the refund always the full `line_total`, or may the reviewer set a lower amount (depreciation
   after months of use)? If so, `warranty_claims` needs a `refund_amount NUMERIC(14,2)` with
   `0 < refund_amount ≤ line_total`.
5. A card covers an order item with `qty > 1`. Does one claim refund all units or one?
6. Should a supplier be able to approve a REFUND alone, or is it a HIGH-risk action needing
   maker-checker like other money movements?
7. Refund destination: Explooro wallet (today) or the original payment method?

## 5. Resolution (2026-10-15)

Answers given: Q1 → **Option B**, only the supplier pays; Q3 → shipping is **not** refunded;
Q4 → the refund is always the full `line_total`.

| Defect | Now |
| :--- | :--- |
| Over-refund of the whole sub-order | `clawback.service.ts` `processWarrantyRefund` credits the customer the claimed item's `line_total` only |
| Shop partner and platform lose their cut | Only the supplier's wallet is debited |
| Second claim on the same sub-order refunds ৳0 | Escrow rows are no longer touched, so every item stays refundable |
| Failures swallowed | The `try/catch` is gone: a failed refund throws and the approval rolls back with it |
| Audit has a null actor | The `finance.clawback.execute` row carries the real approver and role |
| Same claim refunded twice | Refused with `CLAIM_ALREADY_REFUNDED` (the claim row is locked `FOR UPDATE`) |

**Why the supplier's AVAILABLE bucket even while escrow is LOCKED:** `escrow_entries` rows are
all-or-nothing, so debiting ESCROW would leave the full row to be released again later. Debiting
AVAILABLE nets out when that escrow releases, so no migration was needed. A shortfall is recorded in
`negative_balance_recoveries`, the same as a post-release return clawback.

### Still open

1. ~~Return after a warranty refund on the same sub-order~~ **Fixed 2026-10-15.**
   `processReturnClawback` subtracts the warranty refunds already credited on that sub-order from the
   customer's refund and repays that amount to the supplier, who funded it. Each party ends where a
   plain return leaves it. Any `negative_balance_recoveries` row from the warranty refund is closed
   by the `deficit_recovery` job once the supplier's balance is back (§6).
2. Q2 (platform fronting the refund instead of a supplier deficit), Q5 (`qty > 1`: one claim refunds
   all units today), Q6 (maker-checker for supplier-approved refunds) and Q7 (refund destination:
   wallet today) are unanswered.

## 6. Partial returns (2026-10-15)

The same defect existed for returns. `return.service.ts` computed `refund_amount` from the
returned items only, but `executeRefund` always ran `processReturnClawback`, which refunded the
whole sub-order. Decided: each party gives back its own pro-rata share of the returned items, and
shipping is not refunded on a partial return.

- **Two paths in `executeRefund`.** If every unit of every order item comes back, the old full
  clawback runs (shipping included). Otherwise `processPartialReturnClawback` runs.
- **Shares.** Each escrow row's goods-only amount (the supplier's minus shipping) is the weight.
  The refund is the escrowed goods value scaled by the returned items' retail value, so a discount
  is respected. Shares are split with largest-remainder rounding in paisa, so they sum exactly.
  They are debited from AVAILABLE and escrow is left alone, as for a warranty refund.
- **A later full return** nets out every earlier item refund (warranty or partial return): the
  customer gets the rest, and each wallet is repaid what it paid.
- **No double refund of a unit.** A partial return refuses an item already returned (more units
  than ordered across REFUNDED requests) or already refunded by warranty. A warranty REFUND
  refuses an item already returned.
- **Return protection** receives the shop partner's actual share via `clawedBackAmount`, because a
  partial return leaves the escrow row's status unchanged.

### Still open

1. One protection cover pays once. A partial-return claim consumes it, so a later full return on the
   same sub-order gets no protection payout.
2. ~~`negative_balance_recoveries` rows stay `PENDING`~~ **Fixed 2026-10-15.** The daily
   `deficit_recovery` job (`jobs/deficitRecovery.job.js` → `clawback.service.ts`
   `settleDeficitRecoveries`) marks them `PARTIALLY_RECOVERED` / `RECOVERED` as the wallet's balance
   climbs back. No money moves: the clawback already debited the full amount.

## 7. The remaining questions (answered 2026-10-15)

| Question | Answer | What the code does |
| :--- | :--- | :--- |
| Q5 `qty > 1` | One claim refunds **one unit** | `processWarrantyRefund` pays `line_total / qty`; the last unit takes the rounding remainder, so the units sum to `line_total`. Units already returned count against it, and a claim past the last unit is refused (`ITEM_ALREADY_REFUNDED`). A paid REFUND no longer blocks a new claim on the same card |
| Q6 supplier approves alone | **No** | A supplier's REFUND sets the claim to `ESCALATED` (resolution `REFUND` as a proposal) and moves no money. An admin approves or rejects it at **/admin/warranty-claims** (`support.warranty.override`, module `digital_warranty`), which calls the existing override endpoint. The supplier cannot change an escalated claim (`CLAIM_AWAITING_ADMIN`) |
| Q2 platform fronts a supplier deficit | **No** | Unchanged: the supplier's balance goes negative and `negative_balance_recoveries` records it; the daily `deficit_recovery` job closes it as the balance recovers |
| Q7 refund destination | **Wallet, for now** | Unchanged: every refund goes to the Explooro wallet. Customers cannot withdraw from it yet, so a refund is effectively store credit. Proposed for later: refund prepaid orders to the original payment method (the gateway adapters already expose `refund`, and `return_requests.preferred_resolution` already has `ORIGINAL_GATEWAY`), keep the wallet as an opt-in, and send COD refunds to the customer's bKash/Nagad number. Check the refund-medium rule in Bangladesh's Digital Commerce Operation Guidelines before launch |

Also fixed on the way: the supplier claims page posted to `/supplier/claims/:id/resolve`, a route only
the client mock answered, so resolving a claim failed against the live API. It now posts to
`/supplier/claims/:id/review` with the live body shape.

