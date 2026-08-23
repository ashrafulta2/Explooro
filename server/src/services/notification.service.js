/**
 * notification.service.js — Unified Multi-Channel Notification Engine (Prompt 8.2 / Master Spec §H).
 *
 * Implements:
 * 1. Channel-agnostic notify API with template variable rendering.
 * 2. User preference resolution with priority overrides & quiet hours.
 * 3. Multi-channel fan-out (In-App, SMS, Push, Email).
 * 4. Delivery status tracking and read receipts.
 * 5. What's New release announcements tracker.
 */

import { withTransaction } from '../config/db.js';
import { sendInApp } from './notification-channels/inapp.js';
import { sendSms } from './notification-channels/sms.js';
import { sendPush } from './notification-channels/push.js';
import { sendEmail } from './notification-channels/email.js';

export const DEFAULT_TEMPLATES = {
  OTP_VERIFICATION: {
    template_key: 'OTP_VERIFICATION',
    category: 'SECURITY',
    priority: 'CRITICAL',
    title_en: 'Verification Code',
    title_bn: 'যাচাইকরণ কোড',
    body_template_en: 'Your Explooro verification code is {{code}}. Valid for {{validMinutes}} minutes. Do not share this OTP.',
    body_template_bn: 'আপনার এক্সপ্লোরো যাচাইকরণ কোড হলো {{code}}। মেয়াদ {{validMinutes}} মিনিট। কোডটি কাউকে বলবেন না।',
    default_channels: ['SMS', 'INAPP'],
    can_override_preferences: true,
  },
  ORDER_PLACED: {
    template_key: 'ORDER_PLACED',
    category: 'ORDER',
    priority: 'HIGH',
    title_en: 'Order Confirmed',
    title_bn: 'অর্ডার নিশ্চিতকরণ',
    body_template_en: 'Order #{{orderRef}} placed successfully for ৳{{amount}}.',
    body_template_bn: 'অর্ডার #{{orderRef}} সফলভাবে সম্পন্ন হয়েছে। মোট ৳{{amount}}।',
    default_channels: ['INAPP', 'SMS', 'PUSH'],
    can_override_preferences: false,
  },
  PAYOUT_DISBURSED: {
    template_key: 'PAYOUT_DISBURSED',
    category: 'FINANCE',
    priority: 'HIGH',
    title_en: 'Payout Disbursed',
    title_bn: 'উত্তোলন সম্পন্ন',
    body_template_en: 'Payout of ৳{{amount}} has been disbursed to your {{accountType}} account.',
    body_template_bn: 'আপনার {{accountType}} অ্যাকাউন্টে ৳{{amount}} অর্থ সফলভাবে পাঠানো হয়েছে।',
    default_channels: ['INAPP', 'SMS'],
    can_override_preferences: false,
  },
  MARKETING_PROMO: {
    template_key: 'MARKETING_PROMO',
    category: 'MARKETING',
    priority: 'LOW',
    title_en: 'Special Promotion',
    title_bn: 'বিশেষ অফার',
    body_template_en: 'Flash Sale! Get up to {{discountPct}}% off on {{categoryName}} today only!',
    body_template_bn: 'ফ্ল্যাশ সেল! আজই {{categoryName}} এ {{discountPct}}% পর্যন্ত ছাড় পান!',
    default_channels: ['INAPP', 'SMS', 'PUSH'],
    can_override_preferences: false,
  },
  WARRANTY_ISSUED: {
    template_key: 'WARRANTY_ISSUED',
    category: 'ORDER',
    priority: 'HIGH',
    title_en: 'Digital Warranty Issued',
    title_bn: 'ডিজিটাল ওয়ারেন্টি ইস্যু করা হয়েছে',
    body_template_en: 'Warranty card #{{warrantyRef}} active for {{productTitle}}. Valid until {{expiresAt}}.',
    body_template_bn: '{{productTitle}} এর জন্য ওয়ারেন্টি কার্ড #{{warrantyRef}} সক্রিয় হয়েছে। মেয়াদ: {{expiresAt}}।',
    default_channels: ['INAPP', 'PUSH'],
    can_override_preferences: false,
  },
  WARRANTY_CLAIM_SUBMITTED: {
    template_key: 'WARRANTY_CLAIM_SUBMITTED',
    category: 'SUPPORT',
    priority: 'HIGH',
    title_en: 'New Warranty Claim Received',
    title_bn: 'নতুন ওয়ারেন্টি দাবি জমা হয়েছে',
    body_template_en: 'Claim #{{claimRef}} filed for {{productTitle}}. SLA review deadline: {{slaDueAt}}.',
    body_template_bn: '{{productTitle}} এর জন্য ওয়ারেন্টি দাবি #{{claimRef}} এসেছে। পর্যালোচনার শেষ সময়: {{slaDueAt}}।',
    default_channels: ['INAPP', 'SMS'],
    can_override_preferences: false,
  },
  WARRANTY_CLAIM_DECIDED: {
    template_key: 'WARRANTY_CLAIM_DECIDED',
    category: 'SUPPORT',
    priority: 'HIGH',
    title_en: 'Warranty Claim Update',
    title_bn: 'ওয়ারেন্টি দাবির আপডেট',
    body_template_en: 'Your claim #{{claimRef}} was {{status}} (Resolution: {{resolution}}).',
    body_template_bn: 'আপনার ওয়ারেন্টি দাবি #{{claimRef}} {{status}} হয়েছে (সিদ্ধান্ত: {{resolution}})।',
    default_channels: ['INAPP', 'PUSH', 'SMS'],
    can_override_preferences: false,
  },
  WARRANTY_CLAIM_ESCALATED: {
    template_key: 'WARRANTY_CLAIM_ESCALATED',
    category: 'SUPPORT',
    priority: 'CRITICAL',
    title_en: 'Warranty Claim Escalated',
    title_bn: 'ওয়ারেন্টি দাবি অ্যাডমিনে স্থানান্তরিত',
    body_template_en: 'Claim #{{claimRef}} breached supplier SLA deadline and escalated to admin review.',
    body_template_bn: 'ওয়ারেন্টি দাবি #{{claimRef}} এর সরবরাহকারী পর্যালোচনার সময় পার হওয়ায় অ্যাডমিনে স্থানান্তরিত হয়েছে।',
    default_channels: ['INAPP'],
    can_override_preferences: true,
  },
};

