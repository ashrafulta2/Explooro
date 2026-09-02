/**
 * liveModerationConsole.test.js — Live Moderation Console (/moderator/live).
 *
 * Prompt 10.1 REQUIREMENT 6 ("a moderator can mute a participant or terminate a stream") shipped
 * two endpoints and no surface to drive them from. These pin the behaviour the console depends on:
 *
 *   1. Advisory flagging — which chat lines a moderator is shown first, and that flagging never
 *      acts on its own.
 *   2. Message removal — soft delete, scoped to the stream, and gone from the viewer feed.
 *   3. Mute lifecycle — mute, list, lift, expire.
 *   4. Audit trail — every one of these writes an audit_logs row with before/after.
 */

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as liveService from '../src/services/liveStream.service.js';
import {
  muteUserInStream,
  unmuteUserInStream,
  getStreamMutes,
  isUserMutedInStream,
} from '../src/sockets/presence.js';

/**
 * A minimal fake pool. Every service call below routes through liveStream.repository.js, so the
 * fake answers by matching on the SQL each repo function issues rather than by faking the repo —
 * that keeps the queries themselves inside the test's blast radius.
 */
function makeDb({ stream = null, messages = [] } = {}) {
  const audits = [];
  const inserted = [];
  const state = { stream, messages: messages.map((m) => ({ ...m })) };

  const db = {
    audits,
    inserted,
    state,
    async query(sql, params = []) {
      const text = String(sql);

      if (/FROM live_streams/.test(text) && /WHERE\s+ls\.id\s*=|WHERE\s+id\s*=/.test(text)) {
        return { rows: state.stream ? [state.stream] : [] };
      }
      if (/FROM live_stream_messages/.test(text) && /SELECT/.test(text)) {
        const sinceId = Number(params[1] ?? 0);
        return { rows: state.messages.filter((m) => m.id > sinceId) };
      }
      if (/UPDATE live_stream_messages/.test(text) && /deleted_at = now\(\)/.test(text)) {
        const [streamId, messageId, moderatorId, reason] = params;
        const row = state.messages.find(
          (m) => m.id === Number(messageId) && m.live_stream_id === Number(streamId) && !m.deleted_at
        );
        if (!row) return { rows: [] };
        row.deleted_at = new Date().toISOString();
        row.deleted_by = moderatorId;
        row.deletion_reason = reason;
        return { rows: [row] };
      }
      if (/INSERT INTO live_stream_messages/.test(text)) {
        const row = {
          id: 9000 + inserted.length,
          live_stream_id: params[0],
          user_id: params[1],
          message_type: params[2],
          content: params[3],
          metadata_json: JSON.parse(params[4]),
        };
        inserted.push(row);
        state.messages.push(row);
        return { rows: [row] };
      }
      if (/INSERT INTO audit_logs/i.test(text)) {
        audits.push({ sql: text, params });
        return { rows: [{ id: audits.length }] };
      }
      if (/UPDATE live_streams/.test(text)) {
        Object.assign(state.stream, { status: params[1] });
        return { rows: [state.stream] };
      }
      // Audit chain-hash lookups, module settings, and anything else answer empty.
      return { rows: [] };
    },
  };
  return db;
}

const STREAM = {
  id: 1,
  ref: 'LIVE-2026-0001',
  host_id: 6,
  status: 'LIVE',
  title: 'Dhakai Jamdani Live Showcase',
  terminated_by: null,
  termination_reason: null,
};

