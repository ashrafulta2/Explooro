/**
 * CommentThread — the comments under one post, and the box to write one.
 *
 * A flat list, oldest first, so a thread reads top to bottom like a conversation. A comment goes live
 * at once. Its author can delete it; staff (`canModerate`) can remove any, and that is audited.
 *
 * Invariants:
 *  - Comment text is member-typed, so it goes in through textContent only (see dom.js).
 *  - A guest reads the thread but sees a sign-in prompt where the box would be; the server refuses a
 *    guest's comment anyway.
 *  - The count shown on the post is the server's count from the last answer, never a local tally, so
 *    two people commenting at once cannot leave it wrong.
 */
import { el } from './dom.js';
import { Button } from '../ui/Button.js';
import { t, getLanguage } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { formatRelativeTime } from '../../services/format.js';
import {
  listComments, addComment, deleteComment, removeComment, errorText, COMMENT_MAX,
} from '../../services/community.api.js';

/**
 * @param {object} o
 * @param {object} o.post
 * @param {string|null} o.viewerRole        the viewer's role key, null for a guest
 * @param {boolean} [o.canModerate]
 * @param {(count:number)=>void} o.onCount  called with the server's comment count after every change
 */
export function CommentThread({ post, viewerRole, canModerate = false, onCount }) {
  const root = el('section', 'cm-thread', null, { 'aria-label': t('community.comment.title') });
  const list = el('div', 'cm-thread__list', null, { 'aria-live': 'polite' });
  const more = el('div', 'cm-thread__more');
  const form = el('div', 'cm-thread__form');
  root.append(list, more, form);

  let comments = [];
  let hasMore = false;
  let loading = true;

  function row(c) {
    const lang = getLanguage();
    const mayRemove = c.is_mine || canModerate;
    const item = el('article', 'cm-comment', null, { 'data-comment-id': c.id });
    item.append(
      el('span', `cm-avatar cm-avatar--${c.author.role === 'super_admin' ? 'admin' : c.author.role} cm-avatar--sm`, c.author.initials, { 'aria-hidden': 'true' }),
      el('div', 'cm-comment__main', [
        el('div', 'cm-comment__head', [
          el('strong', 'cm-comment__name', c.author.name),
          el('span', `cm-role cm-role--${c.author.role === 'super_admin' ? 'admin' : c.author.role}`, t(`community.role.${c.author.role === 'super_admin' ? 'admin' : c.author.role}`)),
          el('span', 'cm-comment__time', formatRelativeTime(c.created_at, { lang })),
        ]),
        el('p', 'cm-comment__body', c.body),
      ]),
    );
    if (mayRemove) {
      const label = c.is_mine ? t('community.comment.delete') : t('community.comment.remove');
      const btn = el('button', 'cm-comment__remove', label, { type: 'button' });
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const res = await (c.is_mine ? deleteComment(c.id) : removeComment(c.id));
          comments = comments.filter((x) => x.id !== c.id);
          onCount(res.comment_count);
          draw();
        } catch (err) {
          toast.error(errorText(err) || t('community.error.generic'));
          btn.disabled = false;
        }
      });
      item.append(btn);
    }
    return item;
  }

  function draw() {
    list.replaceChildren(...(comments.length
      ? comments.map(row)
      : [el('p', 'cm-muted', t(loading ? 'community.loading' : 'community.comment.empty'))]));
    more.replaceChildren();
    if (hasMore) {
      more.append(Button({ label: t('community.comment.more'), variant: 'ghost', size: 'sm', onClick: () => load(false) }));
    }
  }

  async function load(reset) {
    loading = true;
    try {
      const res = await listComments(post.id, { offset: reset ? 0 : comments.length });
      comments = reset ? res.comments : comments.concat(res.comments);
      hasMore = Boolean(res.meta.has_more);
      onCount(res.comment_count);
    } catch (err) {
      toast.error(errorText(err) || t('community.error.generic'));
    } finally {
      loading = false;
      draw();
    }
  }

  function drawForm() {
    form.replaceChildren();
    if (!viewerRole) {
      form.append(el('p', 'cm-muted', [t('community.comment.sign_in'), ' ', el('a', 'cm-link', t('community.sign_in'), { href: '/login' })]));
      return;
    }
    const box = el('textarea', 'textarea cm-thread__input', null, {
      rows: 2, maxlength: COMMENT_MAX, placeholder: t('community.comment.placeholder'), 'aria-label': t('community.comment.placeholder'),
    });
    const error = el('p', 'cm-composer__error cm-thread__error', '', { role: 'alert' });
    const send = Button({
      label: t('community.comment.post'),
      size: 'sm',
      onClick: async () => {
        error.textContent = '';
        if (!box.value.trim()) { error.textContent = t('community.comment.write_first'); return; }
        send.disabled = true;
        try {
          const res = await addComment(post.id, box.value);
          comments.push(res.comment);
          box.value = '';
          onCount(res.comment_count);
          draw();
        } catch (err) {
          error.textContent = errorText(err) || t('community.error.generic');
        } finally {
          send.disabled = false;
        }
      },
    });
    form.append(box, el('div', 'cm-thread__send', [error, send]));
  }

  drawForm();
  draw();
  load(true);
  return root;
}
