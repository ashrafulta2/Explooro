# Explooro — Live Streaming Architecture & Technology Decision

> **Produced by:** Prompt 10.1  
> **Enforces:** DFD Subsystem 15.0 (Live Stream Commerce Engine) & PRD Live Commerce Specification  
> **Status:** **APPROVED & LOCKED** (Standard: **LiveKit SFU + Adaptive WebRTC & Audio Fallback**)

---

## 1. Executive Summary & Problem Context

Explooro is a social commerce and zero-inventory reseller marketplace built for Bangladesh. In interactive live commerce (the Shopee Live / TikTok Shop model), hosts broadcast real-time video demonstrations, answer customer questions live, pin featured products dynamically onto viewers' screens, and viewers purchase pinned items via 1-click in-stream checkout without interrupting the video stream.

Unlike passive VOD or sports broadcasting, **live stream commerce demands sub-500ms glass-to-glass latency**:
- If a host announces *"The next 10 buyers get this saree for ৳1,200 — 3, 2, 1, pinned!"*, a 5–15 second HLS delay breaks the interactive auction/flash-deal dynamic completely.
- Viewers chatting or asking questions need to hear the host answer in real time.

However, Bangladesh presents unique infrastructural and economic constraints:
1. **Mobile Data Costs for Customers:** Millions of mobile internet users in Bangladesh rely on metered 3G/4G prepaid data packs (typically ৳30–৳100 per GB). High-bitrate video streams drain buyer data packages in minutes.
2. **Server Egress & Bandwidth Economics:** Video bandwidth is the single largest operating expense in live commerce. A poorly chosen streaming protocol or vendor pricing model will bankrupt a regional platform on viewer spikes.
3. **Flutter Mobile Compatibility:** Explooro's cross-platform mobile app (Phase 12) requires first-class Flutter Android and iOS SDKs with hardware acceleration and background audio playback.

---

## 2. Evaluation Criteria

| Criterion | Weight | Requirement / Target for Explooro |
| :--- | :---: | :--- |
| **Glass-to-Glass Latency** | **25%** | **< 500 ms** (WebRTC / ultra-low latency) to support synchronous chat, auction countdowns, and instant product pinning. |
| **Bandwidth Cost & Scalability** | **30%** | Predictable egress costs with self-hosting or low-cost regional CDN integration (e.g. Cloudflare Stream / BGP peering in Dhaka / SG). |
| **Bangladeshi Mobile Optimization** | **20%** | Support for **Simulcast (720p / 480p / 360p)** and **Audio-Only low-bandwidth fallback (64 kbps)** for 3G/poor network conditions. |
| **Mobile & Flutter SDK Quality** | **15%** | Production-ready Flutter SDK, Web client zero-dependency compatibility, and iOS/Android hardware codec support. |
| **Vendor Lock-in & Self-Hostability** | **10%** | Open-source core with zero proprietary lock-in, allowing transition from managed cloud to local VPS / bare-metal SFU clusters. |

---

## 3. Technology Options Evaluated

### Option A: LiveKit (Self-Hosted SFU or LiveKit Cloud) — **CHOSEN**
- **Architecture:** WebRTC SFU (Selective Forwarding Unit) written in Go.
- **Latency:** **< 200 ms** end-to-end globally.
- **Protocol:** WebRTC with automatic Adaptive Bitrate (SVC/Simulcast) and audio-only fallback track.
- **Flutter / Mobile:** Official, active, battle-tested `livekit_client` Flutter plugin.
- **Cost Structure:**
  - *Self-Hosted:* **$0 software license** (Apache 2.0). Pay only for cloud/VPS network egress ($0.01–$0.04/GB or flat-rate unmetered bandwidth on regional servers).
  - *LiveKit Cloud:* Free tier (50 GB/mo), then $0.004 per participant minute or $0.05/GB.
- **Recording & Moderation:** Built-in Egress service for composite MP4 recording to S3/Cloudflare R2 and real-time moderator participant management.

### Option B: Agora.io Interactive Live Streaming (RTC) — **REJECTED**
- **Architecture:** Proprietary global Software-Defined Real-time Network (SD-RTN).
- **Latency:** < 300 ms.
- **Why Rejected:**
  1. **Prohibitive Cost at Scale:** Agora charges per participant minute ($0.99 to $3.99 per 1,000 participant minutes depending on HD resolution). At 10,000 concurrent viewers for a 2-hour mega stream, a single broadcast costs over $25–$50+ in SaaS fees alone, regardless of actual data transferred.
  2. **Closed-Source Lock-in:** Proprietary protocols, closed server software, and zero ability to self-host or negotiate local bandwidth peering in Bangladesh.

### Option C: Mux Video / Cloudflare Stream (LL-HLS / HLS) — **REJECTED**
- **Architecture:** RTMP ingest with Low-Latency HLS (LL-HLS) distribution over CDN.
- **Latency:** **2,000 ms to 5,000 ms (2–5 seconds)**.
- **Why Rejected:**
  1. **Unacceptable Latency for Commerce:** 3–5 seconds delay prevents live product bidding, live chat synchronization, and real-time host-to-buyer interaction.
  2. **High Start-up Latency:** HLS chunk buffer delay causes a 3–6 second black-screen spin when viewers switch between live rooms.

