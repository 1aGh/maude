# #206 spike: CLI design runs reuse Maude Desktop

> T6.1 (measure) + T6.2 (contract) of the issue burndown, plan `.ai/plans/feature-issues-burndown-2026-11.md`.
> Status: **draft — §7 (first-open trust) waits for Michal before T6.3 starts.** DDR:
> `.ai/archive/decisions/DDR-250-cli-reuses-desktop-sidecars.md`. Builds on T1.9 (server-up always headless) and
> T1.10 (the packaged CLI spawns the adjacent sidecar).

**Decision.** The desktop app becomes the one owner of a checkout's server whenever it runs. It publishes an
**app-owned registry** of its sidecars (`<app_data_dir>/servers.json`, root → port + a per-spawn attest key). The CLI
verifies a sidecar by **challenge-response** against that key (never by `_server.json`). It asks the app for anything
that changes the app (open a tab, focus a canvas, keep a tab awake, restart) over an **app-owned unix socket**
(`<app_data_dir>/cli.sock`, request → reply), not over `maude://`. A worktree opens as **its own tab**, labelled with
its branch, kept out of Recent and never linked to a hub. A CLI-started server **yields** to the app's sidecar for
the same root. `_server.json` gets a single-writer rule (compare-and-delete), and the three blind deletes in Rust go.

## 1. Measurements (T6.1)

Rig: the release `maude-server` (built 2026-11-02, `target/release`), copied to the scratchpad; throwaway HOME +
XDG_CONFIG_HOME, a stub `claude` first on PATH, `NO_OPEN=1 MAUDE_NO_AUTOBUILD=1 FARM_LOCAL=1`, no git, no hub.
"C" = a server started like `maude design serve` / `server-up` (plain env). "D" = a server started the way `sidecar.rs
spawn_for` starts one (`MAUDE_SHELL_SIDECAR=1`, `MAUDE_SHELL_TOKEN`, `MAUDE_SHELL_INFO_FILE`; `MAUDE_EXIT_WITH_PARENT=0`
only so the harness could exit). Scripts: scratchpad `run2.sh`–`run4.sh` (not committed).

