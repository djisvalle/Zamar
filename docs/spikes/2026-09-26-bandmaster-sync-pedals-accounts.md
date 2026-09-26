# Spike: bandmaster sync, page turners / auto-scroll, accounts

Status: research only. Nothing here is approved or built. Each topic ends with the questions
that need answers before a design spec is written.

The three topics:

1. Several devices following one setlist, driven by one bandmaster.
2. External page-turner pedals, and auto-scroll.
3. Accounts that sync each person's local data.

They depend on each other, so the suggested order is at the end.

---

## What the current code means for all three

- **Stage state is already a clean seam.** Everything a follower needs to mirror is session
  state in the reducer (`StageState` in `src/state/types.ts`): `songId`, `setlistId`,
  `setlistIndex`, `dispKey`, `view`. It changes through a small set of actions (`STAGE_LOAD`,
  `STAGE_ADVANCE`, `STAGE_SET_KEY`, `STAGE_SET_VIEW`, `STAGE_EXIT` in `src/state/store.ts`).
  Live Stage's prev/next already goes through them (`goToSongOffset` in `LiveStage.tsx`). So
  broadcasting "what's on stage" means sending those actions. The stage doesn't need to change.
- **Persistence rewrites every row on each save.** `songsRepo.replaceAll` runs
  `DELETE FROM songs`, then re-inserts every song, all in one debounced `executeSet`.
  Setlists and settings work the same way. Nothing records *what* changed or *when*. There's
  no `updatedAt`, and deletes leave no tombstones. Row-level sync can't be built on top of that.
- **IDs aren't unique across devices.** New IDs come from `Date.now()` (`${songId}-${Date.now()}`,
  `sec-${Date.now()}`, `mark-${Date.now()}`), and seed songs have fixed IDs (`s11`, …) that
  are the same on every install. Two devices can make the same ID, and every device has its own
  "s11".
- **Attachments are stored inside song rows.** `AttachmentVersion.dataUrl` puts whole PDFs,
  photos and `.mxl` files into `songs.attachments_json` as base64. That's workable for one local
  DB. It isn't workable for syncing or sending over a LAN, where a one-letter lyric fix would
  resend every PDF of that song.
- **There's no keep-awake and no keyboard handling.** v4 of the schema removed the unused
  `keepAwake`/`autoscroll` settings. Nothing in `src/` listens for `keydown`.

---

## 1. Bandmaster-led setlist sync

### What it does

One device (the **bandmaster**, or leader) starts a session for a setlist. Other devices
(**followers**) join. When the leader moves to another song (or another key), every follower's
Live Stage follows within about a quarter-second. Everything should work in a room with poor or
no internet.

### Transport options

| Option | Works offline | iOS ↔ Android | Effort | Notes |
|---|---|---|---|---|
| **A. LAN: leader hosts a WebSocket server, followers find it by mDNS/Bonjour** | Yes (needs a shared Wi-Fi or hotspot, not internet) | Yes | Medium–high | Discovery: `capacitor-zeroconf` (Capawesome and forks) publishes and browses Bonjour on iOS and Android. The server side needs a native listener. Community Cordova/Capacitor "local HTTP + WebSocket server" plugins exist, but maturity is unproven, so plan for a small custom plugin (iOS `NWListener`, Android Java-WebSocket/NanoHTTPD). |
| B. Cloud relay (hosted WebSocket/realtime channel) | No | Yes | Low on the client, but needs a backend | Easiest to build. Fails at exactly the venues that matter (church basements, festival fields). Could be a fallback once accounts (§3) bring a backend. |
| C. Bluetooth LE (leader advertises, followers subscribe) | Yes (no Wi-Fi at all) | Yes | High | Messages are tiny, so bandwidth is fine. `@capacitor-community/bluetooth-le` only does the central role, so leader-side advertising needs custom native code. Range and reliability with 6–10 phones is a risk. |
| D. Apple MultipeerConnectivity / Google Nearby | Yes | **No** (each is tied to one platform, or iOS↔Android support is weak) | Medium | Breaks the OS-agnostic rule. |

**Recommendation: A**, with a way around mDNS. Many church and venue Wi-Fi networks isolate
clients or block multicast. The join sheet should therefore also offer "Join by code": the leader's
screen shows a QR code or short code containing `ip:port` plus a session token. Scanning the QR
needs a barcode plugin. A typed code works without one.

