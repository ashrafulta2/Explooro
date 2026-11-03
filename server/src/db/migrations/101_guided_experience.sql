-- 101_guided_experience.sql — Prompt 13.2: the Next-Step engine's module and the per-user opt-out.
--
-- `guided_experience` gates GET /me/next-step. Default ON: the card is how a new user finds out
-- what to do first (docs/journeys.md). `cache_seconds` is how long one user's answer is reused;
-- any write by that user clears it at once, so the setting only bounds how long a change made by
-- SOMEONE ELSE (an admin approving their KYC, a shopper ordering) takes to show.
INSERT INTO platform_modules (
  key, group_key, label_en, label_bn, description_en, description_bn,
  is_enabled, default_enabled, settings_json, settings_schema, depends_on
)
VALUES (
  'guided_experience', 'content',
  'Next-step guidance', 'পরের ধাপের নির্দেশনা',
  'Shows every user a card with the one thing to do next, from first login to their first real success. Off hides the card everywhere.',
  'প্রথম লগইন থেকে প্রথম সাফল্য পর্যন্ত প্রত্যেক ইউজারকে একটি কার্ডে দেখায় এরপর কী করতে হবে। বন্ধ থাকলে কার্ডটি কোথাও দেখাবে না।',
  true, true,
  '{"cache_seconds": 20}'::jsonb,
  '{"type": "object", "properties": {
      "cache_seconds": { "type": "integer", "minimum": 0, "maximum": 300, "default": 20 }
    } }'::jsonb,
  ARRAY[]::text[]
)
ON CONFLICT (key) DO NOTHING;

-- WHY on user_profiles and not in the browser: the choice should follow the person to every device.
-- Default true, so a user without a profile row (or who never touched the switch) sees the card.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS show_next_steps BOOLEAN NOT NULL DEFAULT true;
