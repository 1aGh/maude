# DDR-250 — The desktop owns a checkout's server; the CLI finds it in an app-owned registry and asks over an app-owned socket

- **Status:** Accepted (Michal 2026-11-08: first-open trust option A)
- **Extends:** DDR-106 (sidecar over the compiled server), DDR-109 (loopback guard), decision `v2-3.4-shell-probe-gate-order` (the shell trusts app-owned files and per-spawn secrets, never the project), `v2-3.7-own-tab-bar` (tabs = a sidecar pool behind one window), `v2-3.5-deep-link-routing`
- **Related:** DDR-084 (server-up boots the compiled binary), `maude/burndown-t1-9-server-up-always-headless`, `maude/burndown-t1-10-app-cli-spawns-adjacent-sidecar`, `gate-b-sec4` (a committed `linkedHub` is a claim, `sync/link-consent.ts`), issue #115 (why Rust deleted `_server.json`)
- **Ticket:** issue #206; plan `.ai/plans/feature-issues-burndown-2026-11.md` T6.1–T6.2
- **Contract:** `apps/studio/client/v2/contracts/206-cli-reuses-desktop.md`

## Context

A terminal design run (`/design:new`, `/design:edit`, screenshots, critics) boots its own `maude-server` through
`server-up`, even when Maude Desktop already serves the same checkout. Measured (contract §1):

- a second server costs 130–360 MB steady, peaks near 0.9 GB per index build, and adds 0.4–0.7 s boot and a second
  watcher and build cache;
- whichever server started first holds the project store lock, so when the CLI was first **the desktop tab is
  read-only** (⌘Z → 409 `store-locked`) for as long as the CLI server lives, and a `server-up` server never exits by
  itself;
- `_server.json` has two writers and no owner: `sidecar.rs spawn_for` deletes the CLI's file, and the CLI server's
  graceful shutdown deletes the desktop's. Then the next `server-up` starts a third server. Rust no longer reads the
  file at all (`wait_for_shell_url` reads the app-owned info file), so the deletes protect nothing.

The shell's trust rule already says the project tree is untrusted. The CLI needs the same rule in the other direction.

## Decision

1. **One owner per checkout while the app runs: the app.** The app's sidecar is the server for its roots. A
   CLI-started server (role `cli`) yields to a verified app sidecar for the same root: it finishes its jobs, releases
   the store lock and exits. The app never adopts, signals or kills a server it did not spawn.
2. **Discovery is an app-owned registry, verified by challenge-response.** Rust writes `<app_data_dir>/servers.json`
   (0600 in a 0700 dir): root realpath → port, pid, state, profile, kind, and a per-spawn `attestKey`. The sidecar gets
   the key as `MAUDE_SHELL_ATTEST_KEY` (scrubbed from the agent like every `MAUDE_SHELL_*` var) and answers `GET
   /_api/shell/attest?n=` with an HMAC over nonce, rootId and port. The CLI uses a port only after that MAC checks
   out. `_server.json` stays for app-less machines and is never a trust input when the registry names the root.
3. **CLI → app is an app-owned unix socket with replies** (`<app_data_dir>/cli.sock`, peer-uid checked): `ensure`,
   `status`, `show`, `lease`/`release`, `restart`. `show` reuses the deep-link routing internals, never the URL parser.
4. **A worktree is its own tab**: labelled `<main> · <branch>`, counted against `RUNNING_CAP`, not in Recent, not
   restored at relaunch, listed in Home under its main project, bound to the main project's profile, and **never
   linked**. The app never passes `MAUDE_APP_BOUND_HUB` for it. `link-consent` already parks its committed
   `linkedHub`, and its Share sheet offers no Connect.
5. **Agent-driven tabs are busy while a lease lives** (TTL, renewed per verb). When three busy or active tabs fill
   `RUNNING_CAP`, the CLI falls back to its own headless server and says so.
6. **A branch change under an open tab warns and relabels.** It refuses only when the tab has unsent changes.
7. **`_server.json` gets a single-writer rule.** The server unlinks it only while it still names itself
   (compare-and-delete), and the three blind deletes in Rust are removed. `runtime-health --restart` never kills an
   app-owned server; it asks the app to restart it.

## Rejected alternatives

- **`maude://open/…` from the CLI.** Any web page can send it, the grammar carries a slug and never a path (two
  worktrees of one linked project share a slug), and it has no reply (no port, no consent outcome). It stays the
  web-to-app door.
- **Single-instance argv** (`Maude --open-root <p>`). The plugin socket is one-way (`/tmp/<id>_si.sock`, `cwd\0\0argv`),
  and every call needs the app binary located and exec'd.
- **Trust `_server.json` + `/_health` pid/rootId (today's accidental reuse).** The file is in the project, and a
  synced or planted copy plus any listener that echoes the pid and rootId passes.
- **The desktop adopts the CLI's running server.** That server carries no profile env, shell token, parent watch or
  app port, so adopting it would grant app-level trust to a process the app did not start.
- **The desktop kills the CLI server by the pid in the lock or `_server.json`.** That signals a number read from a
  project file.
- **One shared server for a worktree and its main checkout.** They are different trees; a server serves one root.

## Consequences

- With the app running, a design run starts no server and opens no window, and the desktop is never read-only
  because of a terminal run.
- New attack surface: a same-user socket that can ask the app to open a folder. That is exactly the first-open trust
  question (contract §7, options A/B/C, recommendation A: silent for known folders and their worktrees, a one-time
  sheet for a new folder).
- The two-servers-on-a-linked-root double sync link is not closed for non-CLI paths (`serve --force`, two installs).
  It is named in the contract §10.5 as a follow-up.

## Open

Michal's answer to the first-open trust question (contract §7). Defaults for the rest are in contract §10.
