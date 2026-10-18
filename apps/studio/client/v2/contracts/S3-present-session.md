# S3 · Present session — awareness, follower page, link, audience window, present-meta

Slice S3.0 (contract) with L4 (hub, Tauri) and S9 (roles, link auth). Built by S3.1 (position echo), S3.5
(present-meta), S3.6a (Tauri), S3.6b (presenter view), S3.7a (awareness + follower root), S3.7b (hub link),
S3.8 (offline). Spec rows: `S3-slices.md` §2 D1, D5, D7–D12. Builds on `V2-1.2-mode-toolbars.md` (§5.4 table, A8
hold, `present-position` / `present-step`), `V2-1.7-roles-acl.md` (§5.2 matrix), V2-1.16 (canvas-scoped reads),
`V2-1.12-file-formats.md` (R1, R6, the reserved `present` / `artboardMeta` keys), `V2-4.9-shell-parity.md`
(decision 2: hidden, never greyed, for absent hardware) and DDR-247 (embed root). Canvas: `04 Modes`
md-present-menu, md-presenter, md-present-link, md-edge-offline, md-edge-ai. Graph:
`maude/v2-S3-present-session-over-awareness`, `maude/v2-S3-presenter-view-desktop-only`,
`maude/v2-S3-present-meta-own-route`, `maude/v2-S3-single-present-owner`, V2-2.4b canvas-meta.v2 (`present` is
`{order, skip}`, notes in `artboardMeta`).

## 1 · Decision

1. **One follower transport.** The presenter's canvas publishes `present` on its collab awareness. Followers
   publish `watching`. The local audience window and remote link viewers are both followers, and one separate
   root renders both: `client/v2/present/follow-view.jsx`, a sibling of `embed-view.jsx`. There is no new socket,
   no new route on the studio and no runtime-state path.
2. **Gate 0 A8, unchanged here.** AI changes show live in Preview, under the pointer too. In Present · Artboards a
   module update is held until the presenter moves on (`present-position` changes) or Present ends. Followers get
   the same hold: they render the presenter's artboard, so they apply the held update when the position changes.
3. **The presentation link is a hub redirect.** `GET /present/<canvas>` checks that the person is signed in and has
   `read` on that canvas, then answers `302` to the studio child's `/?open=<rel>&present=follow`. A missing canvas
   and a forbidden one get the same 404.
4. **The audience window is a top-level desktop window `audience-<pid>` with no capability at all.** Rust builds
   its URL from the caller's recorded origin. The page never passes a URL.
5. **Present writes have their own route,** `PATCH /_api/present-meta`: main origin only, `edit` role, refused to
   read-only sessions. It is never part of `/_api/canvas-meta`, which stays reachable from the canvas origin and by
   read-only sessions and keeps **ignoring** `present` and `artboardMeta` keys.

**Rejected:**
- A presenter channel run by the shell. The shell has no awareness connection; the canvas has one.
- A second socket or SSE stream for followers. That adds a new trust surface for data the awareness relay already
  carries.
- Passing the audience URL from JS to Rust. An argument-chosen URL in a no-capability window is still an opener
  for any page.
- Presenter state in `_state/`. D12: no new runtime-state class, and the four DDR-115 lists stay untouched.
- Adding a `present` lane to `/_api/canvas-meta`. That route is in `CANVAS_SAFE_API` and
  `READ_ONLY_ALLOWED_WRITES`, so a planted canvas or a viewer could reorder a deck.
- Anonymous presentation links. S9 owns links: a Share link opens the canvas, and a presentation link needs a
  signed-in person with Can view.

## 2 · Awareness fields (`use-collab.tsx`, S3.7a)

```ts
// CollabAwarenessState gains two optional fields (R1: absent = not presenting / not watching)
present?: {
  v: 1;
  sid: string;                 // /^[a-z0-9]{8,32}$/, new per Present start; one presenter may run one session
  index: number;               // int, 0 ≤ index < total
  total: number;               // int, 1..2000; counts only presented artboards (skip excluded)
  artboardId: string;          // /^[A-Za-z0-9_-]{1,64}$/
  seq: number;                 // int, 0..2^31-1, +1 per step; a follower ignores a lower seq for the same sid
  media: { playing: boolean; t: number; duration: number; muted: boolean } | null; // t, duration finite, 0..86400
} | null;
watching?: string | null;      // a presenter's sid; set by a follower while it follows that session
```

