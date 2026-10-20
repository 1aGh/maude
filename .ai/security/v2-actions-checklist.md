# Maude v2 security checklist — the project items

Read by `flow:security-auditor` and `flow:ethical-hacker` through `security.projectChecklist` in
`.ai/workflows.config.json`. Check every changed file against each item and cite it by its number
(`C7`). The generic `security-rules` catalog still applies; this list is what only Maude has.

Sources: the v2 gate reviews (Phase 1, 2, 4; wave A; wave B defender + attacker; the S8.5b render door,
`.ai/security/v2-S8.5b-render-door-review.md`) and their fixes (decisions `v2-gate-b-sec1-*`,
`v2-phase2-gate-*`, `v2-S6.0c-window-gate-is-sec-fetch-site`). Ask the graph before re-deriving one:
`kg search "<topic>"`.

A finding on a "Fail-first" item needs a test that goes red on the fix being reverted. A new capability
is also a registry action, a route that enforces its role, and an agent path (surface = substrate).

## A. Who may do it (tier, role, origin)

- **C1 · Every new capability has a registry action with a `minRole`, and the server route enforces it.**
  The client's `canEdit` / `minRole` only shapes the UI. Check the route (`readOnlyRefusal`,
  `access-role-matrix.test.ts`, `_role-refusals` rows), not the button. A hub route also needs its
  `studio-manifest.mjs` row (a cell refuses what the manifest does not list).
- **C2 · A new `maude design <verb>` has the right tier.** `verbTier` (`actions/verbs.ts`): effect `none`
  or `project` without a hold is `auto` and becomes a `Bash(maude design <verb>:*)` allow rule the AI
  runs without asking. Ask of every auto verb: can it read outside this project, spend money or quota,
  reach the network, write where a peer's text could steer it, or delete? Then it is `prompt`, or it
  takes no such argument.
- **C3 · A path or root argument is confined to the session's project.** Wave-B attacker finding 1 (open
  at the time of writing): auto verbs take `--root <any project>`, which is an exfil trifecta (read
  project B, write into A's synced board). Under the chat environment (`MAUDE_CHAT_ID` /
  `MAUDE_AGENT_ACTOR=maude-chat`) a `--root` whose realpath is not the session root is refused, and
  `outOfProject` (bash-guard) must judge verb path flags, not only redirects.
- **C4 · Canvas-origin routes stay narrow.** A route the untrusted canvas iframe (DDR-054) can reach is
  in BOTH `CANVAS_SAFE_API` and `routes/canvas-origin.ts` (a `origin: 'canvas'` spec does both); a
  privileged route (file write, export, `/_config`, anything that spends) is in neither.
  `test/canvas-origin-parity.test.ts` holds it. A canvas-safe GET that carries personal data returns
  a projection (no e-mail), and reads are scoped to the requesting canvas (wave-A C4).
- **C5 · A canvas cannot write what only people write.** Vote, ballot, stamp and result ids are refused
  on canvas-origin board writes and recounted on read; a ballot is committed from a shell-owned
  control, never from a canvas message with no gesture (wave-A M1/M2/C1). The same for
  `to-sticky`, `convert-undo` and any route that acts "as the viewer".
- **C6 · Messages from the canvas are parsed, never trusted.** Every canvas → shell `postMessage`
  goes through `acceptFromCanvas` (origin + active frame + strict parse) and a table entry
  (`DGN_TABLE`); text it carries goes through `notifyCanvasText` (rate limit, coerced to a string).
  A raw `e.data` read is a finding (wave-A M3: a number in a toast title unmounted the shell).
  Shell → canvas sends use one target helper, not `'*'` (Phase 4 D4).
- **C7 · A navigation or window-opening door asks the browser who is calling.** `Sec-Fetch-Site:
  same-origin` checked before the body, a job or a token is touched (S6.0c); a bare `Origin` check or
  "no Origin means the desktop" (`/_ws`, wave-B finding 4) is not enough for a write. Sockets refuse a
  cross-origin handshake (`isSameOriginWs`); the Host guard against DNS rebinding covers every new
  `/_*` read, including the static lane (`/.env`, `/.git/config`) and `/assets/`.

## B. What text and files are data (injection)

- **C8 · Anything another person or the project wrote is untrusted data.** Comments, stickies, labels,
  artboard and DS names, file names, log lines, peer-written `config.json` / `head.json` /
  `.meta.json`, hub error text. Verb output reaches the model inside the untrusted envelope
  (`writeUntrusted`); it never reaches a hook `decision: block` reason, a deny message, a toast, the
  studio brief or a prompt raw. Deny and check messages carry cleaned, capped text (EH-C2, F3, R3-3,
  R3-4: Unicode tags, word joiners, variation selectors); Home shows the hub's error only through a
  fixed reason-to-words map (`v2-gate-b-sec1-join-fixed-words`). A prompt that interpolates canvas
  paths or DS names (`handoff/run.ts`) is a finding until they are cleaned.
