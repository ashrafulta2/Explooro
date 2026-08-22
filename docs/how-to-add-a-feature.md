# How To Add a Feature — a worked example

> **Produced by:** Prompt 0.8
> **Read this once.** It teaches the entire project convention faster than any amount of prose,
> because it walks one small, real feature through **every** layer.
>
> The example: **product tags** — free-text labels a supplier adds to a product, which shoppers can
> filter by. Small enough to follow completely; large enough to touch the database, the API, the
> permission model, the module registry, the UI, both locale files, and the tests.
>
> ⚠️ This walkthrough assumes Phases 1–4 are complete. Adapt the step order to what actually exists
> — check the traceability matrix in [`prompt.md`](prompt.md).

---

## The 14 steps

```
 1 Decide the layer            8 Client: API method
 2 Permission                  9 Client: UI component
 3 Module flag                10 Locale strings (BOTH files)
 4 Migration                  11 Gallery registration
 5 Repository                 12 Tests
 6 Service                    13 Docs
 7 Controller + route         14 Verify
```

Skipping any of 2, 3, 10, 11, or 13 produces code that works today and rots quietly. Those are the
steps that get dropped under time pressure, which is exactly why they are numbered.

---

## Step 1 — Decide the layer

Ask three questions before writing anything:

| Question | For product tags |
| :--- | :--- |
| Is this a **business rule**, or plumbing? | Business rule — there are limits and validation |
| Does it move **money or stock**? | No. So no transaction, no ledger, no invariant risk |
| Who is allowed to do it? | Suppliers on their own products; admins on any |

Business logic goes in `services/`. **Never in a controller.**

---

## Step 2 — Permission

**Never invent a permission key in code.** It will not resolve — `rbac.service.js` reads from the
seeded `permissions` table, which is generated from the catalog.

Add to `docs/permission-catalog.json`:

```json
{
  "key": "catalog.tag.manage",
  "domain": "catalog",
  "label_en": "Manage product tags",
  "label_bn": "পণ্যের ট্যাগ ব্যবস্থাপনা",
  "risk_tier": "LOW",
  "delegable": true,
  "default_roles": ["supplier"]
}
```

**Choosing the tier** (`rbac-spec.md` §2). Tags are low-consequence and reversible, and a supplier
editing their own product's tags needs no oversight → `LOW`. Had this been "delete any seller's
tags", it would be `HIGH` and would route through maker-checker automatically — by changing one
field, not by writing approval code.

`LOW` entries omit `plain_en` / `plain_bn` by rule: they are role defaults and never appear in a
Request Access modal.

Re-seed: `npm run migrate` (Prompt 2.2's loader validates the catalog and fails on any violation).

---

## Step 3 — Module flag

Every feature route needs a module. Either reuse an existing one or add a toggle.

Tags are part of the catalog, not a separable feature, so reuse `core`. If it were separable — say
`product_tags` with a `max_tags_per_product` setting — you would add it to
`server/src/config/modules.seed.json` **and** `docs/module-registry.md`, and get the ON/OFF switch,
targeting, and dependency handling for free.

> **The magic-number rule.** A limit like "10 tags maximum" belongs in module settings or
> `platform_settings`, never in code. If you find yourself typing a number a business person might
> want to change, stop and put it in configuration.

---

## Step 4 — Migration

New file, next number. **Never edit an applied migration** — the runner verifies checksums and will
refuse to proceed.

`server/src/db/migrations/025_product_tags.sql`:

```sql
-- Product tags: free-text labels for discovery and filtering.
-- WHY a join table rather than a text[] column on products: tags need their own usage counts for
-- the "popular tags" filter, and a normalised table makes that a cheap indexed query.

CREATE TABLE tags (
  id          BIGSERIAL PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,
  label_en    TEXT NOT NULL,
  label_bn    TEXT NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE product_tags (
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  tag_id     BIGINT NOT NULL REFERENCES tags(id)     ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, tag_id)
);

CREATE INDEX ON product_tags (tag_id);        -- every FK gets an index
CREATE INDEX ON tags (usage_count DESC) WHERE usage_count > 0;
```

Conventions applied (`erd.md` §0): `BIGSERIAL` id · `TIMESTAMPTZ` · explicit `ON DELETE` on both
FKs (`CASCADE` for the owned child, `RESTRICT` so a tag in use cannot vanish) · `CHECK` on the
count · both language labels · an opening comment saying **what and why**.

Run: `npm run migrate`

---

## Step 5 — Repository — SQL only

`server/src/repositories/tag.repository.js`

```js
/**
 * Tag persistence. SQL only — no business rules, no validation.
 * Every query is parameterised. Never interpolate a client value into SQL.
 */
export function makeTagRepository(db) {
  return {
    async findBySlugs(slugs) {
      const { rows } = await db.query(
        `SELECT id, slug, label_en, label_bn FROM tags WHERE slug = ANY($1)`, [slugs]
      );
      return rows;
    },

    async createMany(tags, client = db) {
      const { rows } = await client.query(
        `INSERT INTO tags (slug, label_en, label_bn)
         SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[])
         ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
         RETURNING id, slug`,
        [tags.map(t => t.slug), tags.map(t => t.label_en), tags.map(t => t.label_bn)]
      );
      return rows;
    },

    async setForProduct(productId, tagIds, client = db) {
      await client.query(`DELETE FROM product_tags WHERE product_id = $1`, [productId]);
      if (tagIds.length) {
        await client.query(
          `INSERT INTO product_tags (product_id, tag_id) SELECT $1, UNNEST($2::bigint[])`,
          [productId, tagIds]
        );
      }
      await client.query(
        `UPDATE tags SET usage_count = (SELECT count(*) FROM product_tags WHERE tag_id = tags.id)
         WHERE id = ANY($2) OR id IN (SELECT tag_id FROM product_tags WHERE product_id = $1)`,
        [productId, tagIds]
      );
    },
  };
}
```

