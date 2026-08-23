# AI Strategy — Prompt 10.2

`idea proposition.md` §D, §W, §Z, §AB name six AI-dependent modules (Shopping Concierge, Sourcing
Intelligence, Creative Studio, Demand Forecasting, Review Integrity, Prescriptive Insights) but no
source document ever picked a provider. This document is that decision, plus the operating rules
every AI feature in this codebase must follow.

## 1. Provider decision

**Default: Anthropic Claude API**, called through the official `@anthropic-ai/sdk` (pinned exact
version — see `docs/dependency-ledger.md`), isolated in the single adapter file
`server/src/services/ai/provider.js`. No controller, agent, or route may import the SDK or call
`fetch` against `api.anthropic.com` directly — every model call goes through `provider.js`, which
is the only file allowed to know the SDK's request/response shapes. This mirrors every other
external integration in this codebase (payments, courier, SMS, streaming): one adapter file, one
`mock` driver, switchable by an env var.

Why Claude over alternatives: native tool use with strict JSON schemas (needed for
catalog-grounded responses), first-class prompt caching (the system prompt + tool schema is
identical across every concierge turn — an ideal cache prefix), and streaming that maps cleanly
onto the SSE contract this prompt already needs for the AssistantPanel UI.

## 2. Model selection per task

| Feature | Env override | Default model | Why |
| :--- | :--- | :--- | :--- |
| Shopping Concierge (10.2) | `AI_MODEL_CONCIERGE` | `AI_MODEL` (`claude-sonnet-5`) | High volume, grounded lookup — not a hard reasoning task. Run at `output_config.effort: "low"` to bound cost/latency; correctness comes from tool grounding, not model depth. |
| Sourcing Intelligence (10.2) | `AI_MODEL_SOURCING` | `AI_MODEL` (`claude-sonnet-5`) | Same shape as concierge — margin/trend lookup over structured data. `effort: "low"`. |
| Creative Studio (10.3) | `AI_MODEL_CREATIVE` | `AI_MODEL` | Longer generative output (ad copy) — default effort. |
| Demand Forecasting (10.3) | — | N/A | Statistical baseline is the arithmetic engine (moving average + seasonality); the model is only used to *explain* a number that was already computed, never to compute it. |
| Review Integrity (10.3) | — | N/A initially | Rule/heuristic scoring first (text patterns, velocity, reviewer history). A model call is an optional future enhancement, not required for the moderation flag. |
| Prescriptive Insights (10.3) | `AI_MODEL_CREATIVE` | `AI_MODEL` | Short, per-user recommendation text grounded in the user's own metrics. |

Every task-specific env var is optional; when unset, `AI_MODEL` (`.env.example`, default
`claude-sonnet-5`) is used. This keeps a single source of truth for "which model are we paying
for" while leaving room to move a specific feature to a cheaper or more capable model later without
touching code — a config change only, per the "business numbers live in settings, not code" rule.

## 3. Cost per 1K tokens (cached: 2026-06-24, from Anthropic's published rates)

| Model | Input / 1K | Output / 1K |
| :--- | ---: | ---: |
| `claude-sonnet-5` | $0.002–0.003 (intro rate through 2026-08-31, then $0.003) | $0.010–0.015 |
| `claude-haiku-4-5` | $0.001 | $0.005 |
| `claude-opus-5` | $0.005 | $0.025 |

`provider.js` holds a `PRICING_PER_1K` table matching this, applied to the `usage` block on every
provider response to compute `cost_usd`, which is what gets written to `ai_usage_events` and summed
for the spend cap. Re-verify this table against the `claude-api` skill's pricing reference whenever
a model changes and update both places together.

## 4. Latency targets

- **First token**: < 1.5s for the concierge/sourcing chat (streamed — the AssistantPanel renders
  the first delta as soon as it arrives, never waits for the full turn).
- **Full grounded turn** (one tool round-trip: search catalog → compose): < 4s at p95.
- **Tool round-trip cap**: at most 3 provider calls per user turn (initial call → tool_use →
  tool_result → final call, with one retry budget). A turn that would need a 4th round-trip instead
  returns whatever grounded data it already has, with the reply text noting the search was
  narrowed — never an unbounded loop.

## 5. Prompt caching strategy

Render order is `tools` → `system` → `messages` (SDK/API requirement). Both agents keep:

