/**
 * CommunityPage — the /community timeline (module `community_posts`).
 *
 * One mixed feed for everyone, narrowed by tabs (Reviews / Updates / Ideas / News) and two small
 * filters (who posted, sort). Each role gets its own post window:
 *   customer review · supplier update · shop partner idea · admin announcement.
 * Staff with `community.post.moderate` also get a Moderation tab: posts go live at once and are
 * reviewed after a report.
 *
 * The stylesheet is imported here, not from main.css, so it ships in this route's chunk and never
 * weighs on the entry bundle (see the CSS-budget note in styles/main.css).
 */
import '../styles/components/community.css';
import { appStore } from '../state/appStore.js';
import { t, getLanguage } from '../services/i18n.js';
import { updateHead } from '../services/seo.js';
import { can } from '../services/permissions.js';
import { isFeatureEnabled } from '../services/featureFlags.js';
import { toast } from '../services/toast.js';
import { formatNumber } from '../services/format.js';
import { Button } from '../components/ui/Button.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { PostCard } from '../components/community/PostCard.js';
import { PostComposer } from '../components/community/PostComposer.js';
import { ModerationQueue } from '../components/community/ModerationQueue.js';
import { el } from '../components/community/dom.js';
import {
  listPosts, toggleLike, reportPost, moderatePost, errorText, ROLE_KINDS,
} from '../services/community.api.js';

const PAGE_SIZE = 20;
const TABS = [
  { key: '', label: 'community.tab.all', count: 'ALL' },
  { key: 'REVIEW', label: 'community.tab.review', count: 'REVIEW' },
  { key: 'UPDATE', label: 'community.tab.update', count: 'UPDATE' },
  { key: 'IDEA', label: 'community.tab.idea', count: 'IDEA' },
  { key: 'ANNOUNCEMENT', label: 'community.tab.announce', count: 'ANNOUNCEMENT' },
];
const FROM = ['', 'customer', 'supplier', 'saler', 'admin'];

