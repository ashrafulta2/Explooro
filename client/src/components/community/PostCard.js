/**
 * PostCard — one post on the community timeline.
 *
 * Every post shares one skeleton so the feed scans easily: author line, content, the product it is
 * about, then actions. Only the middle differs by type:
 *   REVIEW        rating + facet bars, liked / could be better, usability tip
 *   UPDATE        stock facts and price tiers (supplier → shop partners)
 *   IDEA          numbered steps (shop partner)
 *   ANNOUNCEMENT  title and message (admin, can be pinned)
 *
 * Invariants:
 *  - All member-typed text goes in through textContent (see dom.js).
 *  - "Verified purchase" renders only from `post.verified_purchase`, which the server derives from
 *    the stored proof of purchase; the author cannot send it.
 *  - Reporting leaves the post visible. It only files the report; the server decides about hiding.
 */
import { el, icon, productTitle } from './dom.js';
import { Button } from '../ui/Button.js';
import { t, getLanguage } from '../../services/i18n.js';
import { toast } from '../../services/toast.js';
import { formatBdt, formatNumber, formatRelativeTime } from '../../services/format.js';
import { REPORT_REASONS, errorText } from '../../services/community.api.js';

function stars(n) {
  // WHY an SVG and not the ★ glyph: amber text on white is ~1.5:1, and a filled-versus-hollow shape
  // also carries the value without relying on colour.
  const wrap = el('span', 'cm-stars', null, { role: 'img', 'aria-label': t('community.card.rating_of', { n }) });
  for (let i = 1; i <= 5; i += 1) wrap.append(el('span', i <= n ? 'cm-star cm-star--on' : 'cm-star', icon('star', 'cm-star__icon')));
  return wrap;
}

function facetBar(label, value) {
  const track = el('span', 'cm-bar__track', el('span', 'cm-bar__fill', null, { style: `width:${value * 20}%` }));
  return el('div', 'cm-bar', [el('span', 'cm-bar__label', label), track, el('span', 'cm-bar__value', `${formatNumber(value)}/5`)]);
}

function productRow(post, { cta = null, note = '' } = {}) {
  if (!post.product) return null;
  const lang = getLanguage();
  const row = el('div', 'cm-product');
  row.append(el('div', 'cm-product__thumb', icon('package')));
  const text = el('div', 'cm-product__text', [
    el('a', 'cm-product__name', productTitle(post.product, lang), { href: `/product/${post.product.ref}` }),
    note ? el('span', 'cm-product__note', note) : null,
  ]);
  row.append(text);
  if (cta) {
    row.append(el('a', 'btn btn--primary btn--sm cm-product__cta', cta, { href: `/product/${post.product.ref}` }));
  }
  return row;
}

/**
 * The photos and video of a post. One file shows large; several share a grid. A photo opens full
 * size in a new tab; a video plays in place (metadata only until played, so a feed of videos stays light).
 */
function mediaGallery(post) {
  if (!post.media?.length) return null;
  const alt = t('community.card.photo_alt', { name: post.author.name });
  const wrap = el('div', `cm-media cm-media--${Math.min(post.media.length, 4)}`);
  for (const m of post.media) {
    if (m.kind === 'VIDEO') {
      wrap.append(el('video', 'cm-media__item cm-media__item--video', null, {
        src: m.url, controls: true, preload: 'metadata', playsinline: true, 'aria-label': t('community.card.video_label', { name: post.author.name }),
      }));
    } else {
      wrap.append(el('a', 'cm-media__link', el('img', 'cm-media__item', null, { src: m.url, alt, loading: 'lazy', decoding: 'async' }), {
        href: m.url, target: '_blank', rel: 'noopener noreferrer',
      }));
    }
  }
  return wrap;
}

function reviewBody(post) {
  const d = post.details;
  const body = el('div', 'cm-body');
  const facets = [['quality', d.quality], ['value', d.value], ['delivery', d.delivery]].filter(([, v]) => v);
  body.append(el('div', 'cm-rate', [
    el('div', 'cm-rate__score', [el('span', 'cm-rate__num', `${formatNumber(d.rating)}.0`), stars(d.rating)]),
    facets.length ? el('div', 'cm-rate__bars', facets.map(([k, v]) => facetBar(t(`community.card.facet.${k}`), v))) : null,
  ]));
  const notes = el('div', 'cm-notes');
  if (d.liked) notes.append(el('p', 'cm-note cm-note--good', [el('strong', '', `${t('community.card.liked')} `), d.liked]));
  if (d.could_improve) notes.append(el('p', 'cm-note', [el('strong', '', `${t('community.card.could_improve')} `), d.could_improve]));
  if (notes.childElementCount) body.append(notes);
  if (d.tip) body.append(el('div', 'cm-tip', [icon('sparkles'), el('span', '', [el('strong', '', `${t('community.card.tip')} `), d.tip])]));
  return body;
}