| What | Tiny project (1 canvas) | Real-size project (copy of this repo's `.design`, 135 `.tsx`, 418 MB, unlinked) |
| --- | --- | --- |
| Boot → `/_health` 200 | 250–420 ms | C 686 ms (writer, boot reconcile), D 432 ms (read-only) |
| RSS, idle | 116–133 MB | C 283 MB at +5 s, 360 MB at +20 s; D 160 MB at +20 s |
| RSS peak | — | **929 MB** right after one `/_index-data` (falls back to ~166 MB after GC) |
| CPU at boot | 0.3–0.4 s | C 3.0 s (reconcile), D 1.0 s |
| A 40-write burst, both watching | +0.08 s (C) / +0.13 s (D) CPU | — |

No ACP adapter or thumbnail children were running (stub `claude`). A real tab adds them, so a doubled server is
**at least** ~130–360 MB steady, up to ~0.9 GB transient per index build, and a second watcher, canvas build cache
and boot reconcile.

**Two servers on one root (local project, format 2):**

1. **Store lock.** C (first) holds `_state/project-store.lock`. D opens the store **read-only**: it lists history,
   but the desktop user's ⌘Z → `POST /_api/project/undo` answers **409 `store-locked`**. Restore, trash and every
   local-kernel write fail the same way (`sync/local-kernel.ts` `submit`). Already pinned by
   `test/local-kernel-routes.test.ts` "a second studio … writes are refused by the lock".
2. **The lock is held for as long as C lives.** A `server-up` server is `nohup` + `setsid` with no parent watch
   (`shell/parent-watch.ts` exempts it on purpose), so C **never exits by itself**. Once C was SIGTERMed, D took the
   lock within one `LOCK_RETRY_MS` (5 s) and recorded the next outside edit (`outside@3`).
3. **Watcher.** Both watch and both record the same outside edit (`outside@2` on both, served from one store).
   The cost is CPU; there is no corruption (one writer).
4. **Sync (from code, not run: no hub in the rig).** `isLocal = enabled && !ctx.cfg.linkedHub`: the store lock
   covers a local project only. For a linked project nothing in `sync/index.ts` stops two servers from both running
   the sync link (two providers on one disk projection, one device). T6.3 has no case that needs this. The yield
   rule (§6) makes sure it cannot happen through the CLI.

**The `sidecar.rs:419-441` delete race — reproduced, in both directions:**

- *Desktop opens a root C serves:* `spawn_for` deletes C's `_server.json`, and D writes its own. C keeps running,
  orphaned, and still holds the store lock. **The desktop tab is read-only for as long as C lives**
  (`run4.sh`: after D booted, `server-up` reused D, and the lock still named C).
- *C stops while D runs:* C's graceful shutdown (`server.ts` ~1326) **unlinks D's `_server.json`** (it does not check
  the pid), so the file is absent while D runs. The next `server-up` therefore starts a third server.
- The Rust deletes are now vestigial: Rust reads `_server.json` nowhere. `wait_for_shell_url` replaced
  `wait_for_server` and reads the app-owned info file. The only Rust touches left are three blind deletes
  (`sidecar.rs:438`, `sidecar.rs:1078`, `lib.rs:791`), and they only cause harm.

**Today, desktop first:** `server-up` already reuses the desktop's sidecar (`run4.sh`: 388 ms, no new process). It
trusts `_server.json`'s pid + port only after `/_health` names the same pid and `rootId`. So reuse already works by
accident. What is missing is trust (the file is in the project), the race above, tabs, and the browser step.

## 2. Inventory — every CLI path that boots a server or opens a window

| Path | Boots? | Reads `_server.json` | Opens a window | T6.3 change |
| --- | --- | --- | --- | --- |
| `server-up.sh` | **yes** (nohup+setsid, own session) | yes (pid+port, `/_health` pid+rootId) | no (T1.9) | ask the registry first (§3); spawn only on `none`/`cap-full`; spawn as role `cli` (§6) |
| `maude design serve` (`design.mjs runServe`) | **yes** (foreground) | no | browser unless `NO_OPEN` | refuse with a pointer when an app sidecar serves the root (`--force` keeps today's behaviour) |
| `visual-sanity.sh`, `smoke.sh` (`BOOT_VERBS`) | via server-up | yes | no | inherit server-up |
| `runtime-health.sh --restart` | **kills the pid in `_server.json`**, then server-up | yes | no | **never kill an app-owned server**: `op:'restart'` over the socket (§4), or refuse |
| `screenshot.sh`, `perf.sh`, `draw-proof.sh`, `photo-bg-remove.sh`, `photo-adjust.sh`, `generate.sh`, `canvas-rects.sh`, `chat-open.sh`, `assets.sh`, `index.sh`, `audio-search`, `_transcribe`, `_annotate-post`, `_ds-check-live`, `_write-claim`, `_studio-verb` | no (need a server) | yes | no (headless agent-browser; `photo-bg-remove` opens its harness on `canvasOrigin`) | resolve the port through one helper (`desktop-locate`, §3), falling back to `_server.json` |
| `maude design open` / `--panel` (`design-open.mjs` → `POST /_api/ui/open`) | no | via `studio-locate.mjs` | moves the user's view | `op:'show'` over the socket when the app runs: it focuses the tab and opens it if allowed (§4) |
| `/design:browse` (`plugins/design/commands/browse.md`) | via server-up | yes | **yes** (`open "$URL"`) | when the app runs, `op:'show'` and no browser |
| `prep.sh` | no (probe only) | yes | no | report `server.owner: app\|cli\|none` |

The critic agents reach a server only through `screenshot.sh` and `canvas-rects`.

## 3. The app-owned registry

`<app_data_dir>/servers.json` (macOS `~/Library/Application Support/com.maude.app/servers.json`). The directory is
0700 (as `shell-info/` already is) and the file 0600. Only Rust writes it, atomically (tmp + rename), on every pool
change: spawn, ready, rest, wake, reap, quit (an empty list). It is per user and spans all profiles.

```jsonc
{ "v": 1,
  "app": { "pid": 1234, "version": "2.0.0", "socket": "<app_data_dir>/cli.sock", "started": "<iso>" },
  "servers": [ {
      "root": "/abs/realpath", "rootId": "<sha256(realpath)[:12]>",   // = http.ts rootIdentity
      "label": "p-l0123456789abcdef", "state": "running" | "resting",
      "port": 46399, "pid": 5678,                                     // absent while resting
      "attestKey": "<64 hex>",                                        // per spawn; a new one on every respawn
      "profile": "default", "kind": "project" | "worktree",
      "mainRoot": "/abs/main" /* worktree only */, "branch": "feat-x" | null,
      "busy": false, "started": "<iso>" } ] }
```

**Verification (CLI side, `cli/lib/desktop-locate.mjs`, Node built-ins only):**
1. `app.pid` alive, and `realpath(<root>)` matches an entry with `state:'running'`. Otherwise the result is `none`
   (try the socket for a resting tab; §4).
2. `GET http://127.0.0.1:<port>/_api/shell/attest?n=<32 random hex>`. The reply's `mac` must equal
   `HMAC-SHA256(attestKey, "maude-attest/1\n" + n + "\n" + rootId + "\n" + port)` (constant-time compare). A port
   squatter, a respawned sibling or a planted listener cannot answer.
3. Use only the port (always `127.0.0.1`). Never a URL from any file.

**Server side.** Rust mints `MAUDE_SHELL_ATTEST_KEY` per spawn, beside `MAUDE_SHELL_TOKEN`. It sits in the
`MAUDE_SHELL_*` namespace, so `scrubAgentEnv` keeps it from the ACP agent. Rust also writes the key into the
registry, so the env scrub alone does not keep it from the agent: the registry file is readable by anything that
runs as the user. The ACP session's credential deny rules therefore name `servers.json`, `cli.sock`, `run/`,
`shell-info/` and `home/` in the app data folder (`acp/may-scope.ts` `credentialPathsFor`; named entries, not the
whole folder, because a Maude Cloud project's managed copy lives in its `projects/`). A shell command the person
allowed that reads the file without naming it is not covered (the residual named in may-scope.ts). `routes/shell.ts` gains `GET /_api/shell/attest`: main origin only (in neither canvas list), GET only,
`n` = exactly 32 hex characters, otherwise 400. It answers 404 when the env var is absent (a CLI server is never
attestable). The key is read once, then deleted from `process.env`.

`_server.json` stays as it is, for helpers on a machine without the app, but it is **never** a trust input when the
registry names the root. A planted `_server.json` cannot redirect a verb: when the app runs, the registry wins. When
it does not, today's pid + `rootId` check stands.

## 4. The CLI → app channel: `cli.sock`

A unix-domain socket at `<app_data_dir>/cli.sock` (0600 in a 0700 dir; a Windows named pipe with a user-only DACL
later). Rust also checks `getpeereid` == its own uid. One JSON request per connection, one JSON reply, then close.
Each request is ≤ 8 KiB with a 2 s read timeout.

| `op` | Request | Reply |
| --- | --- | --- |
| `ensure` | `{v:1, op, root, purpose:'capture'\|'show', lease?:{id, ttlSec≤600}, expect?:{branch}}` | `{status:'running', port, label, warning?}` · `{status:'consent', ticket}` · `{status:'denied'}` · `{status:'cap-full'}` · `{status:'refused', reason}` |
| `status` | `{v:1, op, ticket}` | the same shapes (the CLI polls a consent ticket ≤ 60 s) |
| `show` | `{v:1, op, root, canvas?, artboard?, element?, mode?}` | `{status:'shown', label}` or an `ensure` refusal |
| `lease` / `release` | `{v:1, op, id, root, ttlSec?}` | `{ok:true}` |
| `restart` | `{v:1, op, root}` | `{status:'restarting'}`, the same path as "Try again" (DDR-235) |

- `root` is an absolute path. Rust realpaths it, requires `<root>/.design/config.json`, and refuses anything under
  (or containing) the app's own data dirs, the profile config folders or the credential folders (`~/.ssh`,
  `~/.aws`, `~/.gnupg`, `~/Library/Keychains` — the set the AI session's deny rules name).
- `show` reuses the deep-link **routing** internals (`windows::open_window_for_root`, park per label,
  `shell://navigate {canvas, artboard}`), never the `maude://` **parser**. `canvas` goes through
  `project_resolve::validate_open_param`.
- **Why not `maude://`:** any web page can navigate to it, its grammar names a project slug and never a path (two
  worktrees of one linked project share a slug), and it has no reply. **Why not single-instance args:** the plugin
  socket is `/tmp/<identifier>_si.sock` and one-way (it carries `cwd\0\0argv` and gives no answer), so the CLI could
  learn neither a port nor a consent result. It also needs the app binary located and exec'd for each call. Both
  keep their current jobs.
- **App not running:** there is no socket, or `app.pid` is dead → today's behaviour (headless own server, no
  window). The CLI never launches the app.

## 5. Worktree tabs

- **Detection (Rust, no git process).** `<root>/.git` is a file `gitdir: <g>`; `<g>/commondir` names the common
  dir, and the main root is its parent when that parent is in the registry or Recent. Then `kind:'worktree'` and
  `mainRoot`. Anything else is an ordinary project and goes through first-open trust (§7).
- **Label.** In the strip: `<main project name> · <branch>`. The branch comes from `<g>/HEAD` `ref: refs/heads/<b>`,
  or the short sha + "detached", or the folder name. The tab is its own pid/label (`pid_for_root` of the worktree
  realpath), with its own sidecar, and counts against `RUNNING_CAP`.
- **Home and Recent.** It is **not** added to Recent and **not** restored at relaunch. Home lists it under its main
  project as a "Worktrees" row while its folder exists. A vanished folder drops the row at the next Home load. If an
  open tab's root disappears, the tab shows "This worktree was removed" with Close (the server is reaped as usual).
- **Profile.** It inherits the main project's binding (`profile_for(mainRoot)`), with no prompt. A sign-in started
  from a worktree tab never creates or rebinds a profile; it says "Sign in from <main>".
- **Sync.** A worktree is **never** linked. The app never passes `MAUDE_APP_BOUND_HUB` for it. Its committed
  `linkedHub` is already parked by `sync/link-consent.ts` (the record is keyed by realpath and the worktree has
  none). The worktree tab's Share sheet replaces "This project says it syncs with … Connect?" with "Syncs from
  <main>" and no button, so a person cannot make it a second linked copy by hand either.
- **Format.** A format-1 worktree is never auto-converted (the conversion writes files on someone else's branch).
  It opens view-only with the usual line.

## 6. Busy, resting, branch, handover

- **Busy.** A live lease (`ensure`/`lease` with `ttlSec`, renewed by every `maude design` verb that touches the
  server) makes the tab busy in Rust: `idle_rest` skips it, and cap resting never picks it. The lease expires on
  its own (default 300 s), so a dead agent leaves no stuck tab. The strip shows the existing "AI running" dot while
  a lease is live.
- **RUNNING_CAP = 3 stays.** `ensure` on a resting or new tab rests the least-recent non-busy, non-active tab, as a
  click does. When all three running tabs are busy or active → `cap-full`, the CLI starts its own headless server
  and prints one line: "Maude has 3 busy projects open — using a separate server for this run."
- **Branch mismatch.** One root has one HEAD, so a mismatch means the folder's branch changed under an open tab (an
  agent ran `git checkout`). Rust keeps the branch each tab was opened with. On `ensure`/`show` with a different
  current branch it relabels the tab, the tab shows one line ("This folder switched from A to B"), and the reply
  carries `warning:{kind:'branch-changed', was, now}`. The CLI prints it and goes on. **Exception:** if the tab has
  unsent changes (`ShellStatus.unsent > 0`), the reply is `refused:'branch-changed-unsent'` and the CLI exits 4 with
  "Maude has unsaved changes for branch A in this folder; save or discard them first." `expect.branch` (the agent's
  own HEAD) differing from the current HEAD gives the same warning. The CLI also warns when `--root` is not its
  cwd's git toplevel ("you are in W, showing M").
- **Handover (the delete-race fix).**
  1. Rust drops all three blind `_server.json` deletes.
  2. `server.ts` writes `_server.json` atomically and, on shutdown, unlinks it **only if it still names this pid and
     `started`** (compare-and-delete, like the store lock's token-guarded release).
  3. A server started by `server-up`/`serve` runs as **role `cli`** (`MAUDE_SERVER_ROLE=cli`; a shell spawn is
     never `cli`). A `cli` server watches `servers.json` every 2 s. When a **verified** (attested) app sidecar for its
     root is running, it yields: it refuses new mutating requests with 409 `yielded`, waits for its export,
     generation and job queue (≤ 120 s), stops sync, releases the store lock, and exits 0. Then D takes the lock
     within `LOCK_RETRY_MS`; measured ≤ 6 s from C's exit.
  4. The app never adopts, signals or kills a server it did not spawn. An adopted server would carry no profile
     env, shell token, parent watch or app port. A kill-by-pid would act on a number from a project file.
  5. While D is read-only and waiting for the lock, its tab shows "Finishing the terminal's run…" (status
     `/_api/shell/status` gains `storeMode: 'writer'|'read-only'`).

## 7. First-open trust — **question for Michal** (blocks T6.3)

> **The first time the terminal (Claude Code, a script) asks Maude to open a folder, what happens?**
>
> Today a folder only becomes a Maude tab when you open it yourself (Home, File › Open project…, a GitHub pull).
> With #206 the AI in your terminal can ask Maude to show a folder: its worktree, or a repo it just cloned.
> Opening a folder runs that project's canvases in Maude (in the sandboxed canvas origin) and starts its server.
>
> **A — Ask once for a new folder (recommended).** Folders Maude already knows (in Recent or ever opened) and
> worktrees of those open silently. For any other folder Maude comes to the front with a sheet: "Claude Code wants to
> show `<folder>` in Maude. Open / Not now". Open is remembered for that folder. Not now tells the terminal to use
> its own hidden server. Settings › General has one switch, "Let the terminal open projects in Maude" (default on).
>
> **B — Ask once for the terminal, then like A.** The very first request ever shows "Let Claude Code in the terminal
> open projects in Maude?". After that, A's rule. One more sheet, once, and you see that the channel exists.
>
> **C — Known folders only, never a sheet.** Only folders already in Recent (and their worktrees) open from the
> terminal. For any other folder the terminal prints "Open `<folder>` in Maude once (File › Open project…)" and uses
> its own hidden server. This is the safest, but a repo the agent just cloned never shows up by itself.
>
> **Profiles, for all three:** a worktree takes its main project's profile. A new folder takes the profile of your
> most recent sign-in, as an unbound folder does today. The terminal can never pick a profile or make a new one.
>
> **As built (Michal chose A; security pass 2026-11-08).** The sheet reads "Claude Code wants to show the folder
> “`<folder name>`” in Maude." with the folder's full real path under it, then: "Either way this project runs on
> this Mac: Open shows it in a Maude tab, Not now lets the terminal run it in its own hidden server." The name is
> the folder's own name, never a label from its config. **Not now** is the default button (Return); **Open**
> counts only one second after the sheet showed — an earlier press raises the sheet again, so a keystroke already
> on its way when Maude came to the front cannot answer it. At most three sheets per ten minutes across every
> folder in one app run; past that the request is refused (`too-many-sheets`) and the terminal prints "Maude asked
> about new folders too often just now — using a separate server for this run. Open the folder in Maude yourself
> (File › Open project…) to skip the question." Not now is kept per folder for the run, as before.
>
> **Recommendation: A.** Known folders carry no new risk: you already opened them and the agent can already write in
> them. The sheet appears exactly when it matters, for a folder Maude has never run, where a cloned repo's canvas
> code would start running. B adds a sheet with no decision in it, and C breaks the worktree-of-a-fresh-clone flow
> the issue asks for.

## 8. Interface summary (what T6.3 builders code against)

- Rust: `servers.json` writer (`cli_registry.rs`), `cli.sock` listener (`cli_channel.rs`), env
  `MAUDE_SHELL_ATTEST_KEY`, worktree detection (`project_resolve::worktree_of`), the lease table in `SidecarState`
  read by `idle_rest` and cap resting, no blind `_server.json` delete.
- Server: `GET /_api/shell/attest?n=` (routes/shell.ts), `MAUDE_SERVER_ROLE=cli` yield watcher
  (`shell/cli-yield.ts`), `_server.json` compare-and-delete, `/_api/shell/status.storeMode`.
- CLI: `cli/lib/desktop-locate.mjs` with `locateDesktop(root) → {port,label,kind}|null`, `askApp(op) → reply|null`
  and `verifyAttest(port, entry)`. `studio-locate.mjs`, `server-up.sh` (through a node one-liner),
  `screenshot.sh`/`smoke.sh`/`canvas-rects.sh`/`perf.sh`, `design-open.mjs`, `runtime-health.sh` and `browse.md`
  call it first.

## 9. Tests that prove it

- `apps/studio/test/server-json-single-writer.test.ts`: boot A, overwrite `_server.json` as B, stop A → the file
  still names B (red today: A unlinks it).
- `apps/studio/test/shell-attest.test.ts`: right key → valid MAC; wrong or short `n` → 400; no env → 404; absent from
  both canvas lists (`canvas-origin-parity`); the key is not in the agent env (`acp-env.test.ts`).
- `apps/studio/test/cli-yield.test.ts`: a `cli`-role server plus a fake attested registry entry → yields, releases the
  lock and exits 0; an unattested entry → does not yield; a job in flight → waits.
- `cli/lib/desktop-locate.test.mjs`: a planted `_server.json` plus a registry naming another port → the registry
  wins; a bad MAC → null; a dead app pid → null; resting → `askApp`.
- Rust unit tests: `cli_channel` refuses another uid, an oversize request, a non-`.design` root, a root under the
  app dirs; `worktree_of` on a file `.git` / a dir `.git` / a broken `gitdir`; leases expire; `spawn_for` deletes no
  `_server.json` (grep pin).
- Desktop e2e lane `cli-reuse` (T6.4): CLI plus desktop on one root → one `maude-server`, no browser, screenshot
  green; worktree → a new labelled tab, reaped on close, not in Recent; no app → today's fallback; the desktop opens a
  root a CLI server holds → that server exits, and the tab can undo within 10 s.

## 10. Open questions (each has a default)

1. Restore worktree tabs at relaunch? **Default: no** (agent-driven, short-lived; Home's Worktrees row reopens one).
2. Lease default TTL. **Default: 300 s**, renewed per verb; `/design:edit` runs that pause longer renew in their loop.
3. Should `ensure` front the app for `purpose:'capture'`? **Default: no**; only `show` and the consent sheet do.
4. Windows/Linux. **Default:** the same protocol over a user-only named pipe / socket under `$XDG_RUNTIME_DIR`; build
   it after macOS.
5. Linked-project double sync link (§1.4) without the CLI (two app installs, or `serve --force`). **Default:** out of
   scope; file a follow-up issue for a sync-link single-instance guard.