1. The tool schema array — static per agent, never touches user data.
2. The system prompt — static text (persona, grounding rules, injection-resistance instructions),
   with `cache_control: { type: 'ephemeral' }` on the final system block.

as the frozen, cacheable prefix. Only the actual conversation (`messages`) varies per request. This
gives every concierge/sourcing turn after the first in a conversation a cache hit on the entire
system prompt and tool schema — the dominant fixed cost of a grounded, tool-using agent.

## 6. Monthly cost ceiling & spend cap enforcement

- Bootstrap default: `AI_MONTHLY_SPEND_CAP_USD` in `.env.example` (100 USD/month).
- Source of truth once the platform is running: `platform_settings` key
  `ai.monthly_spend_cap_usd` — same "env bootstraps, `platform_settings` wins" pattern as every
  other business number (`server/src/config/env.js` §BUSINESS DEFAULTS).
- `provider.js` sums `ai_usage_events.cost_usd` for the current calendar month before every turn.
  If the running total is at or above the cap, the turn **does not throw** — it degrades (see §7).
- The cap and the current month's spend are readable by Admin via
  `GET /api/v1/ai/usage` (permission `ai.config.manage`) and editable via
  `PATCH /api/v1/ai/usage/cap`, both audit-logged. `client/src/pages/admin/ModuleControlPage.js`
  renders this as a compact spend card above the "AI & Advanced" module group, since that is
  already where every AI module lives in the admin's mental model.

## 7. Graceful degradation policy

Every AI-dependent feature must keep working — in a reduced form — when AI is unavailable. "AI
unavailable" covers three cases, all handled inside `services/ai/index.js` before the client ever
sees an error:

1. **Module disabled** (`ai_concierge` / `ai_sourcing_chat` / `ai_creative_studio` off) — handled
   at the route layer by the existing `requireModule` middleware (403 `MODULE_DISABLED`) and
   mirrored client-side by `PermissionGate`'s `module` gate, which renders a `fallback()` instead
   of the AssistantPanel trigger. No AI-specific code needed here — this is the platform's existing
   module-gating contract, reused as-is.
2. **Over monthly budget** — the turn runs the same tool call(s) it always would (catalog search /
   sourcing lookup — these cost nothing, they are plain SQL) but skips the model call entirely and
   returns a deterministic, templated bilingual reply composed directly from the structured tool
   result, with `degraded: true` and a reason on the final SSE event. The AssistantPanel renders
   this exactly like a normal answer plus a small "basic search — AI temporarily paused" notice; it
   never surfaces as an error state.
3. **Provider failure** (timeout, 5xx, network error after the retry budget in §8) — same
   deterministic fallback as case 2. The user gets real, grounded search results either way; only
   the natural-language framing is templated instead of generated.

This same deterministic fallback path is also exactly what the `AI_DRIVER=mock` driver runs in
development (see §9) — there is one degraded-mode code path, not two, which is what keeps it
actually exercised (and therefore actually working) instead of a rarely-hit branch that only fires
in a real outage.

## 8. Retry policy

`provider.js` retries a transient failure (429, connection error, 5xx) up to 2 times with
exponential backoff (300ms → 900ms) before handing control to the degradation path in §7. A 4xx
that is not 429 (bad request, auth failure) is not retried — it is logged and degrades immediately,
since retrying a malformed request just wastes the latency budget.

## 9. Safety

1. **Prompt-injection resistance.** All product titles/descriptions, reviews, and prior chat
   content returned by a tool are untrusted data, never instructions. Two independent layers:
   - The system prompt explicitly states that tool-result text is catalog data to summarize, never
     commands to follow, and that only the platform's own system prompt carries instructions.
   - `sanitizeUntrustedText()` (`conciergeAgent.js` / `sourcingAgent.js`) pattern-matches common
     injection phrasing ("ignore previous instructions", "you are now", "disregard the above",
     "system:") in any text pulled from the database before it is embedded in a tool result sent to
     the model, replacing a match with `[REDACTED_INSTRUCTION_ATTEMPT]` and recording an
     `ai_safety_incidents` row.
   - Structurally, this is defense in depth on top of the real guarantee: **price, stock, and
     rating are always rendered on product cards straight from the structured tool-result JSON**,
     never parsed out of the model's free-text reply. Even a successful injection that changed the
     model's prose cannot change what number a product card shows, because the card never reads the
     prose.