### Option D: Self-Hosted SRS (Simple Realtime Server) or OvenMediaEngine — **REJECTED**
- **Architecture:** Open-source WebRTC / OME streaming servers.
- **Why Rejected:**
  1. **Immature Flutter Ecosystem:** Lack of official, maintained Flutter mobile SDKs compared to LiveKit.
  2. **Complex Client Orchestration:** Hand-rolling multi-track WebRTC negotiation, simulcast renegotiation, and connection recovery across flaky 3G mobile networks requires massive engineering overhead.

---

## 4. Quantified Bandwidth Cost Comparison

The table below calculates the network data transfer and estimated server/cloud cost for a **1-hour live stream** across 3 concurrent viewer tiers and 3 resolution profiles:

### Bitrate Profiles
- **720p HD (High Quality / Wi-Fi):** Video 1,400 kbps + Audio 96 kbps = **1,500 kbps** (~675 MB per viewer/hour)
- **480p SD (Standard Mobile 4G):** Video 600 kbps + Audio 64 kbps = **664 kbps** (~298 MB per viewer/hour)
- **Audio-Only (Low-Bandwidth / 3G Mobile Saver):** Audio 64 kbps = **64 kbps** (~28.8 MB per viewer/hour)

### 1-Hour Stream Bandwidth & Cost Breakdown

| Concurrent Viewers | Profile | Data Egress (GB) | Est. Cost: Self-Host SFU ($0.02/GB Egress) | Est. Cost: LiveKit Cloud ($0.05/GB) | Est. Cost: Agora ($1.99/1k min HD) |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **100 Viewers** | 720p HD (1.5 Mbps) | **67.5 GB** | **$1.35** (৳160 BDT) | **$3.38** (৳400 BDT) | **$11.94** (৳1,430 BDT) |
| 100 Viewers | 480p SD (664 kbps) | **29.8 GB** | **$0.60** (৳72 BDT) | **$1.49** (৳178 BDT) | **$7.50** (৳900 BDT) |
| 100 Viewers | Audio-Only (64 kbps) | **2.88 GB** | **$0.06** (৳7 BDT) | **$0.14** (৳17 BDT) | **$4.00** (৳480 BDT) |
| **1,000 Viewers** | 720p HD (1.5 Mbps) | **675 GB** | **$13.50** (৳1,620 BDT) | **$33.75** (৳4,050 BDT) | **$119.40** (৳14,320 BDT) |
| 1,000 Viewers | 480p SD (664 kbps) | **298 GB** | **$5.96** (৳715 BDT) | **$14.90** (৳1,788 BDT) | **$75.00** (৳9,000 BDT) |
| 1,000 Viewers | Audio-Only (64 kbps) | **28.8 GB** | **$0.58** (৳70 BDT) | **$1.44** (৳172 BDT) | **$40.00** (৳4,800 BDT) |
| **10,000 Viewers** | 720p HD (1.5 Mbps) | **6,750 GB** | **$135.00** (৳16,200 BDT) | **$337.50** (৳40,500 BDT) | **$1,194.00** (৳143,280 BDT) |
| 10,000 Viewers | 480p SD (664 kbps) | **2,980 GB** | **$59.60** (৳7,152 BDT) | **$149.00** (৳17,880 BDT) | **$750.00** (৳90,000 BDT) |
| 10,000 Viewers | Audio-Only (64 kbps) | **288 GB** | **$5.76** (৳691 BDT) | **$14.40** (৳1,728 BDT) | **$400.00** (৳48,000 BDT) |

### Key Economic Findings:
1. **Self-hosted LiveKit SFU provides an 88% cost reduction** compared to Agora at 10,000 viewers ($135 vs $1,194).
2. **Audio-Only fallback reduces bandwidth by 95.7%** (from 675 MB/hr to 28.8 MB/hr). Enabling audio-only mode ensures that buyers on budget 1 GB mobile packs can listen and purchase for over 34 hours without exhausting their data pack.

---

## 5. Architectural Decision & Implementation Standard

1. **Standard Streaming Protocol:** WebRTC through LiveKit SFU adapter abstraction (`server/src/integrations/streaming/index.js`).
2. **Pluggable Drivers:**
   - `STREAM_DRIVER=mock` (**Default in Development**): Zero external dependency, full host and viewer simulation, animated presenter video playback, pin sync, live chat, and audio-mode toggle.
   - `STREAM_DRIVER=livekit`: Generates JWT room access tokens for publishers and subscribers using LiveKit credentials (`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL`).
3. **Adaptive Bitrate & Mobile Mode:**
   - WebRTC Simulcast layers: 720p (high), 480p (mid), 360p (low).
   - Audio-Only toggle in the viewer UI to disable the video track subscription and consume only 64 kbps audio.
4. **Data Sync & Real-Time Events:**
   - Video/audio media flows through WebRTC.
   - Product pinning, real-time reactions, chat messages, moderator mute/kick events, and live sales alerts flow through the **Explooro WebSocket Gateway** (`/ws` via `presence.js`), ensuring instant synchronization (< 500 ms) without loading media servers with high-frequency JSON message parsing.
5. **Recording & Replays:**
   - Live stream sessions are recorded composite to Cloudflare R2 / S3 storage via the media pipeline for review integrity, moderation audit, and shoppable short-video replay clips.