**Platform costs to flag (iOS):**
- iOS asks for Local Network permission the first time the app browses or hosts. That needs
  `NSLocalNetworkUsageDescription` and `NSBonjourServices` in `Info.plist`, plus a pre-prompt
  sheet. Per the Gotchas, gate it in the destination screen, like the Tuner mic sheet.
- When the app is in the background, iOS suspends the leader's listener. The leader has to keep
  Zamar in the foreground, which is normal on stage. Screen lock would also kill it, so this
  depends on keep-awake (§2).
- None of this has been tested, since iOS is unverified. Android needs
  `CHANGE_WIFI_MULTICAST_STATE` for mDNS.

**Browser dev:** a browser tab can't host a server. For dev, a `BroadcastChannel` transport
behind the same interface lets two tabs act as leader and follower. That gives a way to test the
protocol without devices.

### Protocol sketch

Send stage commands, not content:

```
leader → follower   hello   { sessionId, setlistId, setlistRev, leaderName }
leader → follower   stage   { seq, setlistId, setlistIndex, songId, dispKey, view? }
follower → leader   join    { deviceName, has: { setlistRev, songIds+revs } }
leader → follower   bundle  { setlist, songs[], attachments? }   // only if the follower is missing things
either              ping/pong  // detect a lost leader; followers show "Bandmaster disconnected"
```

- `seq` is a number that only goes up. Followers ignore stale messages, and a follower that
  reconnects asks for the latest `stage`.
- In the app, this is a small middleware around `dispatch`. When leading, stage actions go out
  after they're applied. When following, received `stage` messages are dispatched locally as
  `STAGE_LOAD`/`STAGE_SET_KEY`. Followers get a "Following <name>" pill and a **Leave** button.

### Content: followers who don't have the songs

This is the real problem. A follower with an empty library can't show song `s42`. Options:

1. **The leader sends a set bundle when a follower joins** (setlist + the songs in it + optionally
   their attachments). It doesn't depend on accounts. It works offline. The export code
   (`utils/exportSet.ts`) already walks a setlist's songs. Base64 PDFs could make this several MB
   per song, which is fine over LAN.
2. Followers must already have the songs (through accounts/team sync, §3). That's cleaner long
   term, but it makes §1 depend on §3.

Recommend (1) for v1. Also needed: what a follower does with a received song. Options are to keep
it only for the session, save it into the library, or ask.

### What the leader controls

Proposed default: song position is **leader-controlled**. **Key** is the leader's concert key, and
each follower keeps any personal offset. **View/version**, annotations, zoom and lyrics-only stay
**personal**, because a violinist on the Violin PDF and a vocalist on chords shouldn't be forced
to one view. Scroll position within a song stays personal (but see "Leader page-turn" in §2).

### Questions

1. Does the leader need to be a player on stage, or can it be a separate device (such as the
   sound desk, or an iPad on a stand)?
2. Can followers move ahead on their own (look ahead, then "snap back to leader"), or is it
   strictly locked?
3. Should the key change follow the leader? What happens for transposing instruments, and should
   capo wait until capo returns?
4. Should received songs be kept, dropped when the session ends, or kept after asking?
5. Is it acceptable to require shared Wi-Fi or a phone hotspot in v1, or must it work with no
   network at all (which means BLE, option C)?
6. Should setlist *edits* the leader makes during a session (reorder, add a song) go to
   followers live, or only the stage position?

---

## 2. External page turner and auto-scroll

### Page-turner pedals (keyboard mode)

Most pedals (AirTurn BT200/Duo/Quad, PageFlip Cicada/Firefly/Butterfly, iRig BlueTurn, Donner)
pair as **Bluetooth keyboards**. They send ↑/↓, ←/→, or Page Up/Page Down, depending on a
mode switch on the pedal. The OS passes these to the WebView as normal `keydown` events on iOS,
Android and desktop browsers. So for most pedals this needs **no native code and no plugin**. It
follows the same approach as Newzik, forScore and unrealBook.

Implementation sketch:
- One `keydown` listener in Live Stage. By default, `ArrowDown`/`ArrowRight`/`PageDown`/`Space`
  is **next** and `ArrowUp`/`ArrowLeft`/`PageUp` is **previous**. Ignore the key when focus is in
  an `input`/`textarea` or while Annotate is open.