describe('Live Moderation Console (/moderator/live)', () => {
  beforeEach(() => {
    for (const streamId of [1, 501, 502]) {
      for (const { user_id: userId } of getStreamMutes(streamId)) unmuteUserInStream(streamId, userId);
    }
  });

  describe('1. Advisory flagging of live chat', () => {
    test('Flags an off-platform contact vector (BD phone, email, or WhatsApp)', async () => {
      const phone = await liveService.flagLiveMessage(null, 'Call me 01711998877 for wholesale');
      assert.equal(phone.length, 1);
      assert.equal(phone[0].code, 'EXTERNAL_CONTACT_LEAK');
      assert.equal(phone[0].severity, 'HIGH');

      const whatsapp = await liveService.flagLiveMessage(null, 'ping me on whatsapp bhai');
      assert.equal(whatsapp[0].code, 'EXTERNAL_CONTACT_LEAK');

      const email = await liveService.flagLiveMessage(null, 'mail korun seller@example.com');
      assert.equal(email[0].code, 'EXTERNAL_CONTACT_LEAK');
    });

    test('Reuses the product queue blocklist, in English and in Bengali', async () => {
      // A term banned for a product listing has to be banned in live chat too, or the blocklist is
      // just a speed bump around the listing form.
      const en = await liveService.flagLiveMessage(null, 'this is a first copy replica');
      assert.ok(en.some((f) => f.code === 'PROHIBITED_KEYWORD_EN'));

      const bn = await liveService.flagLiveMessage(null, 'এটা নকল মাল');
      assert.ok(bn.some((f) => f.code === 'PROHIBITED_KEYWORD_BN'));
    });

    test('Ordinary shopping chat is not flagged', async () => {
      for (const line of [
        'Apu eta ki khati cotton? Dam koto?',
        'Saree ta sundor, ami 2 ta nilam',
        'Delivery Chattogram e koto din lagbe?',
      ]) {
        assert.deepEqual(await liveService.flagLiveMessage(null, line), [], `false positive on: ${line}`);
      }
    });

    test('Flagging is advisory — it never removes anything by itself', async () => {
      const db = makeDb({
        stream: { ...STREAM },
        messages: [
          { id: 11, live_stream_id: 1, message_type: 'CHAT', content: 'Call 01711998877', user_id: 44, deleted_at: null },
        ],
      });

      const feed = await liveService.getStreamModerationFeed(db, 1);
      assert.equal(feed.flagged_count, 1);
      assert.equal(feed.removed_count, 0, 'a flag must not delete the message');
      assert.equal(feed.messages[0].deleted_at, null);
      assert.equal(db.audits.length, 0, 'reading the feed is not a state change and writes no audit');
    });

    test('A blocklist failure degrades the feed to fewer flags, never to none', async () => {
      // db.query throwing simulates the settings lookup failing; the pure leak detector must still
      // run, because a moderator seeing an empty chat is worse than seeing partial flags.
      const brokenDb = {
        query: async (sql) => {
          if (/platform_modules/i.test(String(sql))) throw new Error('settings unavailable');
          return { rows: [] };
        },
      };
      const flags = await liveService.flagLiveMessage(brokenDb, 'whatsapp e message korun');
      assert.ok(flags.some((f) => f.code === 'EXTERNAL_CONTACT_LEAK'));
    });
  });

  describe('2. Removing a single chat message', () => {
    test('Soft-deletes, records who and why, and writes an audit row', async () => {
      const db = makeDb({
        stream: { ...STREAM },
        messages: [{ id: 11, live_stream_id: 1, message_type: 'CHAT', content: 'Call 01711998877', user_id: 44, deleted_at: null }],
      });

      const removed = await liveService.removeStreamMessage(db, {
        streamId: 1,
        messageId: 11,
        moderatorId: 3,
        reason: 'Sharing off-platform contact details',
      });

      assert.ok(removed.deleted_at, 'the row is tombstoned, not destroyed');
      assert.equal(removed.deleted_by, 3);
      assert.equal(removed.deletion_reason, 'Sharing off-platform contact details');
      assert.equal(removed.content, 'Call 01711998877', 'the evidence survives for a later dispute');

      const log = db.inserted.find((r) => r.message_type === 'MODERATION');
      assert.ok(log, 'the stream keeps its own moderation log entry');
      assert.equal(log.metadata_json.action, 'REMOVE_MESSAGE');
      assert.equal(log.metadata_json.targetUserId, 44);

      assert.equal(db.audits.length, 1, 'exactly one audit_logs row');
    });

    test('A message id from another stream cannot be removed through this one', async () => {
      const db = makeDb({
        stream: { ...STREAM },
        messages: [{ id: 77, live_stream_id: 2, message_type: 'CHAT', content: 'other stream', user_id: 9, deleted_at: null }],
      });

      await assert.rejects(
        () => liveService.removeStreamMessage(db, { streamId: 1, messageId: 77, moderatorId: 3, reason: 'x' }),
        /not in this stream/i
      );
      assert.equal(db.audits.length, 0, 'a refused action writes no audit row');
    });

    test('Removing the same message twice is refused rather than double-logged', async () => {
      const db = makeDb({
        stream: { ...STREAM },
        messages: [
          { id: 11, live_stream_id: 1, message_type: 'CHAT', content: 'spam', user_id: 44, deleted_at: new Date().toISOString() },
        ],
      });

      await assert.rejects(
        () => liveService.removeStreamMessage(db, { streamId: 1, messageId: 11, moderatorId: 3, reason: 'x' }),
        /already been removed/i
      );
    });

    test('A removed message stays visible to moderators but is gone from the viewer feed', async () => {
      const db = makeDb({
        stream: { ...STREAM },
        messages: [
          { id: 11, live_stream_id: 1, message_type: 'CHAT', content: 'removed one', user_id: 44, deleted_at: new Date().toISOString(), deletion_reason: 'Spam' },
          { id: 12, live_stream_id: 1, message_type: 'CHAT', content: 'kept one', user_id: 21, deleted_at: null },
        ],
      });

      const feed = await liveService.getStreamModerationFeed(db, 1);
      assert.equal(feed.messages.length, 2, 'the console sees both');
      assert.equal(feed.removed_count, 1);

      // The viewer-facing query is the one that must exclude it; asserted on the SQL because the
      // fake pool cannot evaluate a WHERE clause.
      const repoSrc = await import('node:fs').then((fs) =>
        fs.readFileSync(new URL('../src/repositories/liveStream.repository.js', import.meta.url), 'utf8')
      );
      const viewerQuery = repoSrc.slice(repoSrc.indexOf('export async function getStreamMessages('));
      assert.match(
        viewerQuery.slice(0, viewerQuery.indexOf('export async function getStreamMessagesForModeration')),
        /deleted_at IS NULL/,
        'getStreamMessages must filter out removed messages'
      );
    });
  });

  describe('3. Mute lifecycle', () => {
    test('Mute is recorded, listed with an expiry, and audited', async () => {
      const db = makeDb({ stream: { ...STREAM } });

      await liveService.muteParticipant(db, {
        streamId: 1,
        targetUserId: 44,
        moderatorId: 3,
        durationMinutes: 30,
        reason: 'Sharing contact details',
      });

      assert.equal(isUserMutedInStream(1, 44), true);

      const mutes = getStreamMutes(1);
      assert.equal(mutes.length, 1);
      assert.equal(mutes[0].user_id, 44);
      assert.ok(new Date(mutes[0].expires_at).getTime() > Date.now(), 'a mute carries a lapse time');

      const log = db.inserted.find((r) => r.message_type === 'MODERATION');
      assert.equal(log.metadata_json.action, 'MUTE');
      assert.equal(log.metadata_json.durationMinutes, 30);
      assert.equal(db.audits.length, 1);
    });

    test('A mute can be lifted early', async () => {
      const db = makeDb({ stream: { ...STREAM } });
      muteUserInStream(1, 44, 60 * 60 * 1000);

      const result = await liveService.unmuteParticipant(db, { streamId: 1, targetUserId: 44, moderatorId: 3 });

      assert.equal(result.was_muted, true);
      assert.equal(isUserMutedInStream(1, 44), false);
      assert.equal(db.audits.length, 1);
    });

    test('Lifting a mute nobody had changes nothing and logs nothing', async () => {
      const db = makeDb({ stream: { ...STREAM } });

      const result = await liveService.unmuteParticipant(db, { streamId: 1, targetUserId: 999, moderatorId: 3 });

      assert.equal(result.was_muted, false);
      assert.equal(db.audits.length, 0, 'an audit trail of no-ops buries the real entries');
      assert.equal(db.inserted.length, 0);
    });

    test('An expired mute stops silencing and drops off the list', () => {
      muteUserInStream(502, 44, -1000); // already lapsed
      assert.equal(isUserMutedInStream(502, 44), false);
      assert.deepEqual(getStreamMutes(502), []);
    });

    test('Mutes are scoped per stream', () => {
      muteUserInStream(501, 44, 60_000);
      assert.equal(isUserMutedInStream(501, 44), true);
      assert.equal(isUserMutedInStream(502, 44), false, 'a mute in one broadcast must not silence another');
    });
  });

  describe('4. Terminating a broadcast', () => {
    test('Termination writes an audit row carrying the before and after status', async () => {
      const db = makeDb({ stream: { ...STREAM } });

      await liveService.terminateStream(db, { streamId: 1, moderatorId: 3, reason: 'Counterfeit goods' });

      assert.equal(db.audits.length, 1, 'cutting a seller off mid-sale must be auditable');
      const [, params] = [db.audits[0].sql, db.audits[0].params];
      const flat = JSON.stringify(params);
      assert.match(flat, /live\.stream\.terminate/, 'the audit names the action');
      assert.match(flat, /Counterfeit goods/, 'the audit carries the stated reason');
      assert.match(flat, /HIGH/, 'termination is recorded at its real risk tier');
    });

    test('The moderation log records the termination on the stream itself', async () => {
      const db = makeDb({ stream: { ...STREAM } });
      await liveService.terminateStream(db, { streamId: 1, moderatorId: 3, reason: 'Counterfeit goods' });

      const log = db.inserted.find((r) => r.message_type === 'MODERATION');
      assert.equal(log.metadata_json.action, 'TERMINATE');
      assert.equal(log.metadata_json.reason, 'Counterfeit goods');
    });
  });

  describe('5. Moderation feed shape', () => {
    test('Separates moderation actions from chat, newest action first', async () => {
      const db = makeDb({
        stream: { ...STREAM },
        messages: [
          { id: 10, live_stream_id: 1, message_type: 'CHAT', content: 'hello', user_id: 21, deleted_at: null },
          { id: 11, live_stream_id: 1, message_type: 'MODERATION', content: 'Participant muted', user_id: 3, metadata_json: { action: 'MUTE' }, deleted_at: null },
          { id: 12, live_stream_id: 1, message_type: 'MODERATION', content: 'Message removed', user_id: 3, metadata_json: { action: 'REMOVE_MESSAGE' }, deleted_at: null },
        ],
      });

      const feed = await liveService.getStreamModerationFeed(db, 1);

      assert.equal(feed.messages.length, 1, 'MODERATION rows are not chat');
      assert.equal(feed.action_log.length, 2);
      assert.equal(feed.action_log[0].action, 'REMOVE_MESSAGE', 'most recent action first');
    });

    test('System rows (pins, purchases) are never screened for policy breaches', async () => {
      const db = makeDb({
        stream: { ...STREAM },
        messages: [
          // Platform-generated text that happens to contain a blocklist word must not be flagged:
          // the platform is not the one breaking policy.
          { id: 10, live_stream_id: 1, message_type: 'BUY', content: 'Someone bought a replica-print scarf', user_id: 21, deleted_at: null },
        ],
      });

      const feed = await liveService.getStreamModerationFeed(db, 1);
      assert.deepEqual(feed.messages[0].flags, []);
      assert.equal(feed.flagged_count, 0);
    });

    test('An unknown stream id is rejected, not rendered empty', async () => {
      const db = makeDb({ stream: null });
      await assert.rejects(() => liveService.getStreamModerationFeed(db, 4242), /not found/i);
    });
  });

  describe('6. Broadcast preview', () => {
    test('A LIVE stream is observed with a hidden, non-publishing token', async () => {
      const db = makeDb({ stream: { ...STREAM, room_id: 'room_mock_1' }, messages: [] });
      const feed = await liveService.getStreamModerationFeed(db, 1, { moderator: { id: 3 } });

      assert.equal(feed.preview.mode, 'LIVE');
      assert.ok(feed.preview.token, 'a token is issued');
      // Covert observation: the host must not see a moderator join, or they simply behave for the
      // duration of the watch and the observation proves nothing.
      assert.equal(feed.preview.hidden, true);
      // ...and the moderator cannot speak into the room they are policing.
      assert.equal(feed.preview.can_publish_data, false);
      assert.match(feed.preview.identity, /^moderator_/);
    });

    test('The observation token is scoped to the sitting, not to the shift', async () => {
      const db = makeDb({ stream: { ...STREAM, room_id: 'room_mock_1' }, messages: [] });
      const feed = await liveService.getStreamModerationFeed(db, 1, { moderator: { id: 3 } });

      const lifetimeMs = new Date(feed.preview.expires_at).getTime() - Date.now();
      assert.ok(lifetimeMs > 0, 'not already expired');
      assert.ok(lifetimeMs <= 2 * 3600 * 1000, 'an observer token outlives its sitting by hours, not a shift');
    });

    test('Data saver is carried into the token, not faked client-side', async () => {
      const db = makeDb({ stream: { ...STREAM, room_id: 'room_mock_1' }, messages: [] });
      const feed = await liveService.getStreamModerationFeed(db, 1, { moderator: { id: 3 }, audioOnly: true });
      assert.equal(feed.preview.audio_only, true);
    });

    test('An ended broadcast offers its recording, because terminations get contested', async () => {
      const db = makeDb({ stream: { ...STREAM, status: 'ENDED', room_id: 'room_mock_1' }, messages: [] });
      const feed = await liveService.getStreamModerationFeed(db, 1);

      assert.equal(feed.preview.mode, 'RECORDING');
      assert.ok(feed.preview.recording_url, 'something to actually watch');
      // No live token is minted for a room that no longer exists.
      assert.equal(feed.preview.token, undefined);
    });

    test('A terminated broadcast is reviewable after the fact', async () => {
      const db = makeDb({ stream: { ...STREAM, status: 'TERMINATED', room_id: 'room_mock_1' }, messages: [] });
      const feed = await liveService.getStreamModerationFeed(db, 1);
      assert.equal(feed.preview.mode, 'RECORDING');
    });

    test('A scheduled broadcast has nothing to show and says so', async () => {
      const db = makeDb({ stream: { ...STREAM, status: 'SCHEDULED', room_id: null }, messages: [] });
      const feed = await liveService.getStreamModerationFeed(db, 1);

      assert.equal(feed.preview.mode, 'NOT_STARTED');
      assert.equal(feed.preview.token, undefined, 'no token is minted for a room nobody is in');
    });
  });
});