function updateBody(post) {
  const d = post.details;
  const body = el('div', 'cm-body');
  if (post.body) body.append(el('p', 'cm-text', post.body));
  const facts = [
    [t('community.card.stock'), formatNumber(d.stock)],
    [t('community.card.min_order'), t('community.card.pcs', { n: formatNumber(d.min_order) })],
    [t('community.card.best_price'), formatBdt(d.best_price)],
    d.ships_from ? [t('community.card.ships_from'), d.ships_from] : null,
  ].filter(Boolean);
  body.append(el('dl', 'cm-facts', facts.map(([k, v]) => el('div', 'cm-fact', [el('dt', '', k), el('dd', '', v)]))));
  if (d.tiers?.length) {
    const line = d.tiers.map((x) => t('community.card.tier', { qty: formatNumber(x.min_qty), price: formatBdt(x.price) })).join('  ·  ');
    body.append(el('p', 'cm-tiers', [el('strong', '', `${t('community.card.price_tiers')} `), line]));
  }
  return body;
}

function ideaBody(post) {
  const body = el('div', 'cm-body');
  body.append(el('h3', 'cm-title', post.title));
  if (post.body) body.append(el('p', 'cm-text', post.body));
  body.append(el('ol', 'cm-steps', (post.details.steps || []).map((s, i) => el('li', '', [el('span', 'cm-steps__n', formatNumber(i + 1)), el('span', '', s)]))));
  if (post.details.tags?.length) body.append(el('p', 'cm-tags', post.details.tags.map((x) => `#${x}`).join('  ')));
  return body;
}

function announceBody(post) {
  return el('div', 'cm-body', [el('h3', 'cm-title', post.title), el('p', 'cm-text', post.body)]);
}

function reportPanel(post, { onReport, close, onDone }) {
  let reason = REPORT_REASONS[0];
  const panel = el('div', 'cm-report', null, { role: 'group', 'aria-label': t('community.report.title') });
  panel.append(el('p', 'cm-report__title', t('community.report.title')));
  const picks = el('div', 'cm-chips');
  const buttons = REPORT_REASONS.map((r) => {
    const b = el('button', r === reason ? 'cm-chip cm-chip--on' : 'cm-chip', t(`community.report.reason.${r}`), { type: 'button', 'aria-pressed': r === reason });
    b.addEventListener('click', () => {
      reason = r;
      buttons.forEach((x, i) => {
        const on = REPORT_REASONS[i] === r;
        x.classList.toggle('cm-chip--on', on);
        x.setAttribute('aria-pressed', String(on));
      });
    });
    return b;
  });
  picks.append(...buttons);
  panel.append(picks);
  const send = Button({
    label: t('community.report.send'),
    size: 'sm',
    onClick: async () => {
      send.disabled = true;
      try {
        const res = await onReport(post, { reason });
        toast.success(t(res.already_reported ? 'community.report.already' : 'community.report.sent'));
        onDone(res);
        close();
      } catch (err) {
        toast.error(errorText(err) || t('community.error.generic'));
        send.disabled = false;
      }
    },
  });
  const cancel = Button({ label: t('community.report.cancel'), variant: 'ghost', size: 'sm', onClick: close });
  panel.append(el('div', 'cm-report__actions', [send, cancel, el('span', 'cm-report__hint', t('community.report.stays_live'))]));
  return panel;
}

/**
 * @param {object} o
 * @param {object} o.post                        a serialized post from the API
 * @param {string|null} o.viewerRole             the viewer's role key, null for a guest
 * @param {boolean} [o.canModerate]              shows Hide instead of Report
 * @param {(post:object)=>Promise<{liked:boolean,like_count:number}>} o.onLike
 * @param {(post:object, v:{reason:string})=>Promise<object>} o.onReport
 * @param {(post:object, action:string)=>Promise<void>} [o.onModerate]
 * @param {()=>void} [o.onNeedSignIn]            called when a guest tries to like or report
 */