- **What "next" does:** scroll the chart pane by one screen minus an overlap, such as 15% so the
  last line stays visible. At the bottom of a song in a setlist, go to the next song
  (`STAGE_ADVANCE`). The reverse for "previous". For PDFs, scrolling a screen is already right for
  `PdfPages`' vertical page stack. Option: "page by PDF page" instead. Scrolling moves the pane,
  not the transformed chart, so `screenScaleOf` doesn't matter here.
- Settings → **Page turner**: choose what each action does (scroll vs. next song). Add a
  "Press your pedal" learn mode that stores `event.code` for pedals in odd modes.

Caveats to flag:
- **iOS hides the on-screen keyboard while any hardware keyboard is connected.** That includes a
  pedal. Quick edit, Cues and Annotate text entry would lose the soft keyboard. forScore
  documents this exact problem. The only fixes are turning the pedal off or switching its mode.
  This needs a help note, since Zamar can't override it.
- A pedal in a **media-key** mode (play/pause, volume) usually doesn't reach the WebView at all.
  Tell users to use arrow or page mode.
- **MIDI footswitches**: iOS WKWebView doesn't support Web MIDI, so these need a native CoreMIDI /
  Android MIDI plugin. Leave this out of v1.

Effort: small, about a day or two plus a Settings row. The best return of the three topics.

### Auto-scroll

- The chart pane scrolls at a steady rate, driven by `requestAnimationFrame`. It has play/pause in
  the Stage chrome, a pedal action, and tap to pause.
- **Speed:** there are three choices. (a) Work it out from the song: `(scrollHeight − clientHeight)
  / (durationSec − leadInSec)`. Every `Song` already has `durationSec`, but it's often 0 or
  approximate. (b) A manual speed that's saved per song. (c) Both, with (a) as the default and a
  per-song speed override. (c) needs a new optional `Song.scrollSpeed` column, an additive
  migration like v5–v10.
- It shouldn't fight the idle chrome auto-hide. Scrolling isn't user activity, so chrome should
  still hide.
- It can't move marks out of place. The whole chart, marks included, is inside the scrolling
  pane, the same as when a user scrolls by hand.

### Keep-awake (prerequisite)

Pedals, auto-scroll and a leader session are all useless if the screen locks mid-song. Nothing
keeps the device awake today. `@capacitor-community/keep-awake` (iOS/Android/web Wake Lock)
while Live Stage is showing would fix that. The old dead toggle was removed because there was
nothing behind it. This would be the real version.

### Link to §1

A leader's page turn could be sent to followers as a scroll fraction. Proposed: **don't**,
because each person's layout differs (text size, view, PDF vs chords). Only song changes are
shared. Worth confirming.

### Questions

7. Does "next" at the bottom of a song move to the next song automatically, or only on a second
   press?
8. Auto-scroll speed: from duration, manual, or both? Is there a lead-in delay before scrolling
   starts?
9. Should keep-awake always be on in Live Stage, or be a setting?

---

## 3. Accounts to sync local data

### Scope to settle first

"Sync" could mean either of two different features:
- **(a) Personal sync:** one person, several devices (phone + iPad). Conflicts are rare.
- **(b) Team sharing:** a worship team shares a library and setlists, and several people edit.
  This needs roles, permissions, invites, and real concurrent-edit conflicts.

(a) is much smaller. (b) is what lets §1 stop sending bundles. Which is meant decides nearly
everything below.

### Foundation work needed with any backend

These pay off even before any backend is chosen:
1. **Row-level writes.** Replace `replaceAll` with upserts plus deletes for only the changed
   records. Add `updatedAt` and `deleted` (tombstone) columns, and possibly `rev`. One additive
   migration.
2. **Globally unique IDs** (`crypto.randomUUID()`) for every new record, and a plan for the seed
   songs' fixed IDs. Either give seeds new IDs on first run, or treat seeds as local-only and
   never sync them.
3. **Take attachments out of the row.** Store each file once under a content hash, using
   `@capacitor/filesystem` on native and IndexedDB/OPFS on web, and keep only the reference in
   `attachments_json`. Syncing and LAN bundles can then skip files the other side already has.
   The local DB also gets much smaller, which helps load time today.
4. **Merge rules.** For most fields, the newer `updatedAt` wins, per record. For
   `annotations`, merge by mark `id` (marks already have IDs), with tombstones for deleted marks.
   Two devices marking the same chart then combine their marks instead of one overwriting the other.

### Backend options