- **Validator** `sanitizePresent(raw) → Present | null` and `sanitizeWatching(raw) → string | null`, both in
  `sanitizeForeignState` (the one chokepoint). Any bad member drops **the whole** `present` (null), never a partial
  object. Extra keys are dropped.
- **Who publishes.** The canvas publishes `present` only when the shell's `set-mode` says so (`caps.present`, new
  bool, below). The shell sets it in Present · Artboards for a session that may broadcast. **Present · Canvas**
  publishes nothing: there is no position to follow. It clears to `null` on exit, on `pagehide`, and on a role
  clamp.
- **Who may broadcast (D11).** `edit` on the canvas. A Can view or Can comment person presenting on the desktop
  with presenter view on still publishes (`caps.present` true), because their audience window is a local peer on
  the Mac's own relay. Two things stop it from reaching anyone else: the hub strips it (below), and no
  read-only link session can open presenter view (desktop only, D10).
- **Relay strip (L4 and S9).** Every relay hop that carries a state to another person drops `present` from a
  connection without `edit` on that canvas:
  - The hub does it in `beforeHandleAwareness` (`apps/hub/src/server.mjs`, next to `dropCtlAwareness`). It re-encodes
    the state without the key. L4 confirms that the hook can see the connection's role; if it cannot, the strip
    moves to the per-connection awareness apply.
  - The studio's local relay does it for read-only link sessions. The desktop's own tabs are the Mac owner's and
    are not stripped.
  - `watching` is never stripped: any role may watch.
- **Watchers** = the foreign states whose `watching === mySid`, counted per awareness change. Display "N watching",
  with "99+" above 99. The count includes the local audience window. Presenter view says "Audience on …" for it
  rather than counting it as a person.

## 3 · Bridge messages (lead adds to `bridge/dgn-protocol.ts`)

| Message | Dir | Gate | Payload | Status → slice | Notes |
| --- | --- | --- | --- | --- | --- |
| `present-position` | c2s | `active` | `{ index, total, artboardId, sid, seq }` | proposed → live S3.1 | **adds `sid`, `seq`** (int-checked like §2). Echo per step; the shell drives the counter, presenter view and the A8 apply |
| `present-step` | s2c | `parent` | `{ to: number \| 'next' \| 'prev' }` | proposed → live S3.1 | `to` int, 0 ≤ to < 2000; the canvas clamps to `total` |
| `present-follow` | s2c | `parent` | `{ sid: string \| null; live: boolean; locked: boolean }` | new S3.7a | the follower shell tells its canvas which session to follow; `sid: null` = the first presenter seen; `locked` = audience (ignores keys and clicks) |
| `present-follow-state` | c2s | `active` | `{ live: boolean; sid: string \| null; presenterName: string; presenterIndex: number; index: number; total: number; watchers: number; ended: boolean }` | new S3.7a | name ≤ 64 (already sanitised in the canvas; the shell renders it as **text only** and re-clamps); ints bounded like §2 |
| `present-media` | c2s | `active` | `{ playing, t, duration, muted }` | new S3.3 | as S3-slices S3.3 |
| `present-media-cmd` | s2c | `parent` | `{ op: 'play' \| 'pause' \| 'mute' \| 'unmute' }` | new S3.3 | presenter view sends `mute` to the Mac's canvas: only the audience plays sound |

`ModeCaps` gains `present: boolean` (default false; `NO_CAPS.present = false`), parsed by the `set-mode` `caps`
validator. The shell computes it as `mode === 'present' && present.kind === 'artboards' && (can(role, 'edit') ||
presenterViewOn)`. The relay strip (§2) is what enforces D11. The cap only keeps honest clients quiet.

## 4 · The follower page (`client/v2/present/follow-view.jsx`, S3.7a)

**URL** (main origin, any shell): `/?open=<designRel>.tsx&present=follow[&sid=<sid>][&audience=1]`