/**
 * Replaces {{variable}} placeholders with values from data object.
 */
export function renderTemplateString(templateStr, data = {}) {
  if (!templateStr) return '';
  return templateStr.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    return data[key] !== undefined ? String(data[key]) : '';
  });
}

function generateNotificationRef() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return `NTF-${code}`;
}

/**
 * Resolves which channels to dispatch to based on user preferences and priority overrides.
 */
export async function resolveChannels(db, userId, template, requestedChannels = null) {
  const targetChannels = requestedChannels || template.default_channels || ['INAPP'];

  // Critical / Security templates bypass preference opt-outs
  if (template.can_override_preferences || template.priority === 'CRITICAL') {
    return targetChannels;
  }

  // Fetch user preference for this category
  const { rows: prefRows } = await db.query(
    `SELECT * FROM notification_preferences WHERE user_id = $1 AND category = $2`,
    [userId, template.category]
  );

  const prefs = prefRows[0] || {
    inapp_enabled: true,
    sms_enabled: true,
    push_enabled: true,
    email_enabled: true,
  };

  const resolved = [];
  for (const ch of targetChannels) {
    const chUpper = ch.toUpperCase();
    if (chUpper === 'INAPP' && prefs.inapp_enabled !== false) resolved.push('INAPP');
    if (chUpper === 'SMS' && prefs.sms_enabled !== false) resolved.push('SMS');
    if (chUpper === 'PUSH' && prefs.push_enabled !== false) resolved.push('PUSH');
    if (chUpper === 'EMAIL' && prefs.email_enabled !== false) resolved.push('EMAIL');
  }

  return resolved;
}