| Option | What it is | Fit | Concerns |
|---|---|---|---|
| **Bring your own cloud** (iCloud Drive / Google Drive app folder / Dropbox) | No Zamar accounts. The app syncs a change log plus attachment files into the user's own cloud storage. | This is what users leaving OnSong know (OnSong uses Dropbox/iCloud). No server to run, no stored user data, no privacy-policy burden for hosted content. | Only suits (a), not team sharing. iCloud is Apple-only, so Android users need Google Drive or Dropbox. Each provider needs its own OAuth or native plugin. You write the merge logic yourself. |
| **PowerSync + Postgres (e.g. Supabase)** | Syncs local SQLite with Postgres. Has an official Capacitor SDK that uses the same `@capacitor-community/sqlite` driver Zamar already uses, with WA-SQLite on web. | Closest fit to the existing stack. Handles (a) and (b) with row-level sync rules and offline-first behaviour. | The Capacitor SDK is alpha/beta. The web side would replace `sql.js`/`jeep-sqlite` with WA-SQLite, which touches the pinned-`sql.js` gotcha. It's a hosted service or self-hosted, with ongoing cost. The schema must move to its model. |
| **Supabase/Firebase directly, hand-rolled sync** | Auth + DB + file storage. The app pushes and pulls changed rows. | Flexible. | All of the offline/merge work is yours to write, and it's easy to get wrong. Firebase's offline cache isn't SQLite, so there would be two local stores. |
| CRDT (Automerge / Yjs) | Merge-free documents. | Strong for concurrent editing of the same chart text or annotations. | Big change to the data model. Too much for (a), and probably premature for (b). |

### Account and App Store obligations (any hosted option)

- **Sign in with Apple is required on iOS** if the app offers any third-party login (Google etc.)
  (App Store Guideline 4.8). Email/password or passkeys alone avoid that rule.
- **Account deletion must be possible inside the app** (Guideline 5.1.1(v)).
- A privacy policy, data-export and GDPR handling, and a paid backend.
- **Copyright:** hosting users' uploaded charts and PDFs (often CCLI/SongSelect content) on Zamar
  servers is different from keeping them on the device. For team sharing (b) especially, this
  should be checked before building. Bring-your-own-cloud avoids most of it.

### Recommendation

Do the foundation work (1–4) first, as a separate refactor. It doesn't depend on a backend, it
makes LAN bundles in §1 efficient, and it makes the local DB faster. Then pick the backend after
(a) vs (b) is decided. For (a) only: bring your own cloud, starting with iCloud Drive + Google
Drive. For (b): PowerSync + Supabase. Build a small working test of it first, because its
Capacitor SDK is still pre-1.0.

### Questions

10. Personal sync across your own devices, team sharing, or both? If both, which first?
11. Are you willing to run and pay for a backend, or should Zamar stay serverless (bring your own
    cloud)?
12. Which sign-in methods: Apple + Google, email, passkeys?
13. Do seed/sample songs sync, or are they local-only?
14. Has the copyright/licensing side of hosting user charts been looked at?

---

## Suggested order

1. **Keep-awake + pedal support** (§2). Small, no infrastructure, and immediately useful on stage.
2. **Auto-scroll** (§2), once questions 7–9 are answered.
3. **Storage foundation** (§3 items 1–4). Unique IDs, row-level writes, attachments as files.
   This is a refactor only, with nothing visible to users, and both remaining topics need it.
4. **Bandmaster LAN session** (§1) with set bundles. Needs a custom native plugin and Android
   device testing. iOS can't be verified yet.
5. **Accounts** (§3), once the scope and backend questions are settled.

Each of 2–5 is a non-trivial feature. Per the feature workflow, each gets its own spec, a
mock-up where the UI changes (the join/follow sheet, Page turner settings, sign-in), and a
plan.

## Sources

- [PowerSync Capacitor SDK docs](https://docs.powersync.com/client-sdks/reference/capacitor), [announcement](https://powersync.com/blog/introducing-the-powersync-capacitor-sdk), [npm `@powersync/capacitor`](https://www.npmjs.com/package/@powersync/capacitor)
- [Capawesome Capacitor Zeroconf](https://capawesome.io/docs/sdks/capacitor/zeroconf/), [trik/capacitor-zeroconf](https://github.com/trik/capacitor-zeroconf)
- [Newzik: Bluetooth page turners](https://newzik.com/en/resources-sheet-music-app/bluetooth-page-turner-sheet-music), [forScore: virtual keyboard won't appear](https://forscore.co/kb/virtual-keyboard/), [PageFlip FAQ](https://www.pageflip.com/pages/faq)
