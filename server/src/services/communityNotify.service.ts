/**
 * communityNotify.service.ts — what the community timeline tells people (templates: migration 084).
 *
 *   someone comments on your post        → the post's author           COMMUNITY_COMMENT
 *   reports hide your post               → its author                  COMMUNITY_POST_AUTO_HIDDEN
 *   a moderator hides / removes / keeps  → its author                  COMMUNITY_POST_HIDDEN / _REMOVED / _RESTORED
 *   staff remove your comment            → the comment's author        COMMUNITY_COMMENT_REMOVED
 *
 * Deliberately NOT notified: likes (too noisy to be useful), your own actions on your own post, and
 * a comment while an earlier comment on the same post is still unread.
 *
 * Invariants:
 *  - A notification is a courtesy, never a precondition: every call here swallows its own failure, so a
 *    broken notification service can never fail a comment or a moderation decision.
 *  - The person who acts is never told about their own action.
 *  - A post author with an UNREAD comment notification for that post is not sent another. The unread
 *    one already points at the post, and ten comments in a minute would otherwise be ten bells.
 */

import { notify } from './notification.service.ts';

/** Replaceable in tests, so they can see what would be sent without a notifications table. */
export const notifier = { send: notify };

const KIND_WORD = {
  REVIEW: { en: 'review', bn: 'রিভিউ' },
  UPDATE: { en: 'product update', bn: 'পণ্যের আপডেট' },
  IDEA: { en: 'post', bn: 'পোস্ট' },
  ANNOUNCEMENT: { en: 'announcement', bn: 'ঘোষণা' },
};

/** What to call the post in a sentence: its title, else its product, else the kind of post it is. */
export function postLabels(post) {
  const kind = KIND_WORD[post.post_type] ?? { en: 'post', bn: 'পোস্ট' };
  return {
    postLabelEn: post.title ? `"${post.title}"` : post.product_title_en ? `${kind.en} on "${post.product_title_en}"` : kind.en,
    postLabelBn: post.title ? `"${post.title}"` : post.product_title_bn ? `"${post.product_title_bn}" নিয়ে ${kind.bn}` : kind.bn,
  };
}

export const postLink = (postId, { comments = false } = {}) => `/community?post=${postId}${comments ? '&comments=1' : ''}`;

export function excerpt(text, max = 80) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

async function send(db, args) {
  try {
    await notifier.send(db, args);
  } catch (err) {
    // WHY console and not a throw: see the invariant above. The failure is visible in the server log.
    console.warn('[community] notification not sent:', args.templateKey, err?.message ?? err);
  }
}

/** Is there already an unread COMMUNITY_COMMENT bell for this person about this post? */
async function hasUnreadCommentNotice(db, userId, postId) {
  try {
    const { rows } = await db.query(
      `SELECT 1 FROM notifications
        WHERE user_id = $1 AND template_key = 'COMMUNITY_COMMENT' AND is_read = false
          AND data_json->>'postId' = $2
        LIMIT 1`,
      [userId, String(postId)]
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Has this person turned community notifications off in-app (/settings/notifications)? The
 * notification service only gates the delivery channels, but a notification row IS the in-app bell,
 * so for the one preference-respecting template the mute is honoured here, before the row exists.
 */
async function hasMutedCommunity(db, userId) {
  try {
    const { rows } = await db.query(
      `SELECT inapp_enabled FROM notification_preferences WHERE user_id = $1 AND category = 'COMMUNITY'`,
      [userId]
    );
    return rows[0]?.inapp_enabled === false;
  } catch {
    return false;
  }
}

export async function notifyPostAuthorOfComment(db, { post, comment, actorId }) {
  if (Number(post.author_id) === Number(actorId)) return;
  if (await hasMutedCommunity(db, Number(post.author_id))) return;
  if (await hasUnreadCommentNotice(db, Number(post.author_id), post.id)) return;
  await send(db, {
    userId: Number(post.author_id),
    templateKey: 'COMMUNITY_COMMENT',
    data: { actorName: comment.author_name ?? '—', excerpt: excerpt(comment.body), postId: post.id, linkUrl: postLink(post.id, { comments: true }) },
  });
}

/** `outcome` is AUTO_HIDDEN | HIDDEN | REMOVED | RESTORED. */
export async function notifyPostAuthorOfDecision(db, { post, outcome, actorId = null }) {
  if (actorId !== null && Number(post.author_id) === Number(actorId)) return;
  await send(db, {
    userId: Number(post.author_id),
    templateKey: `COMMUNITY_POST_${outcome}`,
    data: { ...postLabels(post), postId: post.id, linkUrl: outcome === 'REMOVED' ? '/community' : postLink(post.id) },
  });
}

export async function notifyCommentRemoved(db, { comment, actorId }) {
  if (Number(comment.author_id) === Number(actorId)) return;
  await send(db, {
    userId: Number(comment.author_id),
    templateKey: 'COMMUNITY_COMMENT_REMOVED',
    data: { excerpt: excerpt(comment.body), postId: comment.post_id, linkUrl: postLink(comment.post_id) },
  });
}
