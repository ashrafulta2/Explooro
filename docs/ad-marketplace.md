# The Ad Marketplace

How Explooro sells advertising, who sets the prices, and how the money moves.

Prompt 9.1 shipped one thing a seller could buy: a sponsored search slot, priced by whatever CPC
bid the seller typed in. There was no catalogue, no second format, and no way for the platform to
say what an ad costs. This document describes what replaced that.

---

## 1. The shape of it

```
ad_products  ──(bought as)──▶  ad_campaigns  ──(charged via)──▶  ledger_transactions
   │                                │                                    │
   │ rate_card JSONB                │ quote_json (frozen at purchase)    │ AD_SPEND
   │ edited by growth.ad.govern     │ billing_mode: PREPAID | METERED    │ seller → platform
   │                                │
   └── FLAT_DAILY / FLAT_SLOT also reserve ad_slot_bookings (one row per slot per day)
```

Three ideas carry the whole feature:

1. **A format is data, not code.** Every sellable ad is a row in `ad_products`. Its commercial
   terms live in a `rate_card` JSONB that an administrator edits from a page. Adding a tenth format
   that prices like an existing one is a row, not a deploy.
2. **One pricing engine.** `server/src/services/adPricing.js` computes every ad price the platform
   ever shows or charges — the seller's live wizard preview, the binding quote frozen onto the
   campaign, each metered click or thousand views, and the "from ৳450/day" label on the card. It
   works in integer paisa, so ৳0.35 × 1000 is exactly ৳350.00.
3. **Two ways to be billed.** Formats that rent a position are **PREPAID**: paid in full at
   purchase, inventory reserved. Formats that buy attention are **METERED**: nothing upfront,
   charged as results arrive, capped by a budget.

---

## 2. The nine formats

| Key | Format | Surface | Model | Ships at |
| :-- | :-- | :-- | :-- | :-- |
| `search_boost` | Search Boost | Search results | CPC | floor ৳1.00/click |
| `product_page_ads` | Competitor Page Ads | Other sellers' product pages | CPC | floor ৳1.50/click |
| `feed_promotion` | Home Feed Promotion | Home feed | CPM | ৳80 / 1,000 views |
| `category_banner` | Category Banner Takeover | Top of one category | FLAT_DAILY | ৳450/day, min 3 days, 4 positions |
| `home_spotlight` | Homepage Spotlight | Homepage hero carousel | FLAT_DAILY | ৳1,500/day, 5 positions |
| `store_boost` | Storefront Boost | Store directory | FLAT_DAILY | ৳180/day, min 7 days, 8 positions |
| `live_spotlight` | Live Stream Spotlight | Live lobby | FLAT_SLOT | ৳600/stream, 3 positions |
| `flash_slot` | Flash Sale Featured Slot | Homepage flash strip | FLAT_SLOT | ৳2,000/slot, 6 positions |
| `push_blast` | Push Notification Blast | Shopper notifications | CPS | ৳0.35/recipient, min 1,000 |

Those numbers are **starting prices only** — the defaults a fresh install boots with. From the
first edit onward the rate-card editor owns them, and re-running the migration never overwrites an
admin's price (the seed is `ON CONFLICT DO NOTHING`).

A sixth pricing model, **CPA** (a percentage of each attributed sale), is implemented in the quote
engine and accepted by the schema, but is deliberately **not seeded as a purchasable format**:
order attribution has no hook yet, so selling it would mean promising an ad the platform cannot
bill for. Seeding a `CPA` row is the last step of wiring it, not the first.

---

## 3. Who sets the price

`growth.ad.govern` — HIGH risk tier, delegable. That combination is the point: a Super Admin can
hand ad pricing to one named staff member without handing over anything else, and because the
permission is HIGH risk it flows through the maker-checker path like every other high-risk grant.

The holder opens **`/admin/growth/ad-pricing`** and edits, per format:

- the rate for its model (floor + suggested CPC, CPM rate, daily rate, slot rate, per-recipient rate);
- commercial floors — minimum budget, minimum/maximum days, minimum/maximum quantity;
- how many positions exist per day, for formats that reserve one;
- service fee % and VAT %;
- the loyalty discount each trust tier receives (Starter / Verified Trader / Elite Partner);
- whether the format is on sale at all, and whether it needs creative review.