| Param | Rule |
| --- | --- |
| `open` | required; the same canvas grammar the shell's `?open=` already takes. Missing → "Nothing to follow" |
| `present=follow` | selects the root. `client/v2/present/follow-location.js` `isFollowLocation(location)`, checked **before** `isEmbedLocation` in `app.jsx`'s root switch |
| `sid` | optional `/^[a-z0-9]{8,32}$/`, otherwise ignored. Absent → the first presenter seen on that canvas; a later presenter does not take over |
| `audience=1` | lock: no follow bar, no keys, no cursor, sound on. It only removes chrome, so it grants nothing if typed by hand |

**S3.7a, after the S3.6a security review** (the audience window on a second display):

- **Audience URLs never reach the editor.** `isFollowLocation` is true for `present=follow` **and for any URL
  that carries `audience`**. Without `present=follow` (or with an `audience` other than exactly `1`) the follower
  root refuses before it fetches anything: the audience window stays blank, other viewers get "Nothing to
  follow".
- **`open` is decoded once** (URLSearchParams) and the decoded value is re-checked by `followOpenRel`: no empty,
  `.` or `..` segment, no segment starting `_` (runtime dirs), no `%`, `?`, `#`, `\`, `:` or control character,
  ≤ 1024 characters, ending `.tsx`. Anything else → "Nothing to follow".
- **Capability marker.** `client/v2/present/follow-location.js` exports `supportsAudienceLock = true`. S3.6a's
  audience-window seam (`client/v2/present/audience-window.js`) checks it before it opens a window; a build
  without the marker has no follower root that honours the lock, so no audience window is opened.

- **The canvas frame** is built with `canvasShellUrl` opts `{ ro: true, comments: false, follow: true }` →
  `ro=1&comments=0&follow=1`. It is seeded like the embed: `set-mode { mode: 'present', present: { kind:
  'artboards', from: 'start' }, caps: NO_CAPS }`, then `present-follow`.
- **States** come from `present-follow-state`:
  - live: "● Live · <avatar> <name> is on 6 of 14".
  - drifted (a local ← → turns Live off): "<name> is on 6 of 14 · you're on 5", with the primary **Catch up**.
    Catch up sends `present-follow {live: true}`.
  - waiting (no presenter state yet): "Waiting for the presenter…".
  - ended: "<name> ended the presentation". The canvas keeps the last artboard. For a role that may open it,
    there is also an **Open the canvas** link (`/?open=<rel>`).
- Watchers: faces and "N watching" (md-present-link).
- In a browser, esc first leaves the browser's full screen (the browser's own behaviour). The page adds no esc
  handler.
- **Role:** any session with `read` on the canvas (Can view and up). The page always runs `ro=1`. C30: no AI panel.

## 5 · Hub `GET /present/<canvas>` (L4, `apps/hub/src/present-route.mjs`, S3.7b)

- **Path:** `/present/<seg>(/<seg>)*` → `rel = segs.join('/') + '.tsx'`. Each segment is percent-decoded and NFC.
  Refused (404): an empty, `.` or `..` segment, a segment starting `_`, control characters, a `\` or `:`, or a path
  longer than 1024. Containment goes through `path-contain.mjs` under the design root. The drawn
  `alligators.cloud.maude.sh/present/combine-kampan` resolves to `combine-kampan.tsx`.
- **Signed out:** the ordinary sign-in redirect, with `returnTo` set to the same path (`validateReturnTo`).
- **Signed in:** `can(session, 'read', rel)` per V2-1.16. That covers observer (Can view) and up, and
  canvas-scoped grants.
- **Missing or forbidden:** the same 404 (same status, body and headers). There is no existence oracle.
- **Allowed:** `302 Location: /?open=<encodeURIComponent(rel)>&present=follow`, `Cache-Control: no-store`.
- **GET and HEAD only.** Any other method → 405. No token in the URL. It is not a Share link: Share links stay S9's
  `POST /api/access/links` and open the canvas.
- **Copy presentation link** (`client/v2/present/copy-link.js`): `${cfg.cloud.url}/present/${rel without .tsx,
  each segment encodeURIComponent}`. It is shown only in cloud-linked projects. ⌘K lists it greyed, with the note
  "in a cloud project", elsewhere (V2-4.9 decision 2 pattern). Offline it still copies (the URL is deterministic)
  and toasts "Copied — viewers follow once you're back online."

## 6 · Tauri: the audience window (L4, `apps/desktop/src-tauri/src/present.rs`, S3.6a)

```rust
#[derive(Serialize)] pub struct PresentDisplay { id: String, name: String, primary: bool, current: bool }
/// Every monitor. `id` = stable hash of (name, position, size); `current` = the caller's window's monitor.
#[tauri::command] pub fn present_displays(webview: Webview) -> Result<Vec<PresentDisplay>, String>;
/// Open (or move) THIS project's audience window, full screen, on `display_id`. Rust builds the URL itself:
/// <caller's recorded origin>/?open=<canvas>&present=follow&audience=1&sid=<sid>. `canvas` must pass the
/// design-rel grammar (§5), `sid` /^[a-z0-9]{8,32}$/. The window opens unfocused, so the presenter keeps the keys.
#[tauri::command] pub fn present_audience_open(webview: Webview, display_id: String, canvas: String, sid: String)
  -> Result<(), String>;
