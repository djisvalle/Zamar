# Spec: Multi-Device, Online, Persistent Sync for Live Stage

## Status

Design spec only — **not implemented**. This document describes a possible future
capability. It deliberately does not touch `src/`. Per `CLAUDE.md`, the current mockup
is single-device, offline, and reseeds from `src/state/mockData.ts` on every reload —
none of that changes as a result of this file existing. Treat this as the spec a real
implementation would be built against, kept separate so the mockup's "no persistence or
sync" scope stays honest and easy to point to.

## 1. Problem

Today, Live Stage (`src/screens/live-stage/`) is one device's private view of one
device's in-memory `stage` state. A worship team running multiple devices on stage
(leader on a tablet, vocalists/band on phones) has no way to see the same song, the
same transposed key, the same scroll position, or the same annotations at the same time
— every device is its own island. The goal of this spec is a **live-sync layer**: one
leader device drives what every follower device displays, in real time, during a live
set, with the setlist/song data itself persisted and synced outside of the live session
too (so a change made at home shows up on every device before the next rehearsal).

This is two related but separable problems:

- **A. Live session sync** — low-latency, ephemeral, "what's on screen right now"
  (current song, scroll/section position, key, capo, annotate-mode marks). Must work
  with venue Wi-Fi that is slow, absent, or captive-portal-gated.
- **B. Data persistence & sync** — durable, cross-session, "what's in the library"
  (songs, setlists, settings). Needs to survive app restarts and propagate to devices
  that weren't in the room for a given edit.

A device can need (A) without (B) (an ad-hoc rehearsal with local-only songs) and (B)
without (A) (solo practice, no other devices present). They're built as independent
layers, not one monolith.

## 2. Goals / Non-Goals

**Goals**

- One "leader" device's Live Stage state (current song, position, key/capo, chord vs.
  sheet view) mirrors to N "follower" devices within ~200ms on a local network.
- Works with no internet connectivity — most venues cannot be assumed to have usable
  Wi-Fi, and cellular is unreliable indoors.
- Setlists/songs/settings edited on one device eventually appear on all the user's
  other devices (and, if the team feature ships, teammates' devices), including edits
  made while offline.
- Sync is resilient to devices joining late, dropping mid-set, and rejoining.
- No account/server dependency for the local-only, single-user case — sync should not
  regress the "no login required" experience the mockup implies.

**Non-Goals (v1)**

- Multi-leader / co-editing during a live session (only one device drives the room at a
  time; see §4).
- Cross-organization sharing / public setlist links.
- Real-time collaborative *editing* of a song's chord chart during a live session
  (editing happens in `add-edit-song/`, outside the live session).
- Video/audio streaming between devices — this is state sync only (text/JSON-sized
  payloads), not media.
- Drag-and-drop run-sheet reordering sync — out of scope until reordering itself exists
  in the base app (noted as unbuilt in `CLAUDE.md`).

## 3. User Scenarios

1. **Band on stage, no venue Wi-Fi.** Worship leader's iPad is the leader device.
   Guitarist and bassist's iPhones join as followers over a local peer-to-peer link
   (no router, no internet). Leader advances to the next song; both followers' screens
   change within a beat. Leader transposes on the fly (capo comes off); followers'
   chord charts re-render in the new key immediately.
2. **Rehearsal at home, real Wi-Fi.** Same flow, but over the home network — should
   use standard local networking (mDNS/Bonjour-style discovery) instead of a
   peer-to-peer radio link, since Wi-Fi is already available and cheaper on battery.
3. **Solo practice, no other devices.** No session is ever started; Live Stage behaves
   exactly as it does today. Live-sync must be fully opt-in and invisible when unused.
4. **Setlist edited during the week, everyone syncs before Sunday.** A song's chords are
   fixed on the leader's laptop-class device (or an add-edit-song session on a phone)
   on Tuesday. By Sunday, every team member's device has the corrected chart —
   independent of whether they're in a live session — because it synced through the
   persistence layer (§7), not the live-session layer (§6).
5. **Late join / reconnect.** A follower's device is in airplane mode for a song and a
   half, then reconnects. It must catch up to the leader's *current* state on
   reconnect (not replay every intermediate event) — see §6.4.
6. **Leader handoff.** The person running point hands their phone to someone else
   mid-set (device swap, or app crash/restart). The room should not go dark — see §6.5.

## 4. Session Model

- **Session** = one ephemeral live-sync group, scoped to one setlist (or ad-hoc song
  queue), created by a device that becomes the **leader**.
- **Leader**: the single source of truth for live playback state for the session's
  duration. Only the leader's local Live Stage interactions (song navigation, transpose,
  capo, chord/sheet toggle, annotate strokes) produce outbound sync events.
