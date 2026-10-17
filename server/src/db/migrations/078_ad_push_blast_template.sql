-- 078_ad_push_blast_template.sql — the notification template the Push Blast job sends.
--
-- WHY a migration, not just DEFAULT_TEMPLATES in notification.service.ts: notifications.template_key is a
-- foreign key to notification_templates and nothing copies the in-code defaults into the table, so a
-- template that exists only in code fails the insert (same trap as migration 065). Found by running the
-- blast end to end against a real database: every send failed and the whole purchase was refunded.
--
-- The "Sponsored:" prefix is part of the stored title so an ad can never pass itself off as a platform message.
INSERT INTO notification_templates
  (template_key, category, priority, title_en, title_bn, body_template_en, body_template_bn, default_channels, can_override_preferences)
VALUES
  ('AD_PUSH_BLAST', 'MARKETING', 'LOW',
   'Sponsored: {{headline}}', 'স্পন্সর্ড: {{headline}}',
   '{{body}}', '{{body}}',
   '["PUSH","INAPP"]'::jsonb, false)
ON CONFLICT (template_key) DO NOTHING;
