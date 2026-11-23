# Legal document templates

Fill-in templates for the four documents published at **/admin/platform/legal**:

| File | `doc_key` | Who must agree |
| :--- | :--- | :--- |
| [terms.md](terms.md) | `terms` | Everyone |
| [privacy.md](privacy.md) | `privacy` | Everyone |
| [refund.md](refund.md) | `refund` | Read only (part of the Terms) |
| [partner-agreement.md](partner-agreement.md) | `partner_agreement` | Explooro partners |

Version 1 of each document is already live (seeded by migrations 104 and 106). These templates
are the fuller, standard version to complete and publish as the next version.

## The three kinds of marking

| Marking | Meaning | What you do |
| :--- | :--- | :--- |
| `[[FILL: ...]]` | Information only you know (a licence number, a name, a date) | Replace the whole `[[...]]` with the real value |
| `[[CHOOSE: A / B]]` | A business decision with standard options | Keep one option, delete the rest and the brackets |
| `[[LAWYER: ...]]` | A point a Bangladeshi lawyer must confirm | Ask, fix the sentence if needed, then delete the note |

Before publishing, search the text for `[[`. **Nothing marked `[[` may remain.** If one is
missed it is shown to users exactly as written, so it is easy to spot but embarrassing.

## Do not touch `{{...}}`

`{{company.legal_name}}`, `{{company.address}}`, `{{company.trade_license}}`,
`{{company.support_email}}`, `{{company.support_phone}}`, `{{returns.window_days}}`,
`{{returns.max_courier_refund}}` and `{{returns.pickup_fee}}` are filled in automatically by the
platform when the document is shown. Fill the company details once in the *Company details* card
on /admin/platform/legal; the return numbers come from the returns settings. Never type those
values into the text, or the document will drift from what the platform really does.

## Publishing

1. Complete every `[[...]]` in both the English and the Bangla body.
2. At /admin/platform/legal, choose the document, paste the title and the two bodies.
3. Tick **everyone must agree again** only when what people agree to has changed (the first time
   you publish these templates, it has).
4. Write a short change note, e.g. "Full version reviewed by our lawyer."

The text format is small: `## Heading`, blank-line paragraphs, `- ` list items and `**bold**`.
Nothing else is rendered.

## Words users never read

These documents are read by customers, partners and suppliers, so the words in
[`docs/glossary.md`](../glossary.md) (escrow, payout, KYC, SKU, ledger, …) are not used. Keep it
that way when you edit.
