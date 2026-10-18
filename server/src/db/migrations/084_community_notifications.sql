-- 084_community_notifications.sql — notifications for the community timeline.
--
-- 1. A new notification category, COMMUNITY, so a member can mute community activity from
--    /settings/notifications without muting orders or payouts. The category is a CHECK list on
--    notification_templates and notification_preferences, so both gain the value. The constraints
--    were created inline in 020 with generated names, so they are found by what they check.
--
-- 2. The six templates. WHY rows here and not only in code: notifications.template_key is a foreign
--    key to notification_templates, and nothing copies in-code defaults into it (see 065).
--
--    COMMUNITY_COMMENT          someone commented on your post               (respects the COMMUNITY preference)
--    COMMUNITY_POST_AUTO_HIDDEN reports hid your post until a moderator looks (always delivered)
--    COMMUNITY_POST_HIDDEN      a moderator hid your post                    (always delivered)
--    COMMUNITY_POST_REMOVED     a moderator removed your post                (always delivered)
--    COMMUNITY_POST_RESTORED    a moderator put your hidden post back        (always delivered)
--    COMMUNITY_COMMENT_REMOVED  staff removed your comment                   (always delivered)
--
--    WHY the moderation notices ignore the preference (can_override_preferences = true): an author
--    whose post disappeared must be told, and a mute meant for "someone commented" should not hide it.
--    All six are in-app only: no SMS or push for a comment.

DO $$
DECLARE
  tbl TEXT;
  existing TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['notification_templates', 'notification_preferences'] LOOP
    SELECT conname INTO existing
      FROM pg_constraint
     WHERE conrelid = tbl::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%category%';
    IF existing IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', tbl, existing);
    END IF;
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (category IN (''TRANSACTIONAL'', ''SECURITY'', ''ORDER'', ''FINANCE'', ''MARKETING'', ''SYSTEM'', ''COMMUNITY''))',
      tbl, tbl || '_category_check'
    );
  END LOOP;
END
$$;

INSERT INTO notification_templates
  (template_key, category, priority, title_en, title_bn, body_template_en, body_template_bn, default_channels, can_override_preferences)
VALUES
  ('COMMUNITY_COMMENT', 'COMMUNITY', 'NORMAL',
   'New comment on your post', 'আপনার পোস্টে নতুন মন্তব্য',
   '{{actorName}}: "{{excerpt}}"',
   '{{actorName}}: "{{excerpt}}"',
   '["INAPP"]'::jsonb, false),
  ('COMMUNITY_POST_AUTO_HIDDEN', 'COMMUNITY', 'HIGH',
   'Your post is hidden for review', 'আপনার পোস্ট পর্যালোচনার জন্য লুকানো হয়েছে',
   'Reports on your {{postLabelEn}} hid it until a moderator decides. You do not need to do anything.',
   'আপনার {{postLabelBn}} নিয়ে একাধিক রিপোর্ট আসায় মডারেটর সিদ্ধান্ত না নেওয়া পর্যন্ত সেটি লুকানো হয়েছে। আপনাকে কিছু করতে হবে না।',
   '["INAPP"]'::jsonb, true),
  ('COMMUNITY_POST_HIDDEN', 'COMMUNITY', 'HIGH',
   'A moderator hid your post', 'মডারেটর আপনার পোস্ট লুকিয়েছেন',
   'A moderator hid your {{postLabelEn}} after reviewing it. It is no longer on the timeline.',
   'মডারেটর পর্যালোচনার পর আপনার {{postLabelBn}} লুকিয়েছেন। সেটি এখন আর টাইমলাইনে দেখা যাবে না।',
   '["INAPP"]'::jsonb, true),
  ('COMMUNITY_POST_REMOVED', 'COMMUNITY', 'HIGH',
   'A moderator removed your post', 'মডারেটর আপনার পোস্ট সরিয়ে দিয়েছেন',
   'A moderator removed your {{postLabelEn}} after reviewing it. It cannot be restored.',
   'মডারেটর পর্যালোচনার পর আপনার {{postLabelBn}} সরিয়ে দিয়েছেন। এটি আর ফিরিয়ে আনা যাবে না।',
   '["INAPP"]'::jsonb, true),
  ('COMMUNITY_POST_RESTORED', 'COMMUNITY', 'NORMAL',
   'Your post is back', 'আপনার পোস্ট আবার দেখা যাচ্ছে',
   'A moderator reviewed your {{postLabelEn}} and put it back on the timeline.',
   'মডারেটর আপনার {{postLabelBn}} পর্যালোচনা করে আবার টাইমলাইনে ফিরিয়ে দিয়েছেন।',
   '["INAPP"]'::jsonb, true),
  ('COMMUNITY_COMMENT_REMOVED', 'COMMUNITY', 'HIGH',
   'Your comment was removed', 'আপনার মন্তব্য সরানো হয়েছে',
   'A moderator removed your comment: "{{excerpt}}"',
   'মডারেটর আপনার মন্তব্য সরিয়ে দিয়েছেন: "{{excerpt}}"',
   '["INAPP"]'::jsonb, true)
ON CONFLICT (template_key) DO NOTHING;