- **Follower**: read-only with respect to shared state. A follower's own UI (e.g.
  scrolling ahead to peek at the next verse) is local-only and does not affect what
  other followers see, and snaps back to the leader's position on the leader's next
  update (a follower is never left permanently diverged).
- **Session code / pairing**: leader generates a short human-readable code (e.g. a
  6-character code, mirrored as a QR code) at "Start Live Session." Followers join via
  the code or by scanning the QR, not via open broadcast-join — prevents a stranger's
  phone in Bluetooth/Wi-Fi range from joining silently.
- **One leader at a time.** A follower can request "make me leader" (explicit handoff,
  requires leader's device to confirm or timeout-approve); the protocol never
  auto-resolves two devices claiming leadership simultaneously — last-writer-wins on
  state is explicitly out for the *live* layer (see §6.5 for why persistence's CRDT
  approach doesn't apply here).

## 5. Transport Layer

Two transports, selected automatically per §5.3, not exposed as a user-facing setting
beyond an "online/offline" indicator.

### 5.1 Local, no-internet transport (primary for live use)

The venue-Wi-Fi-is-unreliable scenario (§3.1) is the priority case, so the local
transport must not depend on a router or internet path at all.

- **iOS**: `MultipeerConnectivity` (`MCSession` + `MCNearbyServiceAdvertiser` /
  `MCNearbyServiceBrowser`). Handles Wi-Fi (infrastructure or peer-to-peer/AWDL) and
  Bluetooth transparently, with automatic transport selection and encryption built in.
  This is the concrete instance of the "inherent iOS advantage" discussed earlier: no
  server, no pairing UI to build from scratch, works fully offline, and Apple maintains
  the transport-selection logic across the whole radio stack.
- **Android**: `Nearby Connections API` (Google Play Services) as the closest
  equivalent — P2P cluster or star topology over Bluetooth/Wi-Fi Direct/local Wi-Fi.
  Requires runtime location permission for BLE scanning and has more OEM-driven
  inconsistency than the iOS path; budget extra QA time per device family.
- **Cross-platform fallback**: if Zamar ships on both platforms and a session mixes an
  iOS leader with Android followers (or vice versa), neither `MultipeerConnectivity` nor
  `Nearby Connections` interop directly — fall back to the local-Wi-Fi WebSocket path
  below (still no internet required, just a LAN) rather than trying to bridge two
  incompatible P2P stacks.
- **Local-Wi-Fi WebSocket fallback** (used when devices are cross-platform, or a P2P
  radio session fails to establish): leader device runs a small local WebSocket server
  bound to the LAN; followers discover it via mDNS/Bonjour (`_zamar-live._tcp`) and
  connect directly. No internet required, works on any platform, marginally higher
  latency and setup friction than native P2P but has no platform ceiling.

### 5.2 Internet-relay transport (for remote participants / venues with real internet)

For a follower not physically in the room (a remote vocalist, a second campus), or a
venue where local P2P is blocked by network policy: a thin relay (WebSocket or similar,
e.g. hosted alongside the persistence backend in §7) rebroadcasts the leader's event
stream to internet-connected followers. Same event schema as §6.2 — followers don't
know or care which transport delivered an event.

### 5.3 Transport selection

On "Start Live Session," attempt local transport first (§5.1); if a follower can't be
reached locally within a short timeout, offer to invite them via the internet relay
(§5.2) instead. A session can have a mix of local and relayed followers simultaneously.

## 6. Live Session Sync Protocol

### 6.1 Principle: broadcast state deltas, not commands

The leader emits small, typed events describing *what changed*, not RPCs the follower
executes blindly. Followers apply events to their own local copy of the shared `stage`
shape (same shape as today's `state.stage` in `src/state/store.ts`, extended with a
session/version stamp) and re-render through the existing reducer-driven UI — the sync
layer feeds the same store, it doesn't replace the render path.

### 6.2 Event types (illustrative, not final)

| Event | Payload | Notes |
|---|---|---|
| `session.snapshot` | full `stage` state + setlist/song refs | sent to a follower on join or reconnect (§6.4) |
| `stage.songChanged` | `songId`, `setlistSlotIndex` | leader advanced/rewound |
| `stage.keyChanged` | `displayKey` | transpose toolbar action |
| `stage.capoChanged` | `capo` | capo toolbar action |
| `stage.viewChanged` | `"chords" \| "sheet"` | chord/sheet toggle |
| `stage.scrollPosition` | `sectionIndex` or normalized offset, throttled | coarse position, not pixel-perfect scroll mirroring |
| `stage.annotation` | stroke/marker delta | only if annotate-mode sync is in scope for a given release |
| `session.leaderHandoff` | `newLeaderDeviceId` | explicit handoff (§4) |
| `session.heartbeat` | timestamp | presence / liveness, drives §6.4's staleness detection |

Every event carries a monotonically increasing `seq` number scoped to the session, so a
follower can detect gaps (missed events while briefly disconnected) and knows to request
a fresh `session.snapshot` rather than trying to reconstruct intermediate state.

### 6.3 Ordering & consistency

Within one leader, events are strictly ordered (`seq`) and applied in order; a follower
that receives an out-of-order or gapped `seq` requests a re-snapshot rather than
guessing. There is intentionally no cross-device conflict resolution here — unlike §7,
the live layer has exactly one writer (the leader) by construction, so CRDT/last-write-
wins machinery is unnecessary complexity for this layer specifically.

### 6.4 Late join / reconnect

A follower joining mid-session (or reconnecting after a drop) always requests
`session.snapshot` rather than replaying history — the current state is all that
matters live. Heartbeats (§6.2) let a follower detect it's gone stale (no leader event
in N seconds) and show a small "reconnecting…" indicator rather than silently showing
frozen, wrong content.

### 6.5 Leader handoff / leader loss

- **Explicit handoff**: leader-initiated `session.leaderHandoff`; the new leader's
  device takes over emitting events, the old leader becomes a normal follower.
- **Leader disconnect (crash, device died)**: followers detect missed heartbeats and
  surface "leader disconnected" in the UI rather than guessing who's in charge —
  auto-electing a new leader from among followers is explicitly out of scope for v1
  (it's a live show; a silent, automatic leadership change is worse than a visible
  prompt asking someone to tap "become leader"). A human resolves it in one tap.

## 7. Persistence & Data Sync (non-live)

Independent of any live session, songs/setlists/settings need to survive restarts and
propagate across a user's devices (§3.4).

### 7.1 Storage model

- Local durable store per device (e.g. SQLite or equivalent structured on-device store)
  replacing today's "reseed from `mockData.ts` every reload" behavior — this alone,
  even with zero network sync, is a prerequisite most of this spec depends on and is
  probably the first real milestone (see §9).
- Remote backend as the sync point of truth: a managed backend with built-in
  multi-device sync and offline-write support (e.g. CloudKit on iOS, or a
  cross-platform option like Firestore/Supabase if Android is in scope) rather than a
  hand-rolled sync server. Prefer whichever keeps "no login required for a single-device
  user" true — sync should upgrade the experience, not gate it.

### 7.2 Conflict resolution

Unlike the live layer, persistence *does* need multi-writer conflict handling — two
devices can edit the same song offline and reconnect later. Field-level last-write-wins
by edited-timestamp is sufficient for song/setlist metadata (title, key, tempo); the
chord/lyric body text is higher-risk for silent data loss under naive LWW, so either:
(a) treat the whole chart body as one field under LWW and accept "most recent edit
wins, older edit is lost" as a documented limitation, or (b) adopt a text CRDT /
operational-transform approach if concurrent chart editing turns out to be common
enough to justify the complexity. Start with (a); revisit only if real usage shows it's
a problem.

### 7.3 Sync scope

Per-user library by default; a "team" scope (shared setlists/songs across a worship
team's devices) is a natural extension but introduces permissions (who can edit vs.
view) that are out of scope for this spec — noted as a follow-on, not designed here.

## 8. Data Model Changes Required

The current single-device model (`src/state/store.ts`) assumes one reducer, one
in-memory tree, no identity beyond array position/ids that only need to be unique
locally. Multi-device sync requires, at minimum:

- Stable, globally-unique IDs for songs/setlists/slots (already true if `mockData.ts`
  uses UUID-shaped ids; verify none are re-generated on reseed in a way that would
  collide across devices).
- Per-record `updatedAt` (and ideally `updatedBy`/device origin) for conflict
  resolution (§7.2).
- A session/version stamp on `stage` state distinct from the persisted song/setlist
  data, so live-session sync (ephemeral) and library sync (durable) don't get
  conflated in one "everything syncs the same way" model.
- A local write queue / outbox for offline edits made with no connectivity, flushed on
  reconnect — needed however the remote backend in §7.1 is chosen.

## 9. Platform Strategy

This spec assumes iOS ships first, per the earlier discussion of iOS's native advantage
here: `MultipeerConnectivity` (§5.1) and CloudKit (§7.1) both give an offline-capable,
server-free sync story largely "for free" on iOS, which materially lowers the cost of
Scenario 1 (§3.1) — the highest-priority scenario, since it's the actual live-show
case. If/when Android support is added, budget real engineering time for the
`Nearby Connections` + cross-platform-backend paths in §5.1/§7.1 — they are not drop-in
equivalents, both technically and in terms of per-OEM QA surface.

## 10. Failure Modes to Design For

- Leader loses all connectivity mid-song → followers show "reconnecting," not a frozen
  or blank screen (§6.4/6.5).
- A follower's local clock is wrong → don't rely on wall-clock timestamps for live
  ordering; use the session-scoped `seq` (§6.2), not device time.
- Two devices both think they're leader (race during handoff) → last explicit
  `session.leaderHandoff` wins; a device that receives a snapshot contradicting its own
  belief that it's leader immediately demotes itself to follower.
- Persistence sync conflict during a live session (someone edits a song's chart while
  it's being performed) → live session state already holds the chart content it needs
  (sent in `session.snapshot`/carried with `stage.songChanged`); an in-flight library
  edit must not retroactively alter what's on stage mid-song.
- Airplane-mode / no-radios-available device → live session features are hidden or
  clearly disabled, never silently non-functional.

## 11. Suggested Phasing

1. **Local persistence** (§7.1, on-device only, no network) — replace reseed-on-reload
   with a real local store. Prerequisite for everything else; ships value
   (data survives restart) independent of any sync feature.
2. **Live session sync, local transport only** (§5.1, §6) — the highest-value, most
   distinctive feature (Scenario 1); no backend/account required.
3. **Remote persistence sync** (§7.1 remote leg, §7.2, §8's outbox) — cross-device
   library sync outside of live sessions.
4. **Internet-relay live transport** (§5.2) — remote participants.
5. **Team scope / sharing** (§7.3) — explicitly deferred until the above is solid.

## 12. Open Questions

- Is Android support committed, or is this iOS-only for the foreseeable future? Materially
  changes §5/§7's backend and transport choices and how much cross-platform-fallback
  complexity (§5.1's WebSocket path) is worth building up front.
- Should annotate-mode strokes sync live (§6.2's `stage.annotation`), or is that
  acceptable as leader-device-only for v1?
- What's the expected max session size (followers per leader)? Changes whether a
  star topology (leader fans out directly) is sufficient or a relay/mesh is needed even
  for the local transport.
- Does a "team" concept (§7.3) already exist or is planned elsewhere in the product —
  affects whether persistence sync should be designed single-user-first or
  team-first from the start.

## Addendum: iOS-Only vs. iOS + Android for Live Sync

Direct comparison to inform the platform-strategy decision flagged in §9 and the first
open question in §11.

### iOS-only

| | |
|---|---|
| Local transport (§5.1) | `MultipeerConnectivity` — P2P over Wi-Fi *and* Bluetooth, automatic transport selection/fallback, encrypted, no server, works with zero connectivity. Built and maintained by Apple across the whole radio stack. |
| Persistence backend (§7.1) | CloudKit — multi-device sync, offline-write queue, and per-user auth "for free" via the user's existing Apple ID. No account system to build. |
| Device/OS matrix | Small, controlled. Apple ships one BLE/Wi-Fi stack per generation; background-mode and radio behavior is predictable and directly testable on a handful of devices. |
| Engineering cost | Lowest. §5.1's local transport and §7.1's backend are close to drop-in; most of the spec's remaining work (§6's protocol, §7.2's conflict resolution, §8's data model) is unavoidable regardless of platform. |
| Ceiling | Locks out any team member on Android. For a worship-team tool, this is a real adoption risk — bands are rarely 100% one platform, and a "the drummer can't join the session" gap undermines the whole feature's value. |

### iOS + Android

| | |
|---|---|
| Local transport (§5.1) | No shared native P2P stack — `MultipeerConnectivity` and `Nearby Connections` don't interoperate. Requires either running both stacks and bridging them, or standardizing on the cross-platform local-Wi-Fi WebSocket fallback (leader hosts a local server, mDNS discovery) for any *mixed* session, which adds a LAN dependency the pure-P2P path avoided. |
| Persistence backend (§7.1) | Needs a platform-neutral backend (e.g. Firestore/Supabase-style) instead of CloudKit, plus a real auth system CloudKit would have given for free. |
| Device/OS matrix | Large and uneven. `Nearby Connections` needs runtime location permission for BLE scanning, and background radio/networking behavior varies meaningfully across OEM skins (especially aggressive battery-management ROMs that kill background connections) — this is the highest-variance part of the whole spec to QA. |
| Engineering cost | Materially higher: two local-transport implementations (or one fallback-only implementation that's slower/less reliable than either native path), a backend that replaces two "free" platform services, and roughly double the device-matrix QA surface. |
| Ceiling | No platform lock-out — every team member can join regardless of device. This is the feature actually working as intended for a real band. |

### The core tradeoff

iOS-only is materially cheaper to build and more reliable in the no-connectivity venue
scenario that matters most (§3.1) — that's the "inherent advantage" from the original
discussion, concretely spelled out in transport/backend terms. But live-sync's entire
value proposition is *everyone in the room seeing the same thing*, and a worship team is
a mixed-device group by default; shipping iOS-only doesn't make the feature worse, it
makes it **unavailable** to any team with a single Android user. That's a different kind
of cost than "more engineering effort" — it's a ceiling on who the feature can ever
serve, and it doesn't shrink as the engineering budget grows.

### Recommendation

Ship iOS-only for the phase-1 milestones in §11 (local persistence, then local-transport
live sync) to validate the protocol (§6) and UX cheaply and quickly. Treat Android
support as a planned second phase, not a maybe — design §6's event schema and §7's data
model platform-agnostically from the start (they already are) specifically so that
adding `Nearby Connections` + a cross-platform backend later is additive, not a rewrite.
Avoid the trap of letting iOS-only convenience quietly become a permanent architectural
assumption baked into the sync protocol itself.