/// Close the caller's audience window. Idempotent.
#[tauri::command] pub fn present_audience_close(webview: Webview) -> Result<(), String>;
```

- **Caller:** all three call `caller_project(&webview, false)` (label `p-*` and the top-frame origin). Granted in
  `capabilities/default.json` (project webviews only) and registered at the four sites (`lib.rs`
  `generate_handler!`, `build.rs` `commands()`, `capabilities/default.json`, committed
  `permissions/autogenerated/present_*.toml`).
- **No capability:** the label `audience-<pid>` matches no capability file (`p-*`, Home and strip only). The
  window is not in the windows book as a project window, so `caller_project` refuses it, and the follower root
  calls no Tauri API.
- **Navigation guard:** a new `NavRole::Audience`. The top frame is allowed only on the recorded project origin,
  path `/`, query keys exactly `{open, present, sid, audience}`. Subframes are allowed on that project's canvas
  origin, `about:blank` / `about:srcdoc`, and a `blob:` of either. Everything else is refused, including remote
  https and `data:`.
- **Lifetime:** one window per project. It closes when its project tab closes, when the project's server origin
  changes, on End or esc in the presenter's tab (`present_audience_close`), and when its display disappears (Rust
  re-checks `available_monitors()` every 2 s while it is open). Presenting continues on the Mac.
- **Hidden, not greyed (D10):** the "Presenter view on another display" row exists only when `__TAURI__` is
  present and `present_displays()` returns more than one display.

## 7 · `PATCH /_api/present-meta` (S3.5, `routes/present.ts`)

```ts
{ method: 'PATCH', path: '/_api/present-meta', origin: 'main', readOnly: 'refused', handle }
// body (≤ 256 KiB), unknown top-level key → 400
{ file: string;                                             // designRel .tsx; the canvas must exist (404 otherwise)
  present?: { order?: string[] | null; skip?: string[] | null } | null;   // null removes the key / the member
  notes?: Record<string /* artboardId */, string | null>;  // '' or null removes artboardMeta[id].notes
  expected?: string }                                       // ETag of the meta the sheet read; mismatch → 409 stale