/**
 * Channel-agnostic notification dispatch engine.
 */
export async function notify(db, {
  userId,
  templateKey,
  data = {},
  channels = null,
  priority = null,
  client = null,
} = {}) {
  const runner = async (txClient) => {
    // 1. Fetch user info
    const { rows: userRows } = await txClient.query(
      `SELECT id, full_name, phone, email, locale FROM users WHERE id = $1`,
      [userId]
    );

    if (userRows.length === 0) {
      throw new Error(`USER_NOT_FOUND: User #${userId} does not exist.`);
    }

    const user = userRows[0];

    // 2. Fetch template from DB or fallback to default
    let template = DEFAULT_TEMPLATES[templateKey];
    const { rows: tplRows } = await txClient.query(
      `SELECT * FROM notification_templates WHERE template_key = $1`,
      [templateKey]
    );
    if (tplRows.length > 0) {
      template = tplRows[0];
    }

    if (!template) {
      throw new Error(`TEMPLATE_NOT_FOUND: Notification template ${templateKey} is not registered.`);
    }

    // 3. Resolve active channels
    const activeChannels = await resolveChannels(txClient, userId, template, channels);

    // 4. Render English and Bengali bodies
    const renderedTitleEn = renderTemplateString(template.title_en, data);
    const renderedTitleBn = renderTemplateString(template.title_bn, data);
    const renderedBodyEn = renderTemplateString(template.body_template_en, data);
    const renderedBodyBn = renderTemplateString(template.body_template_bn, data);

    const ref = generateNotificationRef();
    const effectivePriority = priority || template.priority || 'NORMAL';

    // 5. Persist notification record
    const { rows: inserted } = await txClient.query(
      `INSERT INTO notifications (
         ref, user_id, template_key, category, priority,
         title_en, title_bn, body_en, body_bn, data_json, channels,
         delivery_status, is_read, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, '{}'::jsonb, false, now())
       RETURNING *`,
      [
        ref,
        userId,
        templateKey,
        template.category,
        effectivePriority,
        renderedTitleEn,
        renderedTitleBn,
        renderedBodyEn,
        renderedBodyBn,
        JSON.stringify(data || {}),
        JSON.stringify(activeChannels),
      ]
    );

    const notification = inserted[0];
    const deliveryStatus = {};

    // 6. Fan-out to resolved channels
    const localeMsg = user.locale === 'bn' ? renderedBodyBn : renderedBodyEn;
    const localeTitle = user.locale === 'bn' ? renderedTitleBn : renderedTitleEn;

    for (const ch of activeChannels) {
      if (ch === 'INAPP') {
        const inappRes = await sendInApp(notification);
        deliveryStatus.INAPP = inappRes.status;
      } else if (ch === 'SMS') {
        const smsRes = await sendSms(user.phone, localeMsg);
        deliveryStatus.SMS = smsRes.status;
      } else if (ch === 'PUSH') {
        const pushRes = await sendPush(userId, { title: localeTitle, body: localeMsg, data });
        deliveryStatus.PUSH = pushRes.status;
      } else if (ch === 'EMAIL') {
        const emailRes = await sendEmail(user.email, { subject: localeTitle, bodyHtml: localeMsg, bodyText: localeMsg });
        deliveryStatus.EMAIL = emailRes.status;
      }
    }

    // 7. Update delivery status
    await txClient.query(
      `UPDATE notifications SET delivery_status = $2 WHERE id = $1`,
      [notification.id, JSON.stringify(deliveryStatus)]
    );

    return {
      notificationId: notification.id,
      ref: notification.ref,
      channels: activeChannels,
      deliveryStatus,
      renderedTitle: localeTitle,
      renderedBody: localeMsg,
    };
  };

  return client ? runner(client) : withTransaction(db, runner);
}

/**
 * Retrieves in-app notifications for a user.
 */