export default function CommunityPage(root) {
  const page = el('div', 'cm-page');
  root.append(page);
  const cleanup = () => page.remove();

  if (!isFeatureEnabled('community_posts')) {
    page.append(EmptyState({ title: t('community.disabled_title'), description: t('community.disabled_desc') }));
    return cleanup;
  }

  updateHead({
    title: t('community.page.title'),
    description: t('community.page.desc'),
    canonicalPath: '/community',
    locale: getLanguage(),
    noIndex: true,
  });

  const { auth } = appStore.get();
  const role = auth?.isAuthenticated ? auth.role : null;
  const canPost = Boolean(role) && Array.isArray(ROLE_KINDS[role]) && ROLE_KINDS[role].length > 0 && (
    role === 'admin' || role === 'super_admin' ? can('community.post.announce') : can('community.post.create_own')
  );
  const canModerate = Boolean(role) && can('community.post.moderate');

  const state = { type: '', from: '', sort: 'recent', mine: false, view: 'timeline', posts: [], counts: {}, hasMore: false, loading: false, composing: false };

  const header = el('header', 'cm-header', [
    el('h1', 'cm-header__title', t('community.page.title')),
    el('p', 'cm-header__sub', t('community.page.sub')),
  ]);
  const viewSwitch = el('div', 'cm-segment', null, { role: 'group', 'aria-label': t('community.page.title') });
  const composeSlot = el('div', 'cm-compose');
  const tabs = el('nav', 'cm-tabs', null, { 'aria-label': t('community.page.title') });
  const filters = el('div', 'cm-filters');
  const feed = el('div', 'cm-feed', null, { 'aria-live': 'polite' });
  const more = el('div', 'cm-more');
  const timeline = el('div', 'cm-timeline', [composeSlot, tabs, filters, feed, more]);
  const moderationSlot = el('div', 'cm-moderation');
  page.append(header, viewSwitch, timeline, moderationSlot);

  const needSignIn = () => toast.info(t('community.sign_in_needed'));

  function renderViewSwitch() {
    viewSwitch.replaceChildren();
    if (!canModerate) return;
    for (const [key, label] of [['timeline', t('community.view.timeline')], ['moderation', t('community.view.moderation')]]) {
      const b = el('button', state.view === key ? 'cm-segment__btn cm-segment__btn--on' : 'cm-segment__btn', label, { type: 'button', 'aria-pressed': state.view === key });
      b.addEventListener('click', () => { state.view = key; renderView(); });
      viewSwitch.append(b);
    }
  }

  function renderView() {
    renderViewSwitch();
    timeline.hidden = state.view !== 'timeline';
    moderationSlot.hidden = state.view !== 'moderation';
    if (state.view === 'moderation') {
      moderationSlot.replaceChildren(ModerationQueue({ onChanged: () => load({ reset: true }) }));
    }
  }

  function renderCompose() {
    composeSlot.replaceChildren();
    if (!role) {
      composeSlot.append(el('div', 'cm-card cm-signin', [
        el('span', '', t('community.sign_in_prompt')),
        el('a', 'btn btn--primary btn--sm', t('community.sign_in'), { href: '/login' }),
      ]));
      return;
    }
    if (!canPost) return;
    if (state.composing) {
      composeSlot.append(PostComposer({
        role,
        authorName: appStore.get().auth?.user?.name || '',
        onCancel: () => { state.composing = false; renderCompose(); },
        onPublished: () => {
          state.composing = false;
          state.type = ''; state.from = ''; state.sort = 'recent'; state.mine = false;
          renderCompose();
          renderTabs();
          renderFilters();
          load({ reset: true });
        },
      }));
      return;
    }
    const trigger = el('button', 'cm-compose__trigger', t(`community.composer.placeholder.${role}`), { type: 'button' });
    trigger.addEventListener('click', () => { state.composing = true; renderCompose(); });
    composeSlot.append(el('div', 'cm-card cm-compose__bar', [
      el('span', `cm-avatar cm-avatar--${role === 'super_admin' ? 'admin' : role}`, (appStore.get().auth?.user?.name || '?').slice(0, 2).toUpperCase(), { 'aria-hidden': 'true' }),
      trigger,
    ]));
  }

  function renderTabs() {
    tabs.replaceChildren(...TABS.map((tab) => {
      const on = state.type === tab.key;
      const b = el('button', on ? 'cm-tab cm-tab--on' : 'cm-tab', [
        t(tab.label),
        el('span', 'cm-tab__count', formatNumber(state.counts[tab.count] ?? 0)),
      ], { type: 'button', 'aria-pressed': on });
      b.addEventListener('click', () => { state.type = tab.key; renderTabs(); load({ reset: true }); });
      return b;
    }));
  }

  function renderFilters() {
    const from = el('select', 'select cm-select', FROM.map((r) => el('option', '', t(r ? `community.from.${r}` : 'community.from.all'), { value: r })), { 'aria-label': t('community.filter.from') });
    from.value = state.from;
    from.addEventListener('change', () => { state.from = from.value; load({ reset: true }); });
    const sort = el('select', 'select cm-select', ['recent', 'top'].map((s) => el('option', '', t(`community.sort.${s}`), { value: s })), { 'aria-label': t('community.filter.sort') });
    sort.value = state.sort;
    sort.addEventListener('change', () => { state.sort = sort.value; load({ reset: true }); });
    filters.replaceChildren(from, sort);
    if (role) {
      const mine = el('button', state.mine ? 'cm-chip cm-chip--on' : 'cm-chip', t('community.filter.mine'), { type: 'button', 'aria-pressed': state.mine });
      mine.addEventListener('click', () => { state.mine = !state.mine; renderFilters(); load({ reset: true }); });
      filters.append(mine);
    }
  }

  function renderFeed() {
    feed.replaceChildren();
    if (!state.posts.length) {
      feed.append(state.loading
        ? el('p', 'cm-muted', t('community.loading'))
        : EmptyState({ title: t('community.empty.title'), description: t(state.mine ? 'community.empty.mine' : 'community.empty.desc'), compact: true }));
    }
    for (const post of state.posts) {
      feed.append(PostCard({
        post, viewerRole: role, canModerate,
        onLike: (p) => toggleLike(p.id),
        onReport: (p, v) => reportPost(p.id, v),
        onModerate: async (p, action) => {
          try {
            await moderatePost(p.id, action);
            toast.success(t(`community.mod.done.${action}`));
            load({ reset: true });
          } catch (err) {
            toast.error(errorText(err) || t('community.error.generic'));
          }
        },
        onNeedSignIn: needSignIn,
      }));
    }
    more.replaceChildren();
    if (state.hasMore) {
      more.append(Button({ label: t('community.load_more'), variant: 'secondary', loading: state.loading, onClick: () => load({ reset: false }) }));
    }
  }

  let request = 0;
  async function load({ reset }) {
    const mine = ++request;
    state.loading = true;
    if (reset) { state.posts = []; renderFeed(); }
    try {
      const res = await listPosts({
        type: state.type || undefined, role: state.from || undefined, sort: state.sort, mine: state.mine,
        limit: PAGE_SIZE, offset: reset ? 0 : state.posts.length,
      });
      // A slower, older answer must not overwrite a newer one after a quick filter change.
      if (mine !== request) return;
      state.posts = reset ? res.posts : state.posts.concat(res.posts);
      state.counts = res.counts;
      state.hasMore = Boolean(res.meta.has_more);
    } catch (err) {
      if (mine !== request) return;
      toast.error(errorText(err) || t('community.error.generic'));
    } finally {
      if (mine === request) { state.loading = false; renderTabs(); renderFeed(); }
    }
  }

  renderCompose();
  renderTabs();
  renderFilters();
  renderView();
  load({ reset: true });
  return cleanup;
}
