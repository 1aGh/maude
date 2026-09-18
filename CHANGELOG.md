# @1agh/maude

## 1.4.3

### Patch Changes

- a5403da: Plans, RCAs, execution reports, retros and code reviews can now live in orbit instead of the repo's `.ai/` folder.

  A project that tracks its work in orbit had its task in one place and the record of why the work was done the way it was in another: markdown files next to the code, on whichever laptop produced them. The flow config gained `integrations.tracker.artifacts`. Left out, nothing changes. Set to `{ "store": "orbit" }`, each of those five documents is sent to orbit the moment it is written rather than copied at the end, and the commands that need one later read it back from there.

  With `"local": "scratch"` the repo keeps no copy: the command writes the document to a spool folder that git ignores, sends it, and deletes it only once orbit has confirmed it arrived. A send that fails leaves the file in the spool and the next flow command tries again, so an orbit that is down or a token that has expired costs a warning, never the document. `"store": "both"` keeps the file and sends it, which is the gentle way to move a project across.

  The PRD, the design system, the codebase map, the workflow state, scenarios and architectural decisions stay where they are. On a project that also uses the knowledge graph, each verdict is still recorded there, now before it is sent rather than after, so the graph keeps being fed.

- b4cd8e1: Sticky notes, drawings and comments in the browser studio of a self-hosted hub now show the project's current state, not the version from the first time the canvas was opened there.

  On a hub without live pairing, the browser studio kept each canvas's annotations and comments at the state they had when someone first opened that canvas in the browser. The desktop and the hub document had the current board; the browser kept showing the old one, even after a reload. The browser studio now picks up those changes while a canvas is open. When a canvas is opened again, anything saved after the studio's last cached copy replaces that copy.

## 1.4.2

### Patch Changes

- 719e978: The desktop app no longer freezes after switching canvases back and forth.

  Switching away from a canvas and straight back, while it was still loading, could leave the app's page stuck at full CPU: nothing on screen responded again until the app was quit. It took a while to happen — the first switch late in a long session, or the sixteenth in ten minutes of editing — and it only happened in the desktop app. Each canvas now finishes starting up in a way that cannot get stuck like that; a fifteen-minute session of edits and switches ran without it.

  An open canvas also no longer shows an older version after two quick changes land one after the other: the newest change is the one on screen, even when the older one takes longer to load.

  And a canvas that changed while it was still being prepared for the screen is prepared again, instead of showing the version from just before — which could leave a teammate's view one edit behind.

  Photo edits arriving from a teammate one after another no longer flick back to the earlier one.

- c5787e2: A project with more than a hundred canvases stays connected.

  The desktop opens one connection to the hub for a whole project, and every canvas signs in over it the moment it opens. The hub software we build on closes any connection with more than a hundred canvases signing in at once — so a large project was cut off as it opened, reconnected, signed every canvas in again, and was cut off again, for as long as it stayed open. Nothing synced, and each round used up that designer's sign-in allowance, which then refused their other devices too.

  The desktop now spreads a large project across several connections, a few dozen canvases each, so it works with hubs already running. Hubs from this release also accept a project's worth of canvases on a single connection.

- 7b8d93c: A canvas that arrives on a new computer keeps its name exactly as it is on everyone else's.

  A computer joining a project could save a canvas under an all-lowercase version of its file name — `surfaceboards-peer.tsx` where everyone else has `SurfaceBoards-peer.tsx` — when the canvas arrived before its own record of where it lives. The project already knows every canvas's place, so a joining computer now uses that from the start.

## 1.4.1

### Patch Changes

- 11b3f65: A workspace that has just woken up no longer lets anyone write before it knows how the project saves.

  A hub reads how its project saves from its own store when it starts, and until that read comes back it was assuming the older, everybody-writes-directly answer. On a cloud workspace the read crosses the network and the workspace wakes up constantly, so somebody reconnecting in that first moment could be handed a writable connection to a project that accepts only proposals — two ways of writing the same canvas at once, which is the one thing this design rules out. Nobody writes now until the answer is in. A workspace that has not looked yet also stops reporting the old answer as though it had: it says it does not know.

  On the desktop, a project you were invited to now offers the way into its own history from the status bar — every change with who made it, and Undo on the ones that are yours. It was only reachable from the View menu before, on the single screen an invited designer actually uses.

## 1.4.0

### Minor Changes

- 216f059: Add `orbit` as a tracker provider for the flow plugin. Set `integrations.tracker.provider` to `"orbit"` (optionally with `baseUrl` and `tokenEnv`, which defaults to `ORBIT_MCP_TOKEN`) and point the project's `.mcp.json` at the orbit MCP server. The config only ever holds the variable name; the token stays in your environment.

  The new `flow:orbit-backend` skill is the provider's single contract. `/flow:plan` finds the task from the branch name or its arguments, or asks once to create it, and writes `ORB-<n>` into the plan's Ticket line. `/flow:execute` reports working state at each milestone so the board shows where a session got to. `/flow:done` marks the task done with the PR link, then pushes the plan, RCA, execution report, code review and retro to orbit. `/flow:status`, `/flow:bug-rca` and `/flow:bug-fix` read the task through the same skill. Every orbit call is warn-only: orbit being down, an expired token or an unknown key never blocks a command. Text read from orbit is treated as untrusted data, never as instructions.

### Patch Changes

- 98f7a57: Team projects: nine fixes to what a shared project does under ordinary work.

  An edit you made against a canvas a teammate moved (or whose folder they renamed) now follows the canvas instead of coming back as a conflict, and renaming a folder no longer makes the person who renamed it miss later edits to the canvases inside it. A canvas made again under a name that was deleted is accepted — before, that one proposal could sit in a desktop's outbox forever and quietly hold back everything queued behind it.

  A teammate's desktop now shows the project's design system: the project's own group labels and design systems travel with its bootstrap and a linked copy fills in only what it lacks. Replacing an image no longer leaves the old picture on the screen that replaced it. A workspace whose disk refuses a write answers at once (instead of leaving the upload hanging until it times out), the waiting file is named in the Sync panel and delivers itself when the disk takes writes again, and a too-big file you remove stops being reported. A timeline drag commits once.

## 1.3.0

### Minor Changes

- a019382: Add native Codex packages for the Maude design and flow workflows alongside Claude Code.

  Share the workflow procedures through small skill entry points and load larger references by stage. Preserve source-owned Codex packages in the Maude launcher, document installation and dependencies for both hosts, and reuse a healthy Studio server when process signalling is unavailable.

  Studio ACP integration remains separate. Visual workflows require working browser tooling; the restricted-environment probe did not complete the full visual editing loop.

- Reliable project multiplayer (accepted revisions). A team project saves through the project itself: "Saving N changes…" until the project confirms, a History of actions with authors, personal Undo that keeps teammates' later work, same-property races ending with the later change, unfinished AI edits held for Publish/Discard, and resumable large-media transfer. Invited designers open a team project from the desktop app with no folder, token or Git. On Maude Cloud the owner switches a project from the dashboard (Saving); self-hosted operators follow the rollout runbook. Also: rename and duplicate canvases, rename folders and artboards, manage images and notes beside canvases from the tree, and Cloud Connect syncs immediately again.
- 0432180: Share canvas and file links that open in the browser or Maude desktop app. Browser history follows the open file, sign-in returns to the shared file, and app links ask before switching projects.

### Patch Changes

- 01bdcfd: Protect canvas source files from malformed shared-document updates (issue #121).

  Preserve unchanged code between concurrent edits, repair exact duplicate seeds in the shared-document sync path, and reject source with syntax errors or duplicate declarations before it overwrites a local file. Keep bounded recovery copies outside rolling history, preserve valid migration backups, and show held updates in the Sync panel. Locally edited files are preserved when a remote update arrives before the file watcher imports them.

- d50954d: Unify Studio notifications in a Sonner stack with automatic dismissal and paused timers during interaction. Keep export errors concise and reveal full diagnostics on demand in export history.
- b89fa4e: Fix Shift+Enter not giving you a new line in a whiteboard sticky note (issue #106). The report was "nefunguje shift+enter na novy radek ve sticky note", and the keystroke was never the problem — the editor passes it straight to the browser, and it inserts the break correctly in both Chrome and Safari. Three separate things then took the line away again, and any one of them alone looks exactly like "Shift+Enter does nothing".

  **A sticky now grows to fit its text instead of clipping it.** A note's size was fixed when you dropped it and nothing ever changed it, while the body is clipped at the card's edge — so past about nine lines every further line simply wasn't drawn. On a note that was already full, Shift+Enter inserted the line and then hid it: nothing moved on screen. The note now grows as you type, and the commit keeps whatever height the text actually needed. It only ever grows, so a note you deliberately made roomy stays that way.

  **Shift+Enter adds a line instead of eating the note.** Opening a sticky from the keyboard (select it, press Enter) selects all of its text, so you can retype it — which is right for a typed character and wrong for Shift+Enter, where the break replaced everything and left one blank line behind. Typing still replaces; Shift+Enter now appends. Your own partial selection is untouched, so replacing the words you highlighted works as before. The same fix covers shape labels and standalone text.

  **A collaborator's edit no longer overwrites the note you have open.** On a project synced to a workspace, someone else committing to the same sticky while you were editing it replaced your live text mid-keystroke — your uncommitted words and line breaks gone, with nothing to undo. What you have typed now stays put until you commit it, while everything arriving from your collaborator — their text included — is still applied to the project exactly as before.

## 1.2.0

### Minor Changes

- 55ccb95: New `qualityScoped` config block: scoped (changed-files/changed-packages-only) quality-gate variants that the flow implementation inner loop (`/flow:utils-verify`, per-task `/flow:execute`, `/flow:bug-fix`, `/flow:quick`) runs instead of repo-wide `quality.*` commands. Gates without a scoped variant are deferred to `/flow:validate` — the full pipeline runs once, at the outer gate. The per-task `code-simplifier` pass moved out of `/flow:execute` (it stays in `/flow:done`), and `/flow:execute` now degrades cleanly to ticket-only mode when no plan file exists.
- f260573: Add a `text` mode to PDF export — keep / embed / outline — plus an always-on font preflight (issue #116). Chromium's `page.pdf()` emits **Type 3** fonts for COLRv1 colour fonts (`@font-palette-values`) and for synthetic italics. A Type 3 "font" is a per-glyph content stream rather than a font program, so a print shop's preflight reports it as _not embedded_, Acrobat and Illustrator render it broken, and DTP re-substitutes by hand. Nothing inside Maude said so: the export succeeded, the file downloaded, and the page looked right on screen — the only signal was `pdffonts` on the delivered artifact, or the printer refusing the job.

  Every PDF export now classifies its own fonts and reports, by name, any that would fail preflight — including flagging a synthetic italic specifically, which unlike a colour font is fixable at the source by loading the real italic face. `--option text=embed` turns that into a hard failure instead of a silent pass; `--option text=outline` converts every glyph to a vector path via Ghostscript, preserving the print boxes, the vector crop and registration marks, and every photo's pixel count and ppi. Ghostscript is resolved off PATH and is present in the cloud render image; the desktop app and the npm CLI do not bundle it (it is AGPL-licensed) and refuse with an install line rather than handing back un-outlined text. The preflight itself needs no external tool. Default behaviour is unchanged — an export that passes no `text` option produces the same bytes it did before, now with a warning when those bytes are unprintable.

### Patch Changes

- 720c948: Fix a comment disappearing seconds after it is added on a hub-linked project (issue #111). Adding a second comment worked, then it vanished and only the first one was left. The comments lane had two authoritative writers and nothing arbitrating between them: a mutation wrote `_comments/<slug>.json` and only afterwards — across a disk re-read, in a call nobody awaited — published the new list into the room's shared document, while `Room.flush()` projects that document straight back over the same file on an 800 ms debounce that _any_ document update re-arms, hub traffic included. On a linked project a flush is therefore almost always pending, so one landed inside that window, wrote the pre-mutation document over the file, and the comment was gone from disk and from the hub before anything read it back. Local projects were spared because nothing else drives their document, which is exactly the scoping the report gave.

  A mutation now publishes to the shared document **first** and to disk second, with both halves awaited, so a flush firing at any point carries a document that already holds the comment — the window is removed rather than narrowed. The projection also refuses to overwrite the file when it would drop a comment the document has never carried, while still materializing a genuine delete, so an edit made directly to the comments file (how `/design:edit` resolves them) can no longer be silently reverted either.

- de636b2: Fix comments duplicating themselves on a linked hub, and refusing to be resolved (issue #112). A comment added to a hub-linked project came back 2, 4, then 8 times, and clicking resolve did nothing. The comments lane wrote to its Y.Array wholesale — `delete(0, len)` + `push(next)` — which is not a replace under concurrency: two writers delete the same items but Yjs keeps both inserts, so the array became the list concatenated with itself, `persistJson` wrote that to `_comments/<slug>.json`, and the duplication became the canvas's truth. Every reconciliation round doubled it, and the cold-start union repair, published through the same wholesale write, re-created what it had just undone — the same defect the `css` lane had in issue #114, one lane later.

  The lane now applies an identity-keyed minimal diff, so collapsing a duplicated array is a pure delete (concurrent collapses are idempotent and converge), and dedupe happens on every apply rather than only at cold start — a project already corrupted in the field heals on the next read or write instead of compounding. The room seed no longer concatenates into a document that already holds the hub's copy, and `commentsPatch` / `commentsDelete` act on every entry carrying the id instead of the first one, which is why resolve appeared to do nothing while the overlay kept drawing the other seven pins.

- c58dfe3: Fix images (and every other project file) silently never arriving on a hub-linked project, while the Sync panel reported everything as synced (issue #109). The report was "nenačítají se obrázky" — broken image placeholders on a canvas — and the whole server log was one line repeated: `[sync/files] assets/<hash>.png: HTTP 429`.

  429 is the workspace saying "come back in a minute", and the file lane did not know that. It read a rate limit as an ordinary per-file failure, fired the rest of the pass at a door that was already shut, and — because a pass only advances its cursor when nothing failed — came back with the identical work set on the next tick. The retries were what kept the limit tripped. Three things made it self-sustaining rather than transient: the per-pass ceiling counted files that _moved_, and a failed transfer moves nothing, so under any refusal it stopped bounding the pass at all and one request went out per path with no ceiling; a pass could be started every 400 ms by the workspace's change channel with no floor and no mutual exclusion, so the client's own request ceiling sat an order of magnitude above the limit it was hitting; and none of it had anywhere to surface, so the status line kept saying `synced`.

  A refused request now pauses the whole file lane for as long as the workspace asked for (honouring `Retry-After`, clamped, with a sane default for hubs that send a bare 429), the first refusal ends the pass instead of spending it, the hard ceiling counts requests rather than successes, passes are floored two seconds apart and can no longer overlap, and both the pause and any failed transfers appear in the Sync panel in words — a pause says nothing is lost and it resumes by itself. The `Retry-After` handling the asset upload lane has carried since August now lives in one module both lanes import, so the two cannot drift apart again.

- de636b2: Fix whole-file duplication in shared-doc sync (issue #114). When several peers seeded the same canvas into one empty document at the same instant, Yjs kept every insert and the lane became the file concatenated with itself — 2×, and up to 5× in the field — so the canvas stopped building (`Multiple exports with the same name "default"`, `"FMT" has already been declared`). The body lane had duplication guards; the `css` lane had none, and was the lane that never came out of a multi-peer cold start clean. The css lane now has its own cold-start table (`decideCssColdStart`) with the same exact-repeat recovery, the same DDR-064 empty-lane guard, and it finally reads the `cssHash` checkpoint the journal has been writing all along; the live seed-duplication repair covers css as well as the body. Related: comment arrays no longer amplify their own duplicates (issue #112) — the cold-start union now dedupes the document against itself, not only against local, which is what turned 2 copies into 4 into 8.

  Also fixes relative imports breaking when a canvas is moved between folders: `moveCanvas`/`moveFolder` relocated the file without re-rooting its `../` specifiers, so a canvas dragged one level deeper failed to build with `Could not resolve`.

- dece0ac: Cloud sync now recovers on its own after the workspace cell sleeps, and stops claiming to be synced when it is not. A dropped WebSocket demoted every canvas to "pending" and nothing ever promoted them back, so a link that had been healthy for hours reported `online` with zero canvases synced — for the rest of the session, until you pressed Resync. Three fixes: a document that re-handshakes is marked synced again; the last-synced clock is only stamped by real sync activity, never by a socket reconnecting; and a new watchdog forces the hub socket down and back up when it claims to be connected but nothing has synced for three minutes (the Hocuspocus socket reports `connected` off the raw WS open — before authentication — and disables its own silence watchdog exactly then, so a socket that upgrades at the edge and hears nothing was permanently "connected"). The stall message also stops blaming your sign-in when the hub has refused nothing — that advice sent people to Resync, which made the display worse.
- 8c9e14f: Fix a large project being unable to sync to a cloud workspace at all, and make the sync visible while it runs. Two real runs against an 8.8 GB project moved **zero** files in 14 and 6 minutes while sending 616 MB of traffic, and from every surface a person can see they were indistinguishable from two runs that were working.

  The cause was not size. A cell resolved its tenant config and minted fresh R2 credentials on **every proxied request**, not on every container start as its own comment claimed — so one file-sync pass of up to 200 uploads drove up to 200 credential mints against the Cloudflare account API. That tripped an account rate limit, and every layer below then erased the signal: the 429 was flattened into an anonymous 502, the response body explaining why was discarded, and the cell read the result as "storage is broken" rather than "come back in a minute". It refused to start, the next request minted again, and the cell restarted 30 times in 10 seconds. The client answered a peer that was not answering by re-sending the same files at full rate — 314 uploads across 44 distinct paths in ten seconds, one image 24 times. Size only decided how fast the limit arrived.

  A running container now resolves neither its config nor fresh credentials, because both are applied at container start and nothing re-reads them. Credentials are cached for their lifetime in the cell's own per-tenant storage, minted once however many requests race, and a refusal that says "come back" opens a cooldown during which the control plane is not contacted at all. A rate limit keeps its status and its `Retry-After` all the way to the client. A cell that genuinely cannot obtain storage still refuses to start — that has not changed; what changed is how often it asks and whether it can tell "busy" from "broken".

  On the client side, a file that fails now backs off before it is tried again (persisted, so restarting is not the bypass), a peer that cannot be reached is reported as one unreachable workspace rather than hundreds of individually broken files, and a file the workspace will never accept — over its size limit, or an hourly upload allowance that is spent — says so by name and stops being retried forever. Two files in the reference project (165 MB and 466 MB) had been re-uploaded on every pass of every boot against a door that refuses anything over 95 MB, because the client and the workspace disagreed about the limit and neither said so.

  The second half is that none of this was visible. `maude design status` reported only canvases, so a project with 803 files still on their way read as fully synced (`0 pending`); the file counters in `.design/_sync.json` sat at zero for twenty minutes while 2 961 ledger rows changed underneath them; the file's own freshness timestamp froze at boot; and nothing anywhere had a denominator, so "1 412" looked the same whether it was a quarter done or finished. Progress is now folded from the ledger — the one source that stayed correct throughout — and the same numbers reach every surface: a progress bar and per-reason blocked counts in the Sync panel, a `files:` line and a live `--watch` mode in the CLI, a periodic line in `maude design serve`, and on the desktop a count in the window title plus one notification when the sync finishes or gets stuck. No estimated time is shown until real delivered bytes have been measured — during this incident a two-second sample read as "about ten minutes left" when the true answer was "never".

## 1.1.0

### Minor Changes

- 3216371: Add the `maude harness` environment projector for managed, fail-closed OpenCode and Codex configuration.

## 1.0.11

### Patch Changes

- Rebuild the committed client bundle against the locked dependency tree.

  `apps/studio/dist/client.bundle.js` and `dist/comment-mount.js` ship as
  committed artifacts, and CI asserts they are byte-identical to what it builds
  itself — the gate that exists because two releases went out with a desktop app
  that opened to a blank window. The committed copies had drifted: they were
  built against a `node_modules` that no longer matched `apps/studio/bun.lock`,
  so a clean `bun install --frozen-lockfile` produced different bytes.

  Nothing user-visible changes; the bundle is the same code compiled against the
  dependency versions the lockfile actually pins. The drift went unnoticed
  because the run that would have caught it was one of the many GitHub Actions
  dropped during an incident, so v1.0.10 reached the fleet, the hub image and the
  render service but was refused at the npm publish gate — correctly, since the
  desktop build could not verify its own bundle.

## 1.0.10

### Patch Changes

- 131df4e: An invite link to a self-hosted workspace opens a welcome page and signs you in.

  Inviting someone to a self-hosted hub mints a link of the form
  `https://<workspace>/join/<token>`. Opening it in a browser showed raw JSON —
  `{"ok":true,"workspace":…,"needsEmail":false,…}` — and nothing else. The
  server half of the invite path was built (mint, look, redeem) for a desktop
  deep-link client that never was, and the studio has since become a browser
  page at `/` behind a cookie session, so the person on the other end of the
  link had a door with no handle.

  The link now opens a welcome page: the email is already filled in when the
  invite was bound to one, the person chooses a password, and one click creates
  the account, consumes the single-use invite, and lands them in the studio
  signed in — the same session the workspace's own sign-in page sets. A short
  password comes back as the form with a sentence, the invite untouched; an
  expired, used or cancelled link is a plain page in plain words. API callers
  keep the JSON contract they had. Sessions minted by an invite now also carry
  the project role every other door stores, so a freshly invited member is not
  met with 401s on the first edit. The plain service pages ("Paused", "You do
  not have access", and now "This invitation no longer works") gained the
  centred layout they had been missing.

  The hub's People view also gained **Approve** on the "Waiting for access"
  queue. When the person you invited signs in through your identity provider
  instead of the link, they used to sit in that queue with nothing to do: "Link"
  wanted an account that did not exist yet, and creating one meant inventing an
  initial password for someone who will never type one. Approve creates the
  account for the address you confirm, with the role you pick, links that
  sign-in to it, and cancels the now-redundant invite — one click. Errors from
  the console are shown as sentences, not JSON.

  A security review of the new door (defender + attacker) ran before commit and
  its findings are fixed in the same change: a mangled invite link — or a
  malformed session cookie on any door — no longer takes the hub process down; an identity-provider-only (`strict`) hub refuses
  the password redeem, not just hides the form; the form gate fails closed
  (same-origin or a matching `Origin`, never same-site); a taken address is one
  neutral sentence instead of an account-existence oracle; the server-rendered
  pages carry referrer, framing and content-security headers; form bodies have
  the same size and time bounds as JSON ones.

- dbd7c8e: Canvas media plays on Linux, and a server that stops for good says so.

  **Linux media (issue #105).** Opening a canvas containing audio or video on
  Linux could take the whole view down with no message, twice over. WebKitGTK
  plays media through GStreamer, and the plugin that registers an audio sink is
  only an _optional_ dependency of WebKitGTK on Arch and most non-Debian distros —
  without it WebKit hits a release assertion and aborts the entire renderer rather
  than playing silently. Past that, the GPU video path asks Mesa's `radeonsi`
  driver for a colour buffer it rejects, and the pixel readback that follows
  faults; on a 4 GB card the same path exhausts video memory and the driver aborts
  outright. Both present identically to the person using it: the window opens, the
  canvas starts loading, the view goes blank.

  The `.deb` now declares the GStreamer plugin packages, so installing with `apt`
  makes the first failure unreachable. For every other install route — a repacked
  `.deb`, a distro package, an extracted tree — Maude looks for the audio sink at
  startup and, when it is missing, says so with the install command for the distro
  it is actually running on. On AMD graphics it sets WebKit's own
  `WEBKIT_GST_DISABLE_GL_SINK` escape hatch for itself, routing video frames
  through system memory; any value you set yourself wins, including `0` to keep
  the GPU path. The desktop docs gained a Linux row, install step, and a section
  covering all of it.

  **A stopped server (found while auditing those crashes).** Two `maude-server`
  cores from one afternoon turned out to share a byte-identical stack: a
  divide-by-zero on a zero stride inside the Bun runtime, which is upstream and
  not fixed here. What was ours is what happened next. The supervisor's restart
  budget counted crashes for the lifetime of the session rather than a crash
  _loop_ — it only ever reset when you switched projects and came back — so three
  unrelated crashes across a day retired the project permanently even though every
  one of them had recovered. And reaching that limit printed to a terminal that an
  app launched from the Dock, Finder or a desktop launcher does not have, leaving
  the window showing a page whose server had stopped answering: no error, no
  reason, no way back short of quitting.

  A crash now only counts toward the limit if the server had not been up and
  serving first, so an isolated fault costs nothing. When the limit really is
  reached, Maude tells you which project stopped, confirms your files on disk are
  untouched, and offers Try again — which restarts the server with a fresh budget
  instead of making you relaunch.

  **Also fixed:** the tarball-shape release gate could not run on npm 11 or newer,
  which changed `npm pack --json` from an array to an object keyed by package
  name. It accepts both shapes now.

## 1.0.0

### Major Changes

- Maude 1.0.

  The release that makes the sync arc real: the whole design folder mirrors both
  ways by default, deletions propagate behind cumulative breakers on both ends,
  and a project has exactly one owner — repo or hub, never both, switchable
  without moving a byte. Everything below it is the work that made that safe to
  turn on.

  **What 1.0 means here, stated plainly.** The journal, epoch and cursor wire
  format is now under semver: a peer on 1.x can talk to a hub on 1.x. That is the
  promise this number makes, and it is the one thing a 1.0.1 cannot take back.
  Everything else — the CLI surface, the plugin commands, the design-system
  scaffolding — has been stable in practice for many releases and is now stable by
  commitment.

  **Sync.** One journal-driven file lane replaces seven: a hub-ordered append-only
  `file_journal`, a payload-free poke, a per-hub ledger, and one pure three-way
  decision table. A fresh link delivers the project in full rather than delivering
  every canvas and losing the design system. A deletion is a tombstone with the
  same compare-and-swap a write has, so an edit that races a delete wins at the
  door; nothing is unlinked, losers land in `_trash/` on both ends.

  **Self-hosting.** `maude hub deploy docker` emits a compose stack + Caddyfile
  that fetches its own TLS; the hub image installs frozen against a committed
  lockfile so a poisoned transitive cannot ride in at build time; backups carry
  the checkout in the same generation as the databases, and `maude hub
restore-drill` proves a generation actually restores rather than assuming it.

  **Hardening.** The typechecker now reads every studio source — 52 files,
  `canvas-lib.tsx` among them, had been reached by nothing — and a coverage
  tripwire keeps it that way. The sync lane is a required CI gate. npm publish is
  blocked on the desktop bundle-completeness and client-boot checks. Six silent
  bugs the checker found are fixed (see the accompanying entry).

  **Known limits, named rather than discovered.**

  - **Hub OIDC is beta.** The browser-auth door has not had its own AppSec pass;
    a re-review already found two "closed" blockers that were not. Use tokens for
    anything you would mind losing.
  - `_trash/` is never pruned or indexed — quarantine is safe but not yet
    findable.
  - The sync flags (`syncFiles`, `propagateDeletes`, `resolveFirstAnchor`) are
    config-only; there is no UI toggle and no first-upgrade consent dialog.
  - Per-file sync state reaches `_sync.json` but the panel shows aggregates plus
    holds, not per-file rows.
  - Adopt/detach is CLI-only.
  - Open hub-trust findings remain tracked and unshipped: scope judged on lexical
    path while class is judged on the real one, delete-confirm semantics, seq
    echo, re-anchor storm recovery, poke cooldown on reconnect, tombstones under a
    degraded epoch, non-TTY `.gitignore` mutation, non-expiring parked remotes,
    and wildcard-scoped session tokens.

  The full deferred list lives in the post-1.0 hardening backlog; nothing on it
  was dropped silently.

### Minor Changes

- 3fdcc23: One sync lane instead of two, and a cloud project that comes back whole.

  The file-plane arc replaced a stack of sync mechanisms with a single lane, but
  replacing is not removing — the old asset engines kept running underneath,
  each a second opinion about a file's fate that nobody consulted on purpose.
  They are gone now. One decision function moves every project file, both
  directions; the old push and pull engines survive only as a thin compatibility
  client for a self-hosted hub that has not upgraded yet, and even that is chosen
  once when you link, never running beside the new lane.

  The cloud side gets the durability the old engines never had for everything but
  top-level pictures. Before, a hub-hosted project's design system — its
  stylesheets, its shared modules, its fonts nested deep in the folder — was safe
  only in the project's git history. A cloud instance that restarts pulls its
  working copy from the newest backup, so anything added since existed in one
  place that instance could not read, and canvases came back framed but unstyled.
  Every one of those files is now written through to durable storage as it lands,
  tracked by the same record the sync uses, so a restarted project comes back
  whole instead of missing its styling. If a file is ever served from the backup
  instead of the working copy, that is now a logged alarm rather than a silent
  fallback — it means the working copy drifted and wants looking at.

  On the desktop, the live editing buffer for each canvas is now the same object
  that syncs to the hub by default, rather than a copy reconciled through disk.
  Set `MAUDE_SHARED_DOC=0` to return to the previous two-document path.

- e951f48: Self-hosting grows up: a workspace you can operate, with your own identity provider.

  A self-hosted hub is the whole product for anyone not on Maude Cloud, and it
  gained the parts that were missing between "the container is up" and "a team
  uses this." People are managed in the admin console now — accounts, roles,
  invite-by-link (the hub still sends no mail; it hands you the link) — over APIs
  that already existed but had no UI. And a hub can accept sign-in from your own
  identity provider: one OIDC adapter covers Auth0, Google, or anything else that
  speaks it, verified with `jose`, with the rule that authenticating grants
  nothing until an admin links the identity to an account.

  Underneath, a live data-loss bug is closed: two hubs sharing one object-storage
  bucket used to prune each other's backup history away on a healthy day. A
  generation now names its owner, a hub refuses to write into a keyspace it does
  not own and shows that state in the console, and losing a `/repo` volume makes
  the hub stop and ask rather than quietly re-seed over the loss. `maude hub
workspace-up` is walked by a new `/design:hub-workspace` interview, and the
  docs cover AWS, durability, people and identity — with a test that fails the
  build if a doc names an environment variable no code reads.

- c825866: Your whole design folder syncs now, deletions stick, and the folder has one owner.

  Until now a linked project synced its canvases and the pictures that happened
  to sit next to them. Everything else — the design system's stylesheets, its
  README, the fonts, shared modules — stayed on whichever machine made it. A
  teammate opening the project got every canvas and none of the styling those
  canvases were written against, which looks less like "sync is behind" and more
  like "the project is broken".

  That folder now mirrors both ways in full. Which files count is decided by one
  rule on each side, and each side asks its own copy rather than trusting the
  other's answer. Three things still never travel: the file naming your hub (a
  synced one would let a hub rewrite where it lives), your per-machine state like
  camera position and local history, and another program's conflict copies.
  Executable modules are the one class gated at both ends. Linking asks once
  whether a hub may deliver them, defaulting to no, and that answer lives on your
  machine where no sign-in response can change it.

  Deleting works. Before, a removed file came back on the next pass, because
  absence and "I haven't heard about it" are the same thing on the wire until
  somebody says otherwise. A deletion is now a statement with a timestamp, sent
  with the same precondition an edit carries — so if somebody changed the file
  while you were deleting it, their change wins and the file returns. Nothing is
  ever unlinked: the losing copy moves to a trash folder on both ends. And when a
  batch goes at once — a branch switch, a restore that half-finished — sync
  pauses in both directions and the Sync panel says what it was about to do and
  to which files; nothing moves until you agree. That pause is a budget, not a
  per-check limit: it counts what has already been removed over the last hour and
  remembers across a restart, because the thing it guards against adds up.

  The folder also has exactly one owner now, where it used to quietly have two.
  Committing `.design/` while a hub mirrors it reads as extra safety and is the
  reverse: a `git pull` and a sync pass can each undo the other, and which wins
  is a matter of timing. So a project is repo-owned or hub-owned. `maude design
adopt` moves it to the hub, `maude design detach` brings it back, and neither
  moves a byte on your disk — adopt stops git tracking the folder, detach lets it
  see it again, and what to commit stays your call. Projects linked before this
  keep working and say so until you choose.

  Per project, `linkedHub.syncFiles: false` returns to the old narrow sync and
  `linkedHub.propagateDeletes: false` holds every absence.

### Patch Changes

- 783f11f: The cloud stops needing a reload, and it stops needing a schedule.

  A file that reached the cloud had already arrived — the bytes were on disk and
  the server would happily serve them to anyone who asked. Nothing asked. Inside
  the container, the mechanism that is supposed to notice a file appearing does
  not fire for the way files actually get written there, so the page showing a
  broken frame had no idea the picture it wanted was two directories away. The
  only cure was a manual reload, which is why "sync doesn't work" and "sync
  finished a minute ago" looked identical from the outside.

  The fix is to stop guessing. The hub now keeps an ordered record of every write
  it accepts, and the moment it accepts one it says so — over the same connection
  your canvases are already using. Peers fetch immediately instead of waiting for
  the next 20-second check, and an open cloud tab repairs the broken frame in
  place.

  What crosses that connection is deliberately almost nothing: a single number
  saying the record moved. It never carries a path, a file, or a hash, so a peer
  still learns _what_ changed only by asking through the same authenticated,
  re-validated route it always used. A lost notification therefore costs a few
  seconds and never correctness — the periodic check is still underneath, and it
  stays at its current cadence until the new path has proven itself in real use.

  Hubs that predate this simply don't advertise it, and every peer keeps today's
  behaviour against them unchanged. Per project, `linkedHub.fileEvents: false`
  opts back out.

- 8134ca8: History now shows the versions that are actually being saved.

  Connect a folder to Maude Cloud and the cloud starts saving it for you — every
  few seconds, without being asked. The panel said so. Directly underneath, it
  also said "No saved versions yet", while the same project open in a browser
  listed three saved versions. Both sentences were true, about two different
  places, and together they read as the one thing that was not true: that nothing
  was being kept.

  The panel was showing the history of the copy on your machine, which in that
  mode nobody writes to. It now shows the cloud's — headed by the cloud project's
  own name, so you can see which project the versions belong to — and clicking a
  version opens the canvas as it was then, even for versions that only ever
  existed in the cloud. If the cloud can't be reached, it says that, with a Retry,
  instead of quietly looking empty.

  While the cloud is saving, the app also stops keeping its own separate account
  of the folder: no unsaved-file marks in the file tree, no draft switcher, no
  background checks against a copy you are not editing through. Disconnect and all
  of it comes straight back, in place, with no restart.

  Your own `git` is untouched by any of this. Nothing is installed into the
  project, nothing is written to its configuration, and a terminal behaves exactly
  as it did before — including switching branches, which still updates what you
  see on screen.

- 35a5b11: Moving a canvas, and opening one made on another machine, stop losing work.

  Four defects in the cloud↔desktop sync, all found by driving a real pair by hand
  rather than by a test, and each one silent — nothing failed, the work simply
  wasn't there.

  Moving a canvas into a folder left every other machine showing it at the old
  place. A move renames the canvas's files onto its new name, and that included
  the document's own CRDT cache — whose last recorded word, written a step
  earlier, was "I have moved away." The new document therefore opened already
  retired and every peer let go of it. The cache is dropped on a move now (the
  canvas is on disk by then), and a document that claims to have moved to where it
  already is gets repaired instead of released — which is what heals the projects
  that already carry the bad stamp.

  A canvas created on a desktop could arrive in the cloud with its body written
  twice, which renders as an empty canvas. A cloud workspace has two writers over
  one folder — the hub, and the studio it supervises — so the studio kept finding
  files it had no record of and offering them to the hub as new, at the moment the
  hub's own copy was still in flight. Two rebuilds of the same body do not merge;
  they concatenate. The studio now asks the hub what it already holds before
  offering anything.

  Editing a canvas in the cloud that was created on a desktop looked like it
  worked and then quietly reverted, because that canvas had never joined the
  cloud's sync set at all. And a canvas whose name contains a space could arrive
  twice under two names, colliding with itself until it stopped syncing entirely.

  Also: revoking an invitation in the admin console now actually revokes it (the
  button called a route the hub does not serve, so the link stayed usable), the
  outstanding-invites list no longer counts spent ones, and an invite's expiry
  reads as time remaining rather than "just now".

- 74d9e0d: Six silent bugs, found by pointing a typechecker at code nothing was checking.

  `apps/studio/tsconfig.json` listed its roots by hand and the list had no `*.tsx`
  entry. Fifty-two tracked files were therefore read by no checker at all — not
  loosely checked, not checked. Among them: `canvas-lib.tsx`, which every canvas
  imports; every overlay; the whole `commands/` directory. Completing the list and
  driving it to zero errors turned up six real defects, each one quiet enough to
  have survived a full test suite and a visual smoke sweep.

  Curved connectors imported from FigJam arrived broken. The importer mapped
  Figma's `CURVED` to the string `curve`, and nothing in the renderer has ever
  known that word — the arrow type is `curved`. Every curved connector silently
  fell back to a straight line.

  A context-menu entry inside a submenu could be permanently dead. Leaf items
  resolve a function-form `disabled` against the thing you right-clicked; submenu
  items were handed the function itself, which is always truthy — so any such item
  rendered greyed out and swallowed every click, whatever the rule actually said
  about that target.

  Design-system motion specimens were not demonstrating their own easing. They
  passed a CSS `cubic-bezier(...)` string to the animation runtime, which accepts a
  named curve or four numbers and silently ignores anything else — so the tiles ran
  on the library default while claiming to show the system's tokens.

  The canvas geometry manifest dropped each artboard's `kind`, so the whiteboard
  tooling that reads it lost the print/web/video distinction. The artboard element
  carries the attribute; the reader simply never copied it across.

  Pre-warming the canvas runtime bundles passed the array index as an options
  object (`.map(fn)` hands its callback three arguments), so every warm-up after
  the first ran with nonsense settings. Invisible, because a failed pre-warm just
  means the real build happens on first use.

  And an inline media player dereferenced a context that can legitimately be
  absent — the overlay beside it already guarded the same value.

  The repair is pinned: a coverage check now asserts that every tracked source
  still reaches the checker, so the surface cannot quietly shrink again.

## 0.60.7

### Patch Changes

- f2de424: A dropped picture crosses to your other machines in seconds, not minutes.

  Both directions had a scheduler in the way. Uploading FROM the desktop waited
  for the full reconciliation sweep — a debounce, a spawned helper process, and
  a probe of every asset in the project — before one new file went up, which
  read as minutes of a placeholder frame. Downloading TO a machine waited for
  the next 20-second polling tick even though the annotation referencing the
  picture had already arrived over the live connection.

  Both get a fast lane now. A file you add is pushed by itself the moment it
  lands on disk (one presence check, one upload — the sweep stays as the
  safety net that reconciles everything else). And the moment a canvas or
  annotation carrying an image reference arrives, the missing-files check runs
  immediately instead of at the next tick. Combined with the in-place heal from
  the previous release, the picture appears on the other side seconds after you
  drop it.

## 0.60.6

### Patch Changes

- 2f43224: A picture you drop on a canvas now reaches your other machines while you
  watch — and heals on screen the moment it lands, without a reload.

  Four holes lined up behind one symptom (a broken-image frame that never
  recovered):

  - The cloud served pictures only from its durable object store, not from its
    own working copy — so a freshly uploaded file that the cloud itself was
    already displaying answered "not found" to every other machine asking for
    it. The working copy now serves first, the object store stays the fallback.
  - One of the three upload doors never told the object-store mirror it had
    written anything, so files pushed through it survived only until the next
    cloud restart.
  - When the mirror DID fail, it failed silently — no log line anywhere. It now
    says loudly what failed and why, and retries once on its own.
  - Browsers never retry an image that failed to load. When the missing file
    finally arrives on disk, open canvases now get a signal and re-point the
    broken images at it — the glyph heals in place instead of waiting for a
    manual reload.

- 7195fc1: Mouse-wheel panning on the canvas is smoother and faster.

  The wheel handler fed the browser's raw `WheelEvent` delta straight into the
  pan distance, but a wheel event isn't always reported in pixels — a physical
  mouse (notably on Firefox, and on some browser/OS driver combinations
  elsewhere) reports "line" units instead, a few small integers per notch.
  Treating that as pixels moved the canvas only a few pixels per wheel notch,
  which read as almost frozen; trackpad panning was unaffected because
  trackpads already report pixel units.

  Wheel deltas are now normalized against the unit the browser actually
  reports before they're applied, so a physical mouse wheel pans at a normal,
  visible speed again.

## 0.60.5

### Patch Changes

- 6ed4e24: Drawings and stickers on the canvas stop disappearing after a cloud restart —
  and a freshly dropped image now actually arrives on your other machines.

  Annotations had no timestamp of their own, so when a machine reconnected, they
  followed whichever side won the CANVAS BODY comparison. An annotation edit
  doesn't touch the body, so a cloud that restarted with a stale, empty
  annotation record — and a newer body — silently replaced your strokes with
  that emptiness on every reconnect. The emptiness even looked non-empty to the
  guards (it's a 72-byte SVG shell with zero strokes in it), so nothing stopped
  it. And because the strokes carried the image references that tell a machine
  which pictures to download, a sticker or drag-and-dropped photo lost its
  durable record within minutes — the other machine showed a broken-image frame
  in the right place, with the right size, forever.

  Annotations now carry their own edit time and resolve independently of the
  body, with one hard rule: an empty record with no timestamp never overwrites
  real strokes — the strokes win and are pushed back up, healing the cloud copy.
  A deliberate "delete all annotations" still propagates: it is stamped when it
  happens, and a stamped deletion that is provably newer is honored.

- 6ed4e24: The desktop app's asset upload no longer depends on tools installed on your
  machine.

  Uploading a project's images to the cloud runs in a helper process, and the
  packaged app resolved that helper's runtime from the system PATH — which, for
  an app launched from the Dock, doesn't include developer tool locations. On a
  machine without a separately installed runtime the upload died at start with
  "Executable not found in $PATH" and the assets waited for the next launch.
  The compiled server now runs the helper through its own bundled runtime, the
  same way every other packaged helper already works, so the sweep starts
  regardless of what the machine has installed.

## 0.60.4

### Patch Changes

- 461935c: Deleting a canvas now means it is deleted, and a picture you add in the browser
  arrives on your other machines.

  Two things were wrong for the same reason: sync could say what a project HAS and
  had no way to say what it no longer has, or to send a picture in the direction
  nobody had built.

  Deleting a canvas only ever moved it to the trash on the machine you were
  sitting at. Nothing told the project, and every machine treats the project as
  the authority on what exists — so the canvas came straight back. It looked like
  deleting was ignored: the canvas vanished for a second and reappeared. Deleting
  is now something the project is told, and every machine puts its own copy in the
  trash where you can still get it back. Making a new canvas with a name you
  deleted earlier works too.

  Pictures only ever travelled one way. An image you dropped onto a canvas on your
  desktop reached the cloud; one you added in the browser never came down, so the
  canvas showed the picture's frame — right place, right size, right caption — and
  no picture, on every machine but the one that made it. Each machine now fetches
  the pictures it can see are missing.

- 18f7c29: Linking a fresh folder to a cloud project can now bring the WHOLE project —
  canvases and the design system that makes them render.

  Sync's unit was a canvas, so a file only ever travelled if a canvas claimed it
  by name. Everything else — the design system's fonts and logos, its stylesheets,
  the token files, the docs — had no lane. Linking a brand-new folder to a project
  delivered every canvas and none of that, so the canvases arrived visibly broken:
  error banners on some, unstyled on the rest, no logos, no fonts.

  The fix is one rule instead of a lane per file kind: what's in the folder syncs.
  A single shared classifier decides membership positively — images, fonts, video,
  stylesheets, docs flow freely; a project's own config and per-machine runtime
  state never travel; code files travel only from a project you own. The receiver
  re-checks every file against its own project before writing it, so the mechanism
  is a manifest and a content hash, never "trust the folder on the other end".

  This ships behind a switch (`linkedHub.syncFiles`), off for now while it soaks;
  today's asset sync is unchanged when it's off.

## 0.60.3

### Patch Changes

- 9756c95: A canvas made anywhere now shows up everywhere, without anyone restarting
  anything — and the cloud keeps its own images.

  Each side used to look for new canvases exactly once, when it started up. Your
  desktop restarts all the time, so a canvas you made there eventually turned up
  in the cloud; a cloud project runs for days, so a canvas you made in the browser
  never turned up anywhere at all. Sync looked one-directional, and a canvas that
  did arrive had no cursors and no live edits in it. Both sides now keep looking:
  a new canvas is picked up as it appears, arrives on the other machine, and is
  live in it — cursors, comments, annotations and all.

  The cloud also stops losing pictures. When it moved your project between
  machines, photographs could come back as grey boxes and the only repair was
  re-uploading everything from your laptop; it now restores them itself from the
  copy it already had. Resync is a desktop control again — in the cloud it never
  could work, and offering it there only produced an error nobody could act on.

  Finally, `maude doctor` notices when your `.gitignore` is quietly dropping work
  Maude considers yours to keep — a stale rule could keep every annotation out of
  git forever, visible in the app and in no clone of it.

## 0.60.2

### Patch Changes

- b66dab3: Design-system files open in the cloud file browser again.

  Clicking a logo, a font or a photograph in a cloud project showed a broken
  image, even though the same files rendered perfectly inside canvases. The cloud
  only ever forwarded a fixed list of addresses to the project, and nobody had put
  design-system files on it — so the file browser was asking for something the
  cloud answered "not found" to without ever looking. It now serves exactly the
  files the desktop is allowed to upload: pictures, fonts and media inside an
  `assets` folder, read-only, with everything else — canvas source, project
  settings, and per-person working state — still invisible.

## 0.60.1

### Patch Changes

- Photographs stop going missing from a cloud project after the server restarts.

  A picture you upload is kept in two places, and a canvas can ask for it from
  either one. Maude was only checking the first, so after a cloud server restart
  it would report a project as fully uploaded while half its photographs had
  quietly become grey boxes — and because it believed they were already there, it
  never sent them again. Maude now treats a picture as uploaded only when both
  copies are really present, so anything that goes missing comes back on the next
  sync instead of staying broken.

## 0.60.0

### Minor Changes

- 188d2ba: Import a Figma file with no Figma account.

  `maude design import-figma --fig <path>` reads a `.fig` or `.jam` you exported,
  entirely offline — no network, no token, no seat. It is the only import door
  that works when you have none of those, and the only one whose images travel
  inside the file, so nothing expires and nothing is rate-limited.

  The decoder is ours and adds no dependency: a narrow ZIP reader and a Kiwi
  schema/data decoder over `node:zlib` alone. That matters beyond tidiness — a
  `.fig` carries its own schema, so a Figma schema change is a non-event rather
  than something to chase, and the door works identically on the npm CLI and in
  the packaged app.

  Pictures come out of the archive itself, including vector icons: the path
  geometry is in the file, so an icon is rebuilt locally as real SVG instead of
  being requested from Figma. The archive's own prelude decides whether it is a
  board or a design file, so there is no mode to pick and no way to ask for the
  wrong translator.

  It refuses rather than guessing. A design importer that half-reads a file it
  does not understand produces plausible, subtly wrong geometry that you discover
  three canvases later, so an unrecognised prelude or a broken chunk stops the
  import and names what it saw. The one thing a local export genuinely cannot
  reproduce — a percent line-height, which needs font metrics the file does not
  carry — is reported, not silently dropped, and so is every node that degrades.

### Patch Changes

- 034f3fb: Your project's assets stop re-uploading themselves every time you open Maude.

  The desktop asked the cloud about each file separately, with a request the
  cloud quietly rewrote on the way in — so the answer never came back as "already
  there", and a design system's logos, fonts and photos were uploaded again on
  every launch. Maude now asks about the whole project in one go: a project whose
  assets are already up there settles in a second instead of minutes, and nothing
  travels twice.

- 66b6826: A Resync button in the Sync panel — and an upload that can no longer take Maude
  down with it.

  Until now the only way to re-check your work against the cloud was to quit and
  reopen Maude, and on a big project that upload could crash the app mid-way,
  leaving the panel stuck at "92 of 182" forever. Resync now re-checks everything
  in one press — every canvas and every file — and the upload runs on its own, so
  if it fails it fails alone: Maude keeps working and the panel tells you what
  happened instead of going quiet. You can also stop an upload part-way; nothing
  is left half-sent.

## 0.59.0

### Minor Changes

- 97159c2: New Sync panel: watch your project sync, file by file.

  - **Per-file sync state.** The status-bar **hub sync** chip is now a button —
    click it to open a Sync panel listing every canvas with its live state
    (_syncing_, _synced_, or _refused_ with the reason), grouped by canvas
    group, with anything that needs attention pinned on top. "Is my work
    actually up there?" finally has a per-file answer instead of one aggregate
    number.

  - **Asset upload progress.** The desktop's asset push to the cloud (images,
    fonts, videos) now reports live progress into the same panel — how many are
    pushed, already there, or failed (with the failing paths listed). Failed
    uploads retry on the next launch.

  - Under the hood this is pure surfacing: the sync payload gains a bounded
    per-document list and an asset-progress lane (additive — older readers are
    unaffected), the panel speaks the same vocabulary as the chip and the cloud
    rail, and everything hub-supplied renders bounded and text-only.

### Patch Changes

- 9ef622a: A project's assets now finish uploading to the cloud in one pass.

  The authenticated asset write lane was sharing the hub's per-IP admin rate-limit
  bucket (5 requests a minute — a brute-force control for unauthenticated
  traffic), so a project with a lot of images, fonts and video moved a handful of
  files per boot and never caught up. It gets its own generous per-token bucket
  now, the desktop paces itself on the hub's `Retry-After` instead of burning the
  window, and a refused upload no longer wedges the sweep — a peer that answers
  before reading the body used to leave the connection desynchronized, which
  could hang the sync and take the dev server with it. A file the hub refuses is
  also named with the real reason instead of a bare status code.

- 3b6f89a: Design-system brand assets now render in the cloud, and the desktop status bar
  stops flapping to "reconnecting" on an idle link.

  - **Cloud images (completing the 0.58.3 fix).** The first pass only pushed a
    project's top-level `assets/` up to the cloud, but a design system keeps its
    logos, signs, fonts and photos under `system/<ds>/assets/…` and references
    them by their full path — served from the cell's checkout, not the asset
    bucket. Those 90-odd files never left the desktop, so every brand logo showed
    a grey "Preview:" placeholder. The desktop now pushes every asset directory to
    the cell over a new checkout-write route (symlink-contained, binary-extensions
    only, size-capped), so brand assets render in the cloud like everything else.

  - **"Reconnecting" flap (desktop).** The status bar could sit on _reconnecting_
    while the cloud sync said _synced_ — two different sockets. The local
    dev-server socket carries no traffic when you're idle, so it hit the 120-second
    idle-timeout, closed, and reconnected in a loop. It now sends a small keepalive
    every 25 seconds, so an idle link stays _live_.

- a6f1c30: The Timeline plays the artboard you're actually looking at.

  - **Fixed: scrub and playback moved the wrong comp.** On a canvas with more than
    one video-comp, the Timeline drew the rows of the artboard you had panned to,
    but Play, scrub, mute and loop drove the _first_ artboard's composition.
    Underneath, the panel picked its target comp by matching clip length — so two
    compositions of the same duration (the ordinary case) collapsed onto whichever
    one happened to mount first. Every comp now says which artboard it belongs to,
    and the transport follows that, not the length.

  - **The Timeline says which artboard it's on.** On a multi-comp canvas the panel
    head shows the scoped artboard's name, so "these rows belong to _that_ board"
    is visible instead of inferred. Pan to another artboard to switch.

  - The clip length is still used as a fallback when the artboard isn't known, but
    only when it identifies exactly one comp — never by silently taking the first.
    The same targeted comp now backs the frame readout and the frame math behind
    drop, split, and the +Title / +Image / +AI clip inserts.

- abbc792: A muted/degraded video export now looks visibly different from a clean one, and mp4/webm export gets an opt-in JPEG capture intermediate.

  - **The "degraded export" pill actually reads as a warning now.** A CSS token typo (`--u-status-warning` instead of `--u-status-warn`) meant the Exports panel's "degraded" pill silently rendered in the same accent color as "running" — undercutting the whole point of flagging a muted or lower-quality export.
  - **`--frame-format jpeg|png` (opt-in, default stays `png`)** on the frame-step video capture path — a lossy-but-faster screenshot intermediate for the fallback exporter, gated off for `--dump-frames` and GIF. No default behavior changes.

## 0.58.3

### Patch Changes

- f28c465: A cloud link renews itself instead of silently dying after 12 hours.

  The desktop held a never-expiring account sign-in next to a ≤12-hour cell
  session token and nothing connected the two — so every cloud workspace link
  stopped syncing within half a day, every canvas was refused with `invalid
token`, and the status bar sat on `connecting…` indefinitely. Re-pressing
  Connect was the only cure, and nothing told you to.

  Now the sync runtime renews the session token in place from the account
  you're already signed into — on a timer before it expires, and immediately
  when a refusal proves it already has. No re-login chore, and the 12-hour
  revocation window is unchanged: a renewal only ever mints a fresh token
  through the cloud, so being signed out, revoked, or removed from a project
  makes it fail exactly where it should.

  Two honesty fixes ride along: the hub's rate-limited refusal of an invalid
  token now says so (a peer no longer mistakes it for a transient limit and
  retries forever into the bucket refusing it), and a link that has synced
  nothing for five minutes reads as **stalled** with a reconnect prompt
  instead of a permanent `connecting…`. Renewal itself is rate-disciplined —
  a floor plus a no-progress cap — so it can never become the retry storm it
  exists to end.

- f0b5e8c: A cloud-linked project now matches your desktop exactly — same files, same
  canvases, same images — and connecting means one save mechanism, not two.

  This closes the remaining faults from the desktop↔cloud sync RCA (fixes 4–8;
  fixes 1–3 shipped alongside the self-renewing link):

  - **No more duplicates or broken canvases.** The hub used to memoise a flat
    fallback path before the canvas's real path was stamped, so a body that
    arrived first was pinned to the wrong location forever — a stub that failed
    its dynamic import in the cloud, and a duplicate file next to the real one.
    The path is now stamped before the first sync, and the hub relocates a
    fallback in place when the real path arrives (never moving a file another
    peer actually owns). A one-shot migration quarantines the duplicate flat
    copies earlier versions already wrote to `_trash/`, never deleting them.

  - **Images show up instead of grey boxes.** The sync lanes carried text only,
    so a linked project's `assets/` never reached the cell. The desktop now
    pushes them over the existing authenticated asset route — streamed,
    size-capped, and contained to the design root — so the cloud serves the real
    bytes.

  - **The cloud picker tells the truth.** The project this folder is linked to
    reads **Connected** (with a Disconnect), not another **Connect** button.

  - **One place your work is saved.** Once a repo is linked and signed in, the
    desktop's local-commit panel steps back to a read-only History with a
    "Cloud is saving — changes sync automatically" note, so you're not choosing
    between two save mechanisms. Your git is untouched; Disconnect brings the
    panel back.

## 0.58.2

### Patch Changes

- f2a38c4: Sync now carries a canvas's folder, so a project arrives whole.

  A canvas synced but its **location** did not: the document name is a flattened
  slug (`ui/2026/social/summer-camp.tsx` → `ui-2026-social-summer-camp`) and
  `/` → `-` is not reversible, so both the desktop and the cloud wrote the body
  flat at the design root — where the file tree lists nothing and nothing syncs it
  onward. Three canvases sat on a live hub with their full bodies and appeared
  nowhere in the cloud, while the desktop's log correctly said `76/76 synced`.

  The path now travels with the document and is checked rather than trusted: it is
  believed only because it slugs back to the very document carrying it, which makes
  a path aimed anywhere else stop addressing that document. A path that fails the
  check — or an older peer that sends none — still gets its canvas, now inside a
  canvas group instead of at the design root, and at a path that still resolves to
  the same document rather than forking it.

  Also: a fresh process no longer serves the previous one's sync verdict, so
  `/_sync-status` can't report `0 synced · 73 rejected` for a link the hub is
  accepting.

## 0.58.1

### Patch Changes

- d6dcbaf: An AI placeholder slate can now move between the storyline and an overlay layer, just like a real clip.

  **Drag it out, drag it back in.** The "move to overlay" and "move to storyline" verbs used to require a clip to carry a real media source, so a not-yet-generated `<AIPlaceholder>` slate — the prompt-carrying stand-in you drop before the AI content exists — was refused every time and stayed stuck wherever it first landed. It now rides the move with its prompt and kind intact, in the storyline or a standalone overlay layer, and back again.

- e3e5d6a: Typing a height for an artboard in the Inspector does something again.

  Width worked; Height silently did nothing whenever the artboard was in Hug mode, where the height is a content-driven floor rather than an exact size — so the value you typed was simply dropped, with no message. A typed height now promotes the artboard to Fixed at that height: the same "freeze the height" write the Hug/Fixed toggle already performed, just seeded from your number instead of the last measured one. In Fixed mode it stays an ordinary resize, exactly as before.

- e3e5d6a: A clip dropped onto the timeline keeps its own length instead of becoming three seconds.

  Every drag-and-drop landed as a 3-second clip, whatever the source actually was, because the drop happened before anything had read the file's real duration and 3s was the fallback. The drop path now loads the media's metadata first and uses its true duration, so a 12-second take arrives as a 12-second clip and no longer has to be re-trimmed by hand.

- e3e5d6a: Follow-ups to the v0.58.0 release-pipeline work, found by running it for real.

  **A push to `main` now touches nothing in the cloud fleet.** v0.58.0 made cell image builds tag-only but kept the branch run's Worker deploy, on the reasoning that the Worker is not the image. It is not that simple: the config _names_ the container image, so deploying the Worker reconciles the container too — and on the release commit, which points at an image only the tag run builds, that failed after the Worker had already been uploaded. A branch push now runs the data-plane tests and stops.

  **The post-deploy check reads the right field.** It looked for the served-bundle hash one level too deep in the health payload, so it could only ever time out — and it passed review because its own test fixture was written to the same wrong shape. The shape is now asserted where the payload is produced, not just mirrored in the test.

  **A cell stops reporting its version as `0.0.0`.** The hub's manifest was never copied into the image, so the version lookup always failed quietly. It is staged now, and `/health` reports the real release on both fields.

## 0.58.0

### Minor Changes

- 981b3de: Maude tells you when a chat finishes or needs input — even in a project you're not looking at.

  **A native notification now fires for a background project, not just the one on screen.** The desktop app polls every project it's keeping alive in the background (up to two others beyond the one you're viewing) and sends a real OS notification the moment a turn finishes or gets stuck waiting on you — including a chat that outlived its browser tab entirely. The notification never names the chat, its title, or anything it said: only the project's own folder name plus a fixed line ("Claude finished" / "Maude needs your input"), because a chat title is generated from whatever the model read, and a lock screen is the wrong place to show that.

  **A permission or question prompt raised in a project you're not looking at now has a real chance of reaching you before it times out.** Previously that signal only ever showed up in the in-app badge — silent if the window wasn't focused, and invisible entirely for a chat with no open tab.

  The visible project's own "you weren't looking" notification (window unfocused or the panel closed) now goes through the same native path under the desktop app, with a Web-notification fallback outside it — same policy as before, just routed through the OS reliably.

  No new setting: turn Maude's notifications off from your OS's own per-app notification controls if you'd rather not get them — an in-app toggle risked becoming the one switch that silently loses the awaiting-input signal too.

- 640b69d: ACP chat: writes are scoped to the project, and chats survive reloads and project switches.

  **The assistant now asks before writing outside your project.** Editing anything inside the project is unchanged — no prompt, exactly as before. A write to somewhere else (a shell profile, a launch agent, another repo) now shows a permission card naming the _resolved_ absolute path, and that consent is per-call: there is no "always allow" on that path.

  Being inside the project is necessary for the no-prompt path, but not sufficient. A handful of in-project files run code later without the assistant touching them again — `.git/` (a hook or a `core.*` config key), `.claude/`, `CLAUDE.md`, `.mcp.json`, `.envrc`, `.vscode/`, `.github/workflows/`, `node_modules/`, `package.json` and lockfiles — so those ask too, with a card that says the file is part of how the project _runs_.

  As part of this, the read-only shell verbs (`ls`, `cat`, `head`, `tail`, `wc`, `tree`, `file`, `stat`, `pwd`) no longer run without asking: a permission rule matches the command name and cannot see what follows it, so `cat > ~/.zshenv` was an unrestricted write. `Read`, `Grep` and `Glob` are unaffected, so reading files is as frictionless as it was.

  **A chat is no longer tied to its browser tab.** Reloading the page, switching branches, or switching projects used to kill a running turn silently. The agent now keeps working and the panel re-attaches to it, joining the live stream to the history it already has without repeating or dropping output. Switching to another project leaves the first one's chats running; switching back lands in the same conversation. Quitting the app still stops everything.

  Switching branches while a chat is mid-turn now warns first — a checkout moves files under an agent that is actively editing them, and version history cannot undo a cross-branch mix-up.

  This does not mean an ACP session can never write outside your project: `maude design <verb>` commands still run without prompting and can reach further. See the feature's decision record for the full, honest scope.

- d4ca488: Click any file in the Studio file tree to preview it — not just canvases.

  Markdown, CSS, JSON, and text files render inline (markdown formatted, everything else as plain text); images, video, and audio play natively; fonts get a live specimen. Design-system asset folders (`assets/fonts`, `assets/logos`, `assets/photos`, …) now list their actual files in the tree instead of showing up empty — click one to see it, no more guessing what's inside from the filename alone.

### Patch Changes

- ca4164c: Connecting a cloud project now tells you what is actually happening, and whether it worked.

  **The sentence you get after Connect is live, and it is true.** It used to be written once, at the instant the confirm dialog closed, from a value that only meant "the sync runtime started without throwing" — not that a socket had opened, a token had been accepted, or a single byte had moved. It then sat there unchanged through every outcome, including a link that never connected at all. It now moves: _Connecting to alligators… → Syncing with alligators — 40 of 75 → Synced with alligators — all 75. 3 came down from the project on this connect._

  **Every state says what to do next.** A hub that refused your canvases says so and tells you to reconnect, because a rotated credential never fixes itself. A hub that is unreachable says your edits are queued and safe, and that nothing needs doing. A project with nothing syncable tells you to make a canvas.

  **The status bar and the connect note can no longer disagree.** They now read the same rule. Previously the status bar keyed off hub _reachability_ alone and never looked at the per-canvas counts — so a link where the hub had refused every single canvas still showed a green dot and the word "synced". Meanwhile the note's own hover text told you to go and check that status bar for the real answer.

  Three underlying fixes make that possible: the connection monitor no longer starts life claiming to be online; the "synced" count can now fall when the hub goes away, instead of freezing at whatever it last reached; and the list of canvases pulled down from the project now names the ones that actually arrived, rather than the ones it was about to fetch.

- daf9d6f: Tagging a release now deploys the cloud and proves it did — and you can see the running version without leaving the app.

  **Only a release tag builds a cell image.** A push to `main` used to build one too, deriving it from `maude-hub:latest` — an image that is only ever rebuilt at release time. So the cell was built on the _previous_ release's hub, and every workflow went green anyway: v0.57.0 put a cell tagged `v0.57.0` into production carrying a six-day-old hub layer, and a route added after v0.56.0 was simply missing from the live fleet. A branch push now runs the data-plane tests and deploys the Worker, and nothing else. It could never roll the fleet in the first place, and the one thing it _could_ do was leave two different images under one tag.

  **"Green" now means a live cell answered on the released version.** After deploying, the workflow polls a real tenant cell until it reports the version just released _and_ the exact client bytes this run built. The two catch different failures and neither replaces the other: the hash catches "same tag, different bytes", and only the version catches "the layer underneath is a release behind" — that stale image was internally self-consistent, so a hash check alone would have waved it straight through.

  **The version is now something you can read.** It shows in the Studio status bar (desktop, browser, and cloud — they all serve the same client), in the hub admin header next to the bundle hash, and at `/health` as `releaseVersion`. Both app manifests join the release line, so the hub stops reporting itself as `0.0.0`.

  **And the release instructions agree with each other.** Three of the four places that tell you how to tag printed a lightweight `git tag vX.Y.Z`, which `git push --follow-tags` silently ignores — the tag stays on your laptop and not one release workflow fires. They all print the annotated form now, and a test fails if any of them drifts back.

## 0.56.0

### Minor Changes

- 8621625: **Cloud: desktop and browser can now share live edits and cursors on the same project.**

  Until now a Maude Cloud cell held two disconnected worlds — the hub's document store, which the desktop app syncs to, and the browser's own collab rooms, which never crossed the gap. A person editing in their browser and a person editing the same project in the desktop app couldn't see each other's cursors, and an edit made in one surface never reached the other live (both still saved to disk, so nothing was lost — the "live" part just didn't exist).

  The cell's own studio process now pairs with its own hub over loopback — never dialing anywhere else — so the browser's editing buffer and the desktop's synced document become the same object. Presence and edits cross both ways; the hub remains the sole committer to the project's git history.

  **Gated to a pilot project for now** (`CELL_LIVE_PAIRING`, currently `alligators` only) while the live cross-surface verification run — two real surfaces, cursors both ways, a reload losing nothing, exactly one committer — completes. No behavior changes for desktop, self-hosted hubs, or any other cloud project.

- 0d8b321: Gemma scout is much easier to set up. The smart-frames `gemma` tier now runs on either of two local runtimes: **Ollama** (new — `ollama pull gemma3:4b`, no Python, vision-capable gemma3 tags auto-detected) or **mlx-vlm** (preferred when present — the benchmarked native-video path). The Settings → Video card shows copy/paste install commands for both (the mlx-vlm one now targets a Maude-managed venv, so it works on PEP 668 externally-managed Pythons) and re-probes automatically, unlocking itself once a runtime is installed. New env knobs: `OLLAMA_HOST`, `MAUDE_OLLAMA_MODEL`.

### Patch Changes

- 1ffba14: Cloud: signing in through the desktop/API door now yields a session that can actually write.

  `/auth/login` (the token-exchange door the desktop app and API clients use) minted sessions with only the one-bit read-only projection of the member's role — never the role itself. The hub deliberately treats a role-less session as no session at all, so every HTTP write from such a session answered 401 "sign in to open this project" while reads and live cursors kept flowing — the same wall stale pre-v0.55.0 browser sessions hit. The door now stores the translated project role at mint, exactly as the browser sign-in door does, and a guard test holds both doors to the same contract.

- aaf3e53: Cloud: drawing, artboard edits and media changes made inside a canvas actually save now.

  Every write leaving the canvas iframe — annotation strokes, artboard layout, uploaded media — was silently converted to a bodyless GET at the platform's front door: the Worker rebuilt the request with an object spread, and a Request's method and body are invisible to spread, so nothing survived. The studio then answered the "write" from its read branches with a 200 the client took as "saved" — changes looked live, crossed as cursors, and vanished on reload. This is also why the v0.55.0 "canvas door refused every write" fix appeared not to work: the method never survived long enough to reach the door it repaired. The rebuild now carries the original request whole, the same rule is applied to the project-hostname marker strip, and both rebuilds are pinned by tests that assert a PUT crosses as a PUT, body intact.

- 2969b00: Cloud: Inspector and artboard edits made in the browser now actually save.

  Inside a cell the editing shell could annotate and comment but nothing else — every CSS-knob change, artboard resize/style/kind, insert, delete, reorder, and text/attribute edit was refused with "local request required (DNS-rebinding guard)". The guard on ~97 studio routes checks for a loopback `Host`, but the cloud proxy deliberately rewrites `Host` to the project's public name, so it could never pass in a cell; annotations and comments were spared only because their handlers carry no such guard. The check is now mode-aware — verbatim loopback locally, and in a cell it accepts the proxy's unforgeable role vouch instead (the same signal the collaboration sockets already trust). A separate one-line inversion is fixed too: the Local/Shared badge lookup was filed as a write and answered 405 for every role. Both are pinned by tests — a helper matrix and a manifest guard that fails the build if a write-classified route is ever a read-only handler again.

- 481da7e: **Cloud: a project now records every edit it receives, and the browser stops asking you to save work that is already saved.**

  The live cross-surface verification run that the previous release gated on has now been done against a real cell — a browser and the desktop app on one project, two accounts, both origins. It found two things that every unit test had passed over, because both live in the seam between the cell's two processes:

  **Edits reached the disk and never reached the history.** In a paired cell the studio process and the hub write the same bytes from the same document, and the studio usually gets there first. The hub committed only files it had written itself, so it wrote nothing, committed nothing, and the project's history simply stopped — while the work sat safely on disk, looking fine. The invariant "exactly one committer" was technically satisfied by there being none. The hub now commits what the document carries, regardless of which process put it on disk, and lets git decide whether anything actually changed.

  **Annotations were saved to a name nothing looked for.** The hub filed a canvas's drawn annotations next to the canvas; everything that reads them looks for them under the canvas's own slug at the top of the design folder. The result was a stray file in the project's history — and, for a project mirrored to GitHub, in the mirror — while the real one stayed untracked. The two now agree.

  **The browser's Changes panel is now History.** A cloud project commits as you work, so a list of "unsaved changes", a Save button and a Publish button described work that was already kept — and the panel's advice to save from your terminal was addressed to people who have no terminal. Where the server owns the history, the panel now shows only what it can honestly offer: what was saved, and when. The desktop app is unchanged; it still owns its own checkout and its own Save and Publish.

- 61f9e47: Cloud: a source edit (Inspector CSS, artboard resize/style, insert/reorder) now updates a collaborator's canvas live, instead of waiting for them to refresh.

  Two people on one cloud project share one server. When one made a source edit, the change reached disk and the git history but the other person's canvas sat on the old version until they manually reloaded — annotations crossed live, structural edits didn't. The cause: the studio announces edits to peers through a filesystem watcher, and the container's recursive watch silently misses the atomic file writes the editor makes (it works on a local Mac, which is why this only showed up in the cloud). Verified against a live project: an edit that returned success delivered nothing to a connected peer socket. The fix announces each write directly from the edit path rather than depending on the watcher, so a peer's canvas hot-swaps within a fraction of a second; a no-op or rejected edit announces nothing. Local (non-cloud) behaviour is unchanged.

- 976c66f: **The bundled knowledge-graph engine (kgai) is upgraded to v1.4.0**, from v1.0.0. If you've turned on the knowledge-graph memory backend (`knowledgeGraph.mode`), you pick up several fixes on top of four months of engine work: `kg context --paths` now matches nested files correctly, `kg as-of <date>` means the end of that day instead of silently excluding anything recorded today, and a bug that could mint a false conflict when re-touching an existing decision element is gone.

  Session-start sync now uses the engine's own fire-and-forget `--auto` mode — it honors a cooldown and never blocks on a store lock, so it can no longer pile up across rapid session restarts. Closing a session (`/flow:done`, `/flow:pause`) still pushes with a deliberate, uncooled sync.

  If you installed the `kg` CLI by hand for the shared company graph, the old install had no self-update — `kg status` now shows the exact version so you can confirm which engine you're actually running before assuming a pin bump reached you.

## 0.55.0

### Minor Changes

- b406a42: Cloud: signing in from the desktop app actually opens your browser, and "Open in Maude" now says what it is about to connect.

  **Sign-in no longer dead-ends.** In the desktop app the button that was supposed to open your dashboard did nothing at all — WKWebView drops `window.open` silently — while the dialog claimed a browser had opened. You were left holding a short code with nowhere to type it. The app now reaches the OS browser through a narrow, host-locked command, the dialog says what to do rather than what supposedly already happened, and the activation address is always shown as something you can click or copy. That address already carries the code, so confirming is one click. The same fix covers the two other buttons on that path — "View in the browser" and "Open the dashboard" — which were equally inert in the app.

  **"Open in Maude" is now a decision, not a one-line strip.** The old prompt asked "Connect this project to X?" without ever saying which project "this" was — the one thing the answer depends on. It now names both sides, states in one sentence what syncs (this folder's `.design/` canvases, and nothing else in the repo), and checks whether the folder you have open actually looks like the workspace the link names. If it doesn't, connecting is demoted behind an explicit "Connect anyway" with an explanation and a way out. Only an exact match, or a folder already signed in to that workspace, passes without comment — a name that merely resembles yours is called out, because a project name is something anyone can choose. Declining stays free: the dashboard mints a fresh link whenever you press the button again.

  Everything that made the old flow safe is unchanged: a link is parked and asked about rather than acted on, a second link never replaces the one you are reading, the code is only ever exchanged against the address the app is configured for, and a link that names one project but opens another is still refused outright.

- 3960647: Cloud: an operator board, server-side product analytics, and figures for what a project actually costs to run.

  **`/operator`** — one signed-in surface showing every project and account, fleet health, the €3/cell model as a ratio rather than an invoice, and MRR as the plane believes it (Stripe stays the authority, and the tile says so). Read-mostly: the only write is a reconcile nudge that requires a reason, and that reason is recorded where the customer can read it. Gated by an `OPERATOR_ACCOUNT_IDS` allowlist that is empty by default, so the surface does not exist until somebody deploys it on.

  **Usage events**, emitted server-side into Workers Analytics Engine — never into the control-plane database, whose whole design is that losing it costs a customer nothing. The vocabulary is closed: every event is declared, every property is an enum, and an account id is shape-validated, so an email address has no path into a datapoint. The privacy notice was revised in the same change as the first event, and a test now checks the page against the code in both directions.

  **Project size and build figures** — each project counts its own designs and reports the totals hourly, so the cost model finally has real numbers instead of an estimate. Counts and durations only; the counts need the project's own credential, and a project that has not reported renders an em-dash rather than a zero.

  Customers also get one thing directly: the project activity page now shows _why_ we looked, not only that we did — including the platform-wide reads that touch every project.

## 0.54.0

### Minor Changes

- 8f19eb5: **Maude Cloud control plane is live.** The tested decision layers (reconciler, billing lifecycle, webhook handling) now run as a deployed Cloudflare Worker with a real D1 database behind them — `/health`, a Stripe webhook endpoint that verifies signatures and never trusts an event's payload (it only names a project to re-derive), and an hourly reconcile sweep so a missed webhook costs at most an hour, never correctness. Deployed on the Free tier a phase ahead of schedule; the custom domain follows with the DNS zone.
- 33e61f8: **Maude Cloud accounts.** You can now create an account and sign in at the control plane: email and password today, "Continue with Google" the moment its credentials are configured — both land on the _same_ account, so nobody signs in twice. What Maude Cloud stores (and what it never does) is stated inside the signup form itself, and the consent is only recorded if you actually ticked it. Signing out ends the session on the server, not just in your browser. A signed-in owner can mint a short-lived, project-scoped pass for attaching a project — an expiring artifact of your account, never a credential to paste around.
- 5595d69: **A hosted Maude project now runs as its own isolated cell.** Each project gets its own container, its own hostname, its own operator credential, and its own slice of storage — nothing is shared between projects but the platform itself. A cell wakes on demand, sleeps when idle, and checkpoints itself to object storage.

  The durability question is settled: a cell was killed outright with its disks deleted, and a fresh one came back with the documents, the users, the git history and the work intact. The checkout and the documents are always saved together, so a restore can never produce a project whose files and canvases disagree.

  `/health` on a hosted project now reports what its workspace actually did at boot — whether it has a checkout, whether storage and a starting project are configured, and how many canvases it holds — because a hosted cell has no console to read.

- d3f957c: **Your hosted workspace now keeps its own history.** Until now, autosave-to-git ran only on a desktop — so a project you opened from a phone, from a browser, or simply with no computer attached kept no history at all: its only record was its current bytes. The workspace itself now commits, using the same append-only engine the desktop uses, so a commit made for you is indistinguishable from one you made. Your name is on the commit; the workspace is only the committer. History is never rewritten.

  Alongside it: media in your workspace is mirrored to your object storage without needing a desktop online, `MAUDE_SEED_REPO` actually clones your existing project on first boot (it had been rendered into every deployment and read by nothing), and a workspace that is shut down or moved mid-session flushes its pending commit first instead of losing the last few seconds of your work.

  `maude hub workspace-up` now proves six of its eight checks for real rather than two — including "autosave produced a commit" and "media reaches the bucket" — and a fresh workspace with nothing in it yet is reported as _not yet proven_, not as a failure.

- 936033b: **You can take your project and go.** A hosted project can produce a complete export: every commit and branch of its history as a git bundle you open with `git clone`, a manifest of every media file with its size, and a README in plain language.

  The README says what the export does _not_ contain as prominently as what it does — the media bytes are listed rather than enclosed, because an export big enough to be expensive is one nobody takes. It also tells you how to tell a bad download from a bad archive.

  This is what makes deleting a project safe: Maude has always refused to erase a project that has not been exported, and now there is something real behind that refusal.

- ed28686: **Open a design project in a browser — and a viewer finally means viewer.** Send a teammate a link and they open the real project: the actual canvases, the actual design system, rendered from your project's own source. They can move things, change text and colours, leave notes anchored to what they clicked, and download everything — signed in with their Maude account, with exactly the rights they already have. Someone invited as a viewer finds no editing at all: absent, not greyed out, in the browser and in the app alike.

  Asking Claude for a change still happens in Maude Desktop, on your own machine with your own subscription — the browser says so where the agent would sit rather than leaving a gap.

  Mirroring grows the mode people expected: as well as backing up the whole workspace to its own branch, Maude can sync your design folder into your working repository as a **pull request** you review and merge. Each option says what it will do before you save it.

  The read-only share gallery and `maude share publish` are gone — the browser door replaced them with the real project, for people who actually have access.

- 4bc964f: **File tree drag & drop + folders.** The file tree is a real file explorer now. Create folders from the header or right-click a canvas/folder for Move to… / New folder here / Delete folder — or just drag a canvas (or a whole folder) onto another folder, including back out to the top level. Every history, comment, annotation, and camera position moves with the canvas automatically, and each move shows an Undo toast.
- bf6bb46: Make the video-comp Timeline a genuinely manual, iMovie-simple editor.

  The bottom Timeline panel gains direct-manipulation editing on top of the
  existing scrub/preview surface — every gesture is a named AST op on the comp
  TSX (the single source of truth), addressed by stableId + content-hash with
  ripple and undo, and reachable headlessly through the same `/_api/clip-edit`
  door that `/design:edit` uses.

  - **Manual cut vocabulary** — split, in-point trim, speed, crop, colour grade,
    per-clip audio (mute / volume / detach), and transitions (add / edit / remove
    via the seam chips), each a parametric verb.
  - **Three-band iMovie layout** for media cuts (overlay lanes · one storyline ·
    audio), with magnetic drag-reorder and drop-to-new-layer. A purely digital
    comp (every beat a hand-authored JSX scene) keeps the stacked
    row-per-sequence projection with layer expansion.
  - **Layers you can rearrange** — drag a clip between the storyline and its own
    overlay layer, and reorder overlay layers vertically (`layer-order` verb;
    document order = paint order).
  - **AI placeholder clips** — drop a slate that occupies real timeline space with
    an inline-editable prompt, then resolve it into generated media in place (the
    clip's identity survives).
  - **In-place text** — Title overlays and AI-slate prompts are editable directly
    in the artboard (double-click), not through a modal.
  - **Frame-anchored comments** — a Timeline comment tool (press `C`, click) pins
    feedback to an exact frame + clip + lane, surfaced as first-class agent
    context via `/_comments`.

  Real per-clip visuals (filmstrips for video, the still itself for images,
  waveforms for audio) render behind the blocks, and long comps get an
  export-tier notice.

  Also: debug/`tauri dev` desktop builds no longer auto-update in the background —
  the silent updater was replacing a dev build with the released version
  mid-dogfood.

### Patch Changes

- f34c3de: **Live collaboration connects in the cloud browser door.** The per-canvas collab socket — cursors, presence names, live annotations, comment sync — could never reach a cloud cell: the studio's loopback-only gate refused every proxied upgrade, and the hub's session gate refused the cookieless canvas origin. The hub now carries a capability-authenticated WebSocket lane on the canvas origin (the same render token the canvas already rides, so a same-site connect just works), the studio accepts proxy-vouched collab upgrades in workspace mode, and the collab room enforces roles at the socket: a viewer's cursor and comments cross, but only editors and owners write annotations — and nobody writes canvas source from the canvas realm, same as always. Presence now introduces members by name instead of `anonymous-…`, and a collab socket that keeps being refused backs off and says so instead of retrying silently forever.
- bf25423: **Maude Cloud stops promising things it cannot do, and can hold more than one customer.** A production-readiness audit found the funnel honest page by page and dishonest end to end: somebody authorised payment for "a home for your design projects" and then discovered, one door at a time, that they needed a desktop computer, an install, and a **second paid subscription with Anthropic** — the word "Claude" appeared on zero customer-facing cloud pages. The landing and the wizard now state the whole bill of materials before the card, framed as the reason the work stays private, and Terms, a Privacy notice and a DPA exist and are linked above the payment button.

  Underneath, three things that were computed but never performed now happen. A tenant who stops paying gets their complete copy built and emailed **before** anything is torn down. A deleted project's bytes are actually deleted. And a cell no longer reads its project name, seed repository and first admin address out of a variable shared by the whole fleet — which meant customer number two's first boot could have cloned customer number one's repository. The instance ceiling moves off one, with the cost per instance written down next to the number.

  Also: cancelling now happens on Maude's own billing page with every date on screen before the click, invoices and billing details live there instead of two hops inside Stripe's portal, VAT is charged automatically, and there is a public pricing page — you no longer have to start a checkout to find out what it costs.

- f43e358: **The browser door is early access, and the release note now says so.** The
  first cloud release described a browser door that shows the full Maude Studio.
  What shipped is a simplified view — your project opens, roles and comments work,
  but Files, Layers, Inspector and search are the desktop's for now, and a
  project's own images and fonts are not served yet. The next release hosts the
  real studio in the cloud rather than a browser-shaped stand-in.

  Everything under it is real and verified in production: per-tenant storage
  credentials, the segregated render origin, the role model enforced at the cell,
  mirror-as-pull-request, and a cell that now reaches the internet by dialling out
  — so a broken platform link between the router and a project can no longer take
  that project offline.

- fc2ab54: **Open a cloud project in a browser and you now get the real Maude Studio.** The
  simplified view is gone. Files, Layers, Inspector, search, the toolbar and the
  branch/LIVE status are the same code the desktop runs — because it _is_ the same
  code: a cell now serves the actual studio behind an authenticating proxy rather
  than a hand-written stand-in.

  Your designs look like your designs. Photographs, club logos, sponsor marks and
  webfonts load on a rendered canvas — a canvas references its assets by absolute
  path, and until now every one of those came back unauthorized, so the page
  rendered with everything that makes it a design missing.

  **A design system's component styles load again — on the desktop too.** Any
  canvas whose design system ships a `preview/_components.css` was rendering
  without it. That was every project with a bootstrapped design system.

  **You are told which account you are signed in as, and can sign out.** A browser
  tab carries no window title and no app switcher, so a project that said VIEW ONLY
  gave no way to tell whether the role was wrong or the account was — and no way to
  change either.

  Also: the owner of a project is an owner again (a session used to store a
  one-bit projection of its role, computed once and frozen for twelve hours), and
  opening a cloud project no longer asks the server for two things it refuses by
  design.

- 09f061e: **A shared cloud project now keeps your place, and lets you look properly.**

  Open a project and you land on a canvas instead of an empty pane, with one line
  telling you what you can do there — and it goes away when you have read it.

  Your open canvas and your pan and zoom are yours alone. Two people in one
  project used to share a single record of "which canvas is open" and "where the
  camera is", so a colleague moving around moved you too — silently, which read as
  the app being flaky rather than as two people sharing one file.

  **Reading a project no longer means reading it blind.** A reviewer can open the
  Inspector and Layers panels. They were offered in the View menu and then quietly
  refused to appear, so "you can look at this project" meant looking without
  structure or measured values. Read-only means you cannot change it, not that you
  cannot see how it is built.

  Media you upload from a browser reaches storage immediately rather than at the
  project's next restart, and a project that is saving while somebody else is
  saving now waits its turn instead of racing — two people editing at once can no
  longer land a half-saved version in the history.

- d763f9f: **Inviting someone as a "viewer" now does what the word says.** The role has existed since the People page shipped, and it enforced nothing — so the workspace refused those sign-ins outright rather than hand somebody a session it could not restrain. A viewer could be invited and then could not get in at all, while the invitation email promised they could look and comment.

  They get in now, and genuinely cannot change anything: the session carries a read-only capability, the sync protocol drops their document edits rather than trusting the app to hide the buttons, and every route that changes something refuses. Signing out and downloading the work still do exactly what a viewer would expect. The editing UI itself is still on screen for them — that half is next, and until it lands a viewer will see buttons the server declines.

  Alongside it, four defects found by walking the paid signup as a stranger rather than by testing it: every outbound email had been silently failing for two days (invitations, and the new pause and deletion notices), the pricing page promised €19 while the payment screen charged €22.99 including VAT, a project created by mistake could never be deleted because deleting requires a copy and an empty project has nothing to copy, and the deletion-warning email would have sent roughly fifty times instead of once.

- 26d0f04: **The Report-a-Bug dialog now speaks the studio's design language.** The first dogfood report filed through the new button caught its own dialog off-brand — legacy hard-edge mono styling instead of the shell's dialog vocabulary. It now rides the same surface as every other studio dialog (soft radii, accent focus rings, accent-filled primary action), in both light and dark themes, with the consent checklist and screenshot redaction unchanged.

## 0.49.2

### Patch Changes

- a5d42d5: Fix the macOS desktop build, which has produced no installer since v0.48.0.

  Three separate faults in the kgai bundling path, all introduced with it:

  - The engine and `libkuzu` were code-signed **before** `tauri build`, but the
    Developer ID only enters a keychain **inside** `tauri build` — so `codesign`
    had nothing to look up and failed the leg outright. Signing now happens
    against a short-lived keychain the build stands up and tears down itself.
  - The kgai download called `api.github.com` unauthenticated, where the quota is
    60 requests/hour shared across every job on the runner's IP. It passed or
    failed by luck; it now authenticates, and no longer walks the plugin tree once
    per architecture.
  - `tauri build` re-ran the kgai sync a third time and overwrote the universal,
    signed engine with a thin, ad-hoc-signed one — which notarization would have
    rejected, and which could not have run on an Intel Mac at all.

  No change to the shipped app's behaviour; this restores the macOS `.dmg`.

## 0.49.1

### Patch Changes

- 76f86a5: Fixes the Windows desktop build, which still failed after the previous fix (`resource path 'resources\plugins\kgai' doesn't exist`). Both kgai resource directories are mapped unconditionally, so both have to exist even on a platform kgai publishes no engine for — only one of them was being created. The empty plugin directory is inert; the app simply finds no kgai plugin and the knowledge graph stays inactive, which is the documented degradation.

## 0.49.0

### Minor Changes

- 2e78f65: **Hub identity + durability.** The self-hosted hub gains a real user model — the same code the future cloud login runs on.

  - **Sign in instead of pasting a forever-token.** `POST /auth/login` mints a scoped, **expiring** peer token (30 days by default, `HUB_USER_TOKEN_TTL_HOURS`); `/auth/logout` and `/auth/session` manage it. Passwords are scrypt at OWASP parameters, and every login failure returns one opaque message with matched timing, so neither the body nor the clock says whether an account exists.
  - **Offboarding that actually offboards.** Deleting, disabling, or changing the password of a user revokes their live credentials and kicks their open sessions — it does not merely block the next login. Revocation is scoped to that user exactly: machine tokens, the admin Bearer, and lookalike addresses are untouched.
  - **The permissive dev-auth path is closed** the moment a hub has any user (or under `HUB_WORKSPACE_MODE=1`). Previously an empty token store with no `HUB_SECRET` meant _any_ token authenticated.
  - **Rate limiting works behind a reverse proxy.** New `HUB_TRUSTED_PROXIES` (CIDRs) — X-Forwarded-For is honoured only from configured proxies, rightmost-untrusted-hop first, so one attacker's login flood no longer rate-limits every other user (and a spoofed header still cannot buy budget). Set by default in the Docker Compose and Fly deploy templates. The limiter is now a SQLite sliding window, so restarting the hub no longer resets an attacker's counter.
  - **Backups with a restore drill.** Scheduled `VACUUM INTO` snapshots of the document store to S3-compatible storage (R2 / MinIO / S3) or a local directory, with retention. `maude hub backup` takes one now; `maude hub restore-drill` restores the newest generation into a throwaway directory and verifies it — SQLite integrity check, document count, and an optional sentinel document — exiting non-zero on failure. It runs in CI, because a backup nobody has restored is a hypothesis.

  Also: hub documents can now be namespaced per project and branch (`ws/<workspace-id>/<branch>/<slug>`, opt-in via `linkedHub.workspaceId` or `MAUDE_HUB_NAMESPACED=1`), so two projects that both contain `ui-screen.tsx` can no longer share one document. And untrusted canvas script can no longer write a canvas's own source through the collaboration document.

- 214f440: **Workspace mode, an asset lane that isn't git, and sign-in.**

  - **Heavy media no longer has to ride git.** Point Maude at an S3-compatible bucket (R2 / MinIO / S3) and new images, video and audio are mirrored there instead of bloating every clone — a 60 MB clip stops being 60 MB in every checkout, forever. Assets stay content-addressed, so uploads are idempotent, cached copies are never stale, and bytes fetched back are verified against the name they arrived under: a hub can refuse to serve an asset, but it cannot substitute one.
  - **`maude hub asset-check`** — every asset a canvas points at must resolve, locally or in the bucket. Reports anything dangling (a permanently broken canvas) and anything present locally but not yet mirrored. Exits non-zero, so it works as a CI step.
  - **The hub can serve assets** at an authenticated `GET /assets/<sha8>`, so a second machine resolves media it doesn't have on disk. Deliberately not presigned URLs — a presigned URL is a credential, and it has no business inside a canvas.
  - **Autosave becomes real history in a hosted workspace.** Edits are committed append-only, attributed to the person who made them (the workspace bot is only the committer), batched at quiescence so a typing session is one commit. Nothing is ever amended, rebased or force-pushed; if a mirror push is rejected because someone else saved first, it stops and says so rather than overwriting their work.
  - **"Sign in to workspace"** — an address, an email and a password, instead of pasting a token. The password reaches only the address you typed and is never stored; what's kept is an expiring session. Failures say something useful ("couldn't reach that workspace", "that address answered, but it isn't a Maude workspace") instead of one generic error.
  - **A disclosure panel** replaces the terminal banner for people who never open a terminal: who operates this workspace, what they can see (your designs, your edit history, when you're editing), what they can't (anything else on your computer — and your designs are never run on their servers), and that you can leave with everything in one click.

  Under the hood: a hosted workspace now refuses to start if it exposes any surface that would render or execute a canvas. That's enforced by the process itself plus a CI gate, not by convention — designs render on your machine, never on a server.

- d007a32: **`maude hub workspace-up` — self-host a workspace in one command, and know it works.**

  A _workspace_ is a hub that owns the project: it holds the authoritative copy, turns autosave into real version history attributed to whoever made each edit, and keeps images and video in object storage instead of git. Teammates sign in with an email and password — no token to paste, no git.

  ```sh
  maude hub workspace-up --dry-run --domain design.acme.com --admin-email alice@acme.com \
    --s3-endpoint https://<account>.r2.cloudflarestorage.com --s3-bucket acme-assets ...
  ```

  `--dry-run` shows exactly what it would write and check; every configuration problem is reported at once, so you fix them in one pass. Without it, the command renders `docker-compose.yml`, `Caddyfile` and `.env` (mode 0600), brings the stack up, and then **verifies it**: the workspace answers, the operator credential works, the first person can sign in, a canvas survives a round trip, autosave produced a commit, media reaches the bucket, no lifecycle rule will expire it, and a backup can actually be restored. A check it can't automate is reported as skipped — never as passed.

  Re-running is the upgrade path and reuses the secrets already in `.env`, so peers who already have tokens keep working.

  It does not pretend to own your deployment afterwards. Every successful run prints what stays yours — rotating the operator secret, scheduling restore drills, pinning the image tag off `latest`, upgrades, the bill, and never putting an expiry rule on the `assets/` prefix.

  Also available conversationally as **`/design:hub-workspace`**, and documented at [Workspace mode](https://maude.sh/docs/hub/workspace).

- e7e720e: **Maude Cloud — the workspace stack, end to end.**

  - **Invite a teammate with a link.** They click it and they are editing: no account form, no token to paste, no git. Looking at an invite never uses it up (a mail scanner following the link would otherwise burn it), a mistyped password never burns it either, and an invite can only ever be used once.
  - **A hosted workspace refuses to run your designs.** It stores and syncs them; it never renders, builds or executes one — enforced by the process refusing to start, by a container image with no browser in it, and by a CI gate that fails if either protection is removed.
  - **Your data is never hostage.** Suspension stops a workspace without deleting it, and an export is delivered before any teardown. That is a state machine, not a policy: the code makes "purged" reachable only through "exported", and if the retention window elapses without the export having actually arrived, it holds and re-sends.
  - **Mirror to your own GitHub repository** — one way, never forced. If the mirror has commits Maude did not create, it stops and says so rather than overwriting them.
  - **A Trust page whose claims are checked**, at [maude.sh/docs/cloud/trust](https://maude.sh/docs/cloud/trust): what the operator can see, what it cannot, subprocessors, breach and deletion timelines — each one naming the mechanism behind it, with a test that fails the build if a cited mechanism disappears or an aspirational sentence creeps in.

  Self-hosting stays free forever and stays the same software: `maude hub workspace-up` runs the identical stack on your own box.

### Patch Changes

- Fixes the desktop build, which failed on every platform in v0.48.0 (`resource path 'resources/kgai' doesn't exist`) and so shipped no `.dmg` / `.msi` / `.deb`. The kgai engine was fetched straight into `src-tauri/resources/`, but the staging script owns that directory and clears it — and it runs afterwards, so the engine was deleted before the bundler looked for it. The fetch now lands in a separate staging area that the staging script copies in, and the resource directory is created even on platforms kgai publishes no build for (which is what broke the Windows leg). Verified against a real built `Maude.app`: it carries the engine, its native library and the kgai plugin, and `maude kg` resolves the bundled engine from inside the app with nothing installed on the machine.

## 0.48.0

### Minor Changes

- Flow and design can now keep their decisions in a **knowledge graph** instead of a folder of markdown, so an agent recalls why something was decided rather than re-deriving it. It's built on [kgai](https://github.com/kgaidev/kgai) and it is **opt-out and capability-gated**: with the `kg` CLI absent — the default for every existing repo — every command runs its classic `.ai/` file path, byte for byte unchanged. Nothing to configure to keep what you have.

  Turn it on and the loop's bookends start using it. `/flow:record-ddr` writes the decision into the graph (deterministic `hash(kind:name)` identity, so the DDR-number race on a shared `main` disappears), `/flow:plan` pulls scope-biased prior art before drafting, `/flow:status` overlays your recent movements, `/flow:pause` records a resumable session event that `/flow:resume` reconstructs from, and `/flow:done` syncs once at close. Design decisions — until now recorded nowhere — join too: `/design:new` and `/design:edit` register canvas and edit nodes with their design system, and `/design:video-analyze` / `/design:reel` record footage and cut decisions.

  **`/flow:migrate-kgai`** imports an existing repo in one pass. It ingests DDRs _and_ the RCA / security-review / code-review verdicts under `.ai/logs/` _and_ STATE.md's progress history, each with its **full text** — so "what alternatives did we reject, and why" answers from the graph with no file open — and rebuilds the typed `SUPERSEDES` / `EXTENDS` / `REFERENCES` / `EVIDENCE_FOR` edges between them, including supersedes that were only ever stated in prose. `--only` refreshes a single changed decision, `--archive` moves the migrated sources aside, `--dry-run` shows you the shape first. Your markdown is never deleted.

  Across repos, one shared store gives a whole company one memory: every write is tagged with its `repo` and `dept`, search biases to your own scope, and `--all-scopes` widens it — so pulling marketing's reasoning from a dev repo is one query. Because that store is a surface anyone can write to, it comes with an explicit trust model (DDR-189): graph output is quoted as inert data and never executed, hub-origin writes are quarantined, and only a locally-authenticated CLI writes.

  Maude Desktop ships the engine itself — `kg` plus its native library as signed sidecars, and the kgai plugin injected into the chat panel — so decisions get captured in the app with nothing installed. Per-user setup and the one-time company setup are documented in `docs/kgai-onboarding.md` and `docs/kgai-company-setup.md`.

## 0.47.0

### Minor Changes

- d2521d6: The ACP chat panel now auto-approves the actions that dominated real design-workflow friction — `agent-browser` calls (via a new hardened `agent-browser-safe` wrapper), checking your own localhost dev servers (via a new `maude design curl-local` verb, loopback-only with DNS-rebinding protection), read-only filesystem inspection (`ls`/`cat`/`pwd`/`head`/`tail`/`wc`/`tree`/`file`/`stat`), and `WebSearch`/`WebFetch` — without widening the session's raw Bash surface. Also: Maude now fires a system notification whenever a chat is waiting on your approval or an answer (not just when a turn finishes), so a stalled session doesn't go unnoticed when the window isn't focused.
- 82af87a: Canvas editing gets Figma-parity smart-select: a mock now opens **live** (Browse tool — buttons click, links follow) and pressing **V** switches to Select, where a plain click picks the top-level object, ⌘-click reaches the deepest element, double-click drills one level at a time (selecting all its text once you reach a leaf, ready to overwrite), and Enter/Shift+Enter/Tab walk the layer tree. The Layers panel now shows unstamped wrapper groups at their real depth, renders component instances in purple with the component's name, supports per-row lock/unlock, and lets you rename a layer inline. A new **"Convert children to absolute position"** context-menu action (and a whole-artboard "Convert layout to absolute…") freezes a flex/grid layout — including dissolving invisible layout wrappers — so every element becomes freely draggable, with one undo reverting the whole change; switching an artboard's kind to Digital or Print offers the same freeze in the same gesture. A new **Detach** button on the Inspector's Shared-component badge clones a component definition for one instance only, so further edits (including position) stay local to that instance instead of moving every other usage.
- 8a80d96: Web artboards (`kind="web"`) get a flex-first authoring contract, a breakpoint chip that tracks the artboard's live width, and a "Duplicate at width…" action (right-click or the Inspector) that clones the artboard at Mobile/Tablet/Laptop/Desktop widths for reflow testing — a structural copy, not a linked variant. Grid containers also get a full CSS-Grid track editor: a new Inspector "Grid" section defines columns/rows with px/%/fr/em/auto/min-content/max-content units (including `fr` round-trip), an on-canvas gutter drag-resize overlay (Shift = resize both neighboring tracks), and a "Grid item" section for `grid-column`/`grid-row` cell placement. No new server-side write surface — both features ride the existing single-property edit-css lane. This is the third of the artboard-kind family (after Digital/Print/Web/Video foundation and print-ready artboards).

## 0.46.0

### Minor Changes

- 5dd5bd1: Artboards can now declare what they are — Digital, Print, Web, or Video — from the Inspector's Kind picker or the right-click context menu, and get their own chrome (a small icon + tint in the label strip). Video kind is inferred automatically for existing canvases with a `<VideoComp>`, so nothing needs to be migrated. Also adds a generic layout-guides primitive (columns/rows/grid, Figma-style) with a new `ArtboardGuidesOverlay` render layer and a per-user, per-canvas visibility lane — the guides toolbar and snap-to-guide UI land in a follow-up release. This is the foundation layer for upcoming print- and web-specific artboard tooling.
- 7f310a7: Print artboards (`kind="print"`) are now genuinely print-ready. Pick a paper size (A6–A0, US Letter/Legal/Tabloid, DL/C5 envelopes, business cards) from the Inspector and it resolves to the correct bleed-inclusive pixel size automatically. Toggleable on-canvas bleed/trim/margin guides follow the pro-tool color convention (red bleed, solid trim, magenta margins). Export a 300–600 DPI PNG, or a print-ready PDF with correct MediaBox/BleedBox/TrimBox nesting and optional vector crop/registration marks — PDF export also gained an independent "Image quality" DPI control for embedded raster content (e.g. a photo on a large-format piece authored at a fraction of its physical size). RGB only — CMYK/PDF-X conversion stays your print shop's job. No new dependencies. The Artboard Inspector panel also now shares the same token-bindable controls as the CSS panel, so Bg/Pad/Gap accept `var(--color-*)`/`var(--space-*)` bindings.
- 67e4361: Video analysis now understands a clip's dynamics instead of screenshotting at a blind frame rate. A new `maude design smart-frames` extractor (skill `footage-keyframes`) picks keyframes at real scene cuts, semantic action beats, and the true first/last frame — three auto-detected tiers that degrade gracefully: a local Gemma-4 MLX scout (opt-in, Apple Silicon) → ffmpeg scene-detection (the default) → the existing Chromium extractor (zero-dep floor), so nobody is forced to download a model. The footage-analyst and `/design:reel` now use it, and a new one-shot `/design:video-analyze` command analyzes a clip end to end — picture AND sound — folding a whisper transcript into the result. Studio Settings gains a "Video" section to choose the engine and one-click-download the optional Gemma model (gated on the mlx-vlm runtime being installed). `ffmpeg` and `mlx-vlm` are new soft dependencies; without them the extractor falls back automatically.

## 0.45.2

### Patch Changes

- e166474: Made Maude Desktop self-contained on a fresh machine. Previously, installing the app on a computer with no `node`/`bun`/`claude` left the AI chat panel stuck on "Working…" forever and every `maude design <verb>` the agent ran failed with "helper not found" / "bun is required" / missing `happy-dom`/`svgo`. Now the ACP adapter and all design helpers run on the bundled Bun runtime (via `BUN_BE_BUN`, no user-installed runtime needed), the compiled `maude` CLI resolves its bundled helpers correctly (staged `cli/` + `MAUDE_PKG_ROOT` + `.app` resource-dir probe), and every standalone helper's npm dependencies are bundled (data-driven, ~13 MB of `.d.ts`/`.map`/`.md` trimmed from the closure). Also: the Claude Code install poll no longer times out while a slow download is still progressing, and clean SVG logos from Illustrator/Serif (a plain `<!DOCTYPE svg …>`) are no longer rejected on import. A release-blocking CI gate (`check-bundle-completeness`) now runs every design verb against the built `.app` in a stripped PATH so this class of regression can't ship again (DDR-177).
- 5aeaa30: Fixed local whisper subtitle model downloads (Settings → Local subtitle models) failing with "model download redirected off huggingface.co (cas-bridge.xethub.hf.co)" — Hugging Face now serves some model blobs through its newer Xet CDN, which the download's host allowlist didn't recognize.

## 0.45.1

### Patch Changes

- Fix the dev-server sidecar (`maude-server`) crash-looping on boot with `Cannot find module '../data/patch.json'` — the css-tree/csso bun-compile patch was only registered in the root pnpm workspace, not in `apps/studio`'s own bun-managed install, so the compiled binary shipped in v0.44.0/v0.45.0 never picked it up. Affects both the desktop app and the npm CLI's `maude design serve`.

## 0.45.0

### Minor Changes

- 9b7dd32: `flow:scenario` now reads a repo-owned `.ai/scenario-guide.md` (path configurable via `paths.scenarioGuide`) for project-specific overrides — device/platform lifecycle, selector conventions, infra-error classification, platform gotchas — mirroring how `/flow:release` already reads `.ai/release-guide.md`. Projects no longer need to hand-author a `.claude/skills/scenario/` wrapper skill for this; `maude init` now scaffolds the guide template. The base protocol also gained four upstreamed defaults: testID-first locator preference, an advisory-only vision selector tier, an `infra-error` result state distinct from `fail` (never a blocker, now tracked via a new `infra_errors` field in `scenario-runner`'s output), and a collaborative step-by-step scenario-authoring loop.

## 0.44.0

### Minor Changes

- AI media generation, bring-your-own-key — images, video, audio, and subtitles, right inside Maude.

  - Generate images (Google Nano Banana) that drop straight onto the active artboard, or edit an existing image with a prompt (maskless edit) — no round-trip through separate photo software.
  - Generate video clips (Veo 3.1) that flow into `/design:reel` like any other footage — analyzed and placed into the edit automatically.
  - Generate music, sound effects, and voiceover (ElevenLabs) that land as audio tracks in the reel, with voiceover automatically ducking music underneath it.
  - Free, local, no-key subtitles via a managed whisper.cpp model — download it from Settings and transcribe any clip in one click, or choose ElevenLabs Scribe / Groq Whisper explicitly instead. Non-WAV clips are auto-converted when ffmpeg is available.
  - Reuse-first for audio: before generating (and paying) again, Maude searches your own previously-generated tracks for a match.
  - Proactive generation: while you're editing a reel or canvas, Maude can notice a missing beat or hero image and offer to fill it — always one explicit confirmation, nothing generated (or spent) without your yes.
  - Reachable everywhere — the new Settings panel, the `maude design generate` CLI, `/design:generate`, a `WANTS_GENERATE` phrasing inside `/design:edit` / `/design:new`, and the native Assistant chat panel.
  - Your API keys are stored locally (OS keychain, or a locked-down local file) and are only ever used server-side — the untrusted canvas surface never sees them.

- Artboards now hug their content by default, plus new background/padding/layout/gap settings.

  - Fixed: adding an element past an artboard's visible bottom edge used to append it invisibly, silently clipped by `overflow: hidden` with no visual cue that it was even there.
  - Artboards now hug their content height by default — the authored height becomes a minimum, not a hard limit — so this can no longer happen. A Hug/Fixed toggle in the artboard's CSS panel lets you pin an exact height when you actually want one.
  - New artboard-level settings — background, padding, layout, and gap — editable from the same panel.

- d0a9906: Bulk media insert + fixed data loss on multi-file drag-drop.

  - The media picker now supports multi-select — pick several photos (or a mix of photos, videos, and audio) in one go instead of one at a time, with a destination toggle (add to the artboard, or add as free-floating annotations on the canvas). The picker defaults sensibly: video and audio always go on the canvas, since only images can drop into an artboard.
  - The tool-palette "Insert Image" tool no longer does nothing on a canvas with no artboard yet — it now opens the picker in annotation-only mode.
  - Fixed a data-loss bug where dragging several files from Finder onto the canvas at once would sometimes silently drop some of them (1 shown, sometimes 2, sometimes N) — every file in a batch now lands reliably.
  - Fixed a follow-up bug where deleting an annotation (Backspace) appeared to do nothing until the canvas was reloaded — the delete was reaching the server correctly but getting silently reverted in the live view.
  - Fixed a related edge case where deleting an image annotation while its upload was still in progress could cause it to reappear once the upload finished.

- 61c2850: Inspector controls redesign — one shared control library for the CSS and Photo panels.

  - The CSS and Photo panels now share one control library (`NumberField`, `Slider`/`SliderField`, `Segmented`, `Swatch`, and more) instead of six-plus separately hand-rolled field factories, fixing a set of long-standing inspector papercuts: dragging to scrub now grabs the field's icon/label handle instead of fighting a click-to-edit; clicking a number field selects the whole value (click again to place the caret); arrow keys step values (Shift for ×10); bounded photo adjustments (brightness, contrast, saturation, grain, pattern, mask) are now real linked slider + numeric pairs instead of plain numeric fields; the CSS border row and the Photo duotone/pattern rows no longer overflow the panel at its default width; and the design-tokens/variables popover now stays anchored to its trigger at any scroll position or canvas zoom.
  - Every primitive is documented in a new design-system specimen (`components-inspector-controls`) alongside the shipped panels, so the two stay in lockstep.
  - Accessibility hardening: the rotation dial is now keyboard-operable (arrow keys, Home/End) and exposes a proper slider role; number fields expose spinbutton semantics; fixed a couple of invalid ARIA attributes and low-contrast labels in the new specimen.

- 637610f: Inspector "Designer mode" — a Figma-vocabulary view of the CSS panel, for designers who don't think in raw CSS.

  - The CSS inspector panel now has two modes, switchable from a small toggle in the panel's own corner (and remembered in Settings → Appearance → "Inspector vocabulary"): **Advanced** keeps the honest CSS property names (`border-radius`, `flex-direction`, `box-shadow`…), and **Designer** regroups the exact same controls into Figma-familiar clusters — Fill, Stroke, Corner radius, Auto layout, Effects, Opacity, Text — and relabels the rows (Direction / Alignment / Gap / Sizing…). Same controls, same live-edit behavior underneath; only the labels and grouping change, and a value set in one mode reads back correctly in the other.
  - Designer mode is tuned for a cleaner, calmer read: it drops the per-row status dots for inherited values (keeping them only where a value is actually customized), and uses quiet title-case section headers instead of the developer-facing monospace labels.
  - Two new style controls are available in both modes: **Blur** (`filter: blur()`) and **Blend** (`mix-blend-mode`).
  - The auto-layout alignment is now a single 9-point pad (one click sets both axes), the first use of the shared inspector `AlignPad`.

- 9c464b0: Onboarding and design-system migration: get to your first AI edit and your first real design system faster, whether you're starting fresh or bringing in an existing brand.

  - **Zero-terminal AI editing setup.** The native app's Assistant panel can now install `claude` for you, sign you into your own Claude subscription via a browser, and reconnect automatically — no terminal, no restart. The `maude` CLI and the design/flow plugins are bundled with the app, so `/design:*` commands work out of the box.
  - **Guided quick setup.** A new "Quick setup" tour and checklist walk a new project from empty → design system → first AI edit, with a persistent "Bring my existing brand" entry point.
  - **Bring your existing brand in.** Upload a logo (SVG) from the Quick setup checklist and Maude pulls out its color palette and recognizable font names to seed a new design system — nothing is applied automatically, every choice is confirmed during setup.
  - **Import design tokens.** `maude design import-tokens` reads a `tokens.json` (W3C design-tokens / Style-Dictionary) or a raw CSS custom-properties file and patches or scaffolds a design system's tokens from it.
  - **Reconstruct a canvas from an image (experimental).** `/design:import --reconstruct <image>` turns a Figma-frame export into a real, editable, token-styled canvas via an AI vision pass plus a reality-check loop against the source. Labeled experimental — review it like a first draft, not a finished import.
  - Every new project is seeded with two "how to use Maude" reference canvases covering the app's own capabilities, so there's something real to look at from the very first launch.

- One Settings modal for everything, plus configurable panel docking.

  - Settings is now one modal with vertical tabs — Appearance, Canvas & View, AI generation, Subtitles — instead of a single unbounded AI-generation-only dialog that could overflow the screen. Each tab scrolls independently, so no category can push the dialog off-screen again.
  - View options that used to live only in the View menu — minimap, zoom controls, annotations default, auto-open Inspector on select — now also live in the new Canvas & View tab, reading and writing the exact same state as the menu (no divergence, no need to remember which surface has which toggle).
  - Panels can now be docked to either the left or right side independently, configurable from a new Layout tab (Layers is now its own dockable panel); the arrangement persists to disk and survives a restart.
  - `⌘,` and File → "Settings…" now open the modal to a chosen tab, and remember the last tab you had open.
  - Fixed a bug where the minimap and zoom controls could still render even while toggled off.

### Patch Changes

- beb779e: Maude Desktop's Assistant chat panel now always runs the exact `maude` CLI and `design`/`flow` plugin versions that shipped with your installed app — never a separately installed copy.

  Previously, if you had an older `maude` on your PATH (e.g. from `npm i -g @1agh/maude`) or `design@maude` already installed via the Claude Code plugin marketplace, the chat panel would silently defer to that older copy instead of the one bundled with the app you just updated. It now always uses the bundled, release-matched copy inside the chat panel specifically — your own terminal `claude` sessions are unaffected and still use whatever you have installed yourself.

- ae906c1: The macOS `.dmg` installer now shows a custom background with an arrow pointing from the Maude icon to the Applications folder, so first-time users know to drag the app there to install it (previously a bare Finder window with no visual cue).

## 0.43.0

### Minor Changes

- 009b114: Publish, Get-latest, and "Add to Shared version" now work on SSH remotes and open a pull request on protected branches, plus a proactive "Get latest" nudge in the dock.

  - **SSH remotes work.** Publishing, getting the latest, and adding a draft to the Shared version over an `ssh://` / `git@github.com:…` remote no longer fail with `unrecognized transport protocol: "ssh"`. The write paths now route SSH remotes through the system `git` binary (using your own key), matching how Refresh already worked — a plain file/local remote is handled too, and a non-github or command-executing remote is refused.
  - **"Add to Shared version" opens a pull request.** On a GitHub project, adding a draft to the Shared version pushes your draft branch and opens a pull request into `main` — the merge happens on GitHub after review, so it works even when `main` is protected and a direct push would be rejected. The pull-request link is shown right in the dialog (opens in your browser, or copies to the clipboard as a fallback). A local-only project still merges directly. If Publish hits a protected branch, the message now points you at the pull-request flow instead of showing a raw git error.
  - **Proactive "Get latest" nudge.** When a teammate publishes and the shared version moves ahead, a blue "Get latest — N new on main" button now appears in the bottom dock (not just buried in the Changes panel), so you're told to pull without hunting for it. Clicking it gets the latest; a content conflict opens the visual resolver.

- 247fff3: Unified text editing across every canvas surface, with inline editing of variable-driven text.

  - Every editable text surface — an artboard element's copy, a shape's text, a sticky, a standalone text-tool label, and a section title — now behaves like one predictable WYSIWYG editor: click to place a caret, type or select normally, Enter to confirm, Shift+Enter for a newline, with a visible blinking caret everywhere and no ghosting or overlap.
  - The four annotation editors were moved off SVG `<foreignObject>` to plain HTML in the world div (the `MediaRefPlayers` pattern), so clicks hit-test correctly at any zoom — caret-at-click, text-tool click-through onto existing text, and no duplicate/ghost editor, by construction. Entering an annotation editor now places the caret at the clicked character instead of selecting everything.
  - A shared, engine-independent custom blinking caret (`caret-color: transparent` + a CSS-animated caret element positioned at the live selection) replaces the native caret, which froze under WebKit's transformed canvas — so the caret blinks identically on all five surfaces.
  - Text that comes from a `{variable}` — a `.map()` over a data array, a component prop fed `BEATS[0]`, or a local `const` — is now editable inline: double-click and change the words, and the edit is traced back to the right source string (picked by which rendered instance you edited and verified against the pre-edit text, so it never rewrites the wrong item). Genuinely computed text (`{price.toFixed(2)}`, template strings) still routes to chat / `/design:edit` with a clear reason instead of a dead-end editor. Undo/redo works for these edits and now survives the canvas reload.
  - A build-time `data-cd-editable` marker gates inline-edit entry so you're only offered an editor where the change will actually save.

- 501f1c0: Whiteboard/annotation improvements: bulk resize, sticky authorship, smarter `/design:board`, and a sticker picker.

  - Selecting multiple annotation elements together now shows live, draggable corner handles that resize the whole group proportionally about a shared origin, instead of only resizing one element at a time.
  - Sticky notes now show who drew them — a name/nickname badge (not an avatar), colored to match that author's live presence cursor.
  - `/design:board` now understands generation requests (e.g. "vytvoř mi team sprint retro" / "make me a team sprint retro"), and Maude Desktop's ACP chat can discover the whiteboard skill on its own instead of requiring the skill to be invoked explicitly.
  - Fixed shape/text-annotation editing: the caret no longer jumps from the top of the box to center on the first keystroke, a blinking caret is now visible everywhere text is edited, double-clicking places the caret at the click point instead of selecting all text, hovering editable text now shows a text cursor, and the Text tool now edits existing text in place instead of stacking a new annotation on top.
  - Newly created shapes and sticky notes auto-focus into text-edit mode immediately, so you can start typing without an extra click.
  - Keyboard shortcuts (e.g. `R` for the rectangle tool) no longer fire while actively typing inside a text/shape/sticky editor.
  - Added a searchable, FigJam-style sticker picker with four bundled "fun/crazy" sticker packs (with attribution) — not emoji.
  - `read-annotations`/`canvas-rects` now tag which section each element belongs to and in what reading order, so board-driven generation (e.g. "make a video from this section") understands section contents as a group.

### Patch Changes

- 9465575: Catch canvases that use a design-system component without importing its stylesheet.

  - When a canvas uses a component from a design system's `preview/` folder (a mascot, a brand logo, any shared specimen component), that component's animation and layout live in the DS's shared `_layout.css` — which the canvas has to import itself. Forgetting it used to render the component silently static and mispositioned (no animation, floating accessory layers), with no error at all.
  - `/design:new` and `/design:edit` now write that required import up front when a canvas pulls in a `preview/` component, and the `design-system-keeper` audit warns if it's ever missing — so the "looks broken but the build is green" case gets caught instead of shipping.

- 9ba8b1f: Video export (MP4/WebM) of complex video-comps no longer fails or hangs. A deeply-nested composition could overflow the one-pass audio renderer (`renderMediaOnWeb`); the export now falls back to frame-by-frame capture and produces a valid (video-only) file instead of erroring. Long renders also get a frame-count-sized time budget, so a 900-frame comp that legitimately takes ~9 minutes isn't aborted mid-render by the old fixed 5-minute cap (overridable via `MAUDE_EXPORT_VIDEO_TIMEOUT_MS`).
- c561f80: Fix several whiteboard section-title bugs and raise the image upload cap.

  - A section's title chip now stays a constant on-screen size at any zoom level, instead of shrinking to unreadable when zoomed out.
  - Double-clicking a section (or sticky/shape) to rename it no longer also triggers the canvas's "fit to view" zoom.
  - The rename editor now confirms on plain Enter (matching a native text input) instead of inserting a newline — Cmd/Ctrl+Enter is still reserved for multi-line standalone text notes.
  - The rename editor's box now matches the read-only chip's background/padding/size, instead of rendering as a bare, tiny sliver of text mid-rename.
  - Dragging multiple image/video/audio files from Finder onto a canvas now adds all of them in one drop, instead of only the first file (previously required dropping one at a time).
  - The per-image upload cap is raised from 10 MB to 50 MB (env-overridable via `MAUDE_ASSET_MAX_IMAGE_BYTES`), matching the existing video/audio cap pattern.

## 0.42.0

### Minor Changes

- 4ff5fd8: Exports now run in the background with live progress, instead of blocking the dialog until the render finishes.

  - `POST /_api/export` still works exactly as before (byte-for-byte, no CLI changes needed) — it now just wraps a background job internally.
  - A new menubar "Exports" button shows a running/queued count, a toast on start and completion (progress bar for multi-artboard `canvas-as-separate` exports, indeterminate spinner otherwise), and a panel listing every export with Download/Save actions. Both dialogs (menubar + in-canvas) close immediately on submit.
  - Multiple exports can run concurrently (default cap 2) — a quick PNG no longer has to wait behind a slow PDF/video render.

  Also fixes a real correctness bug: `canvas-as-separate` (multi-artboard) exports in PNG/PDF/SVG/HTML/PPTX could scramble content — each per-artboard capture pinned the artboard's position for cropping but never restored it, so earlier artboards stayed stacked at the origin and bled into later captures. All 5 render shims now save and restore each artboard's position around its own capture.

### Patch Changes

- 308c156: Fix `/design:new` so canvases are reliably generated with both light and dark theme support on dual-theme design systems.

  The prior dual-theme enforcement mechanism checked `config.json`'s `themeDefault` field for the literal value `"both"` — a value that field's schema (`dark | light` only) can never actually hold, so the check silently never fired. This let canvases ship with a token frozen at its default-theme value and invisible or low-contrast in the un-audited theme.

  - `designSystems[].themes` is now the one authoritative signal for "this DS ships more than one theme" (schema + docs updated); bootstrap persists it going forward instead of leaving it to free-text description.
  - `design-system-completeness-critic`'s V18 check now reads the correct field; a new V18c check catches a token declared in one theme block but silently missing from the other.
  - `/design:new`'s post-write reality check now captures a second screenshot pass in the alternate theme whenever the target design system declares more than one, so both themes are visually confirmed before the canvas is considered done.

## 0.41.0

### Minor Changes

- 0c601a0: Add Intel Mac support to the desktop app.

  The macOS `.dmg` now ships as a universal (Intel + Apple Silicon) binary instead of Apple-Silicon-only — Intel Mac users can now download and run the Maude desktop app natively, with no Rosetta workaround required. Windows and Linux installers are unaffected.

- ddbf1c5: Bring Studio's element editing up to Figma/Webflow-grade direct manipulation.

  - **On-canvas drag-resize** for elements (8 handles + rotate zones, Shift-lock aspect, Alt from-center) and artboards (free-hand resize), plus a live W×H/X,Y readout while dragging.
  - **Structural editing**: delete an element (Del key / context menu), insert a new div/text/image, and insert a whole new empty artboard from a Desktop/Laptop/Tablet/Mobile preset — all Cmd+Z reversible via whole-file snapshot undo.
  - **Richer Inspector knobs**: Position (with a constraints-style inset box), Transform, extra Typography rows, and a Media section (`object-fit`/`aspect-ratio`/`object-position`) — promotes DDR-104's deferred OUT-list into curated, live-preview controls.
  - **Auto-open the Inspector on select** (only when no right panel is already open), **on-canvas padding/gap drag**, and a **shared-component scope badge** ("Local" vs "Shared · edits N places") so editing a reused component's inner element is never a surprise, with instance move/resize routed to stay local.
  - **Editing works on design-system specimens**, not just UI canvases, and **image/video/background swap** via a built-in asset picker (authored `<img>`/`<video>` and annotation media alike).
  - **Editor ergonomics**: keyboard nudge + tree traversal, Cmd+D duplicate, copy/paste style, multi-select align/distribute/tidy-up, deep-select + right-click "Select layer" for nested/overlapping elements, Alt-hover distance measurement, and a free-hand rotate handle.
  - **Flex/auto-layout editor**: per-element Fixed/Hug/Fill sizing plus a grouped direction/wrap/distribution/gap/padding editor (CSS-Grid tracks are a separate follow-up plan).
  - Fixed two camera bugs: moving an absolute element no longer resets the pan, and selecting an overflowing element no longer shifts the layout or reveals a phantom strip.

- fed71d4: Add a full two-way AI toolkit for the whiteboard/annotation layer.

  The design plugin's FigJam-style draw layer (stickies, shapes, connectors) is now a complete two-way AI surface, not just a read-only channel:

  - New `maude design canvas-rects` geometry manifest resolves artboard AND element-level context in world coordinates, so an agent understands which UI element a sketched note is drawn over, and can place new notes/shapes without ever hand-computing a coordinate.
  - `read-annotations --rects` adds that element context to reads.
  - `annotate` gains `--in`/`--pin` (pin a note beside a specific button or element, with an automatic pointer arrow), a `--board` template engine (retro, kanban, social-media calendar, roadmap, brainstorm, checklist, user-flow — all auto-laid-out), and id-preserving `move`/`set-text`/`set-color` ops.
  - A new `/design:board` command and `whiteboard` skill package the whole read-understand-author-verify loop end to end.

### Patch Changes

- 04fad92: Add a `--quick` flag to `/flow:done` for fast, interim closes. It swaps the full `/flow:validate` gate (build + 5-platform cross-platform scenario + a11y audit + design-system-guard) for affected-scope static gates (format/lint/typecheck) plus affected-tests-only, cutting a routine close-out from ~20 min to ~5. DDR sweep, code review (including the security-auditor + ethical-hacker pass), tracker sync, and retro/archive are unchanged — `--quick` only trims Step 1, not tracking or due diligence. Use it for routine/interim closes where a full `/flow:validate` still runs before the branch merges to main.

## 0.40.0

### Minor Changes

- f09d69f: Hand-edit your video comps on the timeline. After the Assistant generates a video you can now drag a clip to move it, drag its right edge to trim (snapping to second-ticks and neighbour edges; hold Alt to drag freely), drop a video / image / audio file to add a clip, raise or lower a clip's stacking, swap a clip's footage, or remove it. Right-click any clip for the same menu — replace, move, hide, or remove — where hide keeps a clip in place while it stops rendering. Clips that layer a background under a title expand into per-layer rows so you can see and replace the video separately from its caption, and transition-based showreels reorder and accept dropped clips too. Keyboard shortcuts help (Space plays/pauses, arrows step frames, Home/End jump to the ends, `.`/`,` hop keyframes), you can drop reference clips anywhere on the canvas and File → Assemble them into a real comp in one click, edits are multi-comp-safe, and inline text / CSS tweaks made on the canvas now persist.
- f09d69f: Design videos and animations right in the canvas. Maude now ships in-house Remotion video compositions — a `<Player>` with a scrubbable, keyframe-aware Timeline (transport, volume, loop) and capture-first MP4 / GIF export (optionally muxing the comp's audio). Generate a motion piece with the Assistant, then watch, scrub, and export it without leaving the canvas.

### Patch Changes

- ac02029: Fix design-system scaffold files never appearing in the file tree — even after a manual reload. The dev-server read `.design/config.json` only once at boot, so when `/design:setup-ds` added the `system` canvas group mid-session, `/_index-data` kept serving the stale boot snapshot. The server now hot-reloads the config when it changes on disk, refreshes the tree over the live `canvas-list-update` push, and tells open shells to refetch `/_config`.

## 0.39.1

### Patch Changes

- cb827e8: Fix the ACP chat panel losing conversational memory across an app restart. Killing and reopening Maude (or a dev-server restart) now resumes the actual `claude` session instead of silently starting a fresh one while showing the old transcript — closing the DDR-125 "cross-restart resume" gap.

## 0.39.0

### Minor Changes

- be5153d: ACP chat image thumbnails + lightbox: images in the native Assistant panel now
  render as inline thumbnails you can click to enlarge — both screenshots you paste
  into the composer and images the assistant references by path (e.g. a
  `/design:screenshot` reply). Companion to DDR-145.

## 0.38.0

### Minor Changes

- dc92aba: The AI chat composer got three fixes and a new attachment affordance. Copy and paste now work in the native app (Cmd+C / Cmd+V / Cmd+X / Cmd+A — a proper Edit menu was missing), and Enter sends your message (Shift+Enter for a newline). Paste a file path, a URL, or an image straight from your clipboard and it collapses into a compact chip — `[file-1]`, `[link-1]`, `[image-1]` — with a reveal line under the composer showing exactly what each chip will send, so nothing hidden ever rides into Claude. A pasted screenshot is saved alongside the chat and Claude reads it on send, just like Claude Code.
- 641499f: ACP chat context hardening: per-canvas selection memory, frozen-at-send chat context, and a session bootstrap brief. Switching canvases while an agent runs no longer loses what you had selected — each canvas remembers its own selection, and every chat message carries the canvas + selection frozen at send time as a visible, removable attachment chip. New agent sessions get a studio-environment brief so Claude knows where it's running without any project CLAUDE.md setup.
- 6995fda: Slash-command autocomplete + inline highlight in the native Assistant chat composer. Typing `/` opens a filter-as-you-type menu of the design and flow commands your `claude` actually has installed (keyboard- and mouse-selectable), and a recognized command lights up as a pill right inside the input — so you don't have to remember which commands exist. The command list comes live from your own Claude session (with a built-in bootstrap list for instant suggestions).
- 30549fe: Drag to reorder elements on a canvas. Grab an element and drop it on the top/left half of another to go above, the bottom/right half to go below, or the middle of a box to nest inside it — the layout reflows live while you hold, Figma-style, with the neighbours gliding into place, and Esc puts it back. Do the same from the Layers panel, which now mirrors the canvas both ways as you drag. Instances of the same reusable component (a board's columns, repeated cards) reorder too. Every move rewrites your `.tsx` source and undoes with ⌘Z / redoes with ⌘⇧Z. Keyboard: with the Layers panel focused, ↑/↓ walk the selection, Alt+↑/↓ move within the parent, and Alt+Shift+↑/↓ move across.
- bbe1448: Zero-install design in the Maude Desktop chat. With only Claude Code installed, the desktop app's chat panel now auto-loads the `design` plugin for its session — `/design:*` commands just work, with no marketplace to add and no `/plugin install` (power users who already installed it see a no-op, no double-load). And the design critics can now actually SEE your artboards: the app bundles a screenshot engine (agent-browser) and provisions a headless Chromium (chrome-headless-shell) on first use, so `/design:critic` / `/design:screenshot` capture renders zero-install. The web `maude design serve` path is unchanged and keeps the manual marketplace flow.

## 0.37.0

### Minor Changes

- f9f475e: You can now start a project two new ways in the desktop app. **`File ▸ New Project…`** (`Cmd+N`) is in the native menu bar — the create flow was previously reachable only from onboarding and the account menu. And the New Project dialog gained a **"This computer only"** option: a plain local git repo (`git init` + `.design/` scaffold, no GitHub, no remote) that you can publish later — so you can design without a GitHub account. Signed out? The menu still opens the dialog; the GitHub option waits for sign-in, local is always available. Backed by a new local-only `POST /_api/project/create-local` endpoint that stays main-origin-only (dual-allowlist, asserted in the canvas-origin gate test). (DDR-137.)

### Patch Changes

- b2de321: `/design:setup-ds`'s Stage-4 design-language moodboard is now saved as a **persistent, commentable UI canvas** at `.design/ui/<ds>-moodboard.tsx` instead of a throwaway file that was discarded after the direction gate. It shows up in `/design:browse` and the canvas list, survives the bootstrap so you can revisit it, and takes comments like any other canvas. In variant mode the 2–3 explored directions are composed as `<DCArtboard>`s **side by side in that one canvas**, so you can compare and comment per-direction. The moodboard is still never written under `system/<ds>/`. (DDR-136, amends DDR-080.)

## 0.36.2

### Patch Changes

- bf80ce3: Desktop onboarding: a batch of first-run fixes so a new user reaches the studio without dead-ends. The GitHub door now reflects that you're already signed in (shows **Continue**, not "Sign in with GitHub"), and the identity rail stays signed-in across a transient profile-fetch hiccup and updates live the moment sign-in completes — instead of wrongly showing "Sign in" with a valid token. **Cancel** on the GitHub device-code modal now re-enables the button immediately (previously it left the button stuck on "Starting…" until the code expired). **Merge this branch → main** shows a progress spinner while it runs (previously the multi-second checkout+merge+push showed nothing). A failed **Restore saved version** now surfaces an error instead of closing silently. And a freshly-created project is seeded with a neutral starter **Welcome** canvas so the studio opens to a real artboard instead of an empty list.

## 0.36.1

### Patch Changes

- cae6497: Inspector CSS edits, inline text rewrites, and custom HTML-attribute edits are now undoable with Cmd+Z (and redoable). Previously these direct in-canvas edits wrote the canvas source but were recorded by neither the undo stack nor the history snapshots, so they couldn't be reverted in-app — and a forwarded Cmd+Z would instead pop an unrelated layout/annotation step. Undo now works from the canvas, the Edit menu, and the inspector fields (Figma-parity).

## 0.36.0

### Minor Changes

- Make the native version-switcher fast, trustworthy, and git-native on real developer repos (DDR-133) — the follow-up the two 2026-06-29 plans (DDR-131 remote drafts, DDR-132 caches) deferred.

  - **Detect-and-prefer system `git`** for the network paths (fetch / ahead-behind), finally landing DDR-107's deferred end-state. A memoized `git --version` probe selects the engine; native `git fetch` / `for-each-ref` are instant on a developer machine. Isomorphic-git stays the fallback for the zero-setup persona, and the DDR-131 transport gate still decides whether a spawn is allowed. Escape hatch: `MAUDE_NO_SYSTEM_GIT=1`.
  - **Bounded network ops, off the first-paint path.** `gitFetchRemote` (~12 s) and `remoteAheadBehind` (~8 s) now have server-side timeouts and never block initial paint — fixing the ~30 s stall on app reopen and the "Refresh timed out" on bigger repos.
  - **UI decoupled from the network.** The popup always re-reads the disk-only local branch list on open, so the dropdown no longer "disappears" after a failed refresh; fetch failures are a dismissable in-popup notice, never the persistent dock-level error.
  - **Repo discovery** now includes org/team repos (`organization_member`) and paginates, so "Pull a local copy" shows every repo you can reach — not just one.
  - **Vocabulary pivot to git-native terms** — `main` / branches / "Merge this branch → main" — replacing the plain-language "Shared version / draft" layer on this surface (supersedes DDR-110/119 here).

- Surface **remote drafts** (branches that exist on the remote but not locally) in the native draft switcher (DDR-131). Previously the switcher listed only local branches, so a teammate's draft — or one you pushed from another machine — never appeared, and the new search box misleadingly returned "Nothing matches" for a branch you knew existed.

  Now every draft shows up as one row tagged by where it lives (`local` / `remote` / `both`); switching to a remote-only draft auto-creates a local tracking branch (`git checkout --track`), so you never have to drop to a terminal. An explicit **Refresh** affordance fetches brand-new remote drafts on demand (ssh-safe, behind a user gesture — never an auto-fetch on popup open) with an "as of <relative time>" staleness hint. The switcher also gained search + a recents sort, and the file tree now refreshes manually via a spin button / ⌘⇧R.

### Patch Changes

- Make opening, restarting, and switching repos in the native studio feel instant (DDR-132). A repo switch respawns the dev-server sidecar as a fresh process, so every open used to do a fresh GitHub round-trip ("Checking GitHub…") plus a network `git fetch` for the ahead/behind nudge.

  Two caches fix this without weakening the token invariant:

  - **GitHub identity — per-user SWR disk cache.** `{ login, name, avatar_url }` is cached to `~/.maude/github-identity.json` keyed by a hash of the token (sha256, first 16 hex — the token itself is **never** written). Identity now paints immediately from disk while a background revalidation refreshes the file; a token/account change is a different key ⇒ one fresh fetch.
  - **Remote ahead/behind probe — in-memory TTL cache + in-flight dedupe.** Memoized per `repoRoot + branch` (~45 s TTL) with concurrent callers coalesced onto one promise, killing the re-fetch storm from panel toggles and effect re-runs within a repo session.

  The loopback token bridge is deliberately left uncached (the keychain stays the single source of truth).

## 0.35.0

### Minor Changes

- 7bd1a20: Make the bookend debate layer **opt-out** (on by default) and document it on the docs site. An absent `orchestration` block in `.ai/workflows.config.json` is now treated as `mode:auto`, and `designTeam.enabled` defaults to `true` — so the debate engages everywhere out of the box: a cheap read-only `reduce` panel on any install, and the live native-agent-team `relay` debate the moment `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is enabled. You add the `orchestration` block only to dial it **down** (`mode:reduce`) or **off** (`mode:off`); nothing to configure to turn it on.

  No premium cost is imposed on installs that never enabled the experimental agent-teams flag — without it, `auto` degrades to the reduce panel. New docs page: **Multi-agent debate** (`/docs/orchestration`) covering the bookend model, the two tiers, the opt-out config, the cast, and the injection/trifecta security posture.

## 0.34.0

### Minor Changes

- ab3a90f: Wire the bookend debate layer (DDR-130) into **all** loop bookends, not just the security pilot. The opt-in multi-agent debate now fires across:

  - **START / divergent** — `/flow:plan` (BUILDER/SHIPPER/BREAKER draft competing approaches before the plan is written), `/flow:setup-prd` (USER-ADVOCATE/SHIPPER contest product direction + MVP scope), `/design:setup-ds` (aesthetic direction).
  - **END / adversarial** — `/flow:validate-security` (attacker↔defender), plus the `/design:critic` + `/design:new` panel merge now reconciles conflicting cross-discipline blockers into one ordered list (reduce-pass, every user) and escalates to a live design-team that revises stances when `orchestration.designTeam` is enabled.
  - **RESEARCH** — `/flow:bug-rca` competes candidate root causes as falsifiable hypotheses, and `ux-research-agent` recommendations can be cross-checked.
  - **Tripwire** — `/flow:quick` escalates a load-bearing check on changes that only look trivial.

  Every wiring is a guarded branch: with `orchestration.mode:off` or the experimental agent-teams flag absent, behavior is byte-for-byte unchanged (plus the always-available reduce-pass). The reduce-vs-relay invariant holds — relay is native agent-teams only, never hand-rolled in markdown.

### Patch Changes

- c724d5d: Security hardening of the bookend debate layer (DDR-130), found by running its own `/flow:validate-security` relay debate against itself. Closed two HIGH findings: (F1) the `flow:investigator` seat no longer carries network-egress tools (`WebSearch`/`WebFetch` stripped; `Bash` constrained to read-only local diagnostics with no secret read) so it can't colocate the untrusted-ingest + private-read + egress trifecta; web fact-checking routes to `design:ux-research-agent`, which never ingests a code diff. (F2) the debate-protocol lead now treats every seat's output as inert attributed data — it quotes a seat's `recommendation`/`top_risk` into plans/canvases but never executes or constructs a tool call from it, closing the output-handling confused-deputy.

## 0.33.0

### Minor Changes

- 2296b5c: Add an opt-in, capability-gated multi-agent **bookend debate layer** to the flow + design plugins (DDR-130). Debate fires at the loop's bookends — divergent at the start (`/flow:plan`, `/flow:setup-prd`, `/design:setup-ds`), adversarial at the end (`/flow:validate-security`, `/design:critic`), plus a research shape (`/flow:bug-rca`, `ux-research`); the middle (`execute`) stays solo.

  Two tiers, auto-selected and degrading cleanly: a **reduce-pass floor** ships to every user with the experimental flag off — `/design:critic` now reconciles conflicting cross-discipline blockers into one ordered list instead of summing independent verdicts — and a native **agent-teams relay tier** (when `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` is enabled) adds live stance revision. New `orchestration.*` config block (`mode` defaults to `auto`, degrades to today's behavior when teams are off — nothing to configure downstream). Five new project-agnostic debate seats (`builder`, `shipper`, `breaker`, `user-advocate`, `investigator`) and a shared `flow:debate-protocol` skill. This release ships the pilot (floor + `/flow:validate-security` proving ground); the broad `mode:auto` rollout is gated on an n=8 security eval.

## 0.32.1

### Patch Changes

- 173f7a4: Desktop: fix the AI chat panel showing "The Claude agent bridge is not installed in this build" in the packaged app (v0.31.0–v0.32.0). The desktop bundle now stages the ACP adapter's JS dependency closure (`@agentclientprotocol/claude-agent-acp` + its JS deps, ~11 MB) into its runtime, and the bridge pins the adapter to your own installed `claude` CLI via `CLAUDE_CODE_EXECUTABLE` — so chat runs on your Pro/Max subscription without shipping the ~210 MB native Claude binary. Adds a build-time gate that fails the desktop build if the adapter isn't staged, and an honest "Claude agent bridge" row in the readiness checklist. AI chat now works in the released `.app`, not only under `pnpm dev:desktop`.

## 0.32.0

### Minor Changes

- c935331: Desktop app: a first-open AI-editing readiness check. The welcome screen, the Assistant panel, and a new **Help → Check AI editing readiness…** menu item now show exactly what AI editing needs — the `claude` CLI, the `maude` CLI, and the Maude plugins in your Claude Code — with a copy-paste fix for anything missing. Nothing blocks the rest of the app, which works with no setup. Also fixes AI editing silently failing in the packaged app: the dev server now inherits your shell PATH when Maude is launched from Finder/Dock.

## 0.31.0

### Minor Changes

- 188efc5: In-UI git layer (Phase 27, epic E2) — see, save, publish your design work without a terminal.

  - **Changes panel** (`View ▸ Changes` / `⌘⇧G`): every changed canvas grouped Modified / Added / Deleted / Untracked, with live M/A/D/U dirty badges in the file tree (updated reactively as you edit). Two-line rows (name + path), per-file select + discard.
  - **Save version** (commit) with a message + per-file selection or "Save all"; metadata sidecars auto-save with their canvas.
  - **Publish changes** (push) + **Get latest** (pull) — token-optional in this release: a system-git credential helper publishes today, GitHub sign-in lands in a later phase. Clean-but-unpublished work surfaces a "ready to publish" state.
  - **History** timeline of saved versions.
  - **Visual diff** (the Maude differentiator): a _rendered_ before/after of the actual canvas — both panes live, with locked synced zoom/pan, side-by-side or an overlay/slider wipe — plus a plain-language Keep mine / Keep theirs / Keep both conflict picker (Keep both is the default, zero data loss). The "before" pane renders the canvas at its past version.
  - Vocabulary is non-technical throughout (Save version / Publish / Get latest / History / Unsaved) — never commit/push/pull.

  Server: `isomorphic-git`-backed `/_api/git/*` endpoints (main-origin only, mirroring the canvas-create security pattern) + a rate-limited historical-canvas render path.

- 188efc5: Sign in with GitHub (Phase 28, epic E3) — start, share, and sync design projects without a terminal (native app).

  - **Sign in with GitHub** from the account bar — a plain device-code flow ("enter this code"), token stored in the OS keychain, never on disk and never exposed to the canvas.
  - **New project** creates a private GitHub repo, scaffolds `.design/`, and opens it; **Pull a local copy** clones one of your repos (or a pasted link) to a folder you pick. A non-Maude folder offers a one-click "Set up Maude here".
  - **Share** invites a collaborator by GitHub username.
  - **Publish / Get latest** now use your GitHub sign-in (no system-git helper needed). A "Get latest" nudge surfaces when a teammate has published changes.
  - **Merge-conflict resolution in the UI**: when you both changed the same canvas, "Get latest" opens the visual resolver — Keep mine / Keep theirs / Keep both (Keep both saves your version as a copy, zero data loss) — and completes the merge with no terminal.

  Security: GitHub access stays confined to the keychain via a loopback token bridge (never reaches the webview/canvas); the clone-URL host is anchored to `github.com` so a crafted link can't redirect the token elsewhere; every `/_api/github/*` + `/_api/git/*` route is main-origin-only (dual-allowlist) + CSRF + loopback gated. See DDR-114 (OAuth-App boundary) and DDR-116 (in-UI conflict resolution).

- 188efc5: Native onboarding, project/draft switcher & the "how sharing works" tour (Phase 29, epic E4) — a non-technical collaborator installs Maude, signs in, and lands in a working project with zero terminal.

  - **First-run onboarding wizard** with three doors — **Sign in with GitHub** (open or create a shared project), **Open a local folder** (with a one-click "Set up Maude here" for a non-Maude folder), and an advanced **Connect to a team hub** door.
  - **Project & draft switcher** — a compact bottom dock to switch projects (recent list + open another) and switch between the **Shared version** and your **drafts**, all in plain words (no `branch`/`checkout`/`main` jargon). Includes **"Add this draft to the Shared version"** — the one-button fold-back that merges, publishes, and tidies the draft; a moved-remote reuses the plain "Get latest first" prompt, never a merge dialog.
  - **"How sharing works" tour** — a re-openable walkthrough (offered after onboarding, in Help) that teaches the **Save changes locally → Publish for everyone → Pull changes** cycle, with a two-layer infographic showing that being together live is automatic.
  - **Native app vs. web studio split** — the standalone app owns the workspace (onboarding, sign-in, the full switcher, plain-words cycle); the terminal-launched web studio shows a read-only branch badge (git vocab) and Changes/Diff/History for awareness, deferring actions to your terminal.

- 188efc5: Branch-scoped live multiplayer & soft editing-presence (Phase 30) — two people on the same shared version now collaborate live, Figma-style, and can tell when someone (or the AI) is editing.

  - **You see only your version.** The canvas tree shows the canvases on the version you're in — switch to a teammate's draft to work with them. No confusing cross-version clutter.
  - **Same version = same room.** On the same shared version you see each other's cursors, annotations, comments — and now each other's **canvas edits** as they happen.
  - **Soft "is editing this" cue.** When a teammate or the **AI agent** is editing a canvas, you get a gentle badge with their colour — a heads-up so you don't step on each other. No locks, no "take over" walls; you can always still look around and edit.
  - **The agent's edits now reach everyone.** The "AI is editing" signal crosses the team hub (previously it only showed on the editing machine).
  - **New canvases arrive cleanly** — instantly for a second tab on your machine, and via **Get latest** for teammates.
  - **Seamless live updates** — a teammate's synced edit now hot-swaps in place instead of reloading the canvas, so presence avatars and cursors no longer blink. Two people cold-starting the same new canvas at once no longer duplicates its contents.
  - **Hub admin** realigned to show the one connected project and its synced canvases.

- 188efc5: Native AI chat sidepanel (Phase 31) — drive Claude from inside Maude, on your own Claude subscription, without opening a terminal.

  - **Chat with Claude in the app.** Open the **Assistant** panel (the ✦ in the menubar, or ⌘⇧A) and ask for an edit, a critique, or a new screen — Claude changes the canvas while you watch. Native app only.
  - **Your own Claude, your own subscription.** It drives your installed `claude` CLI on your Pro/Max plan — no login inside Maude, never metered API billing. Not connected yet? A plain explainer tells you to run `claude` in a terminal.
  - **Multiple chats, in parallel.** Open several chats and work on different things at once — each runs independently in the background, so switching never interrupts a running one. A switcher shows which chats are **running** (live dot), open, or saved; start a new chat or delete an old one.
  - **History that sticks.** Chats are saved per project and reopen with their past messages.
  - **Pick the model + effort**, see what Claude is doing live (a "working" indicator + the running tool), and get an OS notification when a turn finishes while you're looking elsewhere.
  - **`/design:chat`** from your terminal opens (focuses) the panel in the Maude window.

- 188efc5: Native app distribution & auto-update (Phase 32) — Maude is now a real desktop app for macOS and Windows that keeps itself current with no terminal.

  - **Maude is a desktop app.** Download an installer for **macOS** (`.dmg`) or **Windows** (`.msi`), open it, sign in with GitHub, and start designing — no terminal at any step. New `/desktop` download page on the site with platform detection, system requirements, and an FAQ.
  - **Auto-update.** The app polls a signed release feed, downloads new versions in the background, and shows a non-blocking **"Maude updated · restart to apply"** banner — one click puts you on the latest. Updates are ed25519-signed and verified before install, so a tampered feed can't push a rogue build. No `npm`, no command line.
  - **Windows installer in CI.** The desktop build pipeline now produces a (optionally code-signed) Windows `.msi` alongside the macOS `.dmg`, with the auto-update artifacts signed on both.
  - **Opt-in crash reporting (local-only).** A first-run checkbox (default **off**) lets you write a scrubbed local crash log — stack trace + OS + version, never canvas content, file paths, or tokens — that you can attach to an issue. Nothing leaves your machine.
  - **What's New, kept current.** The in-app "What's New" badge now re-checks on window focus, so a background update surfaces it without a reload.

- 188efc5: Presentation Mode + Minimap/Zoom View toggles for the studio canvas browser.

  - **View ▸ Minimap** and **View ▸ Zoom controls** now hide/show the floating mini-map and the zoom pill independently, across every open canvas.
  - **View ▸ Presentation Mode** (previously a stub) is now a real "artboards only" view — it hides the entire UI at once: the menubar, sidebar, and side panels, plus the in-canvas mini-map, zoom pill, tool palette, annotations, and comment pins. Get back to the chrome with **Esc** or the floating **Exit** pill. The canvas tool-palette's presentation button enters the same mode.

  Presentation Mode is non-destructive — it overlays-hides chrome without touching your individual Minimap/Zoom/Annotations toggles, so exiting restores exactly what you had. Fail-closed sync/divergence warnings stay visible even while presenting, and an untrusted canvas can't blank an in-flight dialog. See DDR-117.

- 826e947: design: showcase-grounded canvas generation — `/design:new` and `/design:edit` now reuse the design system's platform showcase layout (`ui_kits-<platform>-showcase`) as the canonical product shell, so a new feature canvas slots into the established nav/sidebar/main/status arrangement instead of re-deriving "where things go". The showcase is collected as a Tier-0 pattern prior (above existing canvases + component specimens) and fed to generation as a reference (not a wireframe); `/design:edit` pre-loads it on add-surface edits; `design-system-keeper` gains a conservative product-shell-reuse audit (Pass A.6). Graceful fallback when a platform ships no showcase — never fatal. See DDR-127.

### Patch Changes

- 188efc5: Fix: the file tree now refreshes when a canvas is created on disk from outside the browser.

  When the Assistant panel (or the terminal) ran `/design:new`, the new canvas landed on disk but never appeared in the FILES tree until you reloaded the window — because the tree only refreshed for canvases created through the in-app **+** button. Now any canvas written straight to disk (the AI agent's `/design:new`, an agent edit, or a `git checkout` that brings in new canvases) shows up in the tree right away, and removed canvases drop out the same way.

- 188efc5: Changes panel: panning/zooming a canvas no longer creates a change, and changes are now grouped by canvas (DDR-115).

  - **Pan/zoom is no longer a "change."** A canvas's camera (pan/zoom) was stored in its versioned `.meta.json` and rewritten on every mouse move, so it churned the Changes panel and would commit on every pan. The camera now lives in a per-machine, gitignored file — the Changes panel reflects your actual work (artboard moves, layout, annotations, specimens, design-system edits), not your mouse.
  - **Changes are grouped by canvas.** Instead of a flat M/A/D/U list, each canvas shows as one entry with its supporting files (Layout & settings, Annotations) collapsed underneath, under a Canvases / Other files split. One checkbox saves a canvas and its supporting files as a unit.
  - **Annotations are now versioned** (they travel with the project and show in the Changes panel); comments stay live-synced over the hub.
  - One canonical runtime-state taxonomy: what's hidden from the Changes panel, what git ignores, and what `maude init` scaffolds now agree.

  Security (`/flow:done` review): the untrusted-origin canvas-meta write lanes are now gated on the canvas existing (no arbitrary-slug file minting).

- 188efc5: History view — click a saved version to preview it (Phase 27.1, epic E2 follow-up).

  - The **History** tab is now interactive: with a canvas (or specimen) open, it lists that file's saved versions and each one is click/keyboard-activatable → opens the visual before/after at that version. With nothing open, it stays a read-only repo-wide list.
  - The **visual diff** gains a **"Saved version" picker** — compare your current canvas against any earlier saved version, not just the last one; the "before" pane re-renders as you pick.
  - Fix: the diff sheet is now vertically centered (a tall comparison no longer clipped its footer on shorter windows).

  Server: the existing `GET /_api/git/log` takes an optional `?path=` to scope History to one canvas — design-tree-scoped, main-origin-only, `GIT_LITERAL_PATHSPECS` + `--`-terminated (no argument injection / pathspec magic).

## 0.30.0

### Minor Changes

- c4d2d31: Canvas annotations — FigJam-parity v3 + bidirectional AI loop (DDR-100)

  The strokes layer grows from "draw and move" to a full diagramming surface, and becomes machine-readable/writable for AI tooling.

  - **Multi-select that works** — marquee/hull drag moves the whole selection (root-cause fix: a stale ref broke every `contains()` path since Phase 5.1), ⌘G/⌘⇧G groups (Excalidraw tag-array model), ⌘D + Alt-drag duplicate, OS-clipboard copy/paste, z-order `[` `]`, align/distribute cluster, edge/center snapping with smart guides.
  - **Shapes, properly** — rotation via corner hover zones (relative to grab, magnetic cardinals, Shift 15°), n/e/s/w edge resize, dimension-match quotas against neighbours with a live W×H label, anchored text in every closed shape (rect/ellipse/diamond/triangle), a toolbar shape-kind switcher that converts in place (id-preserving — text + binds follow), screen-constant selection chrome offset, one undo record per gesture, and anchor-fixed resize on rotated objects.
  - **Connectors** — connection dots on selected shapes draw bound arrows; non-pinned ends auto re-route to face the target; bound curves exit perpendicular to the host side (cubic exit-normals) with sleeker heads. Legacy unbound arrows stay byte-identical.
  - **Section tool** (⇧S) — named region frames that carry their content when dragged.
  - **AI loop** — `maude design annotate` writes sticky/text/shape/arrow/section ops or whole auto-laid-out flow diagrams (`--flow`) through the live server; `read-annotations` v2 returns z/groups/author/binds + `--graph` nodes/edges with W3C-style artboard anchoring. AI-authored strokes carry `data-author="ai"`.
  - Right-click selects + opens an annotation context menu (single menu — the shell canvas menu yields); section/sticky/shape editors share the edit-mode text toolbar.

- af300e8: Hub sync — cold-start data safety + honest status (DDR-102)

  Booting two checkouts/machines linked to the same hub in any order can no longer lose local canvas work, and linked-mode status stops lying about what's actually syncing. Driven by a production incident where one peer's day of mascot work was silently overwritten by another's stale version, and ~65 of 83 canvases never synced behind a permission-denied storm.

  - **Never lose bytes on cold start** — a per-machine content-hash journal tells a clean catch-up apart from genuine divergence. A clean catch-up fast-forwards silently; real divergence snapshots **both** versions to `_history/<slug>/` first, then keeps the newer one (`/design:rollback <canvas>` restores the other). The pre-overwrite snapshot is **fail-closed**: if `_history/` can't be written, the overwrite is refused and local is kept. Comments union-merge by id — never lost in either direction.
  - **One WebSocket per peer** — every canvas's provider is multiplexed over a single shared socket instead of one per canvas, so booting a large project no longer floods the hub with a connection burst.
  - **Honest status** — `maude design status` and the studio banner now report per-canvas state (synced / pending / auth-rejected) with the rejection reason, conflict winners + snapshot timestamps, and a recovery hint; `lastSyncAt` reflects real sync activity, and the boot summary prints settled counts (`81/83 synced · 2 auth-rejected`), not a premature "all syncing".
  - **Smarter auth handling** — the hub sends distinct rejection reasons over the wire (scope / invalid token / rate limit) and splits its rate limit so a legitimate multi-peer boot can't be throttled as if it were brute force (valid tokens 600/min per label via `HUB_CONN_RATE_LIMIT`; invalid attempts 100/min per IP). The peer classifies rejections, aggregates them into one console warning with a reason-correct hint, and stops retrying permanent failures.
  - Re-linking a hub on a machine now warns that it replaces the stored token for every project linked to that hub.

  Note: the hub image (`ghcr.io/1agh/maude-hub`) must be redeployed to pick up the rate-limit + rejection-reason changes; peer-side data safety applies regardless.

- 48e7431: Studio chrome polish — DS-parity + behavioral pass across the canvas browser

  A specimen-by-specimen audit of the studio shell against the maude design system, fixing both look and behavior, each change verified live via agent-browser + the full design smoke (89/89 styled) and the studio test suite (1471 pass).

  - **Resizable panels** — drag the file tree and the right dock to resize (8px grip, accent seam on hover/focus/drag), or nudge with the arrow keys (Home/End to min/max, double-click resets); widths persist per panel. Keyboard-operable + `role="separator"` with `aria-value*`.
  - **Loading skeleton** — a calm `.skel` pulse card shows on the stage while a canvas compiles, cleared by the iframe's `loaded` message (180ms appearance delay so warm canvases never flash it).
  - **Keyboard shortcuts** — a new `?` cheat-sheet (the DS shortcuts-overlay: four dense mono-headed columns, 24 real bindings); `F1` keeps the deep Help modal; Help is now a dropdown. Collisions fixed: Inspector moved to `⌘⇧I` (bare `I` stays the canvas highlighter), New canvas is bare `N` (the browser reserves `⌘N`), and `⌘⇧E`/`⌘⇧H` are now bound. `⌘R`/`⌘⇧I/M/E/H` forwarded from the canvas iframe so they work wherever focus is — `⌘R` with canvas focus no longer browser-reloads the whole shell.
  - **Presence** — collaborator + agent cursors match the design system: the plain triangle pointer glyph, hue pill label (mono, dark text), and the agent rides `--presence-agent` exclusively (human peer hues now exclude the agent + accent bands so attribution is unambiguous).
  - **Annotations snap to the dot grid** — drags fall back to the 24px lattice per-axis when no smart-guide candidate wins; `⌘` still suppresses.
  - **Menubar truth pass** — View ▸ Layers and View ▸ Zoom (In/Out/Fit/Actual) are wired to the live viewport (were disabled as "Phase 4/12" after they shipped); File ▸ Close canvas added; empty shortcut pills hidden; dropdowns layer above the sync banner.
  - **Consistency** — unified focus rings (the DS focus recipe), styled `[data-tip]` tooltips replacing native `title=`, thin scrollbars, the DS selection-handle recipe, Inter/Inter Tight loaded, and a `127.0.0.1` `frame-ancestors` fix so opening the shell via the IP no longer blanks every canvas iframe.

## 0.29.0

### Minor Changes

- fdc340b: Draw animation layer — keyframe IR + Lottie-from-code handoff (DDR-094)

  Extends the static draw engine (DDR-070) to **time**: a cross-platform keyframe IR is the animation source, authored natively in maude and shipped as one Lottie for web + mobile.

  - **Animate a draw mark** — `/design:draw` now handles motion briefs (morph / pulse / blink). A keyframe `Timeline` of property tracks (`draw/animate.ts`) drives the mark; shape morphs come from a deterministic `morphVariants()` producer (fixed vertex count — the cross-renderer interpolability rule), never hand-typed `values=` or CSS `d:path()`. One IR emits both an animated SVG (SMIL) and an animated JSX preview from the same node tree (`toAnimatedSvg`/`toAnimatedJsx`) — the DDR-067 single-source invariant, generalized to time.
  - **Live-motion proof** — `maude design draw-proof --motion` samples the animated element at two wall-clock times and requires an over-time delta. A freeze-frame can't prove animation (the dead-`d:path()` trap), so a still-pass + over-time-no-change is a HARD fail.
  - **`/design:to-lottie`** (+ `maude design to-lottie`) — productionize an animation into **one `.lottie` from code** that renders 1:1 on web (`lottie-web`/`dotlottie-react`) AND mobile (`lottie-react-native`). It's an emitter from the keyframe data (there's no reliable rendered-SVG→Lottie converter), self-verified through headless lottie-web. Encodes the 8 conversion rules (per-segment easing with overshoot, arc parsing, layer ordering, masks, gradient opacity stops, …).
  - **`/design:to-rn`** — native `react-native-svg` + Reanimated fallback for **light** animation only (continuous rich morph hits rn-svg's perf ceiling; `feTurbulence` has no native impl — use `/design:to-lottie` for those).
  - **Reference-adapt license gate** — `/design:draw --reference <url>` adapts an external asset only after a license is fetched and the user picks adapt / inspiration-only; provenance is recorded.
  - **Screenshot port-bounce resilience** — `screenshot.sh` re-reads the live port from `_server.json` and retries once on `ERR_CONNECTION_REFUSED` (dev-server respawned on a new port).

  Reduced motion is host-gated for SMIL/Lottie (the format can't carry it); colors are baked into a Lottie with a runtime override. See DDR-094 + `_draw-motion-rules.md`.

- a647e0a: In-app "What's New" + guided tour for the Maude UI

  - **What's New, in the canvas browser** — a `✦ New` badge in the menubar, a first-run toast, and a reopenable panel surface user-facing updates the moment your installed maude version ships them. Backed by a single source-of-truth feed (`apps/studio/whats-new.json`, served at `GET /_api/whats-new`) that describes Maude's own product updates, resolved from the maude package root (not the served project) and main-origin only. The client compares the installed version against a `localStorage` marker to decide what's unseen. See DDR-086.
  - **Guided tour** — a hand-rolled, zero-dependency overlay (spotlight cutout + accessible dialog with focus-trap, `Esc`/`←`/`→`, `prefers-reduced-motion`) powers both a per-feature spotlight launched from a What's New entry and an evergreen "how Maude works" walkthrough offered once on first run and replayable from Help. See DDR-087.
  - **`/whats-new` on the docs site** — the same feed is mirrored to a committed `site/lib/whats-new.json` (Vercel-safe) and rendered as a release-notes page.
  - **Mechanism** — closing a user-visible feature with `/flow:done` offers to append a feed entry via the repo-internal `whats-new-entry` skill (generic, opt-in `integrations.whatsNew` gate; no Maude paths in the flow plugin). Entries are written pending and stamped with the shipped version + date at release (`scripts/bump-version.sh`).
  - `learnMore` URLs are constrained to `http(s)` at the schema + both render sites, and the feed is validated at site-build time (defense-in-depth).

- e450c42: Annotation brief-boards + create-from-browser (Phase 22)

  - **Brief boards** — `/design:new --blank "<name>"` creates an annotation-only canvas (`kind: "brief-board"`, zero model cost). Annotate it with sticky notes / text / arrows, then run `/design:new` again to have Claude read the notes **verbatim** and insert matching artboards into the same canvas (ingest mode). Escape hatches: `--from-annotations` / `--fresh`; identical-annotations re-ingest short-circuits.
  - **Create + delete canvases from the browser** — a "+ board" control in the dev-server file-tree header (`POST /_api/canvas`, main-origin-only per DDR-054) stamps out a brief board without a slash command and opens it active; a hover trash button on each canvas row soft-deletes it (`DELETE /_api/canvas`) — the whole sidecar set moves to `.design/_trash/` (recoverable), with a confirm prompt and active-tab reset. Both endpoints are gated by path-containment + a non-DS canvas-group allowlist; the design system + config files can't be deleted.
  - **`maude design read-annotations`** — a zero-dep headless reader that turns a canvas's `<slug>.annotations.svg` into structured JSON (the ingest brief source).
  - Canvas `.meta.json` gains an additive `kind` field (default `"canvas"`). See DDR-085. Ingest treats annotation text as untrusted, data-framed content (indirect-prompt-injection mitigation).

- e478743: Canvas media: drop images + paste link chips (Phase 23)

  - **Drop or paste images onto the canvas** — drag a `.png`/`.jpg`/`.gif`/`.webp` from Finder, or `Cmd+V` a clipboard image, straight onto the canvas. It uploads to `<designRoot>/assets/<sha8>.<ext>` and renders as a movable / resizable annotation stroke that persists in the canvas's `.annotations.svg`.
  - **Paste a link → a tidy preview chip** — drop or paste a URL and it renders as a client-only card (link glyph + domain + title), no server fetch and no external favicon (the dev-server stays zero-egress). Click-to-open from the selection toolbar. You don't need to type `https://` — a bare `example.com` is normalized; `javascript:`/`data:` are rejected.
  - Media intake is **paste/drop-only** (no toolbar buttons). Image + link are new annotation strokes — they move, resize, and undo with the existing machinery.
  - **Security (DDR-088):** a new `POST /_api/asset` binary write reachable from the canvas origin is gated by magic-byte sniffing (SVG rejected), a 10 MB per-file cap, content-addressed names, a traversal guard, a per-session write budget, and `maxRequestBodySize`. The annotation-SVG sanitizer now allows an `<image>` href but ONLY a relative `assets/<sha8>.<ext>` path — every external / `data:` / `javascript:` / `..` href is still stripped.

### Patch Changes

- 77ad2ca: Add `maude studio` — a top-level alias for `maude design serve`

  `maude studio [--port N] [--root <path>]` now boots the canvas studio (the design dev server), matching the runtime's new home under `apps/studio/`. `maude design serve` keeps working unchanged. Internally, the dev-server and collab hub moved out of `plugins/design/` to top-level `apps/studio/` + `apps/hub/` (DDR-095) — a pure relocation with no behavior change; `maude design serve` and every `maude design <verb>` behave identically.

## 0.28.1

### Patch Changes

- 3873a3a: Bump `motion` 11.18.2 → 12.40.0 (dev-server canvas animation runtime) and regenerate the committed `dist/runtime/*.js` bundles on the trusted macOS profile. The release-minified `motion.js` / `motion_react.js` ship current; the same regen also refreshes the `react`/`react-dom`/`yjs` runtime bundles to match the post-#31 lockfile (19.2.7 / 13.6.31), which the patch-and-minor sweep had left stale. No public API or canvas-lib surface change — `motion`, `AnimatePresence`, `useReducedMotion` are the only motion APIs consumed and are unchanged in v12. Validated via `check-runtime-bundles` floors, `runtime-health`, and a 45/45 `design smoke` render pass.
- 975cf3a: `/design:setup-ds` Round-2 — scaffold-integrity gates + dev-server boot hardening.

  **Boot fix (the user-visible one):** a global `@1agh/maude` install (or a fresh `git worktree`) could no longer boot the design dev-server — `server-up.sh` ran `bun server.ts` from source, but the npm tarball ships `server.ts`/`sync/index.ts` (which import `yjs`) while excluding the dev-server's `package.json`, so the import crashed and the boot degraded to a generic timeout. `server-up.sh` now boots the **compiled platform binary** (which embeds `yjs` + every runtime dep) the same way `maude design serve` does — resolved in `design.mjs` and handed to the helper via `MAUDE_DEV_SERVER_BIN`, with a structural allowlist so a poisoned side-channel/env can only fall back to source, never redirect the spawn. The local dev tree still boots `bun server.ts` from source (no maintainer regression). When source IS the only option and its deps are missing, boot now fails loud with an actionable `bun install` / reinstall hint instead of a silent timeout (DDR-083/DDR-084).

  **Scaffold-integrity gates:** the bootstrap now fails loud on silently-broken generated output it previously trusted — 0-byte specimens, a `React.*` with no binding import (ReferenceError at module-eval), a `*/` that closed a CSS comment early, and fabricated contrast-ratio claims. Gates run at reconcile + durably in the completeness-critic, are filename-safe, and the prevention rules ship in the sub-agent CODE HYGIENE block (DDR-082).

  The Playwright-missing export error (500 + `npx playwright install` hint, never a 200 + empty body) was already shipped earlier and is unchanged.

## 0.28.0

### Minor Changes

- d1baadf: design: live "agent works here" canvas activity overlay (Phase 13). When any tool — `/design:edit`, `/design:new`, an external editor, a script, `git checkout` — changes a canvas file under the design root, every open canvas tab now shows an animated rim + "editing — <file>" badge on the affected artboard(s), then cross-fades out ~3 s after the last write. It's fs-watch-driven (agent-agnostic, no push protocol), scoped per file (touching one canvas leaves the others dark), and refines to the changed `<DCArtboard>` when the edit is cleanly confined to one. Opacity-only pulse, `prefers-reduced-motion` aware, `aria-hidden`, suppressed in exports. See DDR-075.

  design: HMR error resilience during agent editing (Phase 13.1). While an agent is live-editing a canvas, a half-saved file (missing import, undefined symbol, transpile error) no longer flashes the canvas to a white screen. The dev-server now soft-reloads (import-before-swap) instead of a hard `location.reload()`, and the canvas runtime keeps the last good render via an error boundary, surfacing an amber "build error — holding last working render" toast until a good build lands (then it swaps in). Strictly gated on the AI-activity signal, so manual hand-editing keeps the existing immediate reload. See DDR-077.

  design: agent-colored editing border + wave wash (Phase 13.3). The "editing" indicator is a clear 2.5px border in the active agent's color with a softly breathing glow, plus a full-artboard wave behind it — a single gradient with a sharp bottom edge fading up to transparent, sweeping top→bottom and off past the bottom edge, looping. Compositor-only (opacity glow + transform tide), `prefers-reduced-motion` drops both to static, and it all carries the agent's color (DDR-078). The badge label is unchanged. See DDR-075.

  design: agent presence (Phase 13.2). An agent editing a canvas now surfaces like another connected collaborator — a presence avatar in the top-right stack (with a subtle ✦ AI marker + an "AI agent" popover), and the activity overlay rim/badge tinted with the agent's own color + a deterministic funny name ("editing — Nimble Ferret"). Identity is derived client-side from the existing AI-activity signal (author + session start → funny name + shared peer-palette color); no Yjs awareness changes, no flow-command changes. MVP: one agent per canvas, avatar + overlay (no roaming cursor). See DDR-078.

- 620eff8: design hub: **TSX canvas sync now defaults ON** for a linked project (DDR-079, supersedes DDR-072). Linking a hub and running `maude design serve` now syncs all your `.tsx` canvas bodies without a hidden per-project opt-in — fixing the recurring "I linked but my teammate sees nothing / 0 syncable" footgun (and `--adopt` now seeds a hub with no extra flag).

  `linkedHub.syncTsx` becomes an **opt-OUT**: set `false` to disable project-wide, or a per-canvas `.meta.json "syncable": false` to exclude one canvas. New `maude design link` flags `--no-sync-tsx` / `--sync-tsx` set it without editing config. `maude design status` shows the effective TSX-sync state and prints a migration advisory when the field is unset (so upgraders learn the default flipped). `maude doctor` gains a design-hub health section (linked hub, token-stored, TSX-sync state, sync-agent state from `_sync.json`, + the same advisory) — local-only, no network probe, so it stays fast for the release pre-flight. The dev-server still prints a loud boot banner naming the count + opt-outs against non-loopback hubs.

  Unchanged: the Lock-2 sandbox coupling (TSX only syncs when the cross-origin sandbox is active — `MAUDE_CANVAS_ORIGIN_SPLIT=0` still disables both), the per-canvas sidecar precedence, solo-mode (no sync), and the per-machine trust gate for new remote hubs.

## 0.27.0

### Minor Changes

- fc4233b: design hub: linked-mode cold-start no longer empties a non-empty local canvas when the hub has no state for it yet (fresh / never-seeded hub) — the per-canvas sync agent now seeds local UP to the hub instead of writing an empty body over disk. This was silent local data loss: the HTML body was the one `reconcile()` branch missing the empty-doc guard that comments/annotations/meta/css already had, so a first connect to an empty hub truncated every local canvas to 0 bytes.

  Admin UI: the invite form can now mint a **hub-wide** (`scope: '*'`) token — required for canvas sync, where peers authorize per-canvas slugs that a label-scoped token never matches — via a "Hub-wide" checkbox (on by default), and the issued-token modal shows the real scope. The connected-peers and active-tokens cards now scroll inside a fixed-height box (sticky header) instead of growing the page unbounded as peers/tokens accumulate.

## 0.26.0

### Minor Changes

- 4f6b135: **`/design:draw` — principle-grounded SVG generation for the design plugin.** A new command + geometry engine that draws production-grade vector marks, illustrations, diagrams, and backgrounds as _code_ (the agent specifies intent; deterministic TypeScript computes the coordinates), then verifies them visually and iterates.

  - **Geometry engine** (`plugins/design/dev-server/draw/`): grid-snapped primitives, PCHIP splines, A\* connector routing, optical corrections, OKLCH + WCAG/APCA color, a single-source serializer that emits matching SVG **and** JSX, and an SVGO optimize/validity gate.
  - **Composition layer**: armatures (rule-of-thirds / rabatment / dynamic-symmetry), VME visual-balance + dominance metrics, Cohen-Or colour-harmony, organic `blobPath` — so generation composes on a scaffold instead of scattering randomly.
  - **Brush / engraving layer**: variable-width brush strokes, scatter brushes, dry-brush/grain texture, hatch / cross-hatch line shading, form-following contour lines, and graded stipple.
  - **Agents + verify loop**: a `draw-agent` (plan → generate → render via the `DrawProof` size-ladder → rank → keep-best → critique) and an independent `draw-critic` scored on measurable thresholds (value range, harmony distance, balance, dominance, APCA contrast). Auto-routed from `/design:new`, `/design:edit`, and the critic panel; `/design:setup-ds` can seed organic DS artifacts.
  - New `maude design draw-build` / `draw-proof` / `svg-optimize` dev-tooling verbs. Adds SVGO as a dev-server dependency.

- 4c0cd81: Aesthetic-ambition axis for `/design:setup-ds` — the bootstrap flow no longer collapses every new design system into a single-accent minimal default.

  - New first-class `aesthetic_ambition` axis (`restrained → confident → expressive → maximalist`) threads the whole bootstrap pipeline. A design system can now consciously go colourful/expressive (Figma, Gumroad, Arc) or maximalist (Canva, Affinity, Memphis Config), not only quiet editorial.
  - **Inferred, not a new picker.** `ux-research-agent` derives the ambition from brand character (Probe A lineage + Probe B Zrcadlo+Charakter + the vision-brief product description) as the _anchor_ recommendation; the structural knobs (`accentStrategy`, shadow/decor, radii, type ratio) now derive from it instead of each independently falling back to `single`. It surfaces through the standard confidence gate — no extra forced question.
  - **Absence of signal ≠ `restrained`.** When the brand character gives no clear aesthetic temperature, confidence is low (`<0.60`) and Stage 3 _asks_ across the full scale (including a coordinated multi-colour palette via `palette_options[]`) rather than silently defaulting to minimal.
  - New config field `aestheticAmbition` (`restrained | confident | expressive | maximalist`) sets the per-canvas default opt-out scope under the DS (`restrained`/`confident` → `palette`, `expressive` → `aesthetic`, `maximalist` → `full`), so `/design:new` + `/design:edit` no longer hardcode `palette`.
  - Two new Q9 effect families — `chromatic-blocks` (colour-as-structure, Memphis/Canva) and `gradient-mesh` (aurora backdrops, Figma/Stripe-marketing) — and `signature-moment-critic` now judges a declared-maximalist DS on chromatic _coherence_ rather than absolute surface/accent counts.

  Backwards-compatible: a genuinely quiet brief still infers `restrained` and behaves exactly as before; existing design systems without the field are unaffected. Spec-only change to the design plugin (markdown + JSON Schema). See DDR-073.

## 0.25.0

### Minor Changes

- 4511a19: Annotations FigJam-parity polish v2 — the canvas annotation chrome now matches FigJam much more closely, per the 7-point brief.

  - **One Shape tool** replaces the separate Rect (R) + Ellipse (O) buttons, with a kind switcher: square / rounded square / circle / diamond / triangle / triangle-down (the last three are a new on-disk `polygon` stroke). A bare tap drops a default-sized shape (FigJam "click to place"); a drag sizes it. `rect`/`ellipse` stay byte-identical on disk — no migration.
  - **Full arrowhead vocabulary** — `none / line / triangle / triangle-outline / circle / diamond` selectable **per end**, plus line-type `straight / curved / elbow`. Geometry has a single source of truth (`canvas-arrowheads.ts`) shared by the serializer and the renderer, so on-disk and on-canvas forms can't drift.
  - **Sticky notes** — always 1:1, a 10-tint muted/dim palette (slot 0 muted yellow), body text top-left, corner-radius switch removed. Fixes a latent bug where the per-selection toolbar painted sticky swatches from the ink palette instead of the paper tints.
  - **Richer text controls** — named size presets (Small → Huge) + a numeric field (8–200), Bold, Strikethrough, and alignment, applied to standalone text, anchored text, and sticky bodies.
  - **Ghost placeholder** preview while drawing, and a cohesive **Kenney CC0** cursor pack across every tool (24px, dark-glyph + white-halo so it reads on any background; text I-beam + sticky note authored to match).
  - Custom tool cursors now show across the **whole** app shell (sidebar / top bar / canvas), not just inside the canvas.

  Legacy `.annotations.svg` files round-trip byte-identical (two frozen canaries). Every new attribute serializes only when non-default. Security: the sanitizer allowlist gained `polygon`/`circle` and a glued-handler bypass was closed; arrowhead attrs are parse-clamped + escaped; and the app-wide cursor bridge resolves a trusted tool token (not an untrusted cursor string) so a synced canvas can't push an invisible/displaced cursor as a clickjacking aid (DDR-067 / DDR-054).

## 0.24.0

### Minor Changes

- 7a1c3c7: Canvas-shell chrome now follows the Maude dev-server theme, decoupled from the design system.

  - The canvas workspace plane, floating tool palette, minimap, zoom HUD, selection halos, contextual toolbar, context menu, undo HUD, AI banner, and presence chrome now flip dark↔light **with** the chrome theme toggle, in every open canvas — via a self-contained `--maude-chrome-*` token family keyed by a `data-maude-theme` attribute and propagated over the existing `dgn:*` postMessage bridge. The brand accent stays theme-agnostic; no design-system palette leaks into the chrome (closes system-review D9).
  - **Artboards keep their design system's theme by default.** A new right-click **Theme ▸ DS default / Light / Dark / Follow chrome** submenu flips an individual artboard at will; Light/Dark are enabled only when the DS ships both light + dark token blocks (detected by a runtime probe). The override is applied via an injected stylesheet keyed by the artboard's stable id, so it survives canvas re-renders.
  - `/design:new` + the canvas template now document the two-layer theme model so generated canvases don't hardcode a non-default artboard theme.

- 0531c5b: Phase 11 — flow ⇄ design integration. Flow commands are now aware of the design plugin's `.design/` canvas workspace:

  - `/flow:plan <feature>` detects canvases matching the feature by tag or slug and grounds the plan in them (new **Design canvases** context section).
  - `/flow:done` surfaces canvases marked `ready-for-handoff` and offers a soft handoff sweep before close (`/design:handoff` per canvas, then a follow-up commit stamping `status: handed-off` + `handoffCommit`). Soft-prompt rationale recorded in DDR-066.
  - `codebase-intelligence` / `/flow:setup-codebase-map` snapshots now include a **Design artifacts** section (design systems + per-canvas status).
  - `ddr-keeper` / `/flow:record-ddr` prompt for a `Related canvas` reference on UI-affecting decisions.
  - New `paths.designRoot` config key (default `.design`); canvas `.meta.json` schema formalizes a `status` enum, `handoffCommit`, and `tags`. All integrations skip silently on projects without a design root (no regression).

- Phase 21 — FigJam-parity canvas annotations. The annotation toolkit gains the three primitives reviewers kept leaving Maude for FigJam to do, plus a professional visual pass on the whole annotation chrome.

  **New annotation vocabulary** (back-compatible — every pre-existing `.annotations.svg` round-trips byte-identical):

  - **Sticky notes** (`N` tool) — paper-tone cards with their own word-wrapped text: drag to create, drop straight into an inline editor, recolour from a paper palette, resize with corner handles. Body text persists in an allowlisted `<text>` child (never a `<foreignObject>`) so it survives the annotation-SVG sanitizer (DDR-060 F1); the live canvas re-renders it with a `foreignObject` for word-wrap.
  - **Standalone text** (`T` tool) — free-floating text not anchored to a host shape; single-click to drop a caret, type, Enter commits. `TextStroke.anchorId` relaxed to optional with world `(x, y)`.
  - **Shape + arrow polish** — rect corner radius (square / soft / pill); arrow head direction (none / start / end / both) and a dashed-line toggle.

  **Visual overhaul (FigJam parity):**

  - Dark floating property bar + draw-time tray with icon buttons and circular colour dots (replaces the old squared text chips).
  - A unified, FigJam-style colour system: a single hue family where **stroke is a saturated ink and fill is the index-paired light tint**, independent of each other.
  - Sticky notes get a soft drop-shadow + centred text.
  - **Custom 32×32 SVG tool cursors** (`canvas-cursors.ts`) with a white-outline halo so each glyph reads on light _and_ dark canvases, with per-tool hotspots — replacing the tiny, near-invisible native `crosshair`/`text` cursors.

- f50ffad: Phase 9 Tasks 7–11 — hub deploy tooling, hub-down offline mode, linked-mode gitignore,
  contributor dev workflow, and real-hub integration tests. Completes the phase-9
  self-hostable-hub feature work.

  **Deploy (Task 7):** `maude hub deploy fly|docker` emits ready-to-run config
  (`Dockerfile`, `fly.toml`, `docker-compose.yml` + `Caddyfile`) with placeholders
  substituted, then prints the exact next commands — it never runs `fly`/`docker` for you.
  `maude hub token rotate --label <name>` mints a fresh value for an existing label. A new
  CI workflow publishes a multi-arch (amd64 + arm64) `ghcr.io/1agh/maude-hub` image on every
  release tag. New docs at `/docs/hub` (deploy recipes for Fly / AWS Lightsail / EC2+ALB /
  Hetzner / DigitalOcean / Coolify / Cloudflare-Tunnel, a pricing table, and the
  link/adopt/unlink/status + offline-mode UX). The release image now installs from a committed
  `bun.lock` with `--frozen-lockfile` (no fresh dependency resolution at build time).

  **Hub-down offline mode (Task 8):** when the hub becomes unreachable, the linked-mode sync
  runtime enters offline mode — local edits keep working and queue, a yellow canvas banner
  shows the queued-edit count, and on reconnect a green "Synced" flash clears it (escalating to
  a red "consider git commit && push" banner after 24h offline). `maude design status` reports
  the live state. A hub-wins reconcile that overwrites divergent local content now surfaces a
  conflict notice.

  **Linked-mode gitignore (Task 9):** a single `full` strategy (DDR-056) — canvases + their JSON
  snapshots stay in git (cold backup, PR-reviewable diffs, bootstrap-from-clone) while
  regenerable per-machine runtime state is ignored. `maude design init` and `maude design link
--adopt` write an idempotent `# maude:begin/end` block.

  **Contributor workflow (Task 10):** `plugins/design/hub/CONTRIBUTING.md` (plain-Node + Docker
  levels); `maude hub serve --dev` is zero-config.

  Solo (unlinked) projects are unaffected — the sync runtime is a no-op and the offline banner
  never renders.

- e720040: Phase 9.1 — unblock linked-mode sync for the TSX-only canvas format, safely (DDR-060).

  **The gap being fixed:** linked-mode sync (Phase 9) only ever admitted `.html` canvases,
  but `.tsx` has been the only canvas format since Phase 3.6 — so for every real project,
  sync was a silent no-op (`maude design status` looked healthy while syncing nothing). This
  phase makes `.tsx` syncable without re-opening the audit's CRITICAL **F1** (hub-pushed JSX →
  RCE/exfil).

  **Canvas-origin containment (T2 / 9.1-A, now ON by default — opt out with
  `MAUDE_CANVAS_ORIGIN_SPLIT=0`):** canvas iframes are served from a segregated origin under a
  strict CSP + route-allowlist + iframe sandbox, so a hostile canvas can't reach `/_api/export`,
  `/_config`, repo files, cloud IMDS, or the LAN. In solo mode this purely sandboxes your own
  canvas code (a security improvement, zero functional regression). An F1 adversarial re-audit
  found and this release closes three residuals: a `%2f`-encoded path-traversal that leaked repo
  source (decode-then-gate fix), a missing WebRTC exfil control (best-effort `RTCPeerConnection`
  lockout in the canvas shell + `webrtc` CSP directive for when browsers enforce it), and an
  annotation-SVG sanitizer hardened from a denylist to an allowlist. F1 drops from CRITICAL to
  MEDIUM — the remaining WebRTC/self-navigation exfil applies only to a canvas you _opt into
  syncing_, and the reachable data is collab metadata, not repo files.

  **Per-canvas `.tsx` sync opt-in (T3 / 9.1-B):** a `.tsx` body syncs only when BOTH the
  sandbox is active (`MAUDE_CANVAS_ORIGIN_SPLIT=1`) AND its `.meta.json` sidecar declares
  `"syncable": true` — coupled deliberately (the opt-in is inert without the sandbox) and
  hand-set only (not settable by a remote hub or a canvas). `.html` canvases sync as before.
  Default behavior is unchanged: nothing syncs until you opt in.

  **Untrusted-context marking (T4.5 / F3):** every synced canvas is flagged as untrusted
  Claude-context — `.design/_untrusted/INDEX.json` + a managed `# maude:sync-untrusted` block in
  `.claudeignore` list the synced body/comments/annotations so an injected instruction string
  can't steer a `/design:edit`. Rewritten each `serve`, cleared when nothing syncs.

  **Docs (T5):** the linked-mode CLI banner + `/docs/hub/linking` now describe the HTML-by-
  default / TSX-by-opt-in model and the untrusted-context markers.

  Solo (unlinked) projects now get the protective canvas sandbox by default (no behavior change
  beyond stronger isolation of their own canvas code; `MAUDE_CANVAS_ORIGIN_SPLIT=0` restores the
  legacy same-origin path). Actually _syncing_ a `.tsx` from a hub still requires the explicit
  per-canvas `syncable` opt-in — that surface is unchanged.

- bc6b1bc: `maude doctor` — one umbrella diagnostic for workspace health, plus declarative quality gates.

  - **`maude doctor`** reports missing dependencies (per-plugin, from `plugins/<plugin>/dependencies.json`), `.ai/workflows.config.json` schema errors, stack drift, and missing quality-gate declarations in one report. `--fix` applies safe auto-fixes (per-dep install prompt; config edits are additive and never overwrite an existing user value); `--json` for programmatic consumers; `--plugin` scopes the deps section.
  - **Declarative quality gates.** New optional top-level `quality` map in `workflows.config.json` (`gate → shell-command` string). Flow commands read it directly via `jq` + `eval` — `/flow:utils-verify` + `/flow:quick` run `format`+`lint`; `/flow:validate` runs `format → lint → typecheck → tests → build` then any custom gates; the release pre-flight runs all. No `maude quality run` wrapper — `pnpm <script>` is already the runner. Gate set is per-project and user-owned; the `ai-skeleton` template ships no `quality` block (populate via `maude doctor --fix`).
  - **Manifest-sourced preflight.** `/design:init` + `/flow:init` now source their dependency table from `dependencies.json` (no hardcoded `command -v` chain), with a `_preflight.json` 5-minute cross-command cache and a SessionStart hook that warns (deps only) when a hard dependency is missing. `/flow:init` re-runs are now drift-aware (per-key keep/apply/skip; never clobbers tuned `prohibited`/`boundaries`/`motion`).

  See [DDR-058](.ai/archive/decisions/DDR-058-maude-doctor-deps-config-quality.md) for the unified-diagnostic + no-wrapper-over-pnpm rationale and the `eval`-of-config trust boundary.

### Patch Changes

- 02e890f: Hub admin UI redesigned to match MDCC-DSN/01 design language (dark-theme-only, hard-edges anatomy, Berkeley Mono, catalog SKU labels, tile grid dashboard).
- d159d9d: `/design:setup-ds` hardening round 2 — the bootstrap no longer silently drops a mandatory per-platform showcase, refuses to call "fine but not wow" output a clean pass, and defaults to restrained, research-faithful typography.

  Driven by the `new-studyfi` bootstrap retro. Changes to the design plugin's authoritative spec (`SKILL.md`, `SUB-AGENT-PROMPTS.md`, `commands/edit.md`):

  - **Per-platform showcase, never dropped.** The scaffold roster + fan-out now emit a `ui_kits-<platform>-showcase`/`-index` pair per in-scope platform (Q3), and reconciliation asserts the Q3-derived expected set — an absent mobile/tablet showcase is the same hard-fail as a `pending` one. Reconciliation also runs after partial/failed fan-out batches (not just the happy path), and socket-failure recovery routes back through it.
  - **Fan-out ceiling 3–4** (was 5–8) with sequential waves of ≤4, reconciling between waves — fixes the cohort socket-budget failure that 8 simultaneous long-running agents triggered.
  - **Aspiration bar raised 3.5 → 4.0** ([DDR-057](.ai/archive/decisions/DDR-057-aspiration-pass-bar-raised-to-4.md)). Only `≥ 4.0` prints a clean silent pass; `3.0–4.0` still completes but surfaces the signature-moment-critic's top-2 specific lifts ("what would take this from hezké to wow") instead of a silent "passed". Kolo 2 (Atraktivita) is non-skippable during a first-bootstrap / additional-ds run.
  - **Restraint-default typography** (ratio ≤ 1.2, optical-size ≤ 72, display weight ≤ semibold) — opt UP via `/design:edit`, not down. **Research type-fidelity** — mirror the research's primary display-face role exactly; font availability must not flip a grotesque direction into a serif.
  - **Showcase-from-real-app** — for an existing product, the showcase sub-agent reads the real `AppLayout` + nav and restyles, rather than inventing a fictional product UX.
  - **`/design:edit` fixes** — touch the paired `.tsx` after editing a sibling `.css` (the canvas-build bundle keys on `.tsx` mtime, so a CSS-only edit was otherwise invisible); a matchMedia-first fast-path for motion complaints (headless/OS `prefers-reduced-motion: reduce` correctly suppresses motion — rule that out before chasing CSS).
  - **Asset-path correction** — the documented absolute form for specimen assets is `/<designRoot>/system/<ds>/assets/…` (e.g. `/.design/system/<ds>/assets/logo.svg`); the previously-documented `/assets/<ds>/` alias does not exist and 404s.

## 0.23.0

### Minor Changes

- c21c7d4: Phase 9 Task 4 — bidirectional file sync agent for the linked-hub story (THE hard part).

  When `.design/config.json` declares a `linkedHub` and `~/.config/maude/hubs.json` has a matching token, `maude design serve` now mirrors each canvas's Y.Doc (held by a `@hocuspocus/provider` client talking to the hub) with the on-disk `.html` / `_comments/<slug>.json` / `.annotations.svg` files. Edits from peers land on disk so Claude Code's `Read` / `Edit` / `Write` see them; local file writes propagate up through the hub to other peers — both directions immune to echo loops via SHA-256 fingerprinting + atomic `.tmp` → rename writes.

  Solo mode (no `linkedHub`) is bit-for-bit unchanged.

  New modules under `plugins/design/dev-server/sync/`: `echo-guard.ts` (1500 ms TTL hash queue), `atomic-write.ts` (POSIX rename + Windows EBUSY retry), `codec.ts` (Y.Text ↔ HTML body with minimal-diff ops; Y.Array ↔ comments JSON; Y.Map.svg ↔ annotations.svg), `fs-mirror.ts` (250 ms quiet-window file reader), `agent.ts` (per-canvas orchestrator with 800 ms Y.Doc → disk debounce matching DDR-051; cold-start reconcile with hub-wins default + `adopt` one-shot push-local-up), `hubs-config.ts` (Bun-side token reader), `index.ts` (`createSyncRuntime(ctx)` wiring — dynamic `@hocuspocus/provider` import so unlinked installs don't pay the cost).

  75 new tests including a 100-event stress scenario proving doc + disk + peer convergence under `< 200` doc transitions (no echo amplification). Real-hub WSS integration tests deferred to Task 11's stress matrix.

- 57cd33b: Phase 9 Task 4 hardening pass — addresses chained-finding audit on the bidirectional file sync agent (DDR-054).

  `/flow:done` review-only on the Task 4 ship surfaced 1 CRITICAL + 4 HIGH chained findings (defender saw 0 blockers in-isolation; attacker promoted by composing with pre-existing dev-server behavior). DDR-054 pins the linked-mode trust model: the hub is a semi-trusted writer with the same disk privilege as the local user. Four architectural items remain DOCUMENTED RISKS until Tasks 5/6/8 land; this hardening commit ships the 8 quick wins.

  Fixes:

  - CI environment gate in `createSyncRuntime` (`CI` / `GITHUB_ACTIONS`) — closes future-CI supply-chain side-door (override via `MAUDE_SYNC_IN_CI=1`).
  - Refuse `.tsx` canvases in sync discovery — closes worst lane of hostile-hub RCE (Bun.Transpiler turning hub-pushed JSX into JS).
  - Symlink-safe atomic write: `openSync(tmp, 'wx', 0o600)` + 128-bit random suffix — closes shared-tenant tmp-symlink race.
  - Hard size caps in codec (`4 MB` HTML, `1 MB` comments, `1 MB` SVG) — closes single-canvas memory-exhaustion DoS.
  - Scheme allowlist via new `checkUrlScheme()` — refuses `http://` / `ws://` to non-loopback hosts (closes cleartext-token-over-MITM).
  - Path-containment guards in `fs-mirror.notify` (rejects `..` + absolute) + `fire` (resolved-path-under-rootDir check) — defensive against future refactors that might pipe untrusted paths into the bus.
  - `JSON.parse` reviver stripping `__proto__` / `constructor` / `prototype` keys in agent's comments-from-disk parser — closes cross-machine prototype-pollution surface.
  - `0600` mode warn-once on `~/.config/maude/hubs.json` read (POSIX only) — nudges users back to owner-only token storage if a permissions drift happens.
  - Auto-clear `linkedHub.adopt: true` after first successful adopt-reconcile + writes `lastAdoptedAt` attestation — closes "re-running serve re-pushes local state" loop.

  102/102 sync tests (+27 net new); 632/632 full dev-server suite green; biome lint clean. Deferred items (hub-trust prompt, adopt manifest, CSP+iframe sandbox, `.claudeignore` strategy, collab-room↔sync-agent file ownership) mapped to natural-home tasks in DDR-054 §3.

- 8b89dcb: Phase 9 Task 5 — awareness over WSS (cursors/selections/viewport relay through the hub).

  In linked mode the dev-server now bridges the collab Room's Awareness to the sync
  provider's hub-synced Awareness, so a browser cursor published on one peer reaches
  cross-continent peers via Hocuspocus (which relays awareness between document peers
  by default — no hub change needed). The bridge uses shared-origin echo prevention
  and is owned by the collab registry, which wires it on room creation and re-wires
  across room churn while the provider persists.

  Awareness is ephemeral and writes no files, so this is a provable no-op in solo
  mode (the rendering path is untouched) and does not intersect the comments/annotations
  file-ownership question (DDR-054 F14), which remains deferred to the doc-content bridge.

  Because linked-mode awareness now arrives from a semi-trusted hub, all foreign
  peer state (name/color/cursor/selection/annotations) is sanitized at the single
  `useForeignAwareness` read chokepoint before it reaches the cursor/participant
  render sinks: the wire color is discarded and re-derived locally, the selection
  selector is restricted to the locator grammar (rejecting functional pseudo-classes
  that would cause a render-time DoS), display names are control/bidi-stripped and
  length-capped, and peer/annotation counts are bounded.

- 2096faa: Phase 9 Task 6 — auth + transport hardening (hub-side HMAC token store + per-token
  rate limit + WSS boot guard; CLI-side trust gate, adopt manifest, linked-mode banner).

  **Hub:** the token store moves from a plaintext `tokens.json` to a SQLite `tokens`
  table whose `hash` column holds `hmac_sha256(token, hubKey)` — the raw token value
  is never written to disk, so a leaked store yields no replayable credentials. A
  pre-Task-6 `tokens.json` is imported once on first open (raw values hashed in) and
  renamed aside. `onAuthenticate` now rate-limits each token to 100 authentications
  per 60s window (caps reconnection/replay floods on a leaked token), and `createHub`
  refuses to boot when `HUB_PUBLIC_URL` is plaintext `http://` to a non-loopback host
  unless `HUB_INSECURE_HTTP=1` (TLS terminates upstream — Fly auto-cert / Caddy ACME /
  Cloudflare Tunnel / Tailscale Funnel).

  **CLI:** `maude design link`/`adopt` against a non-loopback hub now requires explicit
  trust (DDR-054 F2) — an interactive `[y/N]` confirmation (or `--yes` non-interactively;
  refuses in a non-TTY without `--yes`) that prints the URL/scheme/host warning, then
  records the hub **per-machine** (in `~/.config/maude/hubs.json` under `trusted[]`, like
  `~/.ssh/known_hosts`) so re-linking doesn't re-prompt. Trust is deliberately NOT a
  committable repo file — that would let a malicious PR pre-seed trust and bypass the
  gate. `--adopt` prints the manifest of local files it will upload and stores an
  `adoptedAt` attestation in `~/.config/maude/hubs.json` (DDR-054 F4). Every non-loopback
  link prints the DDR-054 linked-mode preview banner (F3). Loopback hubs are exempt from
  all gating — solo/local-dev behavior is unchanged.

### Patch Changes

- 43d943c: Design dev-server — the in-place comment tool now works on bare DS specimens, not just `DesignCanvas` UI canvases.

  The comment subsystem (tool palette, overlay, drop routing, tool/selection providers) used to be mounted only by `DesignCanvas`. Bare DS specimens (`system/<ds>/preview/*.tsx`) have no canvas-lib envelope, so they had no comment tool at all. The comment layer is now **shell-owned**: the canvas mount harness (`_shell.html`) renders a single comment layer (new `mountCanvas` / `dist/comment-mount.js`) around any canvas default export, and `DesignCanvas` consumes the shell-provided providers instead of creating its own (so there's still exactly one `CommentsOverlay` per surface — no double-mount). In comment mode on a specimen you now get a hover-preview halo showing which element you're about to comment on, and the dropped pin anchors to that element. The comment layer lives only inside the canvas iframe (the outer app and gallery thumbnails stay uncommentable via `?comments=0`). See DDR-055.

- c97b040: Flow plugin — decouple from GitHub issues.

  The `/flow:bug-rca`, `/flow:bug-fix`, `/flow:status`, `/flow:plan`, `/flow:execute`, `/flow:record-execution` commands and the `debugging-rules` skill are now provider-aware. They honor `integrations.tracker.provider` from `.ai/workflows.config.json` end-to-end — frontmatter, headers, prompts, and example output all speak in terms of "ticket" instead of "GitHub Issue". The GitHub CLI flow (`gh issue view`, `Closes #N`, `REPO=$(gh repo view …)`) is preserved behind explicit `provider === github` guards, so existing GitHub-tracker setups behave identically. ClickUp, Linear, Jira, Notion, Asana, and Shortcut users now have a clean path: set `integrations.tracker.provider` + `integrations.tracker.mcp` and the same flow commands resolve tickets through the MCP server. Schema (`plugins/flow/.claude-plugin/config.schema.json`) and `ai-skeleton` template were already wired for this — only the command/skill text was missing.

- aa50f45: Design dev-server — fix multi-DS file-tree selection and per-DS preview.

  In a project with more than one design system, clicking any DS folder in the file tree highlighted _every_ DS folder (because `DsFolderRow` keyed its active state on a single shared `SYSTEM_TAB` constant), and `openSystem` ignored the clicked DS name so the System view always showed whichever DS was already loaded. Each DS folder now highlights independently (matched against the loaded `systemData.ds.name`) and clicking a folder loads that specific DS's tokens + previews. Also fixes a related leak in `canvasUrl`: a `system/<ds>/preview/` specimen now renders with _its own_ DS's `tokensCssRel` instead of always falling back to `designSystems[0]`, so beta previews no longer render with alpha's tokens.

## 0.22.0

### Minor Changes

- 825175d: feat(design/hub): phase-9 task 2.5 — in-hub admin UI with DDR-053 security hardening

  Adds a vanilla-JS single-page admin at `/admin` bundled into the hub binary (no framework, ~6 KB gz). First-run bootstrap URL printed to logs lets the operator claim the hub without shell access; subsequent visits authenticate via `Authorization: Bearer <secret>`. Four cards: Generate invite (mint copy-paste `maude design link …` command), Connected peers (poll), Hub status (uptime/version/data dir), Active tokens (rotate). One-time bootstrap key is **single-use** (POSIX-atomic rename-to-consume) and **never regenerated** after consumption or expiry — operator falls back to `HUB_SECRET` env on recovery.

  Security architecture pinned in [DDR-053](./.ai/archive/decisions/DDR-053-hub-admin-auth-architecture.md): Bearer-only auth (no `?secret=` query), scope-bound tokens (default `scope = label`; `documentName` must match), session-kick on rotate, per-IP rate limit (5/60s), CSP + X-Frame-Options + Referrer-Policy on `/admin*`, strict `Content-Type: application/json` on POSTs, proto-pollution + body-timeout guards, all log lines scrubbed of CR/LF for log-forging defense, server-side label + documentName + publicUrl validation.

  A11y: WCAG 2.1 AA — `--muted` token darkened to clear 4 contrast blockers, `role="alert"` on error containers, `<dialog>` focus management + `aria-labelledby`, `aria-live` announcement for "Copied ✓", `aria-hidden` on decorative icons, skip-nav link, semantic table captions + `scope="col"`.

  CLI: `maude hub serve` usage refreshed to mention the admin UI + bootstrap flow.

## 0.21.0

### Minor Changes

- acac75d: **Phase 8 — Tasks 4 + 5 + 6: AI activity banner, annotation sync, participant chrome.** Builds on `b0cf7be`. Three new user-visible primitives that complete the live-multiplayer feel of canvas review: a yellow banner during `/design:edit` so you don't fight an in-flight rewrite, real-time annotation stroke sync between tabs, and a top-right avatar stack with one-click follow-mode.

  **Task 4 — AI activity banner with heartbeat.** New `collab/ai-activity.ts` keeps an in-memory map of active edits keyed by canvas file path. New HTTP endpoints — POST `/_api/ai/start { file, author }`, POST `/_api/ai/heartbeat { file }`, POST `/_api/ai/end { file }`, GET `/_api/ai` for mount-time backfill. State changes emit on the existing inspector bus; `ws.ts` broadcasts `{ type: 'ai-activity', file, entry }` to every connected inspector socket, and `client/app.jsx` postMessage-relays to every open iframe. New `ai-banner.tsx` (yellow pill with pulsing dot — "Claude is editing this canvas — your changes may conflict") mounts in canvas-shell, filters by the canvas's own file path, also opens its own standalone inspector WS when running outside an iframe (export renderers, direct `_shell.html` URLs). 30 s heartbeat grace TTL via 5 s janitor — if `/design:edit` crashes (no `/end` POST), the banner clears within 30 s. `/design:edit` slash command updated: `/start` POST after snapshot, `/heartbeat` POST after validate, `/end` via shell `trap EXIT` (covers normal completion + every error path).

  **Task 5 — Annotation stroke sync via Y.Array.** `Y_TYPES.annotations` (Y.Map holding the SVG string under the `svg` key — LWW shape matching the current PUT `/api/annotations` semantics). `persistence.ts` `seed` now reads BOTH `_comments/<slug>.json` AND `<slug>.annotations.svg` into the Y.Doc inside one transaction. `persistJson` writes both back on debounced flush. `Registry.syncRoomFromAnnotations(slug, svg)` mirrors the Task 3 comments-bridge — REST PUT writes push into the live Y.Map so collab peers see the new strokes without a cold-open re-seed. `createApi` signature refactored to take an `ApiHooks { onCommentsChanged, onAnnotationsChanged }` options object (server.ts wires both bridges through it). Client-side `annotations-layer.tsx` observes the Y.Map and rebuilds `strokes` state on every remote change, with an identity-equal bail to skip echo re-renders.

  **Task 6 — Participant chrome + follow mode.** New `participants-chrome.tsx` renders one colored-initials avatar per foreign peer in the top-right corner (28 × 28 px, overlapping stack with hover scale). Click opens a small popover showing the peer's full name and a "Follow {firstName}" button. Following pins the local viewport to the target's: every time their `viewport` Awareness field changes (which they publish on settle per Task 2), the local controller calls `setViewport` to match. tldraw-style soft, one-way follow — the target doesn't know they're being followed, and either side can pan freely; the follower stays in lockstep until they click "Stop following" or the target disconnects (release-on-disconnect is automatic via the awareness change watcher).

  **Verification.** 526/526 bun tests green (+17 net new across this ship: 8 ai-activity covering start/heartbeat/end/grace-TTL/multi-entry, 4 collab-annotations-bridge covering Y.Map round-trip + inspector-write origin, 5 participants-chrome for `initialsFor` whitespace/single/multi/empty/unicode). `bun tsc --noEmit` clean modulo `api.ts(889)` + `runtime-bundle.ts(322)` pre-existing baseline (CLAUDE.md). `/design:smoke` 42/42 ✓ OK on port 4455 (single-tab mode — participants stack empty, banner hidden, no rendering regression). Manual: `POST /_api/ai/start` → `POST /_api/ai/heartbeat` refreshes `lastHeartbeat` → `POST /_api/ai/end` clears, all returning expected JSON. `/design:edit` heartbeat ping integrated.

  **Still deferred to follow-up.** Phase 8 Tasks 7 (persistence + git-lifecycle reconciliation — `.git/HEAD` watcher, force-snapshot before reload prompt, no-data-loss invariant per DDR-051 §3) + 8 (multi-tab stress harness 2 tabs × 30 Hz × 2 min, bounded memory + Y.Doc growth, CI wiring). Then the 5 collab scenarios.

  See `.ai/archive/decisions/DDR-051-collab-persistence-json-snapshot-at-quiescence.md` and `.ai/plans/phase-8-live-collaboration-yjs-lan.md`.

- 9efd1b7: **Phase 8 foundation — Yjs collab runtime (Tasks 0–1).** Loopback-only multiplayer is now possible on a single machine: two browser tabs on the same canvas, or two Claude Code instances editing the same repo, can share a per-canvas Y.Doc + Awareness state. DDR-051 spells out the persistence contract — JSON snapshots in `.design/_comments/<slug>.json` stay canonical (legible in PRs, cold-clone safe); `.ydoc.bin` lives under `.design/_state/` (gitignored) as a real-time cache regenerated from JSON on first open; force-snapshot before `.git/HEAD` changes (Task 7) protects in-flight edits from being silently discarded by a branch switch.

  **New runtime deps.** `yjs ^13.6.30` + `y-protocols ^1.0.7` (≈37 KB gz combined) added to `plugins/design/dev-server/`. Workspace-only — end users still see zero npm runtime deps because everything bundles into the standalone dev-server binary.

  **New collab module.** `plugins/design/dev-server/collab/` (5 files / 544 LOC, each ≤ DDR-013's 300-LOC ceiling): `protocol.ts` encodes/decodes the y-websocket binary frames (sync + awareness); `room.ts` owns one Y.Doc per canvas slug with debounced (800 ms) JSON + binary flush; `registry.ts` is the get-or-create surface (lazy room creation, drop-when-empty); `persistence.ts` wires the seed flow (`.ydoc.bin` → JSON → empty) + the `comments` Y.Array projection back through `api.saveCommentsForFile`; `index.ts` is the public surface.

  **New collab WS endpoint.** `WS /_ws/collab/<canvas-slug>` speaks the binary y-websocket protocol. Loopback-only per DDR-047 — the `host:` request header is checked against `127.0.0.1` / `::1` / `localhost` (any port); non-loopback returns **HTTP 403** with body `cross-machine collab requires Phase 9 hub deploy`. The legacy `/_ws` JSON inspector channel is preserved untouched; `ws.ts`'s `WsData` becomes a discriminated union (`inspector` | `collab`) so both protocols share one Bun.serve `websocket` handler. Cross-machine collab stays gated to v1.1 (Phase 9 hub deploy) — no `--bind 0.0.0.0` flag exists.

  **Verification.** 494/494 bun tests green (+21 new: 4 loopback-host-gate tests, 9 protocol round-trip tests, 8 room behavior tests covering debounced flush, idempotent re-flush, awareness-state cleanup-by-`__connId`, single-seed-under-concurrent-connect, peer-to-peer convergence via Y.Doc update). `bun tsc --noEmit` clean modulo the pre-existing `api.ts(883)` + `runtime-bundle.ts(314)` baseline (CLAUDE.md). Manual loopback smoke: `curl -H 'host: example.com' http://127.0.0.1:4451/_ws/collab/foo` → 403 with expected body; loopback host without WS upgrade headers → 400 (host check passes, upgrade fails correctly).

  **Scope cut for this ship.** Phase 8 Tasks 2–8 (cursor + selection awareness rendering, comments-as-Y.Array client migration, AI activity heartbeat banner, draw annotation sync, participant chrome + follow mode, persistence + git-lifecycle reconciliation, multi-tab stress harness, 5 collab scenarios) are deferred to follow-up sessions. The foundation in this ship is what Phase 9 (cross-machine hub deploy) builds on; Tasks 2–8 are user-visible features that ride on the runtime that just shipped.

  See `.ai/archive/decisions/DDR-051-collab-persistence-json-snapshot-at-quiescence.md` for the persistence contract, `.ai/archive/decisions/DDR-047-collab-scope-cut-no-lan-mode-hub-admin-ui.md` for the v1.0/v1.1 split, and `.ai/plans/phase-8-live-collaboration-yjs-lan.md` for the full task list.

- b0cf7be: **Phase 8 — Tasks 2 + 3: cursor awareness + comments backed by Y.Array.** Builds on `9efd1b7` (Yjs foundation). Two browser tabs (or two Claude Code instances) on the same canvas now see each other's cursors live, and any comment add / patch / delete / reply propagates between tabs within ~33 ms via the y-websocket protocol — with the existing JSON snapshot still the canonical persistence format (DDR-051).

  **Task 2 — cursor + selection awareness.** Each canvas iframe opens a `/_ws/collab/:slug` WebSocket on mount (when its file path yields a valid slug). The client publishes its Awareness state — `{ name, color, cursor: world-coords, selection, viewport, __connId }` — throttled to ~30 Hz on mousemove + viewport settle. Foreign peers render as colored SVG arrows + name labels on top of the canvas, transformed through the local viewport so each cursor anchors to the same conceptual canvas point even when local pan/zoom differs. Color comes from a djb2 hash over the peer's `git config user.name` against a 12-hue palette — every peer hashing "Alice" lands on the same color. New server endpoint `/_api/git-user` exposes the local name; anonymous fallback (`anonymous-<short id>`) when git is unset. yjs / y-protocols/sync / y-protocols/awareness are added to `RUNTIME_PACKAGES` + the `_shell.html` importmap so the client-side Y.Doc + Awareness instance and the server-side room stay protocol-compatible.

  **Task 3 — comments backed by Y.Array.** `Registry.peek()` + `Registry.syncRoomFromComments()` bridge the inspector channel (REST `/_api/comments*` + legacy WS `comments-add`) into the live Y.Array. When `api.commentsAdd/patch/delete/addReply` fires, the new JSON state is pushed into the corresponding room's `Y.Array<comments>` inside a transaction tagged `'inspector-write'` — collab peers see the change instantly without waiting for a cold-open re-seed. Canvas-side `comments-overlay.tsx` observes `doc.getArray('comments')` and updates local state on every remote mutation; the existing postMessage + REST self-heal paths stay as fallback for non-collab callers (export iframes, .html mocks). Net effect: identical user-facing comments behavior, but now bidirectionally live between any two tabs on the same canvas.

  **New files:** `plugins/design/dev-server/use-collab.tsx` (React provider, ~370 LOC), `plugins/design/dev-server/cursors-overlay.tsx` (~130 LOC), `plugins/design/dev-server/test/use-collab.test.ts` (9 unit tests for the pure helpers), `plugins/design/dev-server/test/collab-bridge.test.ts` (6 tests for `Registry.peek` + `syncRoomFromComments`).

  **Modified:** `runtime-bundle.ts` (3 new packages in `RUNTIME_PACKAGES`), `templates/_shell.html` (3 new importmap entries), `http.ts` + `api.ts` (`/_api/git-user` endpoint + `gitCurrentUser()` on the Api surface), `server.ts` (`syncRoomFromComments` bridge wired through the existing `onCommentsChanged` callback), `collab/registry.ts` (peek + syncRoomFromComments), `canvas-lib.tsx` (DesignCanvas wraps with CollabProvider when slug derivable), `canvas-shell.tsx` (CanvasCore publishes cursor + viewport; CanvasRouter mounts `<CursorsOverlay />`), `comments-overlay.tsx` (Y.Array observe path alongside postMessage).

  **Bundle cost.** Per-iframe runtime bundles are lazy: yjs (~32 KB gz prod), y-protocols/awareness (~5 KB gz), y-protocols/sync (~3 KB gz). Canvases that don't mount `<CollabProvider>` never resolve these specifiers and pay zero bundle cost (`canvasSlugFromPath` returns null → provider omitted → tree-shaken).

  **Verification.** 509/509 bun tests green (+15 net new). tsc clean modulo `api.ts(889)` + `runtime-bundle.ts(322)` pre-existing baseline (CLAUDE.md). `/design:smoke` 42/42 ✓ OK (no rendering regression; single-tab mode = no foreign peers = invisible overlay). Manual: `/_api/git-user` returns `{"name":"<git user>"}`; yjs + y-protocols bundles serve via `/_canvas-runtime/*.js` on first request (dynamic build path).

  **Still deferred to follow-up sessions.** Phase 8 Tasks 4 (AI activity heartbeat banner during `/design:edit`), 5 (draw annotation sync via Y.Array), 6 (participant chrome + follow mode), 7 (persistence + git-lifecycle reconciliation with force-snapshot), 8 (multi-tab stress harness + the 5 collab scenarios). The foundation in this ship is the protocol layer all of those will use.

  See `.ai/archive/decisions/DDR-051-collab-persistence-json-snapshot-at-quiescence.md` and `.ai/plans/phase-8-live-collaboration-yjs-lan.md`.

- a6ed8bd: **Phase 8 — Tasks 7 + 8: git-lifecycle reconciliation + multi-tab stress harness.** Builds on `acac75d`. Phase 8 now ships complete (all 9 tasks across 4 commits).

  **Task 7 — git-lifecycle reconciliation (no-data-loss invariant).** New `collab/git-lifecycle.ts` watches `.git/HEAD` via `fs.watch` with a 250 ms debounce. On detected change (`git checkout`, `git pull` mid-session), the watcher SYNCHRONOUSLY calls `registry.flushAll()` to write every dirty Y.Doc → its JSON projection BEFORE broadcasting a `git-lifecycle` bus event. `ws.ts` relays the event to inspector clients; `client/app.jsx` forwards via postMessage to every open iframe AND renders a blue "Repo state changed — reload to sync?" pill with Reload + Dismiss buttons. Reload click → `location.reload()` → Y.Doc re-seeds from the (now branch-current) JSON. This implements DDR-051 §3's no-data-loss invariant: in-flight edits sitting in the 800 ms debounce window are flushed to disk BEFORE the user's reload choice, so an unlucky checkout can never silently discard work. Silent no-op when run outside a git repo (scratch projects, templated bootstraps).

  **Task 8 — multi-tab stress harness.** New `test/collab-stress.test.ts` — two in-memory peers attached to one Room, 30 Hz cursor-shaped Awareness updates for `STRESS_MS` (default 10 s; CI-configurable via `$MAUDE_STRESS_MS` env). Measures RSS growth via `process.memoryUsage().rss` + Y.Doc state size via `Y.encodeStateAsUpdate(doc).byteLength`. Pass thresholds: RSS Δ < 20 MB, Y.Doc Δ < 100 KB. Observed in local 5 s run: 294 updates / 1.7 MB RSS Δ / 0 bytes Y.Doc Δ (Awareness is ephemeral by design — never persisted in the doc, so Y.Doc growth stays at exactly zero in the pure cursor case). Drops cleanly: both peers disconnect → `room.size() === 0`.

  **Verification.** 530/530 bun tests green (+4 net: 3 git-lifecycle + 1 stress). `bun tsc --noEmit` clean modulo `api.ts(889)` + `runtime-bundle.ts(322)` pre-existing baseline (CLAUDE.md). `/design:smoke` 42/42 ✓ OK on port 4456.

  **Phase 8 commit stack on `main`:**

  ```
  acac75d  feat(collab): phase 8 tasks 4–6 — AI banner, annotations, participant chrome
  b0cf7be  feat(collab): phase 8 tasks 2–3 — cursor awareness + comments as Y.Array
  9efd1b7  feat(collab): phase 8 tasks 0–1 — Yjs runtime + loopback-only collab WS
  ```

  (This commit adds Tasks 7+8 on top.)

  **What ships, end-to-end.** Two browser tabs on the same machine, same canvas, now see: each other's cursors (Task 2), comment add/patch/delete/reply propagation (Task 3), AI banner during `/design:edit` (Task 4), draw annotation strokes (Task 5), participant avatars + follow mode (Task 6), branch-switch reload prompt (Task 7). All over loopback `/_ws/collab/:slug`; cross-machine collab stays a Phase 9 hub-deploy story per DDR-047. JSON snapshots in `.design/_comments/` + `.design/<slug>.annotations.svg` stay canonical (DDR-051) so PRs remain legible and cold-clone users get the same state without a synthetic seed step.

  **Still ahead (out of Phase 8 scope).** The 5 collab scenarios — `collab-multitab-cursors`, `collab-comment-sync`, `collab-follow-mode`, `collab-ai-banner`, `collab-branch-switch` — authored via `/scenario new` against `agent-browser`'s two-context harness; these belong in the `/flow:done` step that follows this commit. Phase 9 (cross-machine hub deploy) starts after Phase 8 retro.

  See `.ai/archive/decisions/DDR-051-collab-persistence-json-snapshot-at-quiescence.md`, `.ai/archive/decisions/DDR-047-collab-scope-cut-no-lan-mode-hub-admin-ui.md`, and `.ai/plans/phase-8-live-collaboration-yjs-lan.md`.

- 24e07f3: **Phase A foundation + doctor — `maude doctor` unified workspace diagnostic (Tasks A1–A13 of 28).** One umbrella CLI command that reports missing dependencies, config schema errors, stack drift, and missing quality-gate declarations in one shot. Replaces the per-command `command -v` chains in `/design:init` and `/flow:init` with a single source of truth — `plugins/{design,flow}/dependencies.json` — that both the CLI and slash commands read. `--fix` applies safe auto-fixes (prompts per dep install; silent drift resync; silent additive quality merges; never overwrites existing user values). `--json` for programmatic consumers (slash commands call internal libs directly — no `maude doctor` round-trip from inside `/flow:validate`).

  **New CLI subcommand.** `maude doctor [--plugin <name>] [--fix] [--json]` lands alongside `init` / `config` / `design` / `version` in the dispatcher. Exit 1 on any hard dep missing OR schema error; 0 on healthy or warnings-only.

  **New dependency manifests.** `plugins/design/dependencies.json` + `plugins/flow/dependencies.json` enumerate every CLI binary, MCP server, and system tool the plugin shells out to (8 entries each), with per-platform install hints, hardness (hard / soft), fallback behavior, and the list of plugin files that reference each dep. Schema is shared between plugins via `plugins/{design,flow}/dependencies.schema.json` (Draft 2020-12). Both manifest + schema ship in the npm tarball via the extended `package.json` `files[]`.

  **New shared libs (zero new deps in user-visible runtime).** `cli/lib/preflight.mjs` runs each manifest entry's `check.command` via `bash -c` and reports presence / version / staleness. `cli/lib/stack-detect.mjs` is a pure JS port of `/flow:init` Step 2 bash, extended with a workspace deep-scan so monorepos where every workspace is TypeScript actually detect `language: typescript` (previously the root-only check returned `javascript` because `tsconfig.json` lived under `packages/web/` not at the root). `cli/lib/config-lint.mjs` validates `.ai/workflows.config.json` against the flow plugin's JSON Schema via Ajv2020 (Draft 2020-12), with a Levenshtein post-pass that converts enum errors into actionable suggestions (`tests: "node-test"` → `suggestion: "go-test"`).

  **Schema additions.** `plugins/flow/.claude-plugin/config.schema.json` gains a top-level `quality` block — a flat map of gate name → shell command string (e.g. `{ "lint": "pnpm lint", "format": "biome format --write ." }`). No `GateSpec` object shape, no `order`, no per-gate metadata; slash commands decide their own scope per gate by convention. Also adds `$schema` as a known top-level property so editor-mode configs no longer fail `additionalProperties: false`.

  **New runtime deps.** `ajv@^8` + `ajv-formats@^3` at workspace root (4 transitives: `fast-deep-equal`, `fast-uri`, `json-schema-traverse`, `require-from-string`). Both are widely-used (≈1B+ downloads/wk combined), maintained by the ajv-validator org, no postinstall scripts, no typosquat surface.

  **New shell helper.** `plugins/design/dev-server/bin/preflight.sh` is a thin wrapper that re-shells `node cli/lib/preflight.mjs --plugin design`. Detection logic stays in one place (the Node lib); the shell side exposes `--shell-export` + `--warn-only` for `init.md` and the future SessionStart hook.

  **Verification.** 39/39 node tests green (+27 net new: 8 stack-detect + 10 config-lint + 8 doctor + 1 ad-hoc). 530/530 bun dev-server tests still green (unchanged surface). Biome lint clean on all 14 session files. `maude doctor` dogfooded on this repo: 0 hard deps missing, 0 schema errors, 4 stack drifts surfaced (language js→ts, framework none→next.js, tests node-test→playwright, router none→next-app), 4 quality additions proposed. `npm pack --dry-run` confirms all manifests + schemas + `bin/preflight.sh` ship in the tarball.

  **Deferred to follow-up PRs.** Tasks A14–A28 (A14–A17 init wiring + preflight cache + SessionStart hook + drift-aware `/flow:init` re-run; A18–A23 flow command bindings — `/flow:validate` Step 0.5 + quality.\* eval chain, `/flow:utils-verify` format+lint + drift warning, `quality-gates` skill, `/flow:done` delegation, `/flow:quick` staged-only, `.ai/release-guide.md` pre-flight rewrite; A24–A28 skeleton sanity-check, dogfood `--fix` apply on this repo's config, README + CLAUDE.md docs, DDR-053 — note DDR-052 was taken by parallel hocuspocus work, plan amended). See `.ai/plans/phase-a-deps-and-preflight.md` for the full task ladder.

### Patch Changes

- 7a0823d: **Fix four divergences from the 2026-05-27 `design:new` system review (AI-StudyMate / StudyFi Copilot canvas).**

  - **D-1 — runtime bundle health probe.** New helper `plugins/design/dev-server/bin/runtime-health.sh` HEAD-probes every `/_canvas-runtime/*.js` URL and compares the served body size to the on-disk pre-built bundle in `dist/runtime/`. Ratio < 0.5 = defective dynamic Bun.build; `--restart` auto-kills + respawns the dev-server. Wired into `/design:new` step 2, `/design:edit` step 2, and `/design:smoke` step 1a. Catches the "parse-clean, fails-at-module-eval" class of bug (`ReferenceError: AcceleratedAnimation is not defined` from a 409-line broken `motion_react.js` instead of the 10056-line pre-built) that previously slipped past the HTTP-200 reality check.

  - **D-2 — per-artboard screenshot is a blocker, not a footnote.** `/design:new` step 9 no longer silently falls back to a single 30–60 MB full-page PNG when `screenshot.sh --all-screens` fails. New contract: first pass agent-browser, second pass `--engine playwright`; both fail → `AskUserQuestion` (retry / interactive / accept gap / abort). The final print stamps `Visual verification: SKIPPED` loud when the gap is accepted, instead of burying it in a footnote.

  - **D-3 — render-budget cost on artboard-count question.** New step 4.6 in `/design:new` codifies the artboard-count `AskUserQuestion` with explicit pan/zoom perf trade-offs in every option label. The "recommended" tag is reserved for cost-neutral defaults; ≥ 8 artboards stamps `pan/zoom may stutter on trackpad` in the final print so the user can correlate density with interaction feel.

  - **D-4 — HUD CSS scope-isolation.** Dev-server chrome (cursor/hand/pan toolbar, world-map minimap, halos, marquees, AI banner, annotations, cursors, participants, export dialog) used to inherit `var(--accent, …)` from the canvas's design system — a violet StudyFi canvas turned the floating toolbar violet. New `--maude-hud-*` token family is injected on the canvas iframe `:root` via a dedicated `HUD_TOKENS_CSS` block; 13 dev-server tsx files now reference `var(--maude-hud-accent, …)` instead. Canvas-content motion helpers (`MotionDemo`, `ReducedMotionToggle`) intentionally keep `var(--accent, …)` so they bind to the canvas DS.

  No user-facing breaking changes — the HUD defaults match the previous inline fallback (`#d63b1f`, Maude brand orange-rust), so default-themed canvases look identical. Canvases that intentionally re-themed the HUD by setting `--accent` will now need to set `--maude-hud-accent` instead.

## 0.20.0

### Minor Changes

- 274cae4: **Canvas Cmd+Z / Cmd+Shift+Z** — per-canvas undo / redo stack in the dev-server iframe. Reverses drag, marquee batch-move, equal-spacing distribute, align, and annotation strokes (add / erase / translate / text). Stack persists across canvas switches (keyed by canvas file path on `window.top.__maude_undo_stacks`), ring-capped at 50, cleared on external `.meta.json` edit. Viewport + selection intentionally NOT undoable (Figma convention). Annotation drag now coalesces into ONE undo record per pointerdown → pointerup gesture, not per pointermove tick. Toast HUD announces every operation via `aria-live="polite"`. See DDR-050 (revised twice during the same day's iteration loop; originally drafted as DDR-049 but renumbered after a same-day collision with the motion-one DDR).
- 03c9d0d: **Motion One canonical motion library + `/design:setup-ds` hardening** — DDR-049. canvas-lib gains an 8-role motion vocabulary (`<MotionDemo role>` covering flip / panel / route / soft / spring / scroll / drag / presence) plus `<MotionTrack>` staggered row, `<TokenPlayback>` click-to-fire chip, `<ReducedMotionToggle>` chrome toggle, `useMotionTokens()` live token reader, and `easingFromToken()` mapper. Default `loop="always"` so specimens play motion on first paint (closes the "looks dead at rest" failure mode). Every `<MotionDemo>` root bakes `overflow: hidden` inline so the sparkle-on-tile overflow regression becomes structurally impossible. Reduced-motion enforced in two places: CSS `--dur-*: 1ms` collapse + JS `useReducedMotion()` short-circuit. `motion ^11.0.0` (Motion One — framer-motion's same-author successor, ~10 KB gz) is a new peer-dep of the canvas-lib; canvases that don't import a motion helper pay zero bundle cost (`motion/react` tree-shaken). `_shell.html` importmap + `RUNTIME_PACKAGES` carry `motion` + `motion/react`.

  **`/design:handoff` declares motion correctly.** A canvas that uses any motion helper drops into a Next.js + shadcn project with `bunx shadcn add` — `motion` lands in `registry-item.json` dependencies automatically, primitives are inlined, no `@maude/canvas-lib` reference survives. Animations work with zero manual wiring on the target.

  **`/design:setup-ds` hardening.** Spec-bypass discipline becomes mandatory: every deviation (--quick, --imprint, dev-server boot fail, brief/spec conflict) surfaces in two places — 1-line chat note + row in `_history/_system/<ds>-bypass-log.md`. Closes D-1 + D-5 from the imprint-bootstrap retro (silent elision of Stage 2 / Kolo 2-3 is no longer possible). 4-kola critic panel becomes an explicit `AskUserQuestion` (Full 4 kola / Imprint-only / Custom). `motion-critic` is now in the always-on bucket alongside `a11y-critic` whenever `motion.tsx` exists — `--opt-out=motion` cannot disable it during DS bootstrap.

  **New scaffolder surfaces.** `motion.tsx.tpl` + `motion.css.tpl` + `_motion-readme.md.tpl` ship the 8-role playground (4 token playback chips + 2 cubic-bezier curve SVGs derived from live token values). `_components.css.tpl` (NEW shared anatomy template) ships 8 motion role classes (`.motion-flip` … `.motion-presence`) as a CSS-only escape hatch for canvases that don't want `motion/react`. `SUB-AGENT-PROMPTS.md` extracted from SKILL.md — carries three MANDATORY safety blocks (ANIMATION SAFETY, RELATIVE-URL SAFETY, PLACEHOLDER POLICY) that every Batch B + C sub-agent now obeys.

  **Critic plumbing.** `design-system-completeness-critic` adds V21 (motion specimen renders without console errors via `bin/visual-sanity.sh`) + V22 (every `--dur-*` token must be referenced ≥1× by the motion specimen — orphan-token check). `design-system-keeper` adds Pass A.5 motion-pattern reinvention (grep `@keyframes` against the canvas-lib role table; ≥3 reinventions promote to blocker). `motion-critic` gains review axis #8 (role-vocabulary fidelity — sparkle-≤56px, bounded geometry, first-paint motion, token coverage).

  **One-shot codemod** at `scripts/migrate-motion-specimen.ts` migrates legacy `**/preview/motion.html` to the new TSX shape, archives the `.html` to `_history/_migration-motion-2026-06/`, surfaces inline token overrides as JSDoc comments. Skip-if-already-TSX behavior handles the studyfi-style manual-fix path.

  Closes phase 3.7. 468/468 bun tests green (+7 net for motion). `/design:smoke` 42/42 canvases OK. See `.ai/archive/decisions/DDR-049-motion-one-as-canonical-motion-library.md` for the full motion-runtime decision + alternatives considered (framer-motion, GSAP, WAAPI, CSS-only).

## 0.19.1

### Patch Changes

- dc42ee1: fix(dev-server): System view now renders the project's actual design-system tokens

  `MDCC-DSN/01` (the System tab in the dev-server browser) was reading from the dev-server shell's own chrome stylesheet via `getComputedStyle(document.documentElement)` with a hardcoded list of canonical token names (`--bg-0..4`, `--fg-0..3`, `--accent*`). For projects whose DS used different naming (imported / hand-written / brand mirrors) the overview showed Maude's amber-rust theme instead of the user's tokens; for projects that used the canonical naming, swatch values still came from the shell, not the DS.

  Three fixes:

  - **Bias-free rendering** — `TokenLadder` + `TypeLadder` now consume parsed tokens from `/_system-data` and render swatches from raw values, not `var(--name)` against the shell document. Whatever the user's `colors_and_type.css` declared shows up exactly as written.
  - **Per-DS `tokensCssRel` auto-resolution** — `designSystems[]` entries without an explicit `tokensCssRel` default to `<entry.path>/colors_and_type.css`. Multi-DS projects (or projects with nested-folder DS layouts) no longer need to spell out the path.
  - **DS picker** — when `designSystems.length > 1`, the System view header renders a selector that switches both tokens and previews. Unknown `?ds=<name>` returns 404 instead of silently falling back.

  See `.ai/archive/decisions/DDR-048-dev-server-system-view-no-shell-bias.md` for the full rationale and the contract between the shell chrome and the user-facing System view.

## 0.19.0

### Minor Changes

- 14aa7f9: `feat(design)`: bias-free design plugin templates

  Strip every visual prior from `plugins/design/templates/` so the discovery flow becomes the only place visual choices are made. Previously the templates smuggled a complete "Linear-ish dark dashboard" opinion into every project that ran `/design:setup-ds`: a 4 px spacing scale, an 8-step type ladder, specific easing curves, OKLCH-only color space as a hard rule, a one-accent rule as a structural ban, a 1200 px max-width, 44 × 44 touch targets (Apple-flavored), Inter font, indigo accent, and a dark slate background — none of which the discovery had asked for.

  Three coordinated changes (per [DDR-043](.ai/archive/decisions/DDR-043-bias-free-design-plugin-templates.md)):

  - **Templates become true skeletons.** Every hardcoded numeric / curve / hue in `core/colors_and_type.css.tpl`, `README.philosophy.md.tpl`, `SKILL.md.tpl`, `canvas.tsx.template` is now a `{{placeholder}}` fed by the discovery payload. The only hardcoded values that remain are the `prefers-reduced-motion: reduce` 1 ms collapse (a11y) and the token NAME contract.
  - **Critic gates become discovery-driven.** `design-system-completeness-critic` C7 (one-accent) and V2 (OKLCH-required) now read `config.accentStrategy` and `config.colorSpace` and gate accordingly. Defaults preserve backwards compatibility: missing fields → `single` + `oklch`. Existing downstream projects keep passing without any config change.
  - **`maude design init --no-discovery` defaults are deliberately neutral.** The CLI now emits an achromatic grayscale palette with zero radii, no shadows, system fonts, and a graphite accent — so the output looks obviously unfinished and the designer is nudged toward `/design:setup-ds` instead of unconsciously shipping the default aesthetic. Previously this mode produced a polished-looking dark indigo dashboard that designers kept.

  Also cleaned the worst bias injections in 7 inspiration specimens (`logo.html`, `ui_kits-mobile-showcase.html`, `colors-themes-side-by-side.html`, `colors-accent.html`, plus NOTES comments on the presence/team-accent demos clarifying that their hardcoded OKLCH values are illustrative only).

  No breaking changes — every existing downstream project's `colors_and_type.css` still parses, the critic still passes with the backwards-compat defaults, and the dev-server / canvas runtime are untouched. Run `/design:setup-ds` to take advantage of the wider design space.

- 8728c24: `feat(cli)`: notify users when a newer `@1agh/maude` is published

  Every `maude` invocation now prints a one-line stderr notice when a newer version is available on npm — covers `maude init`, `maude config`, `maude design serve|init|export`, `maude help`, `maude version`, plus the legacy `mdcc` alias (which already prints its own deprecation warning and now follows it with the update hint when one exists).

  **Hot path is sync and never blocks on the network.** The hook in `cli/bin/maude.mjs` reads `~/.cache/maude/update-check.json` (respects `XDG_CACHE_HOME`) and only prints a notice if the cached `latest` is greater than the installed version. A detached child process refreshes the cache from `https://registry.npmjs.org/@1agh/maude/latest` with a 3 s timeout whenever the cache is missing or older than 24 h. The notice therefore appears on the run _after_ a new release rolls into cache — same lag pattern as `update-notifier`, and the price of not adding latency to every CLI call.

  **Skip conditions** (any one wins): `MAUDE_NO_UPDATE_CHECK=1`, `NO_UPDATE_NOTIFIER=1`, `CI=true`, or stderr is not a TTY (pipes, redirects, CI logs). Zero new dependencies — uses `node:https` via global `fetch` and `node:child_process` for the detached refresh.

  Output:

  ```
    ⚠ maude update available: 0.18.2 → 0.19.0
      Run: npm i -g @1agh/maude@latest   (or pnpm add -g / bun add -g)
  ```

  Verified by priming the cache with a fake newer version (notice fires), by setting `CI=true` / `MAUDE_NO_UPDATE_CHECK=1` (silent), and by running the detached child directly against the npm registry (cache populated with the current published version). Unit tests cover the `cmpSemver` comparator under `cli/lib/update-check.test.mjs`.

- 10df682: `fix(dev-server)`: marketplace-cache install boots cleanly on first try

  Before this release, the documented happy-path — `/plugin marketplace add 1aGh/maude` → `/design:setup-ds project` → `/design:browse` — failed with a 404 on `/_client/client.bundle.js` and a 500 on `/_canvas-runtime/*` on a fresh machine. The marketplace install mechanism does a `git clone` (honors `.gitignore`), so `dist/` and `node_modules/` arrived empty even though `npm pack` shipped them. Three independent packaging gaps stacked into one broken first boot.

  Seven coordinated fixes ship together (per [DDR-044](.ai/archive/decisions/DDR-044-marketplace-install-vs-npm-install-artifact-strategy.md)):

  - **Commit `dist/client.bundle.js` + `dist/styles.css` to git** (~270 KB) so marketplace clones get them out of the box. Per-platform binaries (~70–120 MB each) stay gitignored — they ship via `optionalDependencies` sub-packages per DDR-015.
  - **`bun run build.ts` no longer ENOENT-crashes outside the monorepo.** The brittle `../../../package.json` read at `build.ts:73-74` now resolves `plugins/design/.claude-plugin/plugin.json` (always present in both npm and marketplace installs) with a try/catch fallback to `version: 'dev'`.
  - **Boot-time self-heal in `server.ts`.** On startup, if `dist/client.bundle.js` or `node_modules/react/package.json` is missing, the server auto-runs `bun install --production` + `bun run build.ts` before writing `_server.json`. New `MAUDE_NO_AUTOBUILD=1` env flag opts out for read-only-filesystem deployments (server exits 1 with a remediation message instead). React, react-dom, lightningcss, magic-string, and oxc-parser moved from `devDependencies` → `dependencies` so `--production` pulls them. Extracted to a standalone `boot-self-heal.ts` module with full test coverage.
  - **`runtime-bundle.ts` translates Bun-cache-corruption errors** (EISDIR/ENOENT on `~/.bun/install/cache/<pkg>@<version>/…`) into a one-line remediation: `Run \`bun pm cache rm <pkg>\` then reload the page.`New exported`bunCacheRemediation()` helper covers subpath specifiers (`react/jsx-runtime`→`bun pm cache rm react`).
  - **`screenshot.sh` rejects `file://*.tsx`** with exit 2 and a hint pointing at `--port` — the dev-server's `_canvas-shell.html?canvas=<rel>` route is the only way to render TSX (browsers can't compile JSX). The bootstrap skill's "Visual sanity" step has been rewritten to require the dev-server first (the HTML-era `file://` recipe silently no-op'd on TSX scaffolds).
  - **AskUserQuestion fallback documented in `SKILL.md` + `setup-ds.md`.** Stages 0 + 3 now declare a numbered-prose fallback for when the tool is unavailable (don't-ask mode, permission denial). Copy-pasteable templates included. Stage 1 is already prose-only by design.
  - **Single-DS name-convention tension resolved.** New `name_source: "user" | "default"` field on `vision-brief.json`. `setup-ds` warns if `<name>` matches the repo basename (`/design:edit` auto-detection works best with the literal `project` for single-DS) but honors the user's choice either way. The completeness-critic's C2 dirname check now reads `name_source` — user-supplied names never trigger the divergence flag. Legacy briefs predating this release default to `"user"` (no false positives).

  No breaking changes. Existing installs continue working with their committed `dist/` artifacts; the self-heal only fires on the gap scenarios. Source-of-record retro at `.ai/logs/system-reviews/maude-dev-server-bootstrap-review.md` (2026-05-25).

### Patch Changes

- e6bbb7b: `fix(dev-server)`: auto-increment port on collision + canvas-lib watch in compiled binary

  Two unrelated dev-server bugs surfaced from a single `maude design serve` invocation in a second repo on a machine where the dev-server was already running for another project.

  **Port collision (blocker).** `resolvePort()` returned 4399 unconditionally when neither `--port` nor `$PORT`/`$MDCC_DEV_PORT` was set, so the second `maude design serve` invocation on the same machine died with `EADDRINUSE`. Each running instance writes its own `_server.json` into its own `<designRoot>/`, so there was no other obstacle to parallel runs — just the hardcoded port. Fix: when the port is implicit, walk 4399 → 4408 retrying on `EADDRINUSE` and log `[port] 4399 busy, using 4400 instead.` on success. Explicit `--port`/`$PORT` stays a hard failure (so users notice their own collisions). `_server.json` records the actual bound port, so `server-up.sh` and the orchestrator pick up the right URL.

  **canvas-lib watch ENOENT in compiled binary (cleanup).** Follow-up promised in the v0.18.2 changeset. `canvasLibPath()` joined `import.meta.dir` with `canvas-lib.tsx` — inside `bun --compile` standalone binaries that resolves to the virtual `/$bunfs/root`, so `fs.watch` failed with `ENOENT: ... '/$bunfs/root/canvas-lib.tsx'` at boot. Same DDR-045 bug class as v0.18.1 (`existsSync` against virtual fs) but for `fs.watch`. Fix: route through `DEV_SERVER_ROOT` from `paths.ts`. Side benefit: canvas-lib HMR now actually works in the compiled binary.

  Verified by running a second dev-server against a scratch project while another was already listening on 4399 — the second instance bound 4400 cleanly and wrote `port: 4400` into its `_server.json`. No canvas-lib watch warning in the boot log.

- 8100943: `fix(dev-server)`: greenfield `npm i -g @1agh/maude` actually boots (Phase 19.1)

  v0.18.0 shipped seven fixes but had a load-bearing architectural bug that broke the very scenario it was supposed to repair. Three reports crashed `maude design serve` on a clean machine immediately:

  ```
  ⚠ first-boot: installing runtime deps (one-time, ~15s)…
  ENOENT: no such file or directory, posix_spawn 'bun'
  ```

  **Root cause:** the boot self-heal, http route resolver, and runtime-bundle synthetic-entrypoint anchor all used `dirname(fileURLToPath(import.meta.url))` to find the dev-server install dir. In a `bun --compile` standalone binary that resolves to the **virtual** `/$bunfs/root` — bun's embedded filesystem — NOT a real disk path. Every `existsSync` check against it returned false, self-heal false-triggered, tried to `bun install` + `bun build`, ran into PATH inheritance issues in the spawned subprocess, and crashed. Even users who DID have bun installed hit this because compiled-binary spawn-context doesn't inherit shell PATH the same way subshells do. And even if the spawn HAD worked, npm install of the root `@1agh/maude` package never installs nested workspace deps (`plugins/design/dev-server/package.json`'s react/react-dom/etc.) — so the install target wouldn't exist either.

  **Three coordinated fixes:**

  1. **New `paths.ts` module** with `DEV_SERVER_ROOT`, `DIST_DIR`, `CLIENT_DIR`, `RUNTIME_BUNDLES_DIR` constants. Resolves the real disk path across all three runtime modes: (a) dev (`bun server.ts` — uses `import.meta.url`), (b) npm install (walks up from `process.execPath` past `@1agh/maude-<plat>/maude` to find `@1agh/maude/plugins/design/dev-server/`), (c) marketplace cache (same walk-up logic). Detects `/$bunfs/*` and `B:/~BUN/*` virtual paths explicitly. Falls back gracefully when nothing matches. Wired into `http.ts`, `runtime-bundle.ts`, `boot-self-heal.ts` (all consumers replaced).

  2. **Pre-built runtime bundles ship in `dist/runtime/<slug>.js`.** Every release build now also produces 6 minified bundles (react, react-dom, react-dom/client, react/jsx-runtime, react/jsx-dev-runtime, pixi.js — total ~1.1 MB minified). Committed to git via `.gitignore` negation pattern (same precedent as `client.bundle.js` per DDR-044). `runtime-bundle.ts` now checks `dist/runtime/<slug>.js` first and serves it directly with no Bun.build call. Dynamic build remains as fallback for dev mode. This eliminates the runtime dependency on disk `node_modules/react` entirely — npm installs no longer need anything beyond what the tarball ships.

  3. **`boot-self-heal.ts` radically simplified.** Dropped the `bun install` + `bun build` attempt (rooted in the broken assumption about paths and the wrong premise that npm would install nested deps). Now just verifies the two committed artifacts exist: `dist/client.bundle.js` and `dist/runtime/react.js`. If either is missing, prints a one-screen remediation with the looked-under path + the exact reinstall command. No more spawn, no more PATH issues, no more first-boot crashes — either the install is correct (passes silently) or it's broken (fails fast with actionable hint).

  **Verified end-to-end:** the simulated npm install layout (binary at `<tmp>/lib/node_modules/@1agh/maude-darwin-arm64/maude`, dist at `<tmp>/lib/node_modules/@1agh/maude/plugins/design/dev-server/dist/`) resolves correctly via `paths.ts` walk-up, server boots without self-heal warnings, and curl smoke against `/_client/*` and `/_canvas-runtime/*` returns 200 across all 6 runtime sub-bundles. Pre-existing 351-test suite still green; 5 new tests cover `paths.ts` resolution and the simplified self-heal behavior (8 → 5 tests, drop install/build path coverage that no longer applies).

  **Bundle size delta:** +1.1 MB committed (6 minified runtime bundles). Acceptable per DDR-044 precedent (committed artifacts > runtime dependency on disk + PATH that may not exist).

  No breaking changes — v0.18.0 users who happened to have everything aligned still work, and the failure path is now graceful rather than catastrophic.

- 4b8f35d: `fix(dev-server)`: paths.ts walk-up no longer requires package.json anchor

  v0.18.1 shipped `paths.ts` to resolve real disk install root via `process.execPath` walk-up — but the `isDevServerDir()` check required BOTH `http.ts` AND `package.json` to be present. Turns out npm excludes nested workspace `package.json` files from the published tarball by default, so `plugins/design/dev-server/package.json` is absent in every npm install. The walk-up silently fell through to the virtual `/$bunfs/root`, self-heal then reported `dist/client.bundle.js` and `dist/runtime/react.js` missing (against the virtual path), and printed an unhelpful reinstall hint to a user whose install was actually correct.

  Fix: drop the `package.json` check. `http.ts` alone is a sufficient anchor — process.execPath walk-up only traverses node_modules layers above the binary, so false-match risk from a stray `http.ts` somewhere in the user's tree is negligible.

  Verified end-to-end against a real npm install of v0.18.1: replaced the binary in `~/.nvm/.../node_modules/@1agh/maude/node_modules/@1agh/maude-darwin-arm64/maude` with the fix, ran `maude design serve` in a fresh scratch project, server booted without self-heal warnings, `/_client/client.bundle.js` + `/_canvas-runtime/react.js` + `/_canvas-runtime/react-dom_client.js` all returned 200. Greenfield `npm i -g @1agh/maude` is now actually clean.

  (Bonus deferred: `canvas-lib-resolver.ts` still uses `import.meta.url` for `fs.watch`, which logs a benign ENOENT warning against `/$bunfs/root/canvas-lib.tsx` in compiled binaries — doesn't block boot but should adopt `paths.ts` in a follow-up.)

## 0.17.2

### Patch Changes

- 4ad09d6: **fix(dev-server): work around Bun 1.3.4+ `--compile` NAPI embedding regression**

  Every `@1agh/maude-<slug>` binary published since v0.17.0 crashed on startup
  with `Cannot find native binding ... oxc-parser/src-js/bindings.js:575`. Root
  cause: Bun 1.3.4 introduced a regression in `bun build --compile` that no
  longer embeds NAPI-RS platform sub-package bindings (the
  `@oxc-parser/binding-<slug>/parser.<slug>.node` asset). Bun 1.3.3 worked;
  1.3.4 through 1.3.14 (the version `setup-bun@v2` shipped to CI) all break the
  same way. Confirmed via bisect.

  The fix is a build-layer workaround that keeps oxc-parser intact (no parser
  swap, no perf regression, no edits to `canvas-pipeline.ts` /
  `canvas-edit.ts` / `canvas-lib-inline.ts` / `handoff.ts`):

  - `build.ts:writeCompileEntry(target)` generates two thin files per `--target`
    under `dist/.compile-entries/` (gitignored): an `init-oxc-<slug>.ts` leaf
    module that embeds the matching platform binding as an asset via
    `with { type: 'file' }` and sets `NAPI_RS_NATIVE_LIBRARY_PATH` from the
    resolved virtual path, then a `server-<slug>.ts` entry that imports the
    init module BEFORE `../../server.ts`.
  - NAPI-RS's `bindings.js` honors `NAPI_RS_NATIVE_LIBRARY_PATH` before its
    broken platform-detection switch, so the env-var setup bypasses the
    regression entirely.
  - All 7 `@oxc-parser/binding-<slug>` packages are now direct devDependencies
    of `plugins/design/dev-server/` so pnpm symlinks them at workspace level
    (Bun's bundler can't otherwise resolve them — pnpm hides them inside
    oxc-parser's nested node_modules as transitive optionalDependencies).
  - New `test/compile-entry.test.ts` (6 tests, 62 expectations) locks the
    generator's contract: per-target file paths, init-before-server import
    order, POSIX path separators, idempotence.

  See DDR-042 for the full options matrix (why not babel, why not subprocess,
  why not external + ship). Upstream Bun issue filed (draft in
  `.ai/dev-logs/upstream-bun-issue-draft.md`) — when fixed upstream, the entry
  stub generation can be removed.

- a6c76b0: **fix(cli): make `maude design serve` work when postinstall was skipped**

  `runServe` now resolves the platform binary lazily when the side-channel file
  (`cli/.platform-binary-path`) is absent — looks up the sibling `@1agh/maude-<slug>` package via filesystem + `require.resolve`, then caches the result.
  Postinstall becomes an optimization, not a correctness requirement, so global
  installs under Bun (no postinstall by default), `npm --ignore-scripts`, pnpm
  strict-scripts, and Docker layer rebuilds work the same as a vanilla
  `npm i -g @1agh/maude`.

  When no binary is available **and** we're not in a local source checkout
  (`packages/maude-darwin-arm64/` marker), the dispatcher hard-fails with an
  actionable hint (clean reinstall recipe + `npm rebuild` alternative) instead of
  falling through to `bun run server.ts` and crashing on missing `magic-string`
  or `oxc-parser` native bindings — those `node_modules` are not in the
  published tarball.

  In a local dev tree the source fallback is preserved, but a pre-flight check
  verifies `magic-string` and `oxc-parser` are resolvable first and surfaces a
  `pnpm install` hint instead of a cryptic stack trace if they're not (catches
  the npm optional-deps native-binding bug, npm#4828).

  Adds `MAUDE_FORCE_SOURCE=1` env override so maintainers hacking on
  `plugins/design/dev-server/` can skip the binary and run from source.

## 0.17.1

### Patch Changes

- 4a0d6ab: Fix: `bun build --compile` of the dev-server standalone binary failed for all 7 platforms in v0.17.0 because `exporters/pptx.ts` did `await import('playwright')` directly. Bun's compile is greedy and pulled in `chromium-bidi/lib/cjs/bidiMapper/BidiMapper` + `cdp/CdpConnection`, which it can't resolve at compile time.

  The other five exporters (png/pdf/svg/html/canva) already avoid this by spawning `bin/_*-playwright.mjs` as a `node` subprocess. PPTX was the anomaly: it ran a one-shot `chromium.launch()` inline to enumerate `[data-dc-screen]` IDs for canvas-as-separate merge.

  Fix: extract the enumeration into `bin/_enumerate-artboards-playwright.mjs` (new shim that prints one ID per line on stdout) and spawn it via `Bun.spawn(['node', ...])`. Matches the existing subprocess pattern, keeps playwright + chromium-bidi out of the compiled binary graph.

  Locally verified: `bun run build.ts --release` succeeds (162ms compile, 293 modules), 334/334 dev-server tests pass, biome clean.

## 0.17.0

### Minor Changes

- 63bb9fb: Video pipeline infrastructure (phase 15.1) — Remotion workspace under `scripts/video/final/` with nested deps + TikTok-style captioning pipeline + animation libraries + golden-frame regression harness + scaffolder + CSS motion guard + VHS tape discipline + visual QA workflow.

  What ships:

  - **`scripts/video/final/`** standalone Remotion workspace (own `package.json`, `tsconfig.json`, `remotion.config.ts`, Studio entry). Remotion + React deps move out of repo root.
  - **Cherry-picked TikTok captioning** at `src/lib/captioned-clip/` (`Page.tsx` + `SubtitlePage.tsx` + `<CaptionedClip>` wrapper) backed by `@remotion/install-whisper-cpp` + `sub.mjs` build-time pipeline. Caption JSON is editable for Whisper mistranscriptions.
  - **Animation libraries** re-exported through `src/lib/animated/` (`remotion-bits` + `remotion-animated`) — `<AnimatedText>`, `<Animated by={[Fade, Move, Scale]}>` etc. on one import surface.
  - **Reusable capture wrappers** at `src/lib/capture-frames/` — `<TerminalFrame src=...>` (VHS-captured terminal in shadowed inset) + `<BrowserChrome src=... urlBar=...>` (Playwright capture in mock browser chrome with traffic lights + URL bar).
  - **Golden-frame regression harness** (`__tests__/frame-regression.test.ts`) via `@remotion/renderer` `renderStill()` + `pixelmatch`. 18 baseline PNGs cover 6 compositions × 3 frames each.
  - **Visual QA workflow** — `pnpm run qa` renders a composition, extracts 12 evenly-spaced JPGs, builds a 4×3 contact sheet. Agent-readable paths (`QA_FRAME <path>`) + human-eyeballable PNG. Mandatory before delivering a final cut.
  - **CSS motion guard** (`scripts/check-css-motion.sh`) catches `transition:` / `animation:` in inline styles — the documented Remotion footgun that produces broken frames.
  - **VHS tape discipline** — `tapes/_TEMPLATE.tape` canonical template with 1280×720 canvas + Hide+clear+Show pattern baked in; `scripts/check-tape-discipline.sh` lints `tapes/*.tape` for both gotchas. Run via `pnpm run lint:tape`.
  - **`/flow:video-new-scene` scaffolder** — `<scene-id> <duration> "<caption>"` → generates scene folder + Root.tsx composition entry + storyboard row. Idempotent (`--force` to overwrite).
  - **Music manifest scaffold** at `scripts/video/music/MANIFEST.md` — placeholder structure + curation guidelines (Pixabay / FMA / Mixkit), license URL mandatory per track.
  - **DDR-036** records the architectural decisions + the three real-assembly gotchas (VHS Hide buffer leak, Playwright viewport mismatch, why per-scene goldens can't regress captures).
  - **Phase 15.5 plan** banner injection so it picks up the new infrastructure.

  Out of scope / deferred:

  - Real CC0 music track curation (manifest is placeholder).
  - Whisper.cpp model download smoke (~466 MB) — captioning tested with hand-crafted Caption JSON.
  - GitHub Actions video-render workflow (user explicitly opted out; deferred design in plan).
  - Phase 15.5 task-list rewrite (banner is enough; the user already rewrote it on a separate track).

  Infrastructure-only release — no user-facing CLI / dev-server / plugin behavior change.

- 799d939: Phase 6.5 — Canvas export (UI-first, multi-format, scope-aware). One export dialog covers seven formats × four scopes from the canvas UI plus a matching CLI subcommand.

  What ships:

  - **`/design:export` slash command** and **`maude design export`** CLI subcommand — same flag surface (`--format`, `--scope`, `--out`).
  - **In-canvas Export dialog** (`plugins/design/dev-server/export-dialog.tsx`) wired into canvas-shell and the floating chrome.
  - **Seven formats**: PNG, PDF, SVG, HTML (self-contained), PPTX, Canva (handoff PPTX + MCP-ready prompt file per [feedback-mcp-prompt-over-oauth-scaffolding](../memory/feedback-mcp-prompt-over-oauth-scaffolding.md)), ZIP bundle.
  - **Four scopes**: active artboard, active screen, active canvas, all canvases in current DS.
  - **Exporter pipeline** under `plugins/design/dev-server/exporters/` — playwright-driven PNG/PDF/SVG/HTML/PPTX renderers + scope resolver + browser-bundle reuse + history recorder.
  - **Server API** `POST /export` on the dev-server (`http.ts` + `api.ts`) with history persisted under `<designRoot>/_history/_exports/`.
  - **DDRs**: DDR-038 SVG via foreignObject, DDR-039 PPTX via pptxgenjs (superseded), DDR-040 Canva via PPTX + MCP prompt, DDR-041 v2 mature-libraries world reset.
  - **Tests**: 7 bun:test suites under `plugins/design/dev-server/test/exporters/` covering scope resolution, endpoint contract, history, Canva handoff, PPTX render. 334/334 green.

  User-visible: new commands, new dev-server dialog, new on-disk artifacts under `_history/_exports/`. No breaking changes to existing canvas / dev-server APIs.

### Patch Changes

- 799d939: Dev-server floating chrome: unify menubar / statusbar / tool-palette / annotations toolbar onto the `mb-dropdown` brand stamp and block the native context menu over canvas surfaces.

  - Right-click on canvas / iframe / floating chrome now always opens `.dc-context-menu` instead of the browser's native menu (which was leaking on top of, or instead of, our menu).
  - Inputs, textareas, and `contentEditable` elements keep the native context menu so copy / paste still works.
  - Visual: floating chrome surfaces share the same SKU-stamped dropdown skin (`annotations-context-toolbar`, `annotations-layer`, `canvas-lib`, `context-menu`, `tool-palette`, `inspect.ts`, `server.mjs`).

## 0.16.0

### Minor Changes

- 462e95b: design: in-place FigJam-style comments — pins, composer, thread popover, @mention autocomplete

  The comment composer + chip strip moved off the shell BottomBar and into the canvas iframe itself. Clicking an element in the Comment tool now opens a small DS-styled composer bubble anchored to the click point; pins render as 24×24 accent-fill badges at the target element's top-right corner; clicking a pin opens a thread popover with replies, resolve / reopen / delete, and an `@`-trigger autocomplete fed by the local repo's `git shortlog`.

  Schema additions (back-compatible — legacy comments default-fill on read, persist on next write):

  - `Comment.author` — defaults to `git config user.name` at create time
  - `Comment.thread: Reply[]` — `{ id, author, body, created }`
  - `Comment.mentions: string[]` — `@handle` tokens parsed across body + thread

  New HTTP endpoints (Bun runtime, per DDR-009):

  - `POST /_api/comments/<id>/reply` — append to thread, fold @mentions into the union
  - `GET /_api/git-committers` — committer list for the @mention popup, cached 60 s server-side

  Architecture: the overlay renders as a `position: fixed` sibling of `.dc-canvas` (NOT portaled into `.dc-world`) so its z-index actually competes with `SelectionHalos`. Pins stay 24 px at every zoom level, FigJam-style. See [DDR-034](.ai/archive/decisions/DDR-034-comments-overlay-screen-coord-fixed-position.md) for the architectural rationale.

  A11y: comment pin is a `<button>` with `aria-label`; thread popover is `role="dialog"` with focus management + Esc-to-close + focus-restore to the originating pin; mention popup uses the WAI-ARIA combobox-with-listbox pattern.

- c9278b2: **Project renamed `md-claude` → Maude.** Atomic rebrand across the npm package, GitHub repo, Claude Code marketplace, CLI binary, dev-server runtime, docs site, and self-dogfooding directories. See [`docs/MIGRATING-MD-CLAUDE-TO-MAUDE.md`](../docs/MIGRATING-MD-CLAUDE-TO-MAUDE.md) and [DDR-032](../.ai/archive/decisions/DDR-032-rename-md-claude-to-maude.md).

  User-visible changes:

  - **npm**: `@1agh/md-claude` → `@1agh/maude`; 7 per-platform sub-packages renamed in lockstep (`@1agh/maude-<slug>`). The old package was unpublished within npm's 72h grace window — `npm i -g @1agh/md-claude` now 404s.
  - **GitHub**: repo `1aGh/md-claude` → `1aGh/maude` (GitHub 301-redirects raw URL fetches; marketplace install needs to be re-added by hand because the marketplace `name:` field changed).
  - **CLI**: primary bin is `maude` (`maude init`, `maude config`, `maude design serve`). The legacy `mdcc` bin still ships as a deprecation-warning shim and will be removed in v0.17.x. Same for `mdcc-safe` → `maude-safe`. `MD_CLAUDE_SKIP_POSTINSTALL` env var renamed to `MAUDE_SKIP_POSTINSTALL` (old name accepted one cycle).
  - **Marketplace install syntax**: `flow@md-claude` → `flow@maude`, `design@md-claude` → `design@maude`.
  - **Canvas-lib virtual specifier**: `@mdcc/canvas-lib` → `@maude/canvas-lib`. TSX canvases must update their import statements; the dev-server resolver no longer matches the old name.
  - **Workspace scopes** (internal pnpm): `@md-claude/site`, `@md-claude/dev-server`, `@md-claude/hub` → `@maude/*`.
  - **Docs site canonical host**: `maude.sh` (DNS + Vercel wiring is a post-merge maintainer task).

  Intentionally preserved as internal namespaces (DDR-032 sub-decision 2): CSS class identifiers `.mdcc-*`, CSS custom properties `--mdcc-*`, the `site/components/mdcc/` path, the `~/.config/mdcc/` XDG config directory, and `site/app/mdcc-tokens.css`.

- 591f9a8: flow: Add security review subagents — defender (`security-auditor`) for OWASP-class static scans + attacker (`ethical-hacker`) for adversarial threat modeling including AI/MCP attack surface (prompt injection, MCP tool poisoning, confused-deputy, the trifecta). New skill `security-rules` (67 hard-stops across classic + AI-era), new command `/flow:validate-security`, and hooks into `/flow:validate` (step 6.5), `/flow:review-code`, `/flow:done`. New config: top-level `security.{severityFloor,scope,includeAi}` + `skills.securityRules.enabled` (defaults sane; downstream projects get it for free via `mdcc init`).
- 2c90eb1: **`/design:setup-ds` rewritten as 3-stage discovery (Vision → Research → Refinement).** Replaces the v1 12-question fixed dotazník (3 rounds — Identity / Brand / Pro-designer) with a conversational small-step flow that moves from abstract to concrete the way a human designer talks to a stakeholder. See [DDR-033](../.ai/archive/decisions/DDR-033-three-stage-discovery.md) for full reasoning.

  User-visible changes:

  - **Stage 0 — Scope gate.** One picker (`market` / `internal` / `personal` / `oss`) up front, steers Stage 1 wording + post-scaffold aspiration target. The only hardcoded picker in the whole flow.
  - **Stage 1 — Vision.** 11 conversational free-text prompts in 3 batches (PŘÍPRAVA · PROSTOR · DUŠE), emitted as plain prose chat messages with one example per prompt. `skip` is always a valid answer. Output = rich `vision-brief.json`. Pastier's framework (Zrcadlo · Facka · Ulice · Kmen · Zkratka · Charakter · OST) templates the prompts but is invisible in the UI.
  - **Stage 2 — Research.** `ux-research-agent` now receives the full vision-brief (was: one-liner). Returns the existing `discovery` payload plus a new `recommendations` block with `{recommendation, alternatives[], confidence, rationale}` per design decision (palette / typography / signature_treatment / majak_3_codes / density / voice). Pastier probe templates live at `plugins/design/skills/design-system/_pastier-probe-templates.md`.
  - **Stage 3 — Refinement.** Adaptive 0–N AskUserQuestion picks driven by confidence: `≥ 0.85` SKIP / `0.60–0.85` ASK with pre-pick / `< 0.60` ASK without pre-pick. Maják 3-code combination is always a Stage 3 Q. **Zero hardcoded fallback ladders** — if research fails entirely, flow STOPS (re-run / abort), no degradation.
  - **`<brief>` argument shortcut.** Rich `/design:setup-ds <name> "<paragraph>"` invocations pre-fill matching vision-brief fields and skip those Stage 1 prompts (each skip printed inline so user can correct).
  - **`--quick` semantics.** Now collapses Stage 1 to 4 prompts (P1 + P5 + P8 + P10) instead of skipping pre-DDR-033 Round 3.
  - **Post-scaffold critic panel rebranded as "4 kola značky"** (rename only, no agent-code changes): **Kolo 1 — Srozumitelnost** (completeness + a11y), **Kolo 2 — Atraktivita** (graphic-design + signature-moment), **Kolo 3 — Konzistence** (typography + brand + copy). Pastier's fourth kolo (Frekvence) is dropped — outside DS surface.

  Re-bootstrap of existing DSes is lossy on Stage 1 fields (existing DSes don't carry `vision-brief.json`); skill infers from README + tokens + `_layout.css`, user confirms / corrects in a single chat message before Stage 2 runs. `--force` always re-runs Stage 2.

  v1 reference preserved at `plugins/design/skills/design-system/_DISCOVERY-v1.md` for a transition window.

### Patch Changes

- ce72771: flow: Brownfield testing onboarding — three opt-in/advisory additions to make the flow plugin friendlier on existing repos with no test runner or thin coverage. (1) `flow:test-coverage` subagent gains `path <glob>` and `branch` scope modes alongside the existing `diff` default — unblocks brownfield audits like "audit `apps/api/auth/`" without abusing the diff mode; path/branch reports are framed as advisory (no "blockers" count). (2) `/flow:init` Step 2c surfaces a stack-appropriate test-runner recommendation when detection returns `tests=unknown` (vitest for Next/Vite, jest for Expo, pytest, go-test, cargo-test, JUnit) — recommendation only, no scaffolding. (3) `/flow:done` Step 7a refreshes `.ai/state/coverage-baseline.json` on the configured `baselineBranch` (default `main`) when `skills.coverageTrend.enabled` — pairs with the coverage-trend warning already in `/flow:validate` Step 2a. All three are opt-in / advisory by design; the testing-rules iron law still owns greenfield TDD discipline.
- 38de33e: chore: Set up agentic video pipeline toolchain in `scripts/video/` (repo-only, not published to npm). Installs Remotion 4 + VHS 0.11 + Playwright 1.60 + ffmpeg 8.1 and proves they integrate via `pnpm run video:smoke` — a ~13s stitched proof clip (VHS terminal scene + Playwright dev-server canvas + Remotion smoke card, normalized + concatenated). Adds `scripts/video/README.md` runbook + DDR-031 documenting the toolchain choice (rejects custom bash pipeline; ~50–60% less code than the original hand-rolled ladder). Refactors the follow-up plan (`.ai/plans/phase-15.5-marketing-demo-video-30s.md`) to consume the new declarative stack. No user-visible behavior change — this lands the infrastructure the next phase needs to author the 30s marketing demo.

> Renamed from `@1agh/md-claude` in v0.15.0. See [`docs/MIGRATING-MD-CLAUDE-TO-MAUDE.md`](docs/MIGRATING-MD-CLAUDE-TO-MAUDE.md). Historic entries below reference the old name as a matter of record.

## 0.15.0

### Major Changes

- **Project renamed `md-claude` → Maude.** Atomic rebrand across npm, GitHub repo, marketplace, CLI, dev-server, site, docs, and self-dogfooding directories. See [DDR-032](.ai/archive/decisions/DDR-032-rename-md-claude-to-maude.md) and the [migration guide](docs/MIGRATING-MD-CLAUDE-TO-MAUDE.md).
- **npm**: `@1agh/md-claude` → `@1agh/maude` (old package unpublished within 72h window). 7 per-platform sub-packages renamed in lockstep (`@1agh/maude-<slug>`).
- **GitHub**: repo `1aGh/md-claude` → `1aGh/maude` (301 redirect preserved).
- **CLI**: primary bin is now `maude` (`maude init`, `maude config`, `maude design serve`). The legacy `mdcc` bin still works as a deprecation-warning alias and will be dropped in v0.17.x. `MD_CLAUDE_SKIP_POSTINSTALL` env var renamed to `MAUDE_SKIP_POSTINSTALL` (old name accepted for one cycle).
- **Marketplace**: `/plugin marketplace add 1aGh/md-claude` → `/plugin marketplace add 1aGh/maude`. Plugin install syntax changed: `flow@md-claude` → `flow@maude`, `design@md-claude` → `design@maude`.
- **Workspace scopes**: internal pnpm workspaces `@md-claude/site`, `@md-claude/dev-server`, `@md-claude/hub` renamed to `@maude/*`.
- **Domain**: docs site canonical host moved to `maude.sh` (DNS + Vercel wiring done in post-merge step).
- **Canvas-lib virtual specifier renamed**: `@mdcc/canvas-lib` → `@maude/canvas-lib`. Any TSX canvas under a downstream `.design/` directory must update its `from "@mdcc/canvas-lib"` imports to `from "@maude/canvas-lib"` — the dev-server resolver no longer matches the old name.
- **Intentionally preserved as internal namespaces** (per DDR-032 sub-decision 2): CSS class identifiers `.mdcc-*`, CSS custom properties `--mdcc-*`, `site/components/mdcc/` paths, and the `~/.config/mdcc/` XDG config path.

## 0.14.0

### Minor Changes

- b069b9d: **Design plugin — dev-server sidebar restructure: sidecar nesting, per-DS folders, section toggles.**

  - **VS Code-style sidecar grouping.** `.tsx` canvases are the primary tree rows; `.meta.json` / `.css` / `.registry.json` siblings collapse under a disclosure chevron. Multi-extension match keeps `Foo.meta.json` correctly grouped with `Foo.tsx`. Canvas extensions are stripped in row labels, menubar status, and comments-panel group headers.
  - **Per-DS folders inside DESIGN SYSTEM section.** Every entry in `cfg.designSystems` renders as its own folder (`project`, `beta`, …) regardless of single- vs. multi-DS. Folder name opens SystemView for that DS; chevron toggles disclosure. Server emits `dsFolders[]` on the DS group so the client knows which dirs are DS roots.
  - **Every section is expandable.** `PROJECT`, `DESIGN SYSTEM`, `UI CANVASES`, and `RUNTIME` headers are all unified `section-toggle` buttons. Per-section open/collapsed state persists in one `mdcc-sections-expanded` localStorage key. Defaults: working sections (Project, UI canvases) open; meta sections (DS, Runtime) collapsed.
  - **View › Show hidden files (`H` shortcut).** Off by default — hides sidecars, the RUNTIME section, orphan project files, and DS-level docs (`README.md`, `SKILL.md`, `colors_and_type.css`). On reveals everything plus per-canvas chevrons for sidecar disclosure.
  - **DS pill counts DSes** (`pillFromDsCount`), replacing the hardcoded `MDCC-DSN/01` SKU stamp from the CV-08 mock. Multi-DS configs show `2`, `3`, ….
  - **Server `stripPrefix` redesign.** Flattens `.design/` for PROJECT/RUNTIME and `.design/<group.path>/` for canvas groups. DS folders surface as top-level dirs instead of the redundant `system/project` chain.
  - Removed the "Design system view" entry from the View dropdown — redundant with per-DS folder click + existing `S` shortcut.
  - Sidebar open/closed state now persisted (`mdcc-sidebar-open`).

- 5d9292e: **Design plugin — Phase 3.6.1: canvas envelope hygiene, reusable canvas-lib, HMR, and DS specimens as TSX.**

  - **`@maude/canvas-lib`** — shared canvas library (`<designRoot>/_lib/canvas-lib.tsx`) resolved virtually at build time. Ships the frame envelope (`DesignCanvas`, `DCSection`, `DCArtboard`, `DCPostIt`), specimen helpers (`SpecimenHeader`, `SpecimenMeta`, `TokenChip`, `ColorSwatch`, `TypeScaleRow`, `KbdHint`, `ThemeToggle`) and hooks (`useTokens`, `useTheme`, `useArtboardBounds`). Authored once, imported by canvases and specimens — `/design:handoff` inlines used exports per-canvas so the emitted registry-item stays self-contained.
  - **HMR** — `fs-watch` change events now broadcast `canvas-hmr` messages over the existing inspector WebSocket. CSS sibling edits hot-swap via `<link>` cache-bust; `_lib/**` edits trigger hard iframe reload; canvas `.tsx` edits do a module reload. Target p50 < 200 ms click-to-paint, p99 < 400 ms.
  - **DS specimens are now TSX**, not HTML. `/design:setup-ds` scaffolds bare-TSX specimens via the new `ds-specimen.tsx.template`; the `design-system-completeness-critic` and `design-system-keeper` agents read `.tsx`. The legacy `system/<ds>/preview/*.html` set is archived under `_history/_migration-2026-05-15/`.
  - **`/design:edit` Step 1.5** now also pre-loads `<designRoot>/_lib/canvas-lib.tsx` for every `.tsx` canvas so iteration prompts see the authoring vocabulary instead of re-inventing helpers.
  - **Fixes** the white-page regression in `Docs Site.tsx` / `Canvas Viewport.tsx` introduced by the Phase 3.6 codemod (which referenced `<DesignCanvas>` JSX identifiers that were undefined in TSX-land) and rebuilds `Smoke TSX.tsx` against the new envelope.
  - Adds `canvas-lib-resolver`, `canvas-lib-inline`, and `hmr-broadcast` modules to `plugins/design/dev-server/` with full Bun-test coverage.

- 0122207: **Design plugin — Phase 4.1: universal canvas input grammar (DDR-026).**

  Every TSX canvas now ships with the same infinite-canvas affordances out of the box — no opt-in flag, no two-grammar split. Replaces the Phase-4 Cmd-only inspector overlay selection path.

  - **Three canvas tools.** `V` Move (default), `H` Hand, `C` Comment — bottom-left floating ToolPalette + letter-key shortcuts. Scoped to canvas-iframe focus (don't collide with shell shortcuts).
  - **Selection grammar.** `Cmd + hover` previews the deepest element under cursor. `Cmd + click` selects (replace). `Cmd + Shift + click` adds to a multi-selection (dashed group bounding box renders around the union). Bare hover / click pass through — native interactions (button presses, link clicks, input focus) still work in Move tool. Selection halos render as `position: fixed` overlays in screen coords, so 2 px stays 2 px regardless of zoom level.
  - **Hand tool.** Bare drag pans the world — no Space required. Cursor forced to `grab` across every descendant (overrides element-level `cursor: pointer` declarations on buttons / links).
  - **Comment tool.** Hover paints a preview halo on the element under cursor. Click commits that element to the selection set AND opens the shell-side composer for it; the halo persists until Submit / Cancel / Esc. Native interactions on artboard children are fully suppressed via capture-phase `preventDefault + stopImmediatePropagation` — buttons / inputs don't activate while in comment mode.
  - **Right-click context menu.** Element / artboard chrome / world contexts. Items include `Add comment`, `Copy CSS`, `Copy data-cd-id`, `Hide`, `Deselect`, `Fit just this artboard`, `Fit to view`, `Reset view`. Full keyboard navigation (Arrow Up/Down / Enter / Esc), shortcut hints right-aligned in monospace.
  - **Active-artboard indicator.** Subtle 1 px tinted accent ring on the artboard closest to the viewport center — marks the `/design:edit` context anchor without competing with selection halos.
  - **`_active.json#selected` schema widening.** Now accepts `SelectedElement | SelectedElement[] | null`. Writer collapses single-entry arrays to a bare object for back-compat with `/design:edit` and handoff tooling. Reader (`normalizeSelectedRead`) accepts all three shapes.
  - **Inspector overlay slimmed to comment-pin renderer.** The legacy Cmd-hover / Cmd-click selection path (`.dgn-insp-hover` / `.dgn-insp-selected` cyan outline) is removed. Only `.dgn-pin*` styles + the `comments-set` / `comment-focus` message handlers remain. Comment pins still render on legacy `.html` mocks and on TSX canvases equally.
  - **Shell `.sel-halo` wrap removed.** The pre-Phase-4 2 px accent border that wrapped the entire iframe is gone — element-level halos in canvas-shell are the only selection visual now.

  **Decision evolution.** First draft of Phase 4.1 landed an opt-in `inputMode="figjam"` prop on `DesignCanvas`. After live smoke tests the decision flipped to universal grammar (visual-inconsistency feedback: cyan-with-label inspector overlay vs accent-no-label new router) + naming directive (`figjam` removed from public API). The full alternatives history lives in DDR-026.

  **No new dependencies.** All new modules are sibling files under `plugins/design/dev-server/`. Tree-shake-on-handoff still works via `canvas-lib-inline.ts` AST walker — drops carry the canvas-shell code as inlined source.

  `bun test` 185/185, 0 fail (133 baseline + 52 new tests across `input-router`, `use-tool-mode`, `use-selection-set`). `bunx tsc --noEmit` clean of new errors. Canvas-build smoke against Canvas Viewport / Docs Site / Smoke TSX all return 200 with consistent canvas-shell wiring.

- a771d04: **Design plugin — Phase 4.2: free-form artboard repositioning (DDR-027, DDR-028).**

  Artboards on the infinite canvas are now spatially editable. Phase 4 shipped the persistence infra; 4.2 plugs the drag-to-reposition UI surface into both that infra and the Phase 4.1 selection-set + tool-mode grammar.

  - **Drag the artboard chrome** (label strip + outer border) while the Move tool is active. Inner content stays click-through, so Cmd+select still works through it.
  - **Multi-select drag.** When the selection-set contains multiple artboard roots, dragging any one moves all selected artboards rigidly together — relative offsets captured at drag-start and preserved through snap.
  - **Snap-to-grid + snap-to-sibling.** 40 world-unit grid + 8 world-unit tolerance to other artboards' left / right / center on X (and top / bottom / center on Y). 1 px guide lines render at the snapped position in `--accent`. Independent per axis (X can snap to a sibling and Y to the grid simultaneously).
  - **Hold Alt to disable snap.** Per-pointermove modifier read; release Alt and guides reappear on the next move.
  - **Ghost preview.** Original artboards mute to opacity 0.3 (`.dc-dragging`); a semi-transparent clone at opacity 0.5 (`.dc-artboard-ghost`) follows the snapped cursor position. Drop commits.
  - **4 px click-vs-drag classifier.** Below threshold → label `onClick` fires (Phase 4 pan-to-focus regression-clean). At/above → drag starts, the synthetic click is suppressed via a one-shot capture-phase listener.
  - **Persistence on drop.** PATCH `meta.layout.artboards[]` via the existing `patchCanvasMeta` writer. Reload restores positions.
  - **Position-only writes (DDR-027).** The writer strips `w` / `h` from layout payload — artboard size is JSX-authoritative now. The reader still tolerates legacy entries with `w` / `h` for back-compat with Phase 4 default-grid snapshots; the next drag organically migrates them to position-only entries.
  - **Snap tolerance in world units (DDR-028).** Tolerance scales with the layout, not the screen, so snap feel stays consistent across zoom levels. `useSnapGuides` is a pure zoom-agnostic function.
  - **Cursor swap.** `grab` on label hover when active tool is `move`; `grabbing` during drag. Wired via the existing `.dc-canvas[data-active-tool="move"]` projection.

  **New modules.** `use-snap-guides.tsx` (pure snap math, 20 table tests) · `use-artboard-drag.tsx` (state-machine reducer + DOM hook, 20 unit tests) · `SnapGuideOverlay` export from `canvas-lib.tsx` mounted by `CanvasShell`.

  **Bug fixes (caught during visual smoke + code review + post-merge dogfooding).**

  - The reader in `DesignCanvasInner.artboards` `useMemo` previously replaced default-grid entries wholesale with meta entries. Once 4.2 writers started emitting position-only `{ id, x, y }`, the replace left `w` / `h` undefined → artboards rendered at 0×0. Reader now merges meta over defaults instead of replacing.
  - The drag hook used to call `setPointerCapture` on the outer article on pointerdown. That redirected the synthetic `click` event to the captured ancestor, breaking the label button's `onClick` → Phase 4 pan-to-focus regression. Capture removed; global window-level pointermove/up listeners (capture: true) carry the drag without it.
  - `selectedIds` in the drag hook fell back from `Selection.id` (a child element's `data-cd-id`) to `Selection.artboardId`. That pulled stray child cd-ids into the multi-drag identity set and silently disabled multi-artboard drag. New `selectionsToArtboardIds` helper now keys on `artboardId` only; covered by a regression test.
  - Drag commits PATCH'd the server but the local React state stayed frozen — users had to switch canvases to "see" the dropped artboard at its new position. `DesignCanvasInner.artboards` converted from `useMemo([seeds])` to `useState` with optimistic update on commit. Drop now reflects instantly in the DOM without an iframe reload.

  **Handoff regression-clean.** Drag + snap exports (`useArtboardDrag`, `SnapGuideOverlay`, `computeSnap`, `useSnapGuides`, `DragStateContext`) never travel into a handed-off registry item — the static-frame overrides for `DesignCanvas` / `DCArtboard` / `DCSection` break the transitive chain, pinned by 2 new tests in `handoff-static-frames.test.ts`.

  **Schema.** `canvas-meta.schema.json#layout.artboards[].required` narrows from `["id","x","y","w","h"]` to `["id","x","y"]`. `w` / `h` remain in `properties` as legacy read-only fields.

  `bun test` 239/239, 0 fail (baseline + 44 new across snap + drag + 1 canvas-meta-api + 2 handoff). `bunx tsc --noEmit` clean of new errors. Scenario `canvas-artboard-drag` authored at `.ai/scenarios/canvas-format-tsx/canvas-artboard-drag/spec.md`; manual web-desktop end-to-end smoke confirmed drag → snap → drop → reload round-trip with pin artboard at `{x: 1200, y: 1200}` post-reload, plus the post-merge instant-update fix (pin moved from `(0, 900)` → `(1414, 1400)` with DOM reflecting the change immediately on pointerup, no reload).

- 54dbe87: **Design plugin — Phase 4: canvas v2 infinite-canvas engine.**

  Every `.tsx` canvas under `<designRoot>/ui/` becomes a transformable world plane — `DCArtboard` children are absolutely positioned in world coords, the whole scene pans and zooms behind a single transform. Pan/zoom state survives reloads. The dev-server shell stays editor-style (one canvas active at a time, file-tab toggle); the infinite-canvas engine lives **inside** each canvas runtime, not at the shell level.

  - **`DesignCanvas` is now a world plane.** Internal `.dc-canvas` + `.dc-world` structure, render-order default grid (3 cols × max-cell-width × max-cell-height, 80 px gutter), per-cell sizing so canvases with mixed-width artboards tile cleanly. Single-artboard canvases default to fit-to-screen — visually identical to pre-Phase 4 until the user pans / zooms.
  - **`useViewportController` hook** — wheel = 2D pan (Mac trackpad gives both axes), Shift+wheel = horizontal pan (axis-swap robust across browsers/OSes), Ctrl/Cmd+wheel and pinch = zoom around cursor (mathematically exact — the world coord under the cursor stays fixed). Space-hold + drag and middle-mouse drag both pan. Cmd+0 fit, Cmd+1 actual size, Cmd+= / Cmd+- zoom in/out, Cmd+Option+1..9 jump-to-artboard N. Reduced-motion respected.
  - **`DCMiniMap` + `DCZoomToolbar`** — bottom-right 196×132 floating map with click-drag pan; bottom-center −/%/+/fit/1:1 toolbar. Mounted by default; opt-out via `<DesignCanvas controls={{minimap:false, toolbar:false}}>`.
  - **`DCArtboard` label is a focusable `<button>`** — click smooth-pans + zooms to fit just that artboard in 240 ms (rAF ease-out cubic; reduced-motion = instant). Active-artboard indicator (`aria-current="true"` + accent ring) tracks the artboard closest to viewport center.
  - **`<file>.meta.json` persistence** — `canvas-meta.schema.json` extended with optional `layout` + `viewport`. New `/_api/canvas-meta` GET/PATCH endpoint shallow-merges blocks (clamps zoom, rejects non-finite, refuses paths escaping repoRoot). `_shell.html` injects `window.__canvas_meta__`. `onSettle` PATCHes back 500 ms after the last input. 5 new tests pin the contract.
  - **Handoff stays clean.** `applyHandoffStaticOverrides()` in `handoff.ts` swaps `DesignCanvas` / `DCSection` / `DCArtboard` for minimal static-frame variants in the libMap before the canvas-lib BFS — engine code (`useViewportController`, `DCMiniMap`, `DCZoomToolbar`, `WorldContext`, harvest+grid+fit helpers) never reaches the emitted registry item. 4 dedicated tests pin the contract.
  - **Crisp text at any zoom.** The world uses CSS `zoom: N` (layout-level re-flow → text re-rasterizes at target resolution) instead of `transform: scale(N)` (which upsamples a cached layer and produces visible pixelation past zoom ~1.5). Pan velocity stays constant in screen px regardless of zoom.
  - **Pixi.js v8 added to the canvas runtime importmap.** Lazy-bundled at `/_canvas-runtime/pixi-js.js` (1.7 MB, only fetched by canvases that `import 'pixi.js'`). Reserved for the DDR-024-deferred snapshot-to-texture path and high-end designer overlays — current canvases don't need it because CSS `zoom` solves the crispness problem.
  - **DDR-024** captures the perf-gate methodology (`.design/_lab/perf-100-artboards.tsx` reference workload, idle / 5s pan / 10s zoom on M1 MBA, ≥ 20 % uplift over CSS to authorize Pixi.js engine swap). Pixi.js bundle stays deferred until a user-side bench fills the Measurements block.
  - **`_lib/` HMR cache invalidation fix.** When `_lib/canvas-lib.tsx` changes, the in-memory canvas bundle cache is cleared so the iframe reload picks up the fresh build. Without this, the HMR hard-reload message reached the browser but served stale-mtime-keyed bundles.
  - **Slug round-trip fix** in `runtime-bundle.ts`: package names with `.` (like `pixi.js`) now map to slugs with `-` (`pixi-js`) so the URL extension stays unambiguous.

  `bun test`: 123 baseline → 139 with 16 new Phase 4 tests, all green.

- b24726a: **Design plugin — Phase 5.1: FigJam-style annotation overhaul + canvas chrome redesign.**

  The Phase 5 draw layer was write-once: pen/rect/arrow strokes worked, but you couldn't re-select, re-style, move, or delete what you'd drawn, the viewport stuttered, and the dev-server menubar's `View / Selection / Tools` items were inert. Phase 5.1 brings annotations close to FigJam, with a single centered canvas toolbar that replaces the three floating chrome pieces.

  **Annotation rendering**

  - **Portal architecture.** The annotation SVG renders **inside** `.dc-world` via `createPortal`, so the world's CSS `zoom` + `translate` propagate to strokes natively — zero-latency pan/zoom (Phase 5's one-frame shimmer is gone). The input layer is a separate transparent overlay portaled into the host (`.dc-canvas`); viewport gestures (space-pan, middle-mouse, wheel/pinch) coexist with draw mode without `stopPropagation`. See `DDR-029`.
  - **New shapes.** `O` activates the ellipse tool. Rect + ellipse both gain a **fill picker** ("none" + 6-color palette). Pen + arrow gain a **thin / thick** thickness chip (2 px / 6 px). Schema is back-compatible — Phase 5 SVGs round-trip cleanly.
  - **Text-in-shape.** Double-click a selected rect or ellipse → `<foreignObject>` editor opens centered in the shape's bbox. Type your label, `Esc` commits; reload preserves. Font size step (S / M / L) lives in the contextual toolbar.

  **Annotation selection + editing**

  - **Parallel selection store.** `AnnotationSelectionProvider` mirrors `use-selection-set` for stroke IDs. Move-tool bare click on a stroke selects (replace), Shift+click adds. `Cmd / Cmd+Shift` falls through to the existing element-selection path (Phase 4.1 escape hatch preserved). Element + annotation selection don't co-exist visibly.
  - **Marquee drag-select.** In Move mode, drag from empty world → screen-coord rectangle expands as you drag; on release every stroke whose bbox intersects gets selected (Shift = additive). Sub-4-px gestures fall back to "click on empty world → clear".
  - **Contextual floating toolbar.** Per-shape FigJam-style toolbar anchored above the selection union bbox. Color (always), fill (rect/ellipse), thickness (pen/arrow), font-size (text), delete (always). Fields show the intersection across multi-select. Mutations route through a lifted strokes store and trigger the same debounced PUT save as drawing.
  - **Move / nudge / delete.** Drag a selected stroke (or the group) → world-coord translate, persists on release. Arrow keys nudge 1 unit (`Shift` = 10). `Backspace` / `Delete` removes selection.

  **Canvas chrome redesign**

  - **Single centered bottom toolbar** replaces `ToolPalette` + `DCZoomToolbar` (the bottom-right pill). Icon-based buttons grouped into three pill segments: nav (V/H/C) · draw (B/R/O/A/E) · view (presentation toggle + zoom display). Adopts the dev-server menubar's visual language (8 px radius, soft shadow, hairline border) so canvas chrome and app chrome read as one product. New `canvas-icons.tsx` ships a dependency-free Lucide-style icon set.
  - **Color/fill/thickness chrome** sits **directly above** the tool toolbar (centered) when a draw tool is active. Stripped of the Phase 5 "Hide" + "?" buttons — presentation lives on the main toolbar, annotation shortcuts live in the menubar `Help` modal.
  - **Minimap** restyled to the same chrome family (8 px radius, 24 px shadow), unchanged behavior.
  - **Zoom popover** absorbs the legacy `DCZoomToolbar`'s four actions (Zoom In / Out / Fit / Actual Size). Opens above the toolbar with shortcut hints. `DCZoomToolbar` is kept exported for back-compat but no longer rendered by `DesignCanvas`.

  **Dev-server menubar bridge**

  - `View → Annotations` toggles visibility (replaces the disabled "Phase 5" tag).
  - New `Selection` dropdown: `Deselect all` / `Select all annotations`.
  - New `Tools` dropdown: every tool with its shortcut, click → activates inside the canvas iframe via the existing `dgn:*` postMessage channel.
  - `HelpModal` gains an **Annotation tools** section so all 11 shortcuts (B/R/O/A/E, V+click, V+drag, double-click, arrow nudge, Backspace, Shift+P) live in one searchable place.

  **Runtime + build**

  - `react-dom` is now its own runtime bundle (was aliased to `react-dom/client`, which omits `createPortal`). Importmap routes `react-dom` → `/_canvas-runtime/react-dom.js`. See `DDR-029`.
  - New annotation modules: `use-annotation-selection.tsx`, `use-annotations-visibility.tsx`, `annotations-context-toolbar.tsx`, `canvas-icons.tsx`.
  - New `.gitignore` rule for `.design/**/*.annotations.svg` (per-canvas review scratch is user-local, not source).
  - `bun test` 287/287 pass (+18 over Phase 5 baseline). `bunx tsc --noEmit` clean (modulo 2 pre-existing `api.ts` errors).
  - New scenario `canvas-annotations-figjam` (14-step web-desktop walkthrough); supersedes Phase 5's `canvas-annotations`.
  - `DDR-029` recorded — annotation overlay architecture (portal into world, large SVG dimensions, react-dom bundle split).

- cc0ba03: **Design plugin — Phase 5: draw / annotation tools.**

  Annotate any canvas without leaving the dev-server. Pen, rectangle, arrow, and eraser tools mount as a transparent SVG overlay per canvas, persist to `<designRoot>/<slug>.annotations.svg`, and respect the Phase 4.1 tool grammar (V/H/C still rule; B/R/A/E switch into draw modes).

  - **Four shapes.** Pen freehand (multi-point path), rectangle (drag-to-size, negative areas auto-normalize), arrow (line + tri head), eraser (click or drag — hit-tests every stroke shape, removes the topmost match).
  - **Per-stroke color** via a 6-swatch floating chrome (accent · amber · green · blue · purple · ink). Default to the DS accent. Swatch only visible while an annotation tool is active.
  - **World-coord storage.** Strokes are stamped in world coordinates and rendered via the live viewport published by `useViewportControllerContext`; `vector-effect="non-scaling-stroke"` keeps stroke widths pixel-thick across zoom.
  - **Persistence.** Debounced 200 ms PUT to new `/_api/annotations` endpoint (`GET ?file=<canvas>` → SVG body; `PUT { file, svg }` → 204). Server writes `<designRoot>/<slug>.annotations.svg` (1 MB cap, SVG content gate). Reload restores every stroke; each canvas owns its own file (cross-canvas isolation).
  - **Shortcuts.** `B` = pen, `R` = rect, `A` = arrow, `E` = eraser, `V` = back to move, `Esc` = also back to move + clears in-flight. `Shift+P` toggles presentation (hides the layer without writing). `Cmd+/` opens a native `<dialog>` shortcut sheet.
  - **Coexistence with Phase 4.1.** Cmd+click in any draw mode still routes through the input-router's element selection (escape hatch). Pointer events on annotation tools return `no-op` from the router so the SVG layer claims them natively; on non-draw tools the SVG is `pointer-events: none` and the full Phase 4 / 4.1 grammar passes through.
  - **Help dialog uses native `<dialog>`.** Auto-opened with `.showModal()`, dismissed by Esc or backdrop click. Backdrop styled via `::backdrop` so the scrim follows the modal's stacking context cleanly.

  **New modules.** `annotations-layer.tsx` (~640 LOC — overlay + chrome + state machine + persistence client). New helpers exported for unit tests: `penPathD`, `arrowHeadPoints`, `strokesToSvg`, `svgToStrokes`, `strokeHitTest`, `rid`.

  **Server surface.** `api.ts` adds `loadAnnotations` / `saveAnnotations`. `http.ts` adds the `/_api/annotations` route (`GET` / `PUT` / `POST`, returns 400 on non-SVG bodies, 405 on other methods, 1 MB body cap).

  **Tool grammar.** `Tool` union extends to `pen | rect | arrow | eraser` with the `isAnnotationTool()` helper. `DEFAULT_TOOLS` grows to 7 (V/H/C/B/R/A/E). `canvas-shell.tsx` extends the cursor projection (`crosshair` for pen/rect/arrow, `cell` for eraser).

  **Tests.** 30 new tests across `test/annotations-layer.test.ts` (pure helpers: path / head / hit-test / round-trip / escape) and `test/annotations-api.test.ts` (endpoint round-trip + validation gates). `bun test` 269/269 pass (+30). Existing input-router and use-tool-mode tests extend for the new tool set.

  **Scenario.** `canvas-annotations` authored at `.ai/scenarios/canvas-format-tsx/canvas-annotations/spec.md`; smoke piloted against `localhost:4399` via agent-browser (PUT/GET round-trip + reload-restore + cross-canvas isolation verified end-to-end; eraser + Shift+P / Cmd+/ noted as harness limitations covered by unit tests).

  **Known limitations (entry point for Phase 5.1).** Pan/zoom is blocked in draw mode (the SVG claims pointer events). Strokes can't be selected, moved, or restyled after commit. No ellipse tool, no inline text inside shapes, no background fill, single thickness. The Phase 5.1 plan at `.ai/plans/phase-5.1-annotations-figjam.md` covers all of these plus a canvas-chrome redesign (centered icon toolbar replacing the current bottom-left palette).

### Patch Changes

- bf3b399: **Design plugin — Phase 4.0.5: canvas-lib single source in dev-server (DDR-025).**

  Internal refactor — zero behavior change for canvas authors (handoff drop is byte-identical), but plugin-author ergonomics + downstream-project filesystem layout shift.

  - **canvas-lib relocated.** The shared canvas library (`DesignCanvas`, `DCSection`, `DCArtboard`, `DCPostIt`, specimen helpers, hooks) now lives at `plugins/design/dev-server/canvas-lib.tsx` and ships with the dev-server install. Three prior copies — `plugins/design/templates/canvas-lib.tsx.template`, the dogfood `.design/_lib/canvas-lib.tsx`, and every initialized project's scaffolded `<designRoot>/_lib/canvas-lib.tsx` — collapse to one. Plugin releases now reach end users automatically.
  - **Bootstrap drops the canvas-lib scaffold step.** `design-system/SKILL.md` Round-0 Batch-A step 0 deleted. `/design:setup-ds` no longer writes a `_lib/` directory in the project; the virtual specifier `@maude/canvas-lib` resolves directly to the dev-server-bundled file at canvas build time.
  - **Legacy `<designRoot>/_lib/canvas-lib.tsx` deprecation guard.** Downstream projects with a pre-4.0.5 `_lib/canvas-lib.tsx` get a one-shot warning log per dev-server boot (`[canvas-lib] Legacy … detected …`); the project file is **ignored** and the dev-server-bundled lib is authoritative. After two minor versions the warning becomes silent and the fallback comment is removed.
  - **Perf fixture relocated.** `.design/_lab/perf-100-artboards.tsx` → `plugins/design/dev-server/examples/perf-100-artboards.tsx` with sibling `README.md`. The fixture is dev-server tooling, not user content — keeping it in `.design/_lab/` mislabeled the boundary.
  - **canvas-lib HMR.** When `plugins/design/dev-server/canvas-lib.tsx` is edited, the http-layer file-watcher clears the canvas bundle cache and emits a synthetic `_lib/canvas-lib.tsx` event so the existing hmr-broadcast classifier emits the same hard-reload message every open iframe was already wired for. No bespoke client-side wiring.
  - **DDR-022 partially superseded by DDR-025.** "Two-state model" (virtual specifier at author time, AST-inlined at handoff time) stands; only the _physical home_ of the canonical source changed. Header annotation added to DDR-022.

  `bun test`: 133/133 (4 tests in `canvas-lib-resolver.test.ts` rewritten to match the new contract — old assertion was `canvasLibPath('/foo/bar') === '/foo/bar/_lib/canvas-lib.tsx'`; new contract is `canvasLibPath()` returns the dev-server-internal path; new legacy-guard test asserts a planted bogus `<designRoot>/_lib/canvas-lib.tsx` is ignored). Handoff drop sha1-identical to pre-relocation baseline.

## 0.13.1

### Patch Changes

- Hotfix: repair v0.13.0 release pipeline.

  v0.13.0 half-published (3 of 7 platform sub-packages reached npm; the
  root `@1agh/md-claude` package never published). Root causes:

  - `plugins/design/dev-server/build.ts` produced
    `dist/mdcc-windows-x64.exe` but `build-binaries.yml` expected
    `mdcc-win32-x64.exe` (bun's target naming vs. Node's
    `process.platform`). `platformSlug()` now translates
    `windows-x64` → `win32-x64`.
  - `build-binaries.yml` used `container: alpine:3.20` for musl builds,
    but JS-based actions can't run in alpine on arm64 runners. Dropped
    the container; cross-compile musl from regular ubuntu via Bun's
    `--target=bun-linux-*-musl` (statically-linked output).
  - `pnpm install --frozen-lockfile` is fundamentally incompatible with
    the `optionalDependencies` bootstrap pattern (lockfile can't
    enumerate sub-packages that aren't on npm yet). Switched
    `build-binaries.yml > publish-main` and `quality.yml` to
    `--no-frozen-lockfile`.
  - `publish.yml` was a duplicate of `build-binaries.yml > publish-main`
    without the `needs: build-binaries` gate, so it raced ahead and
    always failed at install. Deleted.
  - `scripts/changesets-version.sh` only propagated the bumped version
    to plugin manifests; missed `packages/md-claude-*/package.json` and
    the `optionalDependencies` pins. Now delegates to
    `scripts/bump-version.sh "$NEW"` which covers every manifest.

  GitHub Release creation moved into `build-binaries.yml` (new
  `create-release` job runs first; `publish-main` populates notes after
  npm publish).

## 0.13.0

### Minor Changes

- b200e59: design plugin: stable element-id schema + canonical screenshot pipeline + shared bash helpers

  **New user-visible flags on `/design:screenshot`:**

  - `--screen <id>` — capture one artboard by `data-dc-screen` id (or legacy `data-dc-slot`)
  - `--element <id>` — capture one named region by `data-dc-element` id
  - `--all-screens` — loop over every artboard, write `<NNN>-screen-<id>.png` per artboard
  - existing `--full` / `--selector <css>` / `--area <name>` retained

  **Stable element-id schema in generated canvases:**

  - `DCArtboard` runtime now renders `data-dc-screen="<id>"` alongside the legacy `data-dc-slot` (same value). Backwards-compatible — existing canvases keep working.
  - `/design:new` / `/design:edit` envelope directive 15 instructs `frontend-design` to tag named regions (heroes, CTAs, list rows, form fields) with `data-dc-element="<kebab-id>"`. Stable handles for comments, screenshots, and critic verdicts across iterations.
  - Inspector (`server.mjs` `cssPath()` / `domPath()`) now prefers `[data-dc-element]` → `[data-dc-screen]` → `#id` → `:nth-child`. Cmd+Click on a tagged element yields a stable selector instead of fragile `:nth-child(3)`.

  **Canonical bash helpers under `plugins/design/dev-server/bin/`** (shipped via npm, called from slash commands and critics):

  - `screenshot.sh` — wraps `agent-browser` with `npx playwright` fallback; handles URL resolution, mount poll, per-screen loop, engine selection
  - `bootstrap-check.sh` — detects `.design/config.json` + DS folders; exit 0/10/11; modes: default / `--json` / `--shell-export`
  - `server-up.sh` — server lifecycle (PID + `/_health` check, respawn, 10s poll); stdout = port
  - `slug.sh` — single source of truth for `_history/<slug>/` path normalization

  **Bug fix:** `signature-moment-critic.md` previously referenced `[data-artboard-id]` — a selector that no runtime ever emitted, silently falling back to `--full` and losing per-artboard discipline. Renamed to `data-dc-screen` (sweep across the plugin).

  **Refactor:** inline `agent-browser navigate + screenshot` bash blocks removed from `commands/{screenshot,new,edit,setup-ds}.md`, `skills/design/SKILL.md`, `skills/design-system/SKILL.md`, `agents/design-critic.md`, `agents/signature-moment-critic.md`. All callers now invoke the helper.

  See DDR-007 (element-id schema) and DDR-008 (helper home) for the architectural rationale.

- 77478b0: design plugin: `design-system-keeper` agent + pattern-priors envelope + token-usage doctrine

  **New auto-routed audit agent — `design-system-keeper`:**

  Read-only agent (`tools: Read, Bash, Glob, Grep`) that runs between canvas generation and the critic panel. Two passes:

  - **Pattern-reinvention scan** — greps existing canvases + DS preview library for class shapes the new canvas should have lifted (catches `.pcard` re-deriving an existing `.dc-card`, etc.).
  - **Token-usage audit** — cross-checks every `var(--TOKEN)` against the DS README's `## Token usage guide` table to flag role mismatches (e.g. `--accent-active` used as a fill instead of body-text contrast).

  Findings are warnings by default; the agent self-promotes its own verdict to blocker when ≥ 5 token-usage mismatches OR ≥ 3 pattern reinventions stack on a single canvas (mass-drift signal).

  **New user-visible flag on `/design:new` and `/design:edit`:**

  - `--skip-ds-keeper` — opt out of the precheck for known-experimental canvases / debug runs.

  **Orchestrator integration:**

  - `/design:new` step 9.5 spawns ds-keeper in parallel with the critic panel (always, unless flag).
  - `/design:new` step 5/5a/5b — envelope template now carries a mandatory `## Pattern priors` section listing existing canvases (with their class roots) + DS preview components (with one-line role). Generator is instructed to lift before reinventing.
  - `/design:edit` step 7.5 — conditional precheck (fires when diff ≥ 10 lines OR new class root introduced; skipped on micro-edits).
  - `/design:edit` step 8a — DS-drift fast-path. When user feedback explicitly names DS drift (regex matches "design system" / "DS" / Czech "jiné barvy než DS"), routes a stripped panel `[ds-keeper, design-critic]` capped at 2 iterations. Skips 4–6 critic spawns per iter that would have been deterministic find-and-replace.

  **New DS doc convention — `## Token usage guide` section:**

  `md-claude`'s own DS at `.design/system/project/README.md` gains a Token usage guide table covering all four token families (accent, fg, bg, border) — for each token: "Use for" / "Don't use for". This is the audit source for ds-keeper's Pass B. Future DSes scaffolded by `/design:setup-ds` should follow the same pattern (inspiration-library template carry-over).

  **Pattern-lift discipline codified in CLAUDE.md:**

  New paragraph under § Design plugin: "Pattern priors come first — when working under a project DS that has existing canvases or preview components, those files ARE the design spec. Lift before invent."

  See [DDR-010](.ai/archive/decisions/DDR-010-design-system-keeper-agent.md) and the [Docs Site retro](.ai/logs/system-reviews/docs-site-design-generation-review.md) for the rationale and the cost-saving math (~50–80k tokens per session in the typical "user has existing canvas to lift from" scenario).

- 61d9e9d: **Phase 3.4 — dev-server runtime + build pipeline + distribution overhaul.**

  The dev-server (`mdcc design serve`) is now built on Bun authoritatively (DDR-009), distributed as per-platform standalone binaries via npm `optionalDependencies` sub-packages (DDR-015), and runs on a 7-module TypeScript split of the former 1288-LOC `server.mjs` monolith (DDR-013). The shell client migrates from React 18 UMD via babel-standalone to React 19 from npm, bundled with `Bun.build` to a 66 KB gz IIFE (DDR-012). CSS moves to a `@layer reset, tokens, layout, shell, components, utilities` cascade processed by Lightning CSS at build time (DDR-014).

  **No breaking change for `mdcc` CLI surface.** `mdcc init` / `mdcc config` / `mdcc design serve` / `mdcc design init` all work as before — same flags, same output paths. End-user prereq drops from "Node 20+" to "nothing" once published with sub-packages, because postinstall hardlinks the matching platform binary in place. `mdcc-safe` bin is the `--ignore-scripts` fallback (slower but always works).

  Highlights:

  - `bun build --compile` produces ~57 MB standalone binary per platform (darwin-arm64 / darwin-x64 / linux-x64 / linux-arm64 / linux-x64-musl / linux-arm64-musl / win32-x64).
  - 7 sub-packages under `packages/md-claude-<slug>/`; `optionalDependencies` in the main tarball pin all 7 in lockstep. `scripts/bump-version.sh` + `scripts/check-version-parity.sh` extended.
  - `.github/workflows/build-binaries.yml` is the new release pipeline (fail-fast: false matrix, native runner per platform, npm provenance on every artifact, `publish-main` gated on all sub-packages being live).
  - Native `Bun.serve` WebSocket replaces the hand-rolled RFC-6455 upgrade (saves ~150 LOC + 1.7× WS throughput headroom for future collab features).
  - 7 `bun:test` smoke tests + `perf-harness.ts` measure the Phase 3.4 budgets (cold start < 100 ms HTTP, bundle gz < 80 KB, WS p50 < 1 ms).
  - CSS-only HMR live; full JSX HMR with react-refresh-runtime is deferred to Phase 3.5.

  Unblocks Phase 3.5 (DS-token-aware shell visual refresh) and Phase 4 (Pixi.js canvas v2 + infinite canvas).

  Per-platform sub-packages (new on npm): `@1agh/md-claude-darwin-arm64`, `@1agh/md-claude-darwin-x64`, `@1agh/md-claude-linux-x64`, `@1agh/md-claude-linux-arm64`, `@1agh/md-claude-linux-x64-musl`, `@1agh/md-claude-linux-arm64-musl`, `@1agh/md-claude-win32-x64`. End users should not install these directly — npm resolves the matching one automatically.

  See `.ai/archive/decisions/DDR-{009,012,013,014,015,016}.md` for the full rationale set.

- e5eb043: **Phase 3.5 — dev-server shell refresh: shadcn-style menubar + CV-08 tree-panel + Help modal + paper-grid viewport.**

  The `mdcc design serve` chrome is rebuilt against the `project` DS (MDCC-DSN/01) mocks in `.design/ui/Canvas Viewport.html`. The action-button header (`tree · active · comments · open`) is replaced by a 30 px top **menubar** (`■ MDCC · File · Edit · View · Selection · Tools · Help · CV-stamp · file · N ARTBOARDS · ZOOM 100% · project SKU`) per CV-01/CV-08 spec — see [DDR-017](../.ai/archive/decisions/DDR-017-dev-server-shell-menubar-single-canvas.md). The tabs row is gone — the dev-server is single-canvas; opening a file in the tree replaces the active one. The left sidebar becomes a four-section CV-08 tree (`PROJECT / DESIGN SYSTEM · / UI CANVASES / RUNTIME · GITIGNORED`) backed by a new `kind` discriminator in `_index-data` — see [DDR-018](../.ai/archive/decisions/DDR-018-tree-groups-via-kind-discriminator.md).

  **Visual surfaces (CV-01 / CV-02 static lift)**

  - **Paper-grid viewport bg** — 24 px ink hairline grid on `--u-bg-1`; visible in empty state, covered by iframe once a canvas mounts.
  - **Wordmark watermark** — `mdcc-design-server` 40 px display + `CANVAS · MD-CLAUDE / v{version} / localhost:{port}` SKU sub-line; mounted in the empty state. Version baked at build time via a new `__MDCC_VERSION__` Bun `define`.
  - **Selection halo** — accent 2 px outline + 4 corner ticks around the active iframe when an element is selected (CV-02 lift).

  **Menubar + dropdown**

  - **View dropdown** (T): `Project Tree (T)`, `Comments Sidebar (⌘⇧M)`, `Design system view (S)` all toggleable; `Layers Panel`, `Inspector`, `Annotations`, `Presentation Mode`, `Zoom In/Out/Fit/Actual Size` rendered with `Phase N` tags (inert until those phases land).
  - **Help menu** opens `<HelpModal>` — modal containing the cheatsheet that used to live in the sidebar (Element selection · Tabs & canvas · Slash commands · Opt-out scope · Auto-critic loop · Pin-to-element flow · Comments). Esc / backdrop / × close. Triggered by `?` or `F1` too.
  - **State stamp** in `.mb-status`: cv-stamp (`IDLE / CANVAS / SYSTEM`) + file path + `● N ARTBOARDS · ZOOM 100% · MD-CLAUDE`.

  **Sidebar (CV-08)**

  - New `<Sidebar>` reads `kind`-tagged groups: PROJECT (`▾ .design` root files), DESIGN SYSTEM · (`MDCC-DSN/01` pill, `▾ system/project` with `README.md`, `SKILL.md`, `colors_and_type.css`, `▾ preview` with HTMLs), UI CANVASES (count pill, `▾ ui`), RUNTIME · GITIGNORED (count pill, muted treatment).
  - DS section header is **clickable** — opens the system view. (Replaces the dropped promoted "Design system view" row.)
  - Files-first ordering inside dirs (mock convention).
  - Non-HTML rows are inert (`aria-disabled="true"`, no-op click).

  **Keyboard surface**

  - `T` toggles sidebar visibility (visibility-hidden, state preserved).
  - `S` toggles SYSTEM view.
  - `⌘F` focuses search (re-opens sidebar if hidden).
  - `⌘⇧M` toggles comments rsidebar.
  - `?` / `F1` opens Help modal.
  - `Esc` closes modal / composer / focused pin.

  **Fixes**

  - **Body-grows scrollbar bug** — long selected-element selectors in the statusbar no longer push the grid wider than viewport. Root cause: `.app { grid-template-columns: 320px 1fr }` defaults to `minmax(auto, 1fr)`, so an unbreakable selector string expanded the track. Fix: `minmax(0, 1fr)` + `min-width: 0; overflow: hidden` on `.app` + `.statusbar`.
  - **View dropdown clipped** — earlier `.mb { overflow: hidden }` (added to clamp menubar status) clipped the dropdown (`position: absolute; top: 30px`). Removed; right-side clamp stays on `.mb-status` alone.

  **Server (`api.ts`)**

  - `buildIndexData` synthesizes PROJECT (`.md`/`.json`/`.txt`/`.yml`/`.yaml`/`.css` at `.design/` root) and RUNTIME (`_*` entries at root) groups in addition to the existing canvas groups.
  - DS canvas group widens its scan to `['.html', '.md', '.css', '.json']` so `README.md` / `SKILL.md` / `colors_and_type.css` appear alongside preview HTMLs.

  No `mdcc` CLI surface change. Phase 4 (Pixi canvas v2) lands on this refreshed shell.

## 0.12.0

### Minor Changes

- **design:** add `ux-research-agent` for unbiased discovery + strip brand precedents from the plugin.

  The design-system bootstrap questionnaire previously showed the same hardcoded option ladder (mood / signature / iconography / density / typography / voice) to every project regardless of domain, and plugin docs seeded the orchestrator with brand-name precedents (Linear/Figma/Stripe/Vercel/etc. in CLAUDE.md retros, `_MAPPING.md` fixed answers, agent examples) that got parrotted back into brief proposals.

  - New `design:ux-research-agent` with two modes — `discovery` (called from `/design:setup-ds` Round 0) and `ux-patterns` (called from `/design:new`). Runs 6–8 WebSearch queries across abstract source-type categories (awards / case-studies / indie portfolios / non-English regions / lateral industries / niche publications / heritage) and emits a payload the questionnaire consumes verbatim.
  - Discovery Q5/Q6/Q7/Q8 are now payload-sourced (were hardcoded "stable across projects"). Q9/Q11/Q12 keep their scaffold logic via effect-family classification in `_MAPPING.md`, but the answer pool is payload-generated per project.
  - Brand-precedent purge: removed brand-name lists from `CLAUDE.md`, `SKILL.md` retro examples, `_MAPPING.md` hardcoded answer tables, `/design:setup-ds` example invocation, and `brand-critic` / `typography-critic` prose. Runtime config at `plugins/design/agents/_ux-research-config.json` holds only the abstract WebSearch source-type categories.
  - Cache uses brief-hash exact match (sha8 of brief verbatim) so reworded briefs get fresh research instead of fuzzy-matched cache reuse.

## 0.11.0

### Minor Changes

- 25f7767: **Plugins: namespace `name:` frontmatter + rename `setup-onboard` → `init`.**

  - Every plugin command, skill, and agent now declares `name: <plugin>:<slug>` in its frontmatter (e.g. `flow:resume`, `design:edit`). Without the explicit prefix, Claude Code registers the bare slug — which collides with built-ins like `/resume` and loses the namespaced row in autocomplete. See [Claude Code issue #22063](https://github.com/anthropics/claude-code/issues/22063) and [DDR-006](./.ai/archive/decisions/DDR-006-plugin-namespace-in-name-frontmatter.md).
  - `/flow:setup-onboard` → `/flow:init` and `/design:setup-onboard` → `/design:init`. Bare-verb `init` is the lone exception to the `<group>-<verb>` filename rule, mirroring Claude Code's built-in `/init`. The namespace prefix (`flow:` / `design:`) keeps them unambiguous against the built-in.
  - `/flow:help` and `/design:help` render templates updated to `/<name>` (the prefix is already in `name:`) to avoid double-prefix output.
  - Both `CATEGORIES.md` files updated with new naming convention, the `init` carve-out, and rename-history rows.

  **Downstream impact:** Users invoking the old slash names need to switch — `/flow:setup-onboard` → `/flow:init`, `/design:setup-onboard` → `/design:init`. No backwards-compat stubs; the slash names disappear cleanly because both plugins ship as a single version-pinned bundle.

## 0.9.0

### Minor Changes

- 3ea3774: **Inspiration library expansion** — 46 new reference specimens, bringing `plugins/design/templates/design-system-inspiration/` to **70 files** total (up from 24 in v0.8). Plus removes the `/design` compat stub on schedule.

  **Library additions (46 specimens):**

  - **`foundations/` (8)** — radii, elevation, borders, focus, opacity, selection, grid, iconography. Universal — every project pulls from these.
  - **`status/` (3)** — colors-status, components-status (badges + row indicators), skeletons. Active when `"status" ∈ activeFamilies` (default for almost every project).
  - **`audience-pro/` (6)** — dense list, toast-menu, keyboard primitives, command palette, shortcuts overlay, presence colors. For pro tools with keyboard-first density.
  - **`audience-consumer/` (5)** — marketing card, testimonial, feature grid, generous empty state, page banners. For consumer-facing surfaces.
  - **`audience-developer/` (6)** — terminal pane, log stream, diff view, code block (with syntax-tinted token palette), monospace table, type-mono usage. For developer tools.
  - **`platform-mobile/` (5)** — bottom sheet (3 snap states), pull-to-refresh, tab bar, segmented control, mobile UI kit index.
  - **`platform-desktop/` (2)** — resizable 3-pane layout, desktop UI kit index.
  - **`theme-both/` (1)** — dark + light side-by-side comparison (for `Q4 = both equal` projects).
  - **`patterns/` (6)** — form layouts (4 variants), error pages (404/500/offline/maintenance), onboarding (welcome + tour + coachmark), auth (sign-in / sign-up / reset), pricing tiers, data density (sparse / default / compact).
  - **`meta/` (4)** — tokens index (visual TOC), accessibility patterns (skip-link, sr-only, landmarks, focus trap, ARIA live), i18n (RTL flip, long-text overflow, pluralization, lang attribute), presence-multiplayer (forward-pointer to v1.1+ Yjs features).

  Every specimen carries the `<!-- SPECIMEN: … -->` comment header (DEMONSTRATES / COMPOSITION / COPY VOICE / WHEN SCAFFOLDED / NOTES) — the bootstrap-mode agent reads these as references to learn what each pattern is and how to generate a project-flavored equivalent.

  **Stub removal:**

  - `plugins/design/commands/design.md` — the v0.8 one-version compat stub redirecting `/design` → `/design:edit` — **removed** as scheduled. Calling `/design` no longer resolves; use `/design:edit` directly.
  - `site/content/docs/reference/design/design.mdx` — auto-generated reference page for the removed stub — also removed.
  - Cross-references updated in `plugins/design/CATEGORIES.md`, `plugins/design/commands/help.md`, `CLAUDE.md`, `site/content/docs/design/index.mdx`, `site/content/docs/design/categories.mdx` — the rename history table gains a final row for the v0.9 removal.

  Now-canonical command list: 11 (8 daily + 3 setup, no compat stub).

  **Scaffold sizes (updated):**

  | Project profile         | Approx file count (was → now)                                               |
  | ----------------------- | --------------------------------------------------------------------------- |
  | Consumer marketing      | ~12 → ~18 (foundations, status, audience-consumer, patterns)                |
  | Pro-tool SaaS           | ~22 → ~32 (foundations, status, audience-pro, platform-\*, universal, meta) |
  | Developer CLI dashboard | ~14 → ~22 (audience-developer + meta + foundations + status)                |
  | Consumer mobile         | ~16 → ~22 (platform-mobile + consumer + foundations)                        |
  | Enterprise admin        | ~20 → ~30 (audience-pro + theme-both + patterns + meta)                     |

  Skill `design-system` (bootstrap mode) reads `_MAPPING.md` to pick which subdirs apply per discovery — and now actually has the files to read.

## 0.8.0

### Minor Changes

- cd21658: The `design` plugin gains a bootstrap workflow that takes a project from cold-start to a usable design system in 8 questions. Plus a `<group>-<verb>` command categorization mirroring the flow plugin, an adaptive completeness-critic, and multi-DS support.

  **New slash commands**

  - **`/design:setup-onboard`** — project-level environment init (deps check, install hints, skeleton `.design/config.json`). Mirrors `/flow:setup-onboard`. Auto-invoked transparently when other commands hit a missing config.
  - **`/design:setup-ds <name> "[brief]"`** — dedicated entry point for creating a design system. Thin wrapper that loads skill `design-system` in bootstrap mode. Three internal modes (`first-bootstrap`, `additional-ds`, `re-bootstrap`).
  - **`/design:setup-docs`** — was `/design:docs`; moved to the `setup-*` group.
  - **`/design:help`** — grouped command index, mirror of `/flow:help`.

  **Renamed**

  - `/design "<feedback>"` → **`/design:edit "<feedback>"`**. The bare `/design` form is preserved as a one-version compat stub; will be removed in the next minor.
  - `/design:docs` → **`/design:setup-docs`**.

  **Skill `design-system` — dual-mode**

  - **READ mode** (default) — loads the active canvas's declared DS for iteration.
  - **BOOTSTRAP mode** — auto-invoked by `/design:setup-ds` and as a fallback by `/design:edit` / `/design:new` against fresh repos. Runs hard-deps pre-flight → 8-question discovery (2 `AskUserQuestion` rounds) → consults `_MAPPING.md` → generates project-flavored files using `plugins/design/templates/design-system-inspiration/` as reference → runs `design-system-completeness-critic` → prints next-step block.

  **`mdcc design init`** (new CLI subcommand)

  Non-interactive helper for CI / scripted contexts. `--no-discovery` scaffolds Core only with Recommended defaults; `--discovery-payload <path>` reads pre-computed answers for deterministic skill-driven scaffolds. Interactive bootstrap requires Claude Code — the CLI refuses with a hint.

  **Adaptive completeness-critic**

  New agent `plugins/design/agents/design-system-completeness-critic.md` validates `<designRoot>/system/<ds>/` against a **3-tier rule set**:

  - **Core** (blocker regardless of profile) — README + SKILL + tokens presence, one-accent rule, Core vars (`--accent`, `--bg-0..4`, `--fg-0..3`, motion var), minimum specimens (3/8/12 per profile), no D2 divergence (`system/<projectslug>/` is rejected).
  - **Conventional** (warning, gated by `activeFamilies[]` + `completenessProfile` `minimal | standard | strict`) — OKLCH usage, per-family specimens (status / presence / mono), `prefers-reduced-motion` guard, theme blocks.
  - **Free-form** (no check, acknowledged) — user extensions (`patterns/`, `voice/`, etc.) pass silently.

  Auto-runs at the end of the bootstrap flow; opt-in via `/design:critic --system-only [--ds=<name>] [--all-ds]`.

  **Multi-DS support**

  Projects can now declare multiple design systems under `<designRoot>/system/<name>/`. Each canvas's `.meta.json.designSystem` field names the DS it's built against. The completeness-critic, `flow:design-system-guard`, and the read-side of skill `design-system` all scope to that DS — tokens from one DS never blend into another. `/design:new --ds=<name>` validates the slug against `config.designSystems[]` and fails with a hint to `/design:setup-ds` on unknown DSes (no fallback prompt).

  **Schema additions** (`plugins/design/dev-server/config.schema.json`)

  - `extensions[]` — user-added subdirs the critic acknowledges but doesn't validate
  - `completenessProfile: minimal | standard | strict`
  - `activeFamilies[]` — `accent | status | presence | mono`
  - `designSystems[]` — multi-DS list with name/path/description
  - `defaultDesignSystem` — fallback when canvas meta has no DS field

  Plus `canvas-meta.schema.json` gains `designSystem` (kebab-case slug) + `opt_out_scope` (palette/aesthetic/full) fields.

  **Inspiration library** (skeleton — full expansion in a follow-up)

  New `plugins/design/templates/design-system-inspiration/` ships 24 reference files: `_README` + `_MAPPING` + Core 10 (templates for README, SKILL, INDEX, config, tokens CSS + 9 specimens) + Universal 6 (toggles, dialogs, tooltips, tables, callout, empty-state). Each specimen has a SPECIMEN comment header documenting which tokens it demonstrates and the copy voice it uses. Bootstrap mode reads these as **references**, then generates project-flavored equivalents — never copies verbatim, never with placeholder copy.

  **Categorization** (`plugins/design/CATEGORIES.md`)

  12 commands grouped into `daily` (8: edit, new, critic, browse, rollback, screenshot, handoff, help) + `setup-*` (3: setup-onboard, setup-ds, setup-docs). Plus the bare `/design` compat stub.

  **Site (docs.iagh.cz)**

  `/docs/design` is now a section: `index` (overview), `bootstrap` (cold-start narrative), `multi-ds` (multi-DS reference), `categories` (mirror of `CATEGORIES.md`). Plus the auto-generated reference pages regenerate from the renamed source files. The `mdcc design init` subcommand is documented in `/docs/cli`.

  **CLAUDE.md**

  New "Design system bootstrap" section documenting the 8 load-bearing rules so future sessions don't re-derive them: onboard-before-bootstrap, one-skill-owns-DS-work, three-bootstrap-sub-modes, inspiration-library-not-substrate, dynamic-scaffold-count, single-DS-dirname-is-literal-`project`, three-tier-compliance, daily-verb-is-edit.

  Refs: [`.ai/plans/design-system-init.md`](https://github.com/1aGh/md-claude/blob/main/.ai/plans/archive/design-system-init.md).

### Patch Changes

- a50c9f4: Docs site lands at [`site/`](https://github.com/1aGh/md-claude/tree/main/site) (Fumadocs + Next.js + Tailwind v4 + Orama search). Public URL pending Vercel wiring — see [DDR-005](https://github.com/1aGh/md-claude/blob/main/.ai/archive/decisions/DDR-005-docs-site-stack-and-hosting.md).

  What's there:

  - **Guides** (hand-written): `getting-started`, `cli`, `flow`, `design`, `config`, plus drop-in recipes for Next.js, Expo, and pnpm monorepos.
  - **Reference** (auto-generated): one MDX page per `/flow:*` and `/design:*` command (37 today) sourced from plugin frontmatter; one typed `workflows.config.json` schema page sourced from `config.schema.json`. Two generators under `site/scripts/` run as the site's `prebuild` step — adding a new command auto-publishes its page on next deploy.
  - **LLM-readable output**: Fumadocs ships `/llms.txt`, `/llms-full.txt`, and raw `/llms.mdx/docs/<slug>` per page out of the box; this release adds a `/robots.txt` with an explicit allow for GPTBot / ClaudeBot / PerplexityBot / Google-Extended.

  Infra:

  - New private workspace `@md-claude/site` (not part of the npm tarball).
  - New `.github/workflows/site-deploy.yml` — builds + lints on every PR / push to `main` touching `site/**`. Deploy step is inert until a maintainer adds `VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` repo secrets.
  - Root README trimmed 339 → 164 lines — flow + design command deep dives now live on the docs site; README stays focused on quickstart + contributor info.

  No change to the published `@1agh/md-claude` package contents — `patch` bump captures the infrastructure improvement without overstating user-facing API change.

## 0.7.0

### Minor Changes

- 89bf4e6: **flow:** rename `/flow:resume-task` → `/flow:resume`.

  Pairs cleanly with `/flow:pause` (no asymmetric `-task` suffix). The command file is now `plugins/flow/commands/resume.md`.

  **Breaking change for users with muscle memory** — the old slash name no longer resolves. Update any session notes, scripts, or muscle-memory cheat sheets that referenced `/flow:resume-task`. (Note: `flow:resume-task` was only available in v0.6.0 → v0.6.1; older versions used `/flow:resume-work` which was already phantom.)

  Also fixed two pre-existing phantom command references during the sweep:

  - `plugins/flow/commands/pause.md` — replaced bare `resume-work` mentions with `/flow:resume`.
  - `plugins/flow/commands/setup-prd.md` — replaced `pause-work` / `resume-work` with `/flow:pause` / `/flow:resume`.

## 0.6.1

### Patch Changes

- Remove the 11 Phase 13 backwards-compat stubs ahead of schedule.

  The stubs (`verify.md`, `onboard.md`, `create-prd.md`, `map-codebase.md`, `context.md`, `ddr.md`, `retro.md`, `execution-report.md`, `ai-health.md`, `discover.md`, `code-review.md`) shipped in v0.6.0 as a one-minor-version grace window for users typing the pre-rename slash names. The original plan was to remove them in v0.7.0.

  After ~one day on npm with no observed traffic to the old slash names, the stubs were removed early. Anyone still typing `/flow:ddr`, `/flow:onboard`, `/flow:verify`, etc. in v0.6.1+ will see a "command not found" instead of a redirect message; the new names are in `plugins/flow/CATEGORIES.md` (rename history table), DDR-004, and `/flow:help`.

  Decision is recorded in `.ai/archive/decisions/DDR-004-flow-command-naming-prefix-convention.md` under "Compat-stub removal target (actual: v0.6.1)".

## 0.6.0

### Minor Changes

- 09bcb3b: Adopt pnpm workspaces and Changesets for the release flow. Add `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, GitHub PR + issue templates, Dependabot config, quality CI workflow, CODEOWNERS, and Dependabot auto-merge. No runtime change for `mdcc` or the plugins themselves.
- 9f9a8d8: Flow plugin command categorization — every non-daily `/flow:*` command now uses a `<group>-<verb>` prefix so autocomplete narrows by group.

  **Renamed commands** (old names ship as redirect stubs through v0.6.x; removed in v0.7.0):

  - `/flow:verify` → `/flow:utils-verify`
  - `/flow:onboard` → `/flow:setup-onboard`
  - `/flow:create-prd` → `/flow:setup-prd`
  - `/flow:map-codebase` → `/flow:setup-codebase-map`
  - `/flow:context` → `/flow:setup-context`
  - `/flow:ddr` → `/flow:record-ddr`
  - `/flow:retro` → `/flow:record-retro`
  - `/flow:execution-report` → `/flow:record-execution`
  - `/flow:ai-health` → `/flow:maintain-ai-health`
  - `/flow:discover` → `/flow:maintain-discover`
  - `/flow:code-review` → `/flow:review-code`

  **New:** `/flow:help` — auto-generated grouped command index that reads each command's `category:` frontmatter. `plugins/flow/CATEGORIES.md` is the canonical catalog of the 9 groups (`daily`, `utils`, `setup`, `validate`, `bug`, `record`, `maintain`, `review`, `release`). Rationale + research lives in DDR-004.

  Subdirectory namespacing for slash commands (`commands/bug/fix.md` → `/flow:bug:fix`) is **not supported by Claude Code** ([issue #2422](https://github.com/anthropics/claude-code/issues/2422), [open feature request #44678](https://github.com/anthropics/claude-code/issues/44678)). The strict `<group>-` prefix is the working substitute — typing `/flow:bug-` autocompletes only the bug-\* members.

- 453e66e: Add `integrations.changelog` to flow's config schema and ship two new commands:

  - `/flow:release-changelog` — provider-dispatched authoring (Changesets implemented end-to-end; `git-cliff`, `conventional`, and `custom` enum values stub to "not yet implemented" until their own follow-ups land).
  - `/flow:release` — walks a project-owned Markdown runbook at `integrations.changelog.releaseGuide` (default `.ai/release-guide.md`) step-by-step, never auto-runs, prompts `[run] / [skip] / [edit] / [abort]` per fenced bash block. Provider-agnostic by design — see DDR-003.

  Also: `/flow:validate` gains a non-blocking changelog-hygiene warning; `/flow:done` gains an overridable reminder; `/flow:onboard` auto-detects the provider from filesystem markers (`.changeset/config.json`, `cliff.toml`) and scaffolds the runbook; `mdcc init --provider <name>` propagates the choice into both the config file and the runbook stub. `/flow:execute` and `/flow:quick` no longer hardcode "changeset" — both reference `integrations.changelog.provider`.
