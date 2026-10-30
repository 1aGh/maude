# S5 AI chat — slice plan (Phase 5, lane L3, runs first on L3)

Planning spike for package **S5** (plan § Phase 5 row "S5 AI chat"). This note is a slice plan, not a
contract: the interfaces are the Phase 1 contracts it cites (V2-1.15, V2-1.5, V2-1.14, V2-1.11, V2-1.18)
plus one new note S5.1a writes first (`S5-kernel-foundation.md`). Read code only; nothing was run.
Base: `feat/maude-v2` @ ec2ad93f.

## 1. Scope recap

S5 makes 03 AI Chat true end to end (29 artboards), plus the AI parts of 01. That means:

- **Runs.** A run registry with hub leases (V2-1.15), proved by a two-Mac race test. One AI per artboard,
  with a waiting line and Run on a copy (A4). The run list shows yours, plus others' as View only.
- **Undo.** Per-run stages and "one AI run = one version = one step" (V2-1.5), with the
  you · AI · Tereza interleaving matrix and an out-of-order "Undo this chat".
- **Queue.** Asks are backed by the outbox (V2-1.14): offline, not connected, setting up and used up all
  queue, and the prompt is never lost.
- **Panel.** The canonical panel: title ⌄, ✦ N, +, hide. A simple composer with the scope chip and the
  paperclip, suggestions with a why, and a result that describes itself.
- **On the canvas.** Rings and tags per artboard, and "Made by AI".
- **Chats.** A chat list grouped by canvas, full-text search, Move to trash. Attachments with folder
  consent. Inline permission and choice cards.
- **Needs you** across the panel, the pill, the tab, notifications and the Dock.
- **Leaving.** The quit / close-tab dialog with Keep going (A5), Open in terminal, the connect sheet (A2),
  and Advanced.