Note `client = db`: every write accepts an optional transaction client so the service can compose
these calls inside one transaction.

---

## Step 6 — Service — all the business logic

`server/src/services/tag.service.js`

```js
import { withTransaction } from '../config/db.js';
import { ApiError } from '../plugins/errorHandler.js';

/**
 * Product tag rules.
 * Invariant: a product has at most MAX_TAGS distinct tags, and tags.usage_count always
 * equals the real number of product_tags rows referencing that tag.
 */
export function makeTagService({ tagRepo, productRepo, settings, audit }) {
  const slugify = (s) => s.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  //                                              ↑ \p{L} keeps Bengali letters. [a-z0-9] would
  //                                                silently delete every Bengali tag.

  return {
    async setProductTags(productId, rawTags, actor) {
      const product = await productRepo.findById(productId);
      if (!product) throw new ApiError('NOT_FOUND', { message_en: 'Product not found.' });

      // Ownership. Admins bypass via catalog.product.edit_any, checked in the middleware.
      if (product.supplier_id !== actor.id && !actor.can('catalog.product.edit_any')) {
        throw new ApiError('PERMISSION_DENIED', { details: { permission_key: 'catalog.product.edit_any' } });
      }

      // WHY from settings: "10" is a business decision, not a constant.
      const maxTags = await settings.get('max_tags_per_product', 10);

      const normalized = [...new Map(
        rawTags.map((t) => [slugify(t.label_en || t.label_bn), t])
      ).values()].filter((t) => slugify(t.label_en || t.label_bn));

      if (normalized.length > maxTags) {
        throw new ApiError('VALIDATION_FAILED', {
          message_en: `A product can have at most ${maxTags} tags.`,
          message_bn: `একটি পণ্যে সর্বোচ্চ ${maxTags}টি ট্যাগ থাকতে পারে।`,
          details: { max: maxTags, given: normalized.length },
        });
      }

      return withTransaction(async (client) => {
        const before = await tagRepo.findForProduct(productId, client);
        const created = await tagRepo.createMany(
          normalized.map((t) => ({ slug: slugify(t.label_en || t.label_bn), ...t })), client
        );
        await tagRepo.setForProduct(productId, created.map((c) => c.id), client);

        await audit.record({
          action: 'catalog.tag.manage',
          target_type: 'product', target_ref: product.ref,
          before: { tags: before.map((t) => t.slug) },
          after:  { tags: created.map((t) => t.slug) },
        });

        return created;
      });
    },
  };
}
```

Five conventions in one file: settings not constants · both-language errors · `ApiError` with a
catalogued code · one transaction · an audit row with before/after.

---

## Step 7 — Controller + route

Controller — **HTTP in, HTTP out. Nothing else.**