export function PostCard({ post, viewerRole, canModerate = false, onLike, onReport, onModerate, onNeedSignIn }) {
  const lang = getLanguage();
  const root = el('article', `cm-card cm-card--${post.type.toLowerCase()}`, null, { 'data-post-id': post.id, 'data-type': post.type });
  if (post.is_pinned) root.classList.add('cm-card--pinned');

  const authorName = el('span', 'cm-author__name', post.author.name);
  if (post.verified_purchase) {
    authorName.append(el('span', 'cm-verified', [icon('check_circle'), t('community.card.verified')]));
  }
  const sub = [t(`community.role.${post.author.role}`), formatRelativeTime(post.created_at, { lang })];
  if (post.is_pinned) sub.unshift(t('community.card.pinned'));
  root.append(el('header', 'cm-head', [
    el('span', `cm-avatar cm-avatar--${post.author.role}`, post.author.initials, { 'aria-hidden': 'true' }),
    el('div', 'cm-author', [authorName, el('span', 'cm-author__sub', sub.join('  ·  '))]),
    el('span', 'cm-kind', t(`community.kind.${post.kind}`)),
  ]));

  let content;
  let product = null;
  if (post.type === 'REVIEW') {
    product = productRow(post, { cta: t('community.card.view_product'), note: t('community.card.bought_from_note') });
    content = reviewBody(post);
  } else if (post.type === 'UPDATE') {
    content = updateBody(post);
    product = productRow(post, { cta: viewerRole === 'saler' ? t('community.card.add_to_store') : t('community.card.view_product') });
  } else if (post.type === 'IDEA') {
    content = ideaBody(post);
    product = productRow(post, { cta: t('community.card.shop_this'), note: t('community.card.credit_note', { name: post.author.name }) });
  } else {
    content = announceBody(post);
  }
  root.append(content);
  const gallery = mediaGallery(post);
  if (gallery) root.append(gallery);
  if (product) root.append(product);

  // Actions: a flat row, no borders around each button.
  const likeLabel = post.type === 'REVIEW' ? 'community.card.helpful' : 'community.card.like';
  const likeBtn = el('button', 'cm-action', null, { type: 'button' });
  const paintLike = () => {
    likeBtn.replaceChildren(icon('heart'), el('span', '', `${t(likeLabel)} · ${formatNumber(post.like_count)}`));
    likeBtn.classList.toggle('cm-action--on', post.liked_by_me);
    likeBtn.setAttribute('aria-pressed', String(post.liked_by_me));
  };
  paintLike();
  likeBtn.addEventListener('click', async () => {
    if (!viewerRole) return onNeedSignIn?.();
    likeBtn.disabled = true;
    try {
      const res = await onLike(post);
      post.liked_by_me = res.liked;
      post.like_count = res.like_count;
      paintLike();
    } catch (err) {
      toast.error(errorText(err) || t('community.error.generic'));
    } finally {
      likeBtn.disabled = false;
    }
  });

  const shareBtn = el('button', 'cm-action', [icon('share'), el('span', '', t('community.card.share'))], { type: 'button' });
  shareBtn.addEventListener('click', async () => {
    const url = `${window.location.origin}/community?post=${post.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('community.card.link_copied'));
    } catch {
      toast.info(url);
    }
  });

  const actions = el('footer', 'cm-actions', [likeBtn, shareBtn]);
  let reportSlot = null;

  const closeReport = () => { reportSlot?.remove(); reportSlot = null; };
  if (canModerate) {
    const hide = el('button', 'cm-action cm-action--end', [icon('flag'), el('span', '', t('community.mod.hide'))], { type: 'button' });
    hide.addEventListener('click', () => onModerate?.(post, 'HIDE'));
    actions.append(hide);
  } else if (!post.is_mine) {
    // Nobody reports their own post (the server refuses it too), so the button is simply absent there.
    const report = el('button', 'cm-action cm-action--end cm-action--danger', [icon('flag'), el('span', '', t('community.card.report'))], { type: 'button' });
    report.addEventListener('click', () => {
      if (!viewerRole) return onNeedSignIn?.();
      if (reportSlot) return closeReport();
      reportSlot = reportPanel(post, {
        onReport, close: closeReport,
        onDone: () => { report.disabled = true; },
      });
      root.append(reportSlot);
    });
    actions.append(report);
  }
  root.append(actions);
  return root;
}