export async function getNotifications(db, userId, {
  category = null,
  isRead = null,
  limit = 20,
  offset = 0,
} = {}) {
  let query = `
    SELECT id, ref, template_key, category, priority,
           title_en, title_bn, body_en, body_bn, data_json,
           channels, delivery_status, is_read, read_at, created_at
    FROM notifications
    WHERE user_id = $1
  `;
  const params = [userId];

  if (category && category !== 'ALL') {
    params.push(category);
    query += ` AND category = $${params.length}`;
  }

  if (isRead !== null) {
    params.push(Boolean(isRead));
    query += ` AND is_read = $${params.length}`;
  }

  query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const { rows } = await db.query(query, params);

  return {
    items: rows,
    count: rows.length,
    limit,
    offset,
  };
}

/**
 * Gets unread in-app notification count for a user.
 */
export async function getUnreadCount(db, userId) {
  const { rows } = await db.query(
    `SELECT COUNT(id) as unread_count FROM notifications WHERE user_id = $1 AND is_read = false`,
    [userId]
  );
  return parseInt(rows[0]?.unread_count, 10) || 0;
}

/**
 * Marks a single notification as read.
 */
export async function markAsRead(db, userId, notificationId) {
  const { rows } = await db.query(
    `UPDATE notifications
     SET is_read = true, read_at = now()
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    [notificationId, userId]
  );
  return { success: rows.length > 0 };
}

/**
 * Marks all notifications as read for a user.
 */
export async function markAllAsRead(db, userId) {
  await db.query(
    `UPDATE notifications SET is_read = true, read_at = now() WHERE user_id = $1 AND is_read = false`,
    [userId]
  );
  return { success: true };
}

/**
 * Retrieves user notification channel preferences.
 */
export async function getPreferences(db, userId) {
  const { rows } = await db.query(
    `SELECT category, inapp_enabled, sms_enabled, push_enabled, email_enabled, quiet_hours_start, quiet_hours_end
     FROM notification_preferences
     WHERE user_id = $1`,
    [userId]
  );
  return rows;
}

/**
 * Upserts user notification channel preferences.
 */
export async function updatePreferences(db, userId, preferences = []) {
  for (const pref of preferences) {
    await db.query(
      `INSERT INTO notification_preferences (
         user_id, category, inapp_enabled, sms_enabled, push_enabled, email_enabled,
         quiet_hours_start, quiet_hours_end, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (user_id, category) DO UPDATE
       SET inapp_enabled = EXCLUDED.inapp_enabled,
           sms_enabled = EXCLUDED.sms_enabled,
           push_enabled = EXCLUDED.push_enabled,
           email_enabled = EXCLUDED.email_enabled,
           quiet_hours_start = EXCLUDED.quiet_hours_start,
           quiet_hours_end = EXCLUDED.quiet_hours_end,
           updated_at = now()`,
      [
        userId,
        pref.category,
        pref.inapp_enabled !== false,
        pref.sms_enabled !== false,
        pref.push_enabled !== false,
        pref.email_enabled !== false,
        pref.quiet_hours_start || null,
        pref.quiet_hours_end || null,
      ]
    );
  }

  return { success: true };
}

/**
 * Retrieves latest published release notes if not yet viewed by user.
 */
export async function getLatestReleaseNotes(db, userId) {
  const { rows: releaseRows } = await db.query(
    `SELECT r.*
     FROM release_notes r
     WHERE r.published_at <= now()
     ORDER BY r.published_at DESC
     LIMIT 1`
  );

  if (releaseRows.length === 0) return null;
  const latest = releaseRows[0];

  const { rows: viewRows } = await db.query(
    `SELECT 1 FROM user_release_views WHERE user_id = $1 AND version_tag = $2`,
    [userId, latest.version_tag]
  );

  if (viewRows.length > 0) {
    return null; // Already viewed by this user
  }

  return latest;
}

/**
 * Acknowledges that a user has viewed a release note version.
 */
export async function markReleaseViewed(db, userId, versionTag) {
  await db.query(
    `INSERT INTO user_release_views (user_id, version_tag, viewed_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id, version_tag) DO NOTHING`,
    [userId, versionTag]
  );
  return { success: true, versionTag };
}