- **C9 · A tool result cannot widen the agent's own fence.** A bounded writer (hand-off `owns`, scoped
  run) must fail CLOSED: an agent type that requires a hand-off with none valid has all writes denied,
  and maude verbs are inside the fence too (a per-agent verb allowlist; wave-B finding 3 — `ds-migrator`
  reads peer-written DS labels). The agent must not be able to write `_runs/**/handoff/*.in.json` or
  `agents.json`, and the guard compares realpath and case-folded paths (`.DESIGN/_RUNS` on APFS, `ln -f`).
- **C10 · Maude's own harnesses get no origin exception.** Only the two `LOCAL_HARNESS` module shapes
  render on the canvas origin; a repo `.html` or `.svg` is served inert (sandbox / `INERT_DOCUMENT_CSP`)
  on the main origin; an AI-writable file never renders where privileged routes are reachable. The
  trifecta rule: private data + untrusted content + an exfil channel (git push, paid generation, fetch)
  in one agent loop is a finding even when each piece is "auto".
- **C11 · Imported files are sanitized by the importer, once.** SVG goes through `import-asset`
  (allow-list, no script, no event handlers, no external reference); a new converter (HEIC, PSD, PDF)
  runs under the same size / pixel / time caps and writes only content-addressed names inside
  `<designRoot>/assets/`.

## C. What leaves the machine (credentials, network, cells)

- **C12 · A credential is used only for a record made on this Mac.** A DS library link, hub address or
  grant that arrives through sync (`head.json`, `config.json`) is a peer's text: it never selects the
  hub or the token. Links are recorded per Mac outside the synced tree; a missing record is
  `ds-library-relink`, and "Link again" shows the hub address, re-asks for the grant and has no
  member-token fallback (`v2-gate-b-sec1-library-link-record`; wave-B finding 2 reopens it if the
  fallback stays).
- **C13 · A cell has no new outbound door.** No DS library door (`v2-gate-b-sec1-no-library-in-cell`),
  no loopback or `http:` target, `redirect: 'error'` on every hub health or fetch call, and error codes
  that are not an oracle. In a cell the studio child receives no peer token, no cookie and no inbound
  `x-maude-*` header (`forwardAs` builds the upstream request from nothing); the lane test taps the
  headers. A new `/_api/*` route answers a cell with REFUSED in the hub manifest until it filters by
  `sees`.
- **C14 · A configured output stays where the design root allows.** A handoff `out`, an export folder or
  any path read from a peer-writable config sits under the design root or the kind's default folder and
  has the kind's extension; it is never `package.json` or a source file
  (`v2-gate-b-sec1-handoff-out-folders`).
- **C15 · A staged or proof studio runs with a scrubbed environment.** `ds-upgrade prove` strips secrets
  and cell / hub / pairing variables and refuses in a cell (`v2-gate-b-sec1-prove-env-and-cell`). Any
  new child process that opens a project gets the same scrub.
- **C16 · Spend and quota are a person's act.** A paid generation, a render, a describe run or a
  library update is `prompt` tier and rate limited per actor (the door: 60 submits a minute, 30 an
  hour, 2 active). A route that hashes or reads files for a caller counts its cost (render door L1).

## D. State that must agree

- **C17 · A new `_*` runtime path is added to all FOUR lists** (`isMaudeRuntimeState`,
  `gitignore-block.mjs`, the repo `.gitignore`, and `isRuntimeStateRel` in `sync/file-membership.ts`
  with its byte-identical hub mirror). A runtime-state path that leaks to the file plane syncs to peers.
  A canvas name may not start with `_`. Classifiers compare case-folded (a peer's `_HISTORY/x.tsx`).
- **C18 · One doc name per file.** Sync groups canvases by the final namespaced doc name, so two files
  cannot collapse into one doc; AI writes, git and Syncthing paths are checked too (wave-A C5).
- **C19 · A guard list names the tools that run code on commit.** `PROTECTED_IN_PROJECT` includes
  `lefthook.yml`, `.husky/*`, `.pre-commit-config.yaml` and the quality gates in
  `.ai/workflows.config.json`; a Save-version commit does not run hooks the AI could plant.
- **C20 · Versioned files never break a v1 peer.** A new field in a synced file is optional and ignored
  by old readers; a new file kind is classified in the file plane before it is written.

## E. How a finding is closed

- **C21 · Every finding at or above the floor is fixed with a fail-first test.** Revert the fix once and
  watch it red. Findings below it are listed as open lows with a place (a follow-up, never "logged"
  without an owner). A fix to a hole that also exists in the last release is released as a patch with
  Michal's go.
- **C22 · Accepted risks are decisions.** The linked-project trifecta (EH-C1) is accepted by Michal
  (`v2-phase2-gate-linked-project-writes-accepted`) with the untrusted envelope as the mitigation. An
  item here that a change weakens is a finding even if an earlier review accepted a neighbour of it.
