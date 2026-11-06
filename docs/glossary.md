# Glossary: internal terms and what users read instead

> Prompt 13.6 (Phase 13, Guided Experience). Written 2026-11-04.
> Customers, Explooro partners and suppliers never see the words in the first column. They read the
> label in the second, in English and Bangla. Staff screens may keep a technical term only inside a
> "details" panel. `client/test/plainLanguage.test.js` fails if a banned term (marked ✗) appears in a
> string that a customer, Explooro partner or supplier screen reads.

| Internal term | Banned on user screens | What users read (en / bn) | One-line explanation |
| :--- | :---: | :--- | :--- |
| Escrow | ✗ | Held safely / নিরাপদে জমা | The shopper's money waits with Explooro until the order is delivered and the return window ends, then moves to the seller |
| B2B escrow, milestone settlement | ✗ | Protected bulk deal, paid in stages / সুরক্ষিত পাইকারি চুক্তি, ধাপে ধাপে পরিশোধ | A large order where the buyer's money is held and released to the supplier one agreed stage at a time |
| Vault | kept | Vault / ভল্ট | Your Explooro balance. Money you earned or added, which you can withdraw to bKash, Nagad or a bank. Kept because it is the product's own name, shown in the menu |
| Payout | ✗ | Withdrawal / টাকা তোলা (উত্তোলন) | Sending money from your Vault to bKash, Nagad or a bank |
| Fast payout | ✗ | Early withdrawal / আগাম উত্তোলন | Taking a delivered order's money before its return window ends, for a small fee |
| Ledger, double-entry | ✗ | Transaction history / লেনদেনের ইতিহাস | Every money movement in and out of your Vault |
| Sub-order | ✗ | Parcel / পার্সেল | The part of an order one supplier packs and ships; an order with two suppliers arrives as two parcels |
| SKU | ✗ | Product, product code / পণ্য, পণ্যের কোড | One product (or one size or colour of it) you sell |
| FEFO | ✗ | Expiry first / আগে মেয়াদ শেষ হবে এমনটা আগে | Pack from the batch that expires soonest, so nothing is wasted |
| Consignment | ✗ | Courier booking / কুরিয়ার বুকিং | Booking a courier to pick up a parcel |
| 3PL | ✗ | Courier / কুরিয়ার | The delivery company (Pathao, Steadfast, RedX) |
| KYC | ✗ | Identity check / পরিচয় যাচাই | Checking your NID (and trade licence for suppliers) before you sell |
| SLA | ✗ | Response time / উত্তরের সময়সীমা | How quickly a claim must be answered |
| T+3 | ✗ | 3 days after delivery / ডেলিভারির ৩ দিন পর | |
| Maker-checker | ✗ | Second approval / দ্বিতীয় অনুমোদন | A risky staff action that a second person must approve. Staff only |
| Risk tier | ✗ | Approval level / অনুমোদনের স্তর | How much approval an action needs. Staff only |
| Clearing wallet | ✗ | Outside-money account / বাইরের টাকার হিসাব | The account that records money entering or leaving through gateways and couriers. Staff only |
| Idempotency | ✗ | (never shown) | A safeguard so that pressing a button twice does not do the action twice |
| JIT access | ✗ | Temporary access / সাময়িক অনুমতি | Permission given for a limited time. Staff only |

## Staff screens (admin, moderator, editor)

Staff read the same plain words, in the labels below (Prompt 13.6 REQUIREMENT 2, "admin second").
A technical term may stay only as **data**: a ledger account code (`ESCROW:CUSTOMER_HOLD`), a CSV
column name (`sub_order_ref`), a URL path or an HTTP header. The second `describe` block of
`client/test/plainLanguage.test.js` checks every translated string a staff screen reads, the prose
written straight into staff pages, and the staff browser-tab titles.

| Internal term | Staff label (en / bn) |
| :--- | :--- |
| Escrow, escrow holdings | Held payments / আটকে রাখা টাকা |
| Escrow liability | Held until delivery / ডেলিভারি পর্যন্ত আটকে রাখা |
| Escrow sweep | Release all due / সময় হওয়া সব টাকা ছাড়ুন |
| B2B escrow | Protected bulk deals / সুরক্ষিত পাইকারি চুক্তি |
| Payout, payout queue | Withdrawal, withdrawal queue / উত্তোলন, উত্তোলনের সারি |
| Ledger, general ledger | Transaction records / লেনদেনের খাতা |
| Double-entry ledger integrity | Money records balance / টাকার হিসাব মিলছে কিনা |
| KYC verification | Identity checks / পরিচয় যাচাই |
| Maker-checker | Second approval / দ্বিতীয় অনুমোদন |
| JIT access | Temporary access / সাময়িক অনুমতি |
| Risk tier | Approval level / অনুমোদনের স্তর (the values LOW–CRITICAL stay) |
| SLA | Deadline / সময়সীমা |
| Sub-order | Parcel / পার্সেল |
| Consignment ID | Tracking ID / ট্র্যাকিং আইডি |
| SKU | Product code / পণ্যের কোড |
| FEFO | Expiry first / আগে মেয়াদ শেষ হবে এমনটা আগে |
| 3PL | Courier / কুরিয়ার |

## Rules for new copy

1. Say what happens next, not how the system works: "Your money is held safely until the order is
   delivered", not "Funds are locked in escrow".
2. Error messages say what to do: "Add a phone number to continue", not "Validation failed: phone".
3. A form field has a one-line helper under it, saying what to type and why.
4. A status badge has a tooltip saying what happens next for that status.
5. A term from this table that a user must learn (Vault) is explained the first time it appears on a
   page, in the helper or the page subtitle.