**Already shipped by Phase 4 and Phase 2 (don't redo it):**
- The AI chat island with the 03 header: `client/panels/chat-header.jsx`, testids `ai-chat-header`,
  `ai-chat-new`, `ai-chat-hide`, `ai-chat-count`. It is still hosted by the v1 `ChatPanel.jsx`, which has
  2349 lines.
- ⌘K Ask AI pre-fills the composer (`subscribeAskAI`) and never sends. `ai.chat` is ⌘/, desktop only.
- The hook bracket `routes/agent.ts` (`run/begin|end`, `edit/check|touched`, `check`) runs over an
  **in-memory, per-process** run map, `agent-runs.ts` (V2-2.4b).
- The outbox store with the `ai.prompt` intent kind, lane `ai:<chatId>` and 7-day expiry (`outbox/*`,
  V2-2.16). Nothing calls it for prompts yet.
- `notify.rs` polls `/_api/acp/activity` and drives the Dock badge (V2-3.5).
- The own tab bar (V2-3.7).
- **Not built anywhere (measured by grep):**
  - hub `ai_runs` / `ai_leases` / `ai_tickets`, `runs-v1` and the `fence` envelope;
  - kernel origin `runId`/`chatId`/`madeAt`, `history.undo {actionIds[]}`, and the in-process kernel for
    local projects;
  - `attributeArtboards`;
  - a quit dialog in `lib.rs`;
  - a server-side role gate on `/_ws/acp` prompt frames;
  - `HumanReason 'ai-chat'`.

  v1.9.0 (V2-2.18) did not carry the V2-1.5 / V2-1.15 hub parts, so S5 needs **one more additive hub
  release before any rc** (lead-cut, the V2-2.18 procedure).

## 2. Open questions resolved

| # | Decision | Why |
| --- | --- | --- |
| D1 | S5 owns the op-log foundation: the in-process kernel for local projects plus the V2-1.5 §5.2 kernel extension, in S5.1a/b. S1 and S2 consume it and do not build it. | No V2-2.x task built it. S5 is its first consumer (per-run stages). plan-s1 and plan-s2 both agreed on the team channel. |
| D2 | `kernel.mjs` and `store-core.mjs` are edited in a strict order: **S5.1a → S5.2 → S1's kernel slice** (`history.name`, `names` table, `history.aside`). | Same two files. Parallel builders would conflict. |
| D3 | The `/_ws/acp` role gate is checked **per prompt frame**, against the same live predicate `routes/agent.ts` uses (`readOnly()`: role and format gate), not stamped once at upgrade. It also covers `set-mode`, `set-config` and `permission-response`. | The role can drop mid-socket (A6 removal, V2-1.12 format gate). Rule 12: hidden ≠ refused. Red first. |
| D4 | P3 wins over 03's "asks only before replacing your work". A permission card appears exactly when Claude Code asks: its defaults plus the user's `~/.claude` rules. "Replace / move to the trash" asks come from the design plugin's PreToolUse hook answering `ask` (A13). "Always for this canvas" maps to the agent's own `allow_always` option and is hidden when the agent doesn't offer one. Maude keeps no flag-layer grant store. | P3, decision `v2-V2-0.3-p3-keep-claude-code-defa…`. No second permission system. |
| D5 | The chat list shows **your** chats only. Others' live runs appear in its "Running" group and in ✦ N's "On this canvas" as `RunPublic` rows, View only. No transcript, no prompt. | C27, V2-1.15 §14: chats are per Mac (`_chat/`, DDR-115). |
| D6 | Move a chat to the trash = `trashedAt` in `_chat/<id>.meta.json` (per Mac; the V2-1.12 merge-write keeps unknown keys). S1's Trash panel lists it through a provider (`GET /_api/acp/chats?trashed=1`). Restore clears the key. Clear out deletes the files. Queued prompts drop as G22. | Chats are not on the file plane, so the Trash panel cannot get them from `sync/trash.ts`. |
| D7 | Needs you has **no timeout** while the Mac is online and the owner's socket is alive. The 120 s deny stays only for a detached bridge (V2-1.15 Q1). It gets a security re-review in S5.6. | 03 "never times out", plus fail-closed on every abandonment path. |
| D8 | The ring overlay module `artboard-activity-overlay.tsx` is **owned by S5**. canvas-lib only mounts it with the data of the `dgn` `ai-runs` message (a lead patch request for the bridge table, plus a 5-line mount patch to the L1 owner). | Keeps S5 out of the serial L1 files. |
| D9 | `cf-undo-ai` (⌘Z undoes AI) is an S5 row. Its done-when waits on S2's ⌘Z rebinding. S5.5 builds `undo-stack` + `undo{actionIds,chatId}` and the pure projection reducer (`client/v2/undo/projection.js`). S2 builds keys, Undo history, and the iframe-stack retirement. | V2-1.5 feeds. Agreed with plan-s2. |
| D10 | Open in terminal = the native shell opens Terminal with `claude --resume <sessionId>` in the project root, through a Tauri command. Agent path: human `native-window`. In the browser shell the action is hidden **and** refused. | 03 `ai-adv-edges`. No new spawn surface on the studio HTTP side. |

**Cross-lane contracts to write first:**
1. **`S5-kernel-foundation.md`** — S5.1a's first commit. Consumers: S1 (local Version history) and S2
   (projection). It carries S1's four conditions:
   - machine stamp, plus a foreign store opened as `project-store.<machine>.sqlite` read-only;
   - the `_state/project-store.lock` single-writer lock;
   - a baseline `migration.import` per canvas on the first v2 boot;
   - an optional gzip codec on `createStoreCore`.

   It also carries the same `acceptedHistory / acceptedVersion / acceptedRestore / acceptedUndo` surface
   through `ctx.syncControl.current()` for local projects, and states that watcher writes are
   `kind: 'outside'`.
2. **L4 / S9 hub ownership:** while S5.1a and S5.2 run, `apps/hub/src/project-transactions/*`,
   `store-remote.mjs`, `apps/cells/project-store.mjs` and the new `apps/hub/src/runs-routes.mjs` are
   S5's. S9 doesn't edit them. One hub release (lead) carries S5.1a + S5.2 + S1's kernel slice.
3. **S1 ↔ S5 (no file, interface listed here):**
   - the chat Trash provider (D6);
   - Version history AI rows = actions grouped by `runId`, with `chat.undo` on the row;
   - the Canvases row meta "Needs you" reads `GET /_api/ai/runs`.

## 3. Slices

All server routes go through `routes/<area>.ts` factories. **Lead patch requests:**
- **(P1)** add `aiRoutes` / `chatRoutes` to `routes/index.ts` `allSpecs`, and the legacy `/_api/ai/*` +
  `/_api/acp/*` keys in `http.ts`. They become table routes, and `/_api/ai` keeps its `origin: 'canvas'`
  read.
- **(P2)** registry actions and `HumanReason 'ai-chat'` (V2-1.15 Q5).
- **(P3)** the `dgn` message `ai-runs`.
- **(P4)** `dist/` rebuild after each client slice.
- **(P5)** the `_state/` tripwire fixture entries (V2-2.16): `_state/runs/x.json`,
  `_state/project-store.sqlite`, `project-store.lock`, `ai-stage.json`. No new runtime class.

Testids: re-emit every `chat-*` / `ai-chat-*` testid on its v2 element (rule 5). The existing desktop
e2e `acp-*.e2e.ts` must stay green.

| id | Title | Artboards made verifiable | Files owned | Lead patch requests | Model | Deps | Done-when | Red-first tests | e2e / scenario | Turns |
|---|---|---|---|---|---|---|---|---|---|---|
| **S5.1a** | Kernel extension (V2-1.5 §5.2) + foundation note | — (enables U-rows) | `apps/hub/src/project-transactions/{kernel,store-core}.mjs` (additive: origin keys, `actionIds[]` undo/redo, `run_id`/`chat_id` columns + index, optional codec), `apps/hub/test/kernel-multi-undo.test.mjs`, `S5-kernel-foundation.md` | hub release slot (with S5.2) | opus — kernel / undo | — | One proposal undoes c1's runs 1 + 2 as **one** action. Stored `undoes` = both. Origin keys round-trip. A v1 envelope is unchanged. | U6 (proved wrong today: re-applies run 2), U7, U9, U5/U3/U17 kept green, the `actionIds` validation (1–50, own only → `forbidden`) | — | 90 |
| **S5.1b** | In-process kernel for local projects | — | `apps/studio/sync/local-kernel.ts` (bun:sqlite adapter for `store-core`, machine stamp, lock, baseline import, watcher → `outside`), `apps/studio/test/local-kernel*.test.ts` | wire the local runtime into `ctx.syncControl` (server.ts/http.ts): `/_api/project/{history,undo,restore}` stop answering `legacy` | opus — sync / versioned store | S5.1a | A local project answers history/undo/restore from `_state/project-store.sqlite`. A foreign machine's store opens read-only. Two studios on one folder: the second is refused by the lock. | U21 (local `legacy` today), the lock test, a reopen keeps fences + revisions | — | 130 |
| **S5.2** | Hub runs, leases, fencing (V2-1.15 §5.2–5.3) | — | `store-core.mjs` (`ai_*` tables, `runsBegin/Claim/Renew/End/List`, `fenceCheck` in `commit`, envelope `fence`), `store-remote.mjs` METHODS, `apps/cells/project-store.mjs` STORE_METHODS, `apps/hub/src/runs-routes.mjs` (5 routes, poke `{t:'runs'}`, `runs-v1`), `beforeHandleAwareness` `holding` strip/overwrite, `apps/hub/test/runs-*.test.mjs` | hub release (lead, before any rc). The hub manifest / writer-registry scrapers classify the 5 routes. | opus — hub + concurrency | S5.1a | 300-round HTTP race: 0 double grants. The cloud path under workerd: 0. L1–L10 each a passing test. | R2, R3, R5, S2, S3, S4, S7, L8 newcomer, L9 lapsed ticket, the split-acquire shape shown double-granting | — | 140 |
| **S5.3** | Studio run registry + `/_api/ai/runs*` | — | `apps/studio/ai/runs.ts` (registry, lifecycle reducer §5.5, renew timer, hub-or-local lease home, provisional + CAS §5.6, boot crash scan, `_state/runs/` tmp+rename, retention), `apps/studio/routes/ai.ts` (GET runs, stop, cancel, keep-going, copy, stop-all; v1 `/_api/ai/start\|heartbeat\|end` on the registry; derived `ai-activity`), `agent-runs.ts` becomes a view, tests | P1, P2 (`ai.runs.list`, `ai.stop`, `ai.cancel-waiting`, `ai.keep-going`), P5, bus event `ai:runs {seq}` | opus — run-registry concurrency | S5.1b, S5.2 | `GET /_api/ai/runs` returns mine/others/needsYou/live. A crash leaves `interrupted` records. `runningChats()` / `activitySnapshot()` read the registry, with no second map. `RunPublic` never carries prompt/question/doing. | R6, R7, R8, R11, R12, S5 (old hub → per-Mac + Diagnostics line), S6 (v1 `/design:edit` curl), the reducer per row, the projection-leak unit test | — | 150 |
| **S5.4** | Hooks + agent paths for runs | — | `routes/agent.ts` (deny codes `artboard-busy`/`out-of-scope`/`soft-locked`/`lease-lost`, `chat` binding, 409 `held-by-ai` data feed for S2), `cli/lib/design-hook.mjs` (`chat` from `MAUDE_CHAT_ID`), `acp/env.ts` (`MAUDE_CHAT_ID` into the spawn env), `maude design runs list\|stop` (`apps/studio/bin/runs.sh` + node shim), `plugins/design/hooks/hooks.test.mjs`, the `design` skill section "AI runs and busy artboards" | P2: agent paths (`ai.runs.list` cli auto, `ai.stop` cli auto own runs, `ai.run-on-copy` file). `actions.manifest.json` regen. The `Bash(maude:*)` narrowing check (A13). | opus — security / hook semantics | S5.3 | Terminal Claude sees busy artboards with `runs list` and gets a named deny on one. A chat's hook binds to its `starting` run, so one turn is never two runs. | H1–H5, S1 (`409 held-by-ai`), deny text with no prompt/chat content | — | 110 |
| **S5.5** | Per-run stages, attribution, undo routes | — | `sync/action-stage.ts` → run stages (`merge3` per run, `run-overlap` refusal, `_state/ai-stage.json` v2 reading v1, publish with `fence` + origin + `partial`), `apps/studio/attribute-artboards.ts` (oxc, reference closure), `routes/project-undo.ts` (`GET undo-stack`, `POST undo {actionId\|actionIds\|chatId, redo?}`, old-hub disabled line), `client/v2/undo/projection.js` (pure reducer), tests | P1, bus event `project:action` (V2-1.5 §5.3), P2 `chat.undo` (cli `maude history undo --chat <id>`, permission card; S1 owns the `history` verb, so S5 adds the `--chat` flag) | opus — undo / kernel | S5.1b, S5.3 | Two of your chats on P and S of one file land as **two** actions. Stop → one partial version. An error holds. A crash comes back held. Rings and `touched` name P + S for a K edit, not the whole file. | U10 (one action today), U11, U12, U13, U14, U24 (regex lights all), U1/U2/U4/U18 reducer, `merge3` disjoint/overlap, `attributeArtboards` on the v2 corpus (never inside strings) | — | 150 |
| **S5.6** | ACP server: gating, role gate, outbox, continuation | — | `acp/index.ts` (`prompt {askId, scope}` → `registry.ask` before `bridge.prompt`, chat-level FIFO, `{t:'run'}` frames, **per-frame read-only refusal**, continuation turns, Keep going via `loadSession`, Needs you without timeout D7), `acp/bridge.ts` (permission timeout rule), `outbox` wiring (closed gate `online` / `ai-connected` / `ai-allowance` → `ai.prompt` record; release → `registry.ask`, idempotent by id; G2/G5/G6/G12/G22–G24), tests | — (server-only) | opus — security + outbox | S5.3 | A read-only role's prompt frame → `{t:'error', code:'read-only'}` and `bridge.prompt` never runs. A prompt sent offline sends on reconnect, exactly once. A used-up prompt sends at `resetsAt`. | **acp-role-gate** (red today: the socket has no role), role flips mid-socket, outbox-order O2 with real chat frames, double-submit within 2 s → one, a Needs-you of 10 min not auto-denied (R13), a detached bridge still denies at 120 s | — | 140 |
| **S5.7** | Chat store: list, search, trash, terminal | — | `acp/transcript.ts` + `acp/transcript-io.ts` (canvas grouping from `canvas` meta, `trashedAt`, archive), `routes/chat.ts` (`GET /_api/acp/chats?group=canvas&trashed=`, `GET /_api/acp/chats/search?q=` full-text with snippets, trash/restore/clear), `apps/desktop/src-tauri/src/terminal.rs` (open Terminal `claude --resume`) | P1, P2 (`chat.new`, `chat.rename`, `chat.archive`, `chat.trash`, `chat.copy-transcript` human `ai-chat`; `chat.open-in-terminal` human `native-window`, desktop only and refused in browser), Tauri command registration in `lib.rs` (lead) | sonnet | — | Search over 41 chats returns highlighted snippets ≤ 100 ms. A trashed chat lists in S1's provider and its queued prompt is dropped. Terminal opens the same session. | search (title + body, accent-folded), trash drops queued prompt (G22), the browser refusal of open-in-terminal, `chat-meta-preserve` still green | — | 110 |
| **S5.8** | Panel host + composer + scope + suggestions | ai-open, ai-suggest, ai-scope, ai-question | `client/v2/ai/` new: `AiChatIsland.jsx`, `Composer.jsx` (📎 slot, scope chip + menu: Whole canvas · artboard · Choose artboards… · No canvas — just ask), `Feed.jsx`, `Suggest.jsx` (≤ 3 chips + one why line from comments / clips / last ask), `point-ring` hint; `ChatPanel.jsx` shrinks to a thin host (moves, nothing deleted); `ai.css` (tokens only) | P2 (`ai.ask` human `ai-chat`; `ai.chat` gains `minRole: edit`), P4 | sonnet | — | ⌘/ opens and focuses the field, esc gives focus back. The chip says what AI touches. A question answer ends "The canvas didn't change." Azure send (rule `send-and-ask-ai-are-azure`). | scope-chip state test, suggestion-why derivation (pure), a nothing-deleted test for every moved v1 control, ⌘/ focus test | scenario `ai-chat-simple` steps 1–4 | 140 |
| **S5.9** | Working line, result card, long chat, pin | ai-working, ai-done, ai-long, ai-long-pinned | `client/v2/ai/{Working,Result,BigChat}.jsx` (Working + Stop; Result Undo · Keep going / Compare / Keep the copy; "What AI did · N steps · T" fold; follow-up chips; resize, double-click full height, Jump to latest · N new; Pin to the side via the V2-4.1 pin model), polite live region | P4 | sonnet | S5.8 (UI). Undo needs S5.5. | Done reads "Done — <artboard> is <result>…" (rule `ai-describes-the-result`). Undo = `POST undo {actionId}` of the run. Pinned column shrinks the canvas. | result-card verb set per variant, live-region announces each state once, Jump to latest count | `ai-chat-simple` steps 5–7 | 120 |
| **S5.10** | Attachments + folder consent | ai-attach, ai-attach-menu | `client/v2/ai/{AttachMenu,AChip,DropOverlay,Consent}.jsx`; server `routes/chat-attach.ts` (folder grant per Mac in `_state/ai-grants.json`, read-only listing, video duration / PDF page probe, attachments → Assets), the session's read scope for granted folders | P1, P2 (`ai.attach-files`, `ai.attach-folder`, `ai.attach-assets`, `ai.attach-screenshot`: human `ai-chat`), Tauri file/folder dialog command (lead) | opus — widens what the agent can read | S5.8 | Drop / paste / paperclip yield chips. A folder needs consent once and stays read-only (no write path into it). Not now sends without it. | the grant never allows a write (acp-write-scope extended), the consent is per folder realpath (no symlink escape), `chat-attachments` green | `ai-chat-attach` | 120 |
| **S5.11** | Runs UI: ✦ N list, waiting, copy, rings | ai-hero, ai-two-artboards, ai-same-artboard, ai-copy, ai-queue-rule, ai-tereza | `client/v2/ai/{RunList,WaitingCard}.jsx`, `artboard-activity-overlay.tsx` (D8: working dashed spark + tag + "· N waiting", needs-you azure, others' face-led tag, done ring + wipe + "Made by AI", reduced motion 1 ms), `client/v2/ai/runs-store.js` (subscribes `ai:runs`) | P3 `ai-runs` `{artboards: Record<id,{state,who,tag,waiting}>}` parent-relayed; L1 mount patch in canvas-lib (5 lines); P2 `ai.run-on-copy`; P4 | sonnet | S5.3, S5.8 | Two chats on two artboards: ✦ 2, both ringed. A second ask on a busy artboard shows the Waiting card and starts by itself. Run on a copy places the copy beside the original, from the accepted content. Tereza's run is View only and never counted. | the ✦ N counts only yours, the waiting-card copy rule (estimate only when computed), the ring data has no prompt text, the parent-only relay source check | `ai-chat-runs` (single Mac: R6, R8, R9) | 140 |
| **S5.12** | Chat list + Advanced + edges | ai-chat-list, ai-advanced, ai-adv-edges | `client/v2/ai/{ChatList,Advanced,RawLog}.jsx` (Running first, Earlier by canvas + "N more", search highlights, row ⋯ Open · Rename… · Copy transcript · Archive · Move to trash; Advanced rows = CapabilityBar pickers, Show in chat view, context %, Raw log island, Open in terminal, suggestions on/off, folders AI may read, Always allowed · Reset; message Copy/Retry; suggest-only banner "Allow changes"; slash menu kept) | P2 (Advanced row ids for ⌘K "AI chat panel › Advanced"), P4 | sonnet | S5.7, S5.8 | Every v1 chat control has its v2 home (G0-D D9 ticked). ⌘K finds "model", "raw log", "terminal". | D9 nothing-deleted rows, context % = used/size, the trash dialog names a queued prompt | `ai-chat-list` | 130 |
| **S5.13** | Needs you, inline cards, not-ready | ai-permission, ai-choice-fail, ai-not-ready, ai-needs-hidden, ai-panel-closed | `client/v2/ai/{PermissionCard,ChoiceCard,ProblemCard,ConnectSheet,NotReady,FoldNeeds}.jsx` (lift `PermissionPrompt`/`ElicitationPrompt`/`ReadinessList` logic; D4 mapping; queued / setting-up / used-up / meter lines from outbox gates; ConnectSheet exported for S6), the folded spark busy dot / azure count, in-app toasts | P2, P4; S1 patch: the Canvases row meta "Needs you" | sonnet | S5.6, S5.8 | A permission waits inline, never modal, and the azure ring marks what will change. Offline / not connected / used up keep the prompt and send by themselves (rules `ai-offline`, `ai-not-connected-yet`). The hidden panel shows the busy dot and Needs-you count. | the card title verb = button verb, "Always for this canvas" hidden without `allow_always`, a not-ready prompt never lost across reload | `ai-chat-needs-you` (in-app half) | 140 |
| **S5.14** | Native: quit dialog, Keep going, tabs, notifications | ai-quit, ai-other-tab, ai-needs-tab, ai-needs-away | `apps/desktop/src-tauri/src/{lib.rs (ExitRequested/CloseRequested prevent + round trip), notify.rs (poll `/_api/ai/runs`, Q3 text, Dock = Σ needsYou), tabs.rs (spark / ? marks)}`; `client/v2/ai/QuitDialog.jsx`; the stopped divider + Keep going | Rust files are L4 — run in an L4 window (lead schedules). P4. | opus — Rust/Tauri | S5.3, S5.6 | ⌘Q with 2 running + 1 waiting → dialog "2 chats" → 2 partial versions, 0 hub leases in ≤ 5 s, the sidecar killed. Relaunch shows the divider + Keep going. Notification text without the question. | R10, R11 at boot, the badge sum across projects, a second ⌘Q quits | desktop e2e `ai-quit.e2e.ts`, `ai-needs-away` (screen unlocked, memory) | 130 |
| **S5.15** | Undo this chat, Made by AI, two-Mac matrix | ai-history; 01 cf-ai-done, cf-undo-before, cf-undo-ai, cf-busy | `client/v2/ai/ChatUndo.jsx` (chat ⋯ + Version history AI row action), the Made-by-AI derivation (`client/v2/ai/made-by-ai.js` from `project:action`), the two-Mac rig `apps/desktop/e2e/multiplayer/ai-runs.e2e.ts` (two studios + local hub, Node 24, fake agent) | S1: the Version history AI filter consumes `kind=ai` + `chat.undo`; S2: ⌘Z rebinding (D9) | opus — undo / run concurrency | S5.5, S5.11, S5.14; S1 (panel), S2 (⌘Z) for `cf-undo-ai` | The interleaving matrix E-rows green. Undo this chat out of order = one version. Made by AI clears on the next person's edit. | U3, U6, U8, U15, U16, U22 (old hub: disabled line), U23 E-layer; R1 (50 rounds), R4 (SIGSTOP 40 s) | `ai-runs` two-Mac scenario (R1, R4, R10 rerun, U-matrix E) | 150 |

## 4. Ledger coverage

**03 (package S5, 29 rows), each in exactly one slice:**

| Slice | Rows | Count |
| --- | --- | --- |
| S5.8 | ai-open, ai-suggest, ai-scope, ai-question | 4 |
| S5.9 | ai-working, ai-done, ai-long, ai-long-pinned | 4 |
| S5.10 | ai-attach, ai-attach-menu | 2 |
| S5.11 | ai-hero, ai-two-artboards, ai-same-artboard, ai-copy, ai-queue-rule, ai-tereza | 6 |
| S5.12 | ai-chat-list, ai-advanced, ai-adv-edges | 3 |
| S5.13 | ai-permission, ai-choice-fail, ai-not-ready, ai-needs-hidden, ai-panel-closed | 5 |
| S5.14 | ai-quit, ai-other-tab, ai-needs-tab, ai-needs-away | 4 |
| S5.15 | ai-history | 1 |

Total 29. `ai-hero` is verified last within S5.11, and needs S5.5's done ring for its finish.

**01 (package "S6, S1, S5", 20 rows):**
- **S5.15:** `cf-ai-done`, `cf-undo-before`, `cf-undo-ai` (done-when also waits for S2's ⌘Z), `cf-busy`.
- **Assigned elsewhere:**
  - **S6:** `cf-home-prompt`, `cf-ai-drafting` (the first-canvas drafting flow; uses S5.3/S5.11 rings),
    `cf-blank`, `cf-render-error` (C5), `cf-offline-create` (uses S5.6's queued prompt).
  - **S2:** `cf-select-tweak`, `cf-add-artboard`, `cf-duplicate-width`, `cf-duplicate-done`,
    `cf-frames-text`.
  - **S4:** `cf-sticky-comment`.
  - **S1:** `cf-big-tree`, `cf-panel-search`, `cf-search-k`, `cf-open-big`.
  - **S9:** `cf-status-words` (save status).

**05 (package S11):** none is S5's. S5.13 builds the AI empty / not-ready surfaces that `es-canvas-ai`,
`es-canvas-three`, `es-panels-make` (AI chat empty) and `es-edge-panels` (chat search with no hits) show.
S11 verifies them.

**Rule rows S5 closes:**
- `00/rule/one-ai-per-artboard` — S5.11 + S5.15 R1
- `00/rule/ai-offline` — S5.13
- `00/rule/ai-not-connected-yet` — S5.13
- `00/rule/send-and-ask-ai-are-azure` — S5.8
- `00/rule/ai-describes-the-result` — S5.9 (the agent-side brief wording is S12's)
- `00/rule/ai-holds-still-under-your-pointer` → **S3**: Preview reload gating. S5 supplies the
  `project:action` landing event.
- `00/rule/a-way-in-without-ai` → **S6**.

**Home rows:** `G0-D/D9` (Chat) — S5.12 owns the tick sheet, and S5.13 delivers its card / used-up parts.

## 5. Risks and run order

**Waves** (parallel only where files don't overlap):

| Wave | Slices | Notes |
| --- | --- | --- |
| W1 | **S5.1a** (hub kernel) ‖ **S5.7** (chat store) ‖ **S5.8** (client host) | disjoint: hub / acp+routes/chat / client/v2/ai |
| W2 | **S5.1b** (studio local kernel) ‖ **S5.2** (hub runs) ‖ **S5.9** ‖ **S5.10** ‖ **S5.12** | S5.1b and S5.2 share no file: S5.1b is studio-side, S5.2 is hub-side. The three client slices own separate `client/v2/ai/*` files, and only S5.8 edits the host. |
| Gate | hub release (lead) | S5.1a + S5.2 (+ S1's kernel slice if ready). Additive, v1-compatible, before any rc. |
| W3 | **S5.3** | the registry |
| W4 | **S5.4** ‖ **S5.5** ‖ **S5.6** | agent.ts+hooks / action-stage+attribution+undo routes / acp index+outbox. All three read `ai/runs.ts`; none edits it. |
| W5 | **S5.11** ‖ **S5.13** ‖ **S5.14** (L4 window) | |
| W6 | **S5.15** | needs S1's Version history panel + S2's ⌘Z rebinding for its last two rows |

**Risks:**
1. **The hub release is on the critical path.** S5.3 can develop against S5.2's store in-process, but the
   two-Mac proof needs the released hub, or a local hub from the branch. Ask for the release slot at W2.
2. **Kernel-file contention.** Three packages touch `kernel.mjs` / `store-core.mjs`. The D2 order is
   binding, and the lead should refuse a parallel spawn.
3. **The in-process kernel imports hub code into the compiled sidecar** (`apps/hub/src/project-transactions/*`).
   It must pass the import-coherence gate and the DDR-177 bundle completeness gate. S5.1b's done-when
   includes `check-bundle-completeness.mjs --smoke` on a built `.app`.
4. **Two-Mac e2e timing.** It needs an unlocked screen (memory). Run R1/R4 once with the lane free; they
   are not CI gates.
5. **`ChatPanel.jsx` (2349 lines) moves into `client/v2/ai/`.** The nothing-deleted test and the testids
   catch regressions. S5.8 moves code; it doesn't rewrite it.
6. **The no-timeout Needs you (D7)** reopens DDR-179's fail-closed posture. A security re-review is
   required at the S5 gate.
7. **Rust slice S5.14** shares `lib.rs` with L4 (S9 native). Schedule it inside an L4 window, never
   concurrently.

**Total ≈ 2,090 turns over 16 slices.** 10 are Opus (S5.1a, 1b, 2, 3, 4, 5, 6, 10, 14, 15 — the risk
classes) and 6 Sonnet (S5.7, 8, 9, 11, 12, 13).