// 200 { ok: true, present: {...} | null, notes: Record<string,string>, etag: string }
```

- **Roles.** Today `readOnly: 'refused'` (`readOnlyRefusalFor` → 403). Once S9's `access/roles.ts` lands, the guard
  checks `can(session, 'edit', file)`, with the same 403 for Can comment and Can view.
- **Origins.** Absent from `CANVAS_SAFE_API` and from `routes/canvas-origin.ts`, so the canvas origin and the
  capture origin get 404. `origin: 'main'` keeps it there.
- **Schema.** `canvas-meta.v2.schema.json` `present` and `artboardMeta.*.notes` (strict for our writes). Ids must be
  artboards in the TSX: an unknown id → 422 `unknown-artboard`; duplicates → 422.
- **Preserving.** Every other top-level key, `layout`, and every other `artboardMeta[id]` field (`poster`, `snap`,
  `maxFrames`, `madeBy`) is kept byte-for-byte. An `artboardMeta[id]` left empty is removed. No `last_modified`
  stamp, because that is stamped only on a layout change.
- **Sync.** The route goes through the same versioned-meta writer and `onMetaChanged` hook as the layout lane:
  `sync/writer-registry.ts` `{ class: 'lane', rows: 'S19', via: 'onMetaChanged hook → meta lane.replace', test:
  'test/present-meta-route.test.ts' }`; `studio-manifest.mjs` `{ safe: null, unsafe: 'edit' }`.
- **Undo.** One sheet commit = one V2-1.5 action (`undo: 'step'`).
- **Table change (lead):** `RouteSpec.method` (`routes/table.ts`) becomes `'GET' | 'POST' | 'PATCH'`.
  `guardTableRoute` already applies `sameOriginWrite` to any non-GET. If a scraper refuses the new method, fall
  back to `POST` with the same body. D8 names the route and its gate, not the verb.
- **`/_api/canvas-meta` regression pin:** `PATCH {patch: {present: …, artboardMeta: …}}` leaves both untouched (the
  lanes are explicit today; the test keeps them that way).

## 8 · Registry ids (lead; `actions/defs/view.ts` + `actions/agents.ts`)

| id | Label | Keys / scope | minRole | Agent path | Slice |
| --- | --- | --- | --- | --- | --- |
| `present.from-selection` | Present from “<artboard>” | ⌥⌘↵, `when: mode ∈ edit/viewing/preview` | view | NAV(`<canvas> --mode present`) | S3.1 |
| `present.from-start` | Present from the start | ⇧⌥⌘↵, same `when` | view | NAV(`<canvas> --mode present --from start`) | S3.1 |
| `present.canvas` | Present the canvas | — (re-pointed onto the lane) | view | as today | S3.1 |
| `present.next` / `present.prev` | Next / Previous | → space / ←, scope `present` | view | human(`keys`) | S3.2b |
| `tool.pointer` | Pointer | L, `when: mode present` | view | human(`keys`) | S3.2b |
| `present.order-notes` | Order and notes… | — | edit | file(`canvas-meta`, `design:design`, "present.order / present.skip and artboardMeta.<id>.notes in the canvas .meta.json") | S3.5 |
| `present.presenter-view` | Presenter view on another display | toggle, desktop and more than one display, else absent | view | human(`native-window`) | S3.6b |
| `present.copy-link` | Copy presentation link | — | edit | cli(`maude design open <canvas> --mode present --link`) (S12 documents it) | S3.7b |

No runtime-state paths are added (D12): the session, watchers and back stacks live in awareness and shell memory.

## 9 · Tests that prove it (red first)

| Test | Proves |
| --- | --- |
| `test/present-awareness.test.ts` | forged, oversized, non-int and extra-key `present` dropped **whole**; `watching` grammar; lower `seq` ignored; fails against an unvalidated read |
| `test/present-relay-strip.test.ts` (L4, hub) | a read-only connection's `present` never reaches another connection; its `watching` does |
| `test/follow-view.test.tsx` | URL grammar; root chosen before embed; drift → Catch up → live; `audience=1` has no bar and ignores keys; ended state |
| `test/dgn-present.test.ts` | the four new or changed rows parse, strip junk, and are gated; `present-follow-state` names are rendered as text |
| `apps/hub/test/present-route.test.mjs` | per role (owner/member/viewer/observer/none) and canvas-scoped grant; missing and forbidden 404 byte-equal; signed out → sign-in with `returnTo`; POST → 405; traversal refused |
| Rust `present.rs` tests | `audience_has_no_capability` (no capability file matches `audience-*`); the navigation guard refuses every other URL; the three commands are listed by `every_granted_command_checks_its_caller`; the URL is built from the recorded origin, never from an argument |
| `test/present-meta-route.test.ts` | read-only → 403; canvas origin → 404 (both allowlists); unknown key → 400; unknown id → 422; other meta keys byte-kept; `/_api/canvas-meta` ignores `present`; `canvas-origin-parity` green |
| `test/present-hold.test.ts` (S3.1, T11) | A8: held in Present · Artboards, applied on position change or exit, newest only; live in Preview, also under the pointer |

## 10 · Open questions (recommended default in bold)

- Two people present the same canvas at once? **Each has their own `sid`. A follower without `sid` keeps the first
  presenter it saw, and the bar names who it follows.**
- Can Can comment / Can view broadcast? **No: every relay hop to another person strips it. They present locally,
  and their own audience window still works.**
- Sound with presenter view on? **Only the audience window plays sound. The Mac's canvas gets `present-media-cmd
  mute`.**
- Follow Present · Canvas (free pan)? **Not in v2.0.** Followers would need the camera. `participants-chrome` Follow
  already covers "watch someone pan".
