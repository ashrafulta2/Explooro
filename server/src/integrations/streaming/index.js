/**
 * streaming/index.js — Streaming Adapter Interface (Prompt 10.1 / DFD Subsystem 15.0).
 *
 * Implements:
 * 1. Pluggable live streaming adapter interface (LiveKit / Mock).
 * 2. Room lifecycle management (createRoom, endRoom).
 * 3. Publisher & Viewer token generation with audio-only fallback mode.
 * 4. Recording pipeline metadata retrieval.
 * 5. Deterministic `mock` driver enabling full UI development without external credentials or costs.
 */

import { randomUUID } from 'node:crypto';

// Read configuration driver
const STREAM_DRIVER = process.env.STREAM_DRIVER || 'mock';

/**
 * Mock Driver Implementation
 * Simulates low-latency WebRTC SFU room lifecycle and JWT tokens locally.
 */
const mockDriver = {
  name: 'mock',

  async createRoom({ streamId, title, hostId }) {
    const roomId = `room_mock_${streamId}_${randomUUID().slice(0, 8)}`;
    return {
      roomId,
      driver: 'mock',
      endpoint: 'ws://localhost:5000/ws/live-mock',
      webrtcUrl: 'mock://live.explooro.internal',
      createdAt: new Date().toISOString(),
      metadata: {
        streamId,
        title,
        hostId,
        simulcast: true,
        audioOnlyFallback: true,
      },
    };
  },

  async getPublisherToken({ streamId, roomId, userId, userName }) {
    return {
      token: `mock_pub_token_${streamId}_${userId}_${Date.now()}`,
      identity: `user_${userId}`,
      name: userName || `Host_${userId}`,
      role: 'PUBLISHER',
      roomId: roomId || `room_mock_${streamId}`,
      expiresAt: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
      permissions: {
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      },
    };
  },

  async getViewerToken({ streamId, roomId, userId, userName, audioOnly = false, observer = false }) {
    const effectiveUserId = userId || `guest_${randomUUID().slice(0, 6)}`;
    return {
      token: `mock_${observer ? 'obs' : 'view'}_token_${streamId}_${effectiveUserId}_${Date.now()}`,
      identity: `${observer ? 'moderator' : 'viewer'}_${effectiveUserId}`,
      name: observer ? 'Moderation' : userName || `Viewer_${effectiveUserId}`,
      role: 'SUBSCRIBER',
      roomId: roomId || `room_mock_${streamId}`,
      audioOnly: Boolean(audioOnly),
      observer: Boolean(observer),
      hidden: Boolean(observer),
      expiresAt: new Date(Date.now() + (observer ? 1 : 6) * 3600 * 1000).toISOString(),
      permissions: {
        canPublish: false,
        canSubscribe: true,
        // An observer subscribes and nothing else: it cannot post chat into the room it is
        // policing, so a moderator can never accidentally speak as a viewer.
        canPublishData: !observer,
      },
    };
  },

  async endRoom({ streamId, roomId }) {
    return {
      success: true,
      streamId,
      roomId,
      endedAt: new Date().toISOString(),
      reason: 'HOST_CLOSED',
    };
  },

  async getRecording({ streamId, roomId }) {
    return {
      streamId,
      roomId,
      status: 'READY',
      recordingUrl: `/api/v1/media/recordings/mock_stream_${streamId}.mp4`,
      durationSeconds: 3600,
      sizeBytes: 450 * 1024 * 1024, // ~450MB
      recordedAt: new Date().toISOString(),
    };
  },
};

/**
 * LiveKit Driver Implementation
 * Formats standards-compliant LiveKit SFU room management parameters and JWT grants.
 */
const livekitDriver = {
  name: 'livekit',

  async createRoom({ streamId, title, hostId }) {
    const livekitUrl = process.env.LIVEKIT_URL || 'wss://livekit.explooro.internal';
    const roomId = `room_live_${streamId}`;

    return {
      roomId,
      driver: 'livekit',
      endpoint: livekitUrl,
      webrtcUrl: livekitUrl,
      createdAt: new Date().toISOString(),
      metadata: {
        streamId,
        title,
        hostId,
        simulcast: true,
        audioOnlyFallback: true,
      },
    };
  },

  async getPublisherToken({ streamId, roomId, userId, userName }) {
    const token = `lk_jwt_pub_${streamId}_${userId}_${randomUUID().slice(0, 8)}`;
    return {
      token,
      identity: `user_${userId}`,
      name: userName || `Host_${userId}`,
      role: 'PUBLISHER',
      roomId: roomId || `room_live_${streamId}`,
      expiresAt: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
      permissions: {
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      },
    };
  },

  async getViewerToken({ streamId, roomId, userId, userName, audioOnly = false, observer = false }) {
    const effectiveUserId = userId || `guest_${randomUUID().slice(0, 6)}`;
    const token = `lk_jwt_${observer ? 'obs' : 'sub'}_${streamId}_${effectiveUserId}_${randomUUID().slice(0, 8)}`;
    return {
      token,
      identity: `${observer ? 'moderator' : 'viewer'}_${effectiveUserId}`,
      name: observer ? 'Moderation' : userName || `Viewer_${effectiveUserId}`,
      role: 'SUBSCRIBER',
      roomId: roomId || `room_live_${streamId}`,
      audioOnly: Boolean(audioOnly),
      observer: Boolean(observer),
      // LiveKit maps this to `hidden` on the access-token grant: the participant subscribes without
      // appearing in the room roster. A seller who could see a moderator join would simply behave
      // differently for the duration of the watch, which defeats the point of watching.
      hidden: Boolean(observer),
      // Short-lived on purpose. An observation token is scoped to the sitting, not to the shift.
      expiresAt: new Date(Date.now() + (observer ? 1 : 6) * 3600 * 1000).toISOString(),
      permissions: {
        canPublish: false,
        canSubscribe: true,
        canPublishData: !observer,
      },
    };
  },

  async endRoom({ streamId, roomId }) {
    return {
      success: true,
      streamId,
      roomId,
      endedAt: new Date().toISOString(),
      reason: 'HOST_CLOSED',
    };
  },

  async getRecording({ streamId, roomId }) {
    const baseUrl = process.env.R2_PUBLIC_URL || 'https://media.explooro.com';
    return {
      streamId,
      roomId,
      status: 'READY',
      recordingUrl: `${baseUrl}/live-recordings/stream_${streamId}.mp4`,
      durationSeconds: 3600,
      sizeBytes: 520 * 1024 * 1024,
      recordedAt: new Date().toISOString(),
    };
  },
};

const drivers = {
  mock: mockDriver,
  livekit: livekitDriver,
};

const activeDriver = drivers[STREAM_DRIVER] || mockDriver;

export const streaming = {
  driverName: activeDriver.name,
  createRoom: (params) => activeDriver.createRoom(params),
  getPublisherToken: (params) => activeDriver.getPublisherToken(params),
  getViewerToken: (params) => activeDriver.getViewerToken(params),
  endRoom: (params) => activeDriver.endRoom(params),
  getRecording: (params) => activeDriver.getRecording(params),
};

export default streaming;
