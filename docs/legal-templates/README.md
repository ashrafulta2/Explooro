# Legal document templates

**The live text is in the app.** Migration 113 published these five templates as version 2 of each
document. After that, the app is the source of truth: edit the details at
**/admin/platform/legal**, and publish new versions there. These files are the marked-up working
copy, useful to send to a lawyer, because they still show every decision (`[[CHOOSE]]`) and every
point to check (`[[LAWYER]]`).

| File | `doc_key` | Who must agree |
| :--- | :--- | :--- |
| [terms.md](terms.md) | `terms` | Everyone |
| [privacy.md](privacy.md) | `privacy` | Everyone |
| [refund.md](refund.md) | `refund` | Read only (part of the Terms) |
| [partner-agreement.md](partner-agreement.md) | `partner_agreement` | Explooro partners |
| [supplier-agreement.md](supplier-agreement.md) | `supplier_agreement` | Suppliers |

## How each marking became part of the app (migration 113)

| Marking | In the published text | Where the owner changes it |
| :--- | :--- | :--- |
| `[[FILL: ...]]` | A `{{company.<field>}}` token | The *Company details* card at /admin/platform/legal. Any time; it changes every document at once and asks nobody to agree again |
| `[[CHOOSE: A / B]]` | The option that matches what the platform does today (below) | Publish a new version with the other option |
| `[[LAWYER: ...]]` | Left out of the text | Listed on each document's card as *Check with your lawyer before launch* |

On the admin page, **Show where details go** draws the current text with every token marked:
green filled, yellow default in use, red still empty, grey set by the platform. Required details
that are empty are also listed at the top of the page and outlined in the form.

### The choices migration 113 made

| Document | Choice |
| :--- | :--- |
| Terms | Customers spend Vault money on Explooro (no withdrawal to bKash/Nagad); no arbitration clause before court |
| Privacy | No advertising cookies from other companies (true as of 2026-11-23: no analytics or pixel script is loaded) |
| Refund | Refunds go to the Vault only; no "refund to bKash/Nagad on request" line; no extra non-returnable category |
| Partner Agreement | Partners advertise with the Explooro name only through Explooro's ad tools |
| Supplier Agreement | Parcels go the way the supplier's shipments page shows (courier or sent by hand); no extra fee line; courts, not arbitration; no extra banned category |

### The details (tokens) and their form fields

`{{company.X}}` reads field `X`, or for a pair the `X_en` / `X_bn` fields (the Bangla text falls back
to English). The full list, with each field's bounds and whether it is required, is
`COMPANY_FIELDS` in `server/src/services/legal.service.ts`. Time limits start at the figures these
templates suggested; everything only the owner knows (business type, DBID, e-TIN/BIN, support hours,
service providers, data location, supplier documents, record-keeping years) starts empty.

Never type these values into a document's text. `{{returns.window_days}}`,
`{{returns.max_courier_refund}}` and `{{returns.pickup_fee}}` come from the returns settings.

## Publishing a new version

1. At /admin/platform/legal, open the document and choose **Publish a new version**. It starts
   from the current text, tokens included.
2. Tick **everyone must agree again** only when what people agree to has changed.
3. The server refuses a text that still contains `[[FILL`, `[[CHOOSE` or `[[LAWYER`
   (`LEGAL_MARKING_LEFT`), so a marking copied from these files can never reach a reader.

The text format is small: `## Heading`, blank-line paragraphs, `- ` list items and `**bold**`.
Nothing else is rendered.

## Words users never read

These documents are read by customers, partners and suppliers, so the words in
[`docs/glossary.md`](../glossary.md) (escrow, payout, KYC, SKU, ledger, …) are not used. Keep it
that way when you edit.