```js
// server/src/controllers/tag.controller.js
export function makeTagController({ tagService }) {
  return {
    async setProductTags(req, reply) {
      const tags = await tagService.setProductTags(req.params.id, req.body.tags, req.user);
      return reply.send({ data: { tags } });          // api-contract.md §2.1 envelope
    },
  };
}
```

Route — path, schema, and **all three guards**:

```js
// server/src/routes/tag.routes.js
export default async function tagRoutes(app, { tagController }) {
  app.put('/api/v1/products/:id/tags', {
    preHandler: [
      app.requireModule('core'),
      app.requirePermission('catalog.tag.manage'),
      app.requireRestriction('can_list_products'),
    ],
    schema: {
      params: { type: 'object', required: ['id'],
                properties: { id: { type: 'string', pattern: '^\\d+$' } } },
      body: {
        type: 'object', required: ['tags'],
        additionalProperties: false,                   // ← mandatory, always
        properties: {
          tags: {
            type: 'array', maxItems: 20,
            items: {
              type: 'object', additionalProperties: false,
              required: ['label_en', 'label_bn'],
              properties: {
                label_en: { type: 'string', minLength: 1, maxLength: 40 },
                label_bn: { type: 'string', minLength: 1, maxLength: 40 },
              },
            },
          },
        },
      },
    },
  }, tagController.setProductTags);
}
```

`maxItems: 20` above the service's limit of 10 is deliberate: the schema stops absurd payloads
cheaply; the service returns the real, configurable business error.

No `Idempotency-Key` here — this endpoint moves no money and is naturally idempotent (it sets the
full tag list rather than appending).

---

## Step 8 — Client API method

```js
// client/src/services/catalog.api.js
import { api } from '../core/api.js';

export async function setProductTags(productId, tags) {
  const { tags: saved } = await api.put(`/products/${productId}/tags`, { tags });
  return saved;
}
```

`api.js` handles the JWT, envelope unwrapping, and typed `ApiError`. **Never call `fetch` directly
from a component** — you would lose auth refresh, error typing, and the mock/live switch.

---

## Step 9 — UI component

```js
// client/src/components/product/TagEditor.js
import { Input } from '../ui/Input.js';
import { Badge } from '../ui/Badge.js';
import { t } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { can } from '../../services/permissions.js';
import { setProductTags } from '../../services/catalog.api.js';

export function TagEditor({ productId, initialTags = [], maxTags = 10 }) {
  const el = document.createElement('div');
  el.className = 'tag-editor';

  if (!can('catalog.tag.manage')) {
    el.append(TagList({ tags: initialTags, readonly: true }));
    return el;                                        // read-only, not hidden
  }

  let tags = [...initialTags];

  async function commit() {
    const previous = [...tags];
    render();                                          // optimistic
    try {
      tags = await setProductTags(productId, tags);
      render();
    } catch (err) {
      tags = previous;                                 // roll back
      render();
      toast.error(err.message_bn ?? err.message_en);
    }
  }

  function render() { /* badges + input + empty state */ }
  render();
  return el;
}
```

Conventions: existing `ui/` primitives, not new markup · `PermissionGate` semantics (locked, not
hidden) · optimistic update with rollback · `t()` for every string · a designed empty state.

---

## Step 10 — Locale strings — **both files**

`client/src/locales/en.json`
```json
{ "product": { "tags": {
  "label": "Tags",
  "placeholder": "Add a tag…",
  "empty": "No tags yet. Tags help shoppers find this product.",
  "limit_reached": "You've reached the {{max}} tag limit.",
  "removed": "Tag removed"
} } }
```

`client/src/locales/bn.json`
```json
{ "product": { "tags": {
  "label": "ট্যাগ",
  "placeholder": "ট্যাগ যোগ করুন…",
  "empty": "এখনো কোনো ট্যাগ নেই। ট্যাগ থাকলে ক্রেতারা সহজে এই পণ্য খুঁজে পাবেন।",
  "limit_reached": "আপনি {{max}}টি ট্যাগের সীমায় পৌঁছেছেন।",
  "removed": "ট্যাগ সরানো হয়েছে"
} } }
```

**A string in one file and not the other is an incomplete change.** Write natural Bengali for a
Bangladeshi shopkeeper — not a word-for-word translation of the English.

---

## Step 11 — Gallery registration