2. **PII redaction.** Before a user's message is sent to the model, `provider.js` redacts phone
   numbers, NID-shaped digit runs, and email addresses via the same pattern family
   `audit.service.js` already uses for sensitive-field detection, replacing a match with a typed
   placeholder (`[PHONE]`, `[EMAIL]`) so the model still understands intent ("what's the delivery
   time for my order") without the PII leaving the platform.
3. **Full audit logging.** Every turn writes an `ai_messages` row (user + assistant, redacted) and
   an `ai_usage_events` row (tokens, cost, model, driver). A detected injection or a spend-cap
   degradation additionally writes to `ai_safety_incidents` / is visible in the usage summary. This
   is the AI-specific audit trail — separate from the global `audit_logs` hash chain, which is
   reserved for staff/admin state-changing actions per the platform's audit policy — but every
   AI-triggered state change that *does* mutate platform data (e.g. a Saler's 1-click "Add to
   Store" from a sourcing card) goes through the existing `product.service.js` code path and its
   normal audit trail, not a new one. The AI layer never calls that path directly — the model can
   *recommend*, the confirming click is what executes, same rule as Prompt 10.3's creative studio
   ("every output is a draft requiring human approval").

## 10. Module gates

Five independent module flags (already seeded in `server/src/db/seeds/003_modules.sql`):
`ai_concierge`, `ai_sourcing_chat`, `ai_creative_studio`, `ai_forecasting`, `prescriptive_insights`.
Each can be disabled independently by the Admin without affecting the others — a cost-control lever
per feature, not a single AI on/off switch.

## 11. Prompt 10.3 capabilities — where the model is judgment, not arithmetic

Every 10.3 service follows the same split established by §7's degradation policy: a deterministic,
testable, code-computed core, with Claude used only where actual judgment is needed — never as the
source of a number or a fact.

- **`creativeStudio.js`** — ad copy and description-improvement drafts are grounded in the real
  product row (title/price/category/existing description) and are never auto-applied: ad copy has
  no publish target at all (copy-to-clipboard only), and an improved description must be explicitly
  applied by the owning supplier through the pre-existing, already-audited `PATCH /products/:id` —
  not a new AI-specific write path. Background "treatment" is a flat-canvas matte composite via
  `sharp` (padding/color harmonization), not true background *removal* — full segmentation needs an
  ML model outside the approved dependency list (§ dependency-ledger.md). Claude picks the matte
  style from a 3-value enum only; `sharp` does the actual pixels, isolated behind
  `media.service.js`'s `applyFlatBackgroundMatte` (the one file allowed to import `sharp`, per the
  one-dependency-one-adapter rule).
- **`demandForecast.js`** — `computeStatisticalForecast` is pure arithmetic (moving average +
  day-of-week seasonality + an 80%-band confidence interval) over real `order_items` history; it
  takes no model call. `runForecast` hands the *already-computed* forecast JSON to Claude and asks
  only for a short explanation — the model cannot alter the prediction. A sparse-history guard
  (`insufficient_data`) stops a handful of sales days from producing a falsely confident-looking
  number.
- **`reviewIntegrity.js`** — the fake-review score is a deterministic rule-based sum (text
  patterns, exact-duplicate body text, reviewer/product velocity, account age), not a model
  judgment — a moderation score has to be reproducible and explainable, not subject to sampling
  variance. A review scoring below `FLAG_THRESHOLD` (55) is pushed into the existing Prompt 7.4
  `moderation_queue` (never auto-deleted/auto-hidden — a human always decides); Claude is used only,
  optionally, to phrase the moderator-facing explanation of already-computed signal codes.
- **`prescriptiveInsights.js`** — findings are built from real `order_items`/`saler_store_items`
  sales counts (no page-view/analytics table exists yet, so a conversion-rate metric isn't
  groundable — sold-unit comparisons are used instead) and real stockout forecasts from
  `demandForecast.js`. Claude turns already-computed findings into one recommendation sentence each
  and cannot introduce a number that wasn't in the finding.

All four honor the same spend cap and mock-driver default as 10.2, recorded under their own
`feature_key` (`creative`, `forecast`, `review_integrity`, `insights`) in `ai_usage_events`.