Every save writes an `audit_logs` row with a before/after pair. Every value is re-validated
server-side by `validateRateCard()` against `RATE_CARD_FIELDS`, so an out-of-range price cannot be
stored and then silently used to bill someone.

**Raising a rate never re-prices a campaign already sold.** The quote is frozen onto
`ad_campaigns.quote_json` at purchase.

---

## 4. What a seller sees

`/saler/ads` has two tabs.

**Ad Store** lists every format the seller's role may buy, as a card carrying its real price, its
billing style ("charged as results come in" vs "paid upfront, slot reserved"), and any loyalty
discount their tier earns.

**The wizard** is three steps, each asking one question:

1. *What are you promoting?* — name, headline, description, keywords or category, banner.
2. *How big and how long?* — budget presets for metered formats, day chips for rentals, slot or
   recipient counts for the rest. Most sellers never type a number.
3. *Confirm and pay* — an itemised quote: line items, tier discount, service fee, VAT, total, and a
   button that says exactly what will happen ("Pay ৳2,992.50 from vault" or "Start campaign (cap
   ৳1,000.00)").

The wizard re-quotes through `POST /ads/quote` on every change, debounced. It never multiplies a
rate itself, so the number on the button is the number the purchase charges.

---

## 5. How the money moves

**Prepaid (FLAT_DAILY, FLAT_SLOT, CPS).** Inside one transaction: insert the campaign and creative
→ reserve the slot days → debit the seller's vault and credit the platform treasury as a balanced
double-entry `AD_SPEND` group → write the `ad_billing` row. Reservation happens *before* the
charge, so a sold-out run fails before the seller is charged for a placement they cannot have. An
empty vault fails the purchase with a message naming the shortfall.

**Metered CPC.** Unchanged from 9.1: second-price auction, self-click and duplicate-click fraud
checks, charge bounded by the remaining budget, campaign marked `COMPLETED` at the cap.

**Metered CPM.** Settles on whole thousands of viewable impressions — the unit the seller was
quoted. A partial final thousand is never charged; the rounding goes to the advertiser. If the
vault is short at settlement the campaign is **paused**, not failed, so the seller can top up and
resume while the platform stops delivering views it cannot bill for.

---

## 6. Inventory

Reserved placements expand to one `ad_slot_bookings` row per slot per day, uniquely indexed on
`(slot_key, slot_index, booking_date)`. Two sellers racing for the last homepage position cannot
both win: the second insert violates the index and the whole purchase rolls back.

A booking holds the *same* `slot_index` for its entire run, so a seller's banner does not hop
between positions mid-campaign. `slot_key` is the placement name, except category banners, which
are per-category (`CATEGORY:42`) so two sellers can each own a banner in different categories.

Cancelling a campaign releases every booking from today forward — the platform can resell those
days. It issues **no refund** for the unused tail; that is a money movement an administrator
decides on through the vault's existing adjustment flow, and the audit row records exactly what was
given up.

---

## 7. Serving

`runAuction()` serves metered formats and explicitly excludes `billing_mode = 'PREPAID'` — a
placement already paid for must never be put back into an auction it could lose.
`listReservedPlacements()` (`GET /ads/reserved`) is its counterpart: it returns the bookings for a
surface on a date, in slot order.

**Known gap:** `listReservedPlacements()` is correct but not yet called by anything. No homepage
hero, category banner, store directory, live lobby, flash strip or push sender reads it, so a
prepaid placement is reserved and billed but does not yet appear to shoppers. Wiring each surface
to it is the next piece of work, and it is one call per surface.

---

## 8. Files

| Layer | File |
| :-- | :-- |
| Schema | `server/src/db/migrations/041_ad_marketplace.sql` |
| **Pricing — the only place ad money is multiplied** | `server/src/services/adPricing.js` |
| Catalogue policy, availability, rate-card writes | `server/src/services/adProducts.service.js` |
| SQL | `server/src/repositories/adProduct.repository.js` |
| Purchase, billing, serving | `server/src/services/ads.service.js` |
| Routes | `server/src/routes/ads.routes.js` |
| Seller Ad Store + wizard | `client/src/pages/saler/AdCampaignPage.js` |
| Admin rate cards | `client/src/pages/admin/AdminAdPricingPage.js` |
| Styles (route chunk, never `main.css`) | `client/src/styles/components/ad-store.css` |
| Mocks | `client/src/mocks/handlers/ads.js` |
| Tests | `server/test/adPricing.test.js` |
