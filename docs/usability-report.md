# Usability report: can a first-time user finish their journey?

> Prompt 13.7 (Phase 13, Guided Experience). Started 2026-11-06.
> **Status: the task scripts, the measuring tools and the fix list are ready. No test with a real
> first-time user has been run yet**, so no role has met or missed its target. The "Sessions" table
> stays empty until someone runs them. Nothing below is invented to fill it.

This report has two sources, and they answer different questions:

1. **Task sessions** (§2–§3). One person who has never seen the app, one task, a stopwatch. These show
   *why* people stall: the wrong turns and the moments they hesitate.
2. **Journey metrics** (§4). `/admin/platform/guided-experience` shows, for every journey step, how
   many users reached it, how many finished it, the typical time and where they stopped. It covers
   every real user, but only shows *where* they stall, not why.

A step either source shows as a problem becomes a numbered fix in §5.

## 1. Targets

| Role | Task | Target | Journey steps it covers (`docs/journeys.md`) |
| :--- | :--- | :--- | :--- |
| Customer | Find a product and place a cash-on-delivery order | ≤ 2 min | `add_address` → `fill_cart` → `place_order` |
| Explooro Partner | Publish a store and share it | ≤ 5 min | `name_store` → `add_products` → `share_store` |
| Supplier | Add a product, then mark an order shipped | ≤ 6 min | `add_product` → `stock_product` → `ship_order` |

The clock starts when the participant first sees the signed-in home page and stops when the task's
last step shows as done on their next-step card. KYC is outside the clock. Its review waits on an
admin, so it is prepared beforehand (§2).

## 2. How to run a session

**Who.** Someone who has never used Explooro and does not work on it. They should be comfortable with
a phone and a shopping app, which is the real audience. Run each script with at least three
different people before calling a target met or missed.

**Where.** A staging build or `npm run dev` in mock mode (`VITE_API_MODE=mock`, preview
`explooro-client-mock`). Use a phone-sized window (375 px wide), since most users are on phones. Run
each session in Bangla unless the participant asks for English.

**Accounts.** Use a fresh account per session, so that its next-step card starts at the beginning:

- Customer: a fresh customer with a verified phone and no address.
- Explooro Partner: a fresh partner account with KYC already approved and no store name.
- Supplier: a fresh supplier with KYC approved, no product, and one paid order already waiting for
  shipment, so step 3 of the task is reachable without waiting for a buyer.

**What to say.** Read the task line from §1 aloud, word for word, and nothing more. Do not point,
hint or answer "where is…" questions. If they ask, say "do what you would do at home". Ask them to
think aloud.

**What to write down**, in §3:

- **Time:** start to finish, to the second.
- **Wrong turns:** a tap that leads away from the task (a wrong page, a wrong menu, a back button
  used to undo). Count each one.
- **Hesitations:** more than ~5 seconds without acting, or "where do I…?" said aloud. Note the screen
  and the words they used.
- **Gave up:** if they stop, or pass 3× the target, note the step and end the session.

## 3. Sessions

| # | Date | Role | Participant (no names) | Time | Target met? | Wrong turns | Where they hesitated |
| :- | :--- | :--- | :--- | :--- | :--- | :- | :--- |
| | | | | | | | |

*No session has been run yet.*

### Things to watch for in the first sessions

These came out of the journey audit (`docs/journeys.md` §4) and the plain-language pass
(Prompt 13.6). They are guesses about where people may hesitate, not results:

- **Identity check (KYC) is reachable only from the profile page and the next-step card**
  (`docs/journeys.md` F1). A participant who closes the card may not find it again.
- **Sharing a store** (`share_store`) counts only once a share link is created on the Social Kit page.
  Tapping the store page's own Share button is not counted (F5). Watch whether people think they have
  shared and stop.
- **Supplier "mark shipped"** depends on the operations mode. In manual mode the supplier records the
  courier name and tracking number by hand on `/supplier/shipments`. Watch whether that form is
  understood.

## 4. Journey metrics

`/admin/platform/guided-experience` is held behind `platform.guidance.view` (LOW, given to Admin
and Super Admin). For every step of every journey it shows:

| Column | Meaning |
| :--- | :--- |
| Reached | Users who had the step as their current step, or finished it |
| Finished | Users who finished it |
| Typical time | Median time from first seeing the step to finishing it. Only users seen at both ends count |
| Stopped here | Users who reached it at least *N* days ago and still have not finished |
| Stop rate | Stopped here ÷ (finished + stopped here). Users who reached it recently are left out, since their outcome is not known yet |

The page also shows the `guided_experience` module switch, and per role the share of users who
turned the next-step card off.

**Where the numbers come from.** `journey_step_events` (migration 103). The Next-Step engine writes
one row the first time it sees a step become a user's current step (REACHED), and one the first
time it sees it done (COMPLETED). The page states the raw totals and confirms its rows add up to them.
`server/test/journeyMetrics.test.js` checks that this reconciliation holds on a real Postgres
database.

Known limits:

- Only users who load a page with the next-step card are counted. Users who turned the card off,
  or used the app while the module was off, add no rows.
- A step finished before the card ever showed it (several steps done between two page loads) counts
  as reached and finished, with no time.
- Steps marked **Waits on others** (`receive_order`, `first_order`) stall while a buyer or a courier
  acts, so a high stop rate there is not always the user giving up.
- Counting starts with migration 103 (2026-11-06). Journeys started before that show only from the
  step the user was on that day.

**The 40% rule is configuration.** A step is flagged when its stop rate is **above**
`abandon_threshold_pct` (default 40, allowed 5–95), counted after `abandon_after_days` (default 7,
allowed 1–90). Both are settings of the `guided_experience` module, set at
`/admin/platform/modules`. The bounds live in `SETTING_LIMITS` in
`server/src/services/journeyMetrics.service.ts` and in migration 103's `settings_schema`, and a test
keeps them equal.

## 5. Fixes

The rule: every step the metrics page flags, and every step where a session participant gave up or
missed the target, gets a numbered fix here. Each fix names the step, the evidence and the change.

*No fix is listed yet.* There are no real-user numbers yet: the page has only seeded preview data in
mock mode, and no session has been run. The preview flags seven steps, including partner identity
check at 60.6% and first withdrawal at 66.7%. Those rates come from a made-up funnel in
`client/src/mocks/handlers/guidedExperience.ts`, chosen to exercise the page, so they are not
findings.

When the first real numbers arrive, read the "Steps to fix" list on the page and add one fix per
flagged step, worst first:

| # | Role · step | Evidence (stop rate, or session #) | Change | Status |
| :- | :--- | :--- | :--- | :--- |
| | | | | |