```js
// client/src/pages/dev/gallery-registry.js
import { TagEditor } from '../../components/product/TagEditor.js';

export const registry = [
  // …
  { group: 'Product', name: 'TagEditor', states: {
      default:   () => TagEditor({ productId: 1, initialTags: [{ slug: 'cotton', label_bn: 'সুতি' }] }),
      empty:     () => TagEditor({ productId: 1, initialTags: [] }),
      readonly:  () => TagEditor({ productId: 1, initialTags: [], readonly: true }),
      atLimit:   () => TagEditor({ productId: 1, initialTags: tenTags }),
  } },
];
```

**Same commit as the component.** `/dev/gallery` is how anyone reviews states — light/dark,
en/bn, comfortable/compact, 360px — without hunting for a product that happens to be in the right
state.

Then run `/dev/craft`: press feedback, focus ring, nested radius, tabular numerals, layout-matching
skeleton. It must report zero findings.

---

## Step 12 — Tests

```js
// server/tests/services/tag.service.test.js
describe('tag.service', () => {
  it('rejects more tags than the configured maximum', async () => {
    settings.set('max_tags_per_product', 3);
    await expect(svc.setProductTags(1, fourTags, supplier))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('preserves Bengali characters in slugs', async () => {
    const [tag] = await svc.setProductTags(1, [{ label_en: '', label_bn: 'সুতি' }], supplier);
    expect(tag.slug).toBe('সুতি');            // guards the \p{L} regex
  });

  it('deduplicates tags that normalise to the same slug', async () => {
    const out = await svc.setProductTags(1, [{ label_en: 'Cotton' }, { label_en: ' cotton ' }], supplier);
    expect(out).toHaveLength(1);
  });

  it('refuses a supplier editing another supplier product', async () => {
    await expect(svc.setProductTags(otherProductId, [{ label_en: 'x' }], supplier))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('keeps usage_count consistent after replacing tags', async () => {
    await svc.setProductTags(1, [a, b], supplier);
    await svc.setProductTags(1, [b], supplier);
    expect(await countFor(a)).toBe(0);
    expect(await countFor(b)).toBe(1);        // the invariant from the service docblock
  });
});
```

**Test the invariant you wrote in the docblock**, plus the Bengali case. The slug regex is exactly
the kind of thing a future refactor "simplifies" to `[a-z0-9]` — the test is what stops it.

---

## Step 13 — Docs

| File | Update |
| :--- | :--- |
| `docs/erd.md` | Add `tags` and `product_tags` under §3 Catalog; bump the count in §14 |
| `docs/permission-catalog.json` | Already done in step 2 |
| `docs/architecture-map.md` | Add a "where do I change X?" row: *add a product tag rule → `services/tag.service.js`* |
| `docs/prompt.md` | Update the traceability matrix row honestly |
| `CLAUDE.md` | Only if a **convention** changed. Adding a feature is not a convention change |

---

## Step 14 — Verify

```bash
npm run dev          # both processes start; Vite ready < 500ms
npm run migrate      # applies cleanly, idempotent on re-run
npm test             # all green
npm run build        # succeeds and stays under the 150KB / 40KB budget
```

Then in the browser:

- [ ] `/dev/gallery` → TagEditor renders all four states, light **and** dark, en **and** bn
- [ ] `/dev/craft` → zero findings
- [ ] Supplier can add tags to their own product; a second supplier cannot
- [ ] Exceeding the limit shows the configurable message in Bengali
- [ ] `/admin/security/audit` shows the change with a before/after diff
- [ ] 360px width: no horizontal scroll
- [ ] Keyboard-only: reachable, visible focus ring

---

## What this example did not need

Worth naming, so you can tell when you **do** need them:

| Not needed here | Needed when |
| :--- | :--- |
| `Idempotency-Key` | The endpoint moves money or creates an order |
| A transaction with `SELECT … FOR UPDATE` | You mutate a balance or stock |
| A ledger entry | Money moves. Then it is double-entry, always |
| Maker-checker | The permission is `HIGH` tier — set the tier, get the flow free |
| A new module flag | The feature is separately toggleable by the business |
| A new error code | No existing code in `api-contract.md` §3 fits |
| A mock driver | You are integrating a third-party service |

---

## The shape of every feature

```
catalog → permission → module → migration → repository → service
       → controller → route → client api → component → locales
       → gallery → tests → docs → verify
```

Fourteen steps. Steps 2, 3, 10, 11 and 13 are the ones that get skipped — and skipping them is how
a codebase stops being maintainable by someone who was not there when it was written.
