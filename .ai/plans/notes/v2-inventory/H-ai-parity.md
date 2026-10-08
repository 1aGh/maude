# H — AI parity audit: Maude v2 UI vs. the AI/automation surface

> Read-only audit, 2026-10-08. Repo `personal/maude` @ `ea27a751` (main; Phase 0 not started, `app.jsx` still 17,444 lines).
> Principle under test: **Maude is a design tool built around AI. Every feature the v2 UI offers must also be operable by Claude** — (1) from the in-app AI chat panel (ACP session: Claude Code + bundled plugins, DDR-168) and (2) from Claude Code in a terminal via the plugins + the `maude` CLI.
> Sources: `.ai/plans/feature-maude-v2-redesign.md` (S1–S11, Gate 0), `.ai/plans/notes/v2-inventory/A…F`, `.design/system/maude-v2/CONTRACT.md`; `plugins/{design,flow}`, `cli/`, `apps/studio/{http.ts,acp/,bin/}`, `apps/desktop/src-tauri/src`.

**Headline findings**

1. **The plan has no agent-parity workstream.** "CLI parity" appears once (S8 export). The action registry (V2-1.3 / V2-2.4) is specified as `id, label, where-path, keys, visibility predicate` feeding menus, ⌘K, "?" and the native menu. It has no params, effect class, risk tier, server binding or agent surface, so it cannot produce agent tools as written.
2. **Today the agent's main write path is "edit the source file".** That covers anything stored in project files: canvas TSX, `.meta.json`, `.annotations.json`, DS CSS. Plugins call only ~25 of the ~170 HTTP routes. Claude cannot reach these at all: server, hub and UI state (versions, trash, comments resolution, exports history, sync, roles/share, modes/present, navigation/selection, run queue). This is the class v2 grows most.
3. **The ACP session exposes no tools of the app's own.** `newSessionParams()` sends `mcpServers: []` (`acp/bridge.ts:556`). The only agent→UI channel is `POST /_api/acp/focus` ("open the chat panel"). The agent can read the user's selection (`_active.json`, per-turn `[maude-context]`) but cannot select, open, navigate, switch mode, present or reveal anything.
4. **v2 introduces state that file edits will silently break.** Examples: one AI per artboard (A4), one AI run = one undo step / one version (V2-1.5), soft locks (A10), DS per-canvas pinning plus the "outside change" review (A9, §7), "moved to the trash" never deleted (§7, C17), Made-by-AI provenance. A terminal Claude that `Edit`s a canvas or `rm`s a file bypasses all of them. Today it already shows up as an "outside change", attributed to nobody.
5. **The auto-approve rule `Bash(maude:*)` (DDR-184) grants every `maude` subcommand.** That includes `maude design link/adopt/unlink/detach`, `maude hub token …`, `maude config set`, `maude init --force` and `maude harness`, not only the design helpers. If parity is closed by adding more `maude` verbs, every new verb, including share/invite/role/clear-out, is auto-approved by construction in a session steered by untrusted project content (DDR-054). The recommendation below closes this.

---

## 1. Inventory of today's AI / automation surface

### 1.1 Design plugin — commands (24; `plugins/design/commands/`, ACP auto-loads all of them)

| Command | What it does |
| --- | --- |
| `/design:init` | One-time project design config (`.design/config.json`) + dependency check |
| `/design:setup-ds` | Staged DS bootstrap (vision → research → moodboard direction pick → refinement → LOCK) into `system/<ds>/` folder (tokens CSS + preview specimens + showcases); critic rounds |
| `/design:setup-docs` | Regenerate `<designRoot>` README + canvas INDEX |
| `/design:new` | Create a multi-artboard canvas (normal / blank brief board / ingest-from-annotations), DS-grounded envelope, per-artboard screenshot reality check, auto-critic loop |
| `/design:edit` | Apply NL feedback to the active canvas in place (AST fast path, snapshot, AI-activity banner, draw/media routing, reality check, ds-keeper, critic loop) |
| `/design:critic` | Run the specialist critic panel on the active canvas (`--agent`, `--system-only`) |
| `/design:rollback` | Restore `_history/<slug>/` snapshot(s) taken before each `/design:edit` |
| `/design:screenshot` | Capture canvas / artboard / element / selector / all screens |
| `/design:smoke` | Batch-screenshot every canvas + specimen; blank/unstyled detection; `--perf` |
| `/design:browse` | Open the local canvas browser |
| `/design:chat` | Open the native ACP chat panel (`maude design chat-open` → `/_api/acp/focus`) |
| `/design:board` | Read the whiteboard/annotation layer, answer/annotate it, or generate a board template (retro, kanban, roadmap, …) |
| `/design:draw` | Logo/icon/illustration/diagram via the geometry engine + draw-agent/critic loop |
| `/design:export` | `POST /_api/export` (PNG/PDF/SVG/HTML/PPTX/Canva/ZIP/MP4/WebM/GIF) |
| `/design:handoff` | Emit a shadcn registry sidecar for the active canvas |
| `/design:generate` | BYOK image/audio/video generation → place asset on canvas |
| `/design:photo` | Parametric photo adjust / masks / background removal |
| `/design:import` | Figma/FigJam REST import or `--reconstruct` from an image (vision, sandboxed agents) |
| `/design:reel` | Footage → analysis → EDL → directed Remotion cut (captions, music, transitions) |
| `/design:video-analyze` | Scene-aware keyframes + transcription analysis of a clip |
| `/design:to-lottie` | Verified Lottie from code |
| `/design:to-rn` | React-Native-SVG + Reanimated fallback component |
| `/design:hub-workspace` | Set up and verify a self-hosted hub workspace |
| `/design:help` | List design commands |

### 1.2 Design plugin — skills (9 + 24 `source-command-*` mirrors)

| Skill | What it does |
| --- | --- |
| `design` | Core canvas design/edit rules: DS grounding, snapshots, comments, routing (`_guide-*`) |
| `design-system` | Read / bootstrap / completeness-check a DS (modes); multi-DS via `config.designSystems[]` |
| `ui-kit` | Artboard conventions per platform (desktop/mobile/tablet/print), prototypes |
| `whiteboard` | Read/write annotations via `canvas-rects` + `read-annotations` + `annotate` (DDR-151/242) |
| `video-comp` | Author/export editable Remotion video canvases, timeline metadata |
| `footage-director` | Analyzed footage → EDL → comp code |
| `footage-keyframes` | Scene-aware keyframe extraction (`smart-frames`) |
| `ai-generation` | BYOK generation, asset localisation, consent |
| `self-host` | Self-hosted hub targets (VPS/EC2/Docker) |
| `source-command-*` (24) | Non-user-invocable mirrors that point a non-Claude harness (Codex/OpenCode via `maude harness`) at `commands/<x>.md`. They must track every command rename. |

### 1.3 Design plugin — agents (23)

| Agent | Role |
| --- | --- |
| `design-critic` | Default holistic UX + DS critic; JSON verdict for the auto-fix loop |
| `a11y-critic`, `brand-critic`, `copy-critic`, `frontend-critic`, `graphic-design-critic`, `info-architecture-critic`, `motion-critic`, `typography-critic`, `signature-moment-critic` | Specialist critic panel members (read-only, JSON verdict) |
| `design-system-completeness-critic` | 3-tier DS completeness check (`--system-only`, post-bootstrap) |
| `design-system-keeper` | Pre-critic reuse/token-drift audit (A–A.10 passes, `dsFidelity`) |
| `ux-research-agent` | Discovery / ux-patterns research (WebSearch) feeding setup-ds and new |
| `draw-agent`, `draw-critic` | Geometry-engine SVG authoring + 30-check rubric judge |
| `footage-analyst` | Read-only, egress-free per-clip vision analysis |
| `footage-director` | Builds the EDL from analyses |
| `media-generation-director` | Read-only "gap finder" proposing a generation plan |
| `reconstruct-agent`, `reconstruct-critic` | Bash-free image → artboard reconstruction + comparator (DDR-174) |
| `_draw-design-rules`, `_draw-motion-rules`, `_ux-research-config.json` | Shared rule/config files (not real agents; they show up as agent types — naming hygiene) |

### 1.4 Design plugin — hooks / references

- `hooks.json`: **SessionStart only** → `preflight --plugin design --warn-only`. There are no PreToolUse/PostToolUse hooks, so file writes are neither attributed nor gated.
- `references/edit/*` (25), `references/new/*` (30): step-by-step procedures for `/design:edit` and `/design:new`.

### 1.5 Flow plugin (dev workflow; **not loaded in ACP** — `plugin-bootstrap.ts` "chat ships design-only", 2026-07-03)

- **Commands (31):** `plan`, `execute`, `done`, `quick`, `validate(-a11y|-security|-visual)`, `utils-verify`, `review-code`, `bug-rca`, `bug-fix`, `scenario`, `setup-prd`, `setup-context`, `setup-codebase-map`, `record-ddr|execution|retro`, `release`, `release-changelog`, `pause`, `resume`, `status`, `maintain-ai-health|clean|discover|docs`, `migrate-kgai`, `init`, `help`. These run the project's dev loop. They are not UI parity, but they own git, commit and release, which v2 places under Version history › Advanced.
- **Skills (23):** rules (`a11y-rules`, `motion-rules`, `responsive-rules`, `security-rules`, `testing-rules`, `debugging-rules`), `agent-browser`, `agent-device`, `scenario`, `quality-gates`, `workflow-state`, `kgai-backend`, `kgai-migrate`, `orbit-backend`, `debate-protocol`, `question-protocol`, `ddr-keeper`, `claude-md-keeper`, `codebase-intelligence`, `skill-loader`, `make-skill-template`, `a11y-checker`, plus `source-command-*` mirrors.
- **Agents (12):** `security-auditor`, `ethical-hacker`, `a11y-auditor`, `design-system-guard`, `scenario-runner`, `test-coverage`, debate seats `builder`/`shipper`/`breaker`/`user-advocate`/`investigator`, `_security-regex-catalog`.
- **Hooks:** SessionStart → flow preflight + background `maude kg session-sync`.
- **kgai** (third-party) is injected into ACP so its Stop-hook decision capture fires.

### 1.6 CLI (`cli/bin/maude.mjs`)

| Top-level | What it does |
| --- | --- |
| `maude init` | Scaffold `.ai/` from the flow skeleton |
| `maude config show/get/set` | Edit `.ai/workflows.config.json` (flow config, **not** studio/design config) |
| `maude doctor [--fix]` | Deps + config schema + stack drift + quality gates + linked-hub health |
| `maude preflight --plugin` | Dependency preflight (hooks call it) |
| `maude cache get/put/list/stats/inspect/clear` | Plugin sidecar cache (DDR-061) |
| `maude kg <context/ingest/resolve/doctor/import/sync/…>` | Resolved kgai dispatcher |
| `maude hub serve/token/status/deploy`, `maude hub workspace-up` | Self-hosted sync hub control plane |
| `maude harness`, `maude codex` | Lower the Claude plugin environment to Codex/OpenCode targets; Codex bridge |
| `maude scenario-report` | Deterministic scenario report |
| `maude studio` / `maude design serve` | Boot the dev server |
| `maude version`, `maude help` | — |

`maude design` **lifecycle verbs:** `serve`, `init` (non-interactive DS scaffold), `export`, `link`, `adopt`, `detach`, `unlink`, `status`, `bulk-deletes`.

`maude design` **bin verbs** (`BIN_VERBS`, `apps/studio/bin/*.sh`):

| Verb | What it does |
| --- | --- |
| `prep`, `bootstrap-check`, `slug`, `server-up`, `runtime-health`, `preflight` | Pre-flight context, DS presence gate, history slug, server lifecycle, runtime-bundle probe, deps |
| `screenshot`, `smoke`, `visual-sanity`, `perf`, `ensure-browser`, `agent-browser-safe` | Capture/verify/benchmark; scoped browser automation (DDR-185) |
| `canvas-edit` | AST single-attribute edit by `data-cd-id` on a canvas TSX |
| `canvas-rects` | World-coordinate geometry manifest (artboards + elements) |
| `read-annotations`, `annotate` | Annotation read; typed annotation ops → `POST /_api/annotations/ops` (live merge + broadcast) |
| `draw-build`, `draw-proof`, `svg-optimize`, `to-lottie` | Geometry engine, proof ladder, SVGO, Lottie |
| `import-asset`, `fetch-asset`, `import-brand`, `import-tokens`, `import-figma` | Hardened ingestion (SVG/PDF, URL, brand cues, token files, Figma REST) |
| `photo-adjust`, `photo-bg-remove` | `PUT /_api/photo-edit`; client-side ML bg removal harness |
| `generate`, `audio-search`, `transcribe` | `/_api/generate-jobs`; reuse-before-pay audio search; whisper/Scribe/Groq → SRT/VTT |
| `ingest-footage`, `probe-footage`, `smart-frames` | Footage copy/proxy, keyframes, scene-aware keyframes |
| `handoff`, `asset-sweep` | shadcn registry emit; DS bootstrap real-asset sweep |
| `chat-open` | `POST /_api/acp/focus` |
| `curl-local` | Loopback-only curl (DDR-185) |

(`maude design help` lists only ~27 of the 39 verbs. `photo-*`, `import-*`, `chat-open`, `perf`, `curl-local` and `agent-browser-safe` are missing from the help text, which is already drifting.)

### 1.7 Server HTTP API (`apps/studio/http.ts`, ~170 routes; one switch file, route modules only planned in V2-2.5)

Groups: boot/config (`/_config`, `/_health`, `/_index-data`, `/_system-data`, `/_active`, `/_canvas-state`), canvases/files (`/_api/canvas`, `canvas-meta`, `canvas-source`, `fs-move`, `fs-mkdir`, `tree-state`, `toggle-hide`), editing (`edit-css|text|attr|array-src|scope`, `insert-element|artboard`, `duplicate-*`, `delete-*`, `reorder(-revert)`, `resize-artboard`, `set-artboard-{label,kind,hug,style,guides,print}`, `convert-to-absolute`, `detach-component`, `component-map`), comments (`/_comments`, `/_comments-all`), annotations (`/_api/annotations`, `/ops`), assets/import (`assets`, `asset` + chunked, `import-asset`, `import-brand`, `figma/*`, `stickers`, `photo-edit`), export (`export`, `export-jobs`, `export-history`, `export-assemble`, `export-warmup`), git/history (`git/*`, `project/{history,restore,undo,conflict,ai-action}`, `github/*`), sync/cloud (`/_sync-status`, `sync/{settings,ownership,resync,offline,trash,cancel-assets}`, `cloud/*`, `hub/link`, `workspace/*`), AI (`acp/{chat,chats,status,running,activity,focus,attachment}`, `ai/{start,heartbeat,end}`, `claude/*`), generate/video (`generate/*`, `generate-jobs`, `footage`, `timeline-media`, `clip-edit`, `comp-clips`, `insert|remove|reorder|retime-sequence`), settings/diagnostics (`ui-prefs`, `setup-readiness`, `preflight`, `debug-bundle`, `report(-fallback)`, `shell-shot`, `whats-new`), project create (`project/create-local`, `projects/prepare`, `design/init`).

Gates: `CANVAS_SAFE_API` (14 routes reachable from the untrusted canvas origin, mirrored in `server.ts` routes; DDR-054/088). `READ_ONLY_ALLOWED_WRITES` (viewer writes). `sameOriginWrite` + `isTrustedRequestHost` (CSRF/DNS-rebind). **A non-browser loopback client (CLI/agent) is treated as fully privileged.** No per-caller capability token exists.

Routes the plugins/CLI actually use (grep): `/_active` (33), `/_api/footage` (17), `/_comments` (12), `/_api/generate-jobs` (8), `/_api/export` (8), `/_api/asset` (7), `/_api/photo-edit` (5), `/_api/acp/focus` (4), `/_api/export-jobs`, `/_api/annotations/ops`, `/_api/canvas-meta`, `/_api/ai/{start,heartbeat,end}`, `/_api/set-artboard-print`, `/_api/resize-artboard`, the sequence routes, `/_api/clip-edit`, `/_api/comp-clips`, `/_api/import-asset`, `/_api/generate/*`.

**Some plugin steps still use raw `curl`.** Examples: `/design:edit` step 4.5 AI-activity banner, step 6 validate; the `video-comp` export guide; `footage-director`. In ACP a raw curl **pauses for a permission prompt** (DDR-185), so these steps stall in the panel today.

### 1.8 ACP integration (`apps/studio/acp/`, client `client/panels/{ChatPanel,acp-runtime,chat-context,slash-commands}.js`)

- **Session:** `@agentclientprotocol/claude-agent-acp` adapter, `cwd` = project root, `settingSources: ['user']` (DDR-144), system-prompt append = static studio brief (`bootstrap-brief.ts`), `loadSession` resume of persisted session ids, multi-chat (DDR-125).
- **Plugins injected:** bundled `design` + `kgai` (always, DDR-168); `flow` resolved but **off**; native copies suppressed via `enabledPlugins` flag layer (hand-maintained — drift trap noted in code).
- **Tools:** `allowedTools = Read, Glob, Grep, Bash(maude:*), WebSearch, WebFetch` (+ read-only fs verbs and `agent-browser` per DDR-185). `Edit`/`Write`/`NotebookEdit`/`MultiEdit` are auto-approved **only inside the pinned project root** (`write-scope.ts`, with a deny list: `.claude/`, `.mcp.json`, `CLAUDE.md`, git config …). Everything else goes to the PermissionPrompt card. Modes: default/auto/acceptEdits/plan/dontAsk/bypass (DDR-179).
- **MCP:** **none.** `mcpServers: []`; plugins are injected with `skipMcpDiscovery: true` ("the bridge owns MCP connections"). The app exposes no tool surface of its own to the agent.
- **Context in:** per-turn `[maude-context canvas=… mtime=…][selected: …]` lines (locators only, sanitized; DDR-140), `_active.json` (live selection), comments via `/_comments`.
- **Context out (agent → UI):** only `/_api/acp/focus` and `/_api/ai/start|heartbeat|end` (file-level "AI works here" banner, also broadcast to presence). Elicitation/permission cards come back through the ACP wire.
- **Slash autocomplete:** `STATIC_COMMANDS` in `slash-commands.js` curates 16 design commands. It omits `board`, `generate`, `photo`, `reel`, `import`, `video-analyze`, `chat` and `hub-workspace` (dynamic `available_commands_update` covers them later).
- **Native (Tauri):** `invoke` commands for OAuth, keychain, pick directory/media, save export, open project, recents, updater, crash logs, deep link (`maude://` parked → webview), notifications, managed projects. None are reachable from an agent.

### 1.9 Terminal Claude Code

It gets the same `design`/`flow` plugins only if the user marketplace-installs them (version independent of the app). It gets the `maude` CLI only via npm (version independent again). It can read `_active.json`, `_server.json` and comments, run `maude design <verb>`, and edit files. There is no handoff between terminal and in-app chats. Open in terminal (B8) does not exist. `/design:chat` only opens the panel and cannot attach to or continue a chat.

---

## 2. Parity matrix

Legend: ✅ exists · ◐ partial · ❌ missing · ⚠ exists but outdated for v2.

ACP-callable values:
- **file** = agent can achieve it by editing project files (auto-approved in-project).
- **verb** = a `maude design <verb>` (auto-approved via `Bash(maude:*)`).
- **slash** = a `/design:*` workflow.
- **curl** = loopback route via `curl-local`.
- **no** = not reachable.

"Terminal" is the same as ACP unless noted. In the terminal there is no ACP brief or per-turn context, and the plugin version may differ.

Gap IDs (`G-…`) are referenced in §3–§5. **Bold GAP** = a v2 capability the agent cannot operate at all, or can only operate by bypassing a v2 invariant.

### 2.1 Navigation, search, version history, trash, undo (S1 · canvas 11, 05, 01)

| # | Capability (v2 home) | HTTP API | CLI verb | Plugin cmd/skill | ACP-callable | Gap |
| --- | --- | --- | --- | --- | --- | --- |
| N1 | List canvases/folders, counts, badges (Canvases panel) | ✅ `/_index-data` | ❌ | ◐ `setup-docs` INDEX | file (Glob) — misses server meta (badges, comment counts, sync state) | G-NAV-1 read API `canvas.list` |
| N2 | Rename / move / duplicate canvas, new folder (File menu, panel) | ✅ `fs-move`, `fs-mkdir`, `/_api/canvas` | ❌ | ❌ | **no** — `mv` not allowed; a Write+delete bypasses meta, comments, history slug, trash | **GAP G-NAV-2** |
| N3 | Pins, sort, hidden files (per user) | ◐ `ui-prefs`, `tree-state`; pins ❌ | ❌ | ❌ | no | G-NAV-3 (low value; UI channel) |
| N4 | ⌘K Search — canvases, artboards, actions, settings, where-paths, typo/accent folding | ◐ index only; no search endpoint | ❌ | ❌ | file (Grep) — no artboard labels index, no action index | **GAP G-NAV-4** `search` tool returning action ids + where-paths |
| N5 | Cross-project ⌘K / Home index (C38) | ❌ (new, shell-owned) | ❌ | ❌ | no (by design: the session is project-scoped) | stays UI-only; agent sees own project only |
| N6 | Open canvas / jump to artboard / reveal element (navigate the UI) | ❌ (only `acp/focus`) | ❌ (`browse` opens a browser tab) | ❌ | **no** | **GAP G-NAV-5** UI command channel `ui.open/reveal/select` |
| N7 | Deep link `maude://<project>/<canvas>#<artboard>` | ◐ Tauri `deep_link` (focused window only) | ❌ | ❌ | no | G-NAV-6 `link.app` read tool (generate link) |
| N8 | Version history list, thumbnails, authors (⌥⌘H) | ✅ `project/history`, `git/log`; thumbnails ❌ | ❌ | ⚠ `/design:rollback` uses the `_history/` snapshot stack, a **different store** from Version history | ◐ via Bash(git) (prompts) | **GAP G-HIS-1** `history.list`; retire/realign rollback |
| N9 | Named versions | ❌ new | ❌ | ❌ | no | G-HIS-2 |
| N10 | "What changed" in words (per artboard/element) | ◐ `git/diff` raw | ❌ | ❌ | ◐ agent can diff itself | G-HIS-3 (the agent is a natural *producer* of the words — see §3) |
| N11 | Restore whole canvas as a new version (C5) | ✅ `project/restore` | ❌ | ⚠ rollback restores a snapshot without creating a version | ◐ slash (wrong store) | **GAP G-HIS-4** |
| N12 | Restore one artboard; object-scoped history | ❌ new | ❌ | ❌ | file (agent can splice) — no version entry | G-HIS-5 |
| N13 | Compare pictures (Version history › Advanced) | client-only `DiffView` | ❌ | ◐ `screenshot` | ◐ | low priority |
| N14 | Trash: list / restore canvases | ✅ `sync/trash` | ❌ | ❌ | **no** — an agent "deleting" uses `rm`/Write, which **hard-deletes** (violates §7 "moved to the trash") | **GAP G-TR-1** `trash.move/list/restore` + hook that blocks raw deletes of canvases |
| N15 | Artboard-level trash with original position | ❌ new | ❌ | ❌ | file (removing JSX loses the artboard outside trash) | G-TR-2 |
| N16 | Clear out trash (owner-only) | ❌ new (hub) | ❌ | ❌ | must stay **human-only** | tier: human-only |
| N17 | Undo/Redo incl. AI (⌘Z), Undo history…, "one AI run = one step" | ◐ `project/undo` (project); client stacks | ❌ | ⚠ rollback | **no** — agent writes do not form a run-scoped step | **GAP G-UNDO-1** run bracketing (§3.4) |
| N18 | Moved folder relink, access changed, open-once | native | ❌ | ❌ | no | UI-only (correct) |

### 2.2 Editing objects, inspector, layout, text, pen, components (S2 · canvas 14)

| # | Capability | HTTP API | CLI verb | Plugin | ACP | Gap |
| --- | --- | --- | --- | --- | --- | --- |
| E1 | New artboard with preset (Edit › Advanced ▸ New artboard; F tool) | ✅ `insert-artboard` | ❌ | ✅ `/design:new`/`edit` (generative) | file / slash | G-ED-1 thin `artboard.insert(preset)`; preset catalogue (08) not in plugin |
| E2 | Resize / rename / duplicate / remove / reorder artboards | ✅ `resize-artboard`, `set-artboard-label`, `duplicate-artboard`, `delete-artboard` | ◐ `canvas-edit` (attr only) | ✅ edit | file | ◐ removal must go to trash (G-TR-2) |
| E3 | Insert / duplicate / remove / reorder objects | ✅ `insert-element`, `duplicate-element`, `delete-element`, `reorder` | ◐ | ✅ edit | file | — |
| E4 | Frame selection / remove frame (⌥⌘G / ⇧⌘G), z-order (] [ ⌘] ⌘[) | ❌ new | ❌ | ◐ edit (NL) | file | G-ED-2 add to the TSX writer and expose |
| E5 | Lock / hide-in-editor / Place freely (canvas-only metadata) | ◐ `toggle-hide`; lock store ❌ (V2-1.4) | ❌ | ❌ | **no**; agent may also *ignore* locks when editing files | **GAP G-ED-3** metadata store + the agent must honour it |
| E6 | Inspector style edits (layout, auto layout, constraints, fill, stroke, radius, shadow, words→CSS) | ✅ `edit-css/attr/scope`; words→CSS writer ❌ | ◐ `canvas-edit` | ✅ edit | file | G-ED-4 share the words→CSS writer as a tool so agent and UI emit the same code |
| E7 | Token binding ("Bind", not-a-token detection) | ❌ | ❌ | ◐ ds-keeper audits after the fact | file | G-ED-5 |
| E8 | Text in place, Czech typography pass, Language, Case, style overrides | ✅ `edit-text`; Czech pass ❌ | ❌ | ◐ `copy-critic` | file | G-ED-6 Czech pass as a shared writer step (agent writes must run it too) |
| E9 | Pen + Combine shapes (boolean ops) | ❌ in UI | ✅ `draw-build` (engine) | ✅ `/design:draw` | slash | **reverse gap**: agent ahead; UI Pen should reuse `apps/studio/draw` |
| E10 | Images + crop mode | ◐ `edit-css` object-fit, `photo-edit` | ✅ `photo-adjust` | ✅ `/design:photo` | verb/slash | per-use crop (§7) ❌ → G-AS-5 |
| E11 | Components: ⇧I picker, instances, variants, overrides, Detach, Go to main | ◐ `component-map`, `detach-component` | ❌ | ◐ `ui-kit`, ds-keeper reuse pass | file; detach via HTTP not exposed | **GAP G-ED-7** masters registry + `component.place/swap/detach` |
| E12 | Interaction section (On click / On hover → artboard/canvas link) | ❌ new | ❌ | ❌ | no (no file format yet) | **GAP G-ED-8** define format so agents can write links |
| E13 | Co-edit soft lock (A10), AI holds its run's objects | ❌ new (awareness) | ❌ | ❌ | **no** — file writes cannot see or claim locks | **GAP G-ED-9** |
| E14 | Align / distribute / Tidy up, copy/paste properties | client-only | ❌ | ◐ edit (NL) | file | ok (NL path); optional tools |
| E15 | Figma paste bar → Make editable | ✅ `figma/explode` | ✅ `import-figma` | ✅ `/design:import` | verb/slash | ⚠ v2 says frames arrive as **pictures** first (C24, §7) — plugin doc must change |
| E16 | Stable element ids surviving AI rewrites (V2-1.4) | ◐ `data-cd-id` | ✅ `canvas-edit` uses it | ❌ no rule in `design` skill that rewrites must preserve ids | — | **GAP G-ED-10** id-preservation contract in the edit/new procedures plus a post-write check |
| E17 | Selection — read | ✅ `/_active`, per-turn context | ✅ `prep` | ✅ | yes | — |
| E18 | Selection — set / highlight what AI is changing (outline overlay) | ❌ (only file-level `ai/start`) | ❌ | ◐ edit step 4.5 (raw curl → prompts in ACP) | **no** at artboard/element granularity | **GAP G-ED-11** (feeds rings, "AI works here", A4) |

### 2.3 Modes, Present, interactions/links (S3 · canvas 04)

| # | Capability | HTTP API | CLI | Plugin | ACP | Gap |
| --- | --- | --- | --- | --- | --- | --- |
| M1 | Mode switch Edit · Preview · Present (⌥⌘P, ⌥⌘↵, ⇧⌥⌘↵) | ❌ (iframe `ToolProvider` today; `set-mode` planned V2-1.2) | ❌ | ❌ | **no** | **GAP G-MD-1** via UI command channel ("show it to me in Preview") |
| M2 | Present one by one / the canvas, presenter view on 2nd display | ❌ native | ❌ | ❌ | no | UI-only to *run*; agent may *start* it (UI channel, confirm tier) |
| M3 | Order and notes… (order, skip, speaker notes in `.meta.json`, C31) | ❌ new | ❌ | ❌ | file once the schema exists | **GAP G-MD-2**: an AI should write speaker notes and order. Schema + `canvas-meta.schema.json` + skill guidance |
| M4 | Presentation link with Catch up (`/present/<canvas>`) | ❌ new (hub) | ❌ | ❌ | no | confirm tier (creates a shareable URL) |
| M5 | Links between artboards/canvases in Preview | ❌ new | ❌ | ❌ | no | = G-ED-8 |
| M6 | Inspect / measure (⌥) | client | ✅ `canvas-rects` | ✅ whiteboard | verb | — |
| M7 | AI live in Preview; lands on move-on in Present (A8) | runtime | — | — | n/a | hot-reload gate per artboard needs run→artboard mapping (G-ED-11) |
| M8 | What-shows-per-mode, read-only Viewing state | client + hub roles | ❌ | ❌ | n/a | — |

### 2.4 Annotations, stickers, votes (S4 · canvas 15)

| # | Capability | HTTP API | CLI | Plugin | ACP | Gap |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | Read the annotation layer (graph, scoped, rects) | ✅ `/_api/annotations` | ✅ `read-annotations`, `canvas-rects` | ✅ `whiteboard`, `/design:board` | verb | ⚠ needs scope to selection + target outline (inventory E §6) |
| A2 | Sticky / shape / text / arrow / section / templates write | ✅ `/_api/annotations/ops` | ✅ `annotate` | ✅ | verb | ✅ best-in-class precedent (same ops as the canvas). Vocabulary ⚠ ("board", "whiteboard", "post-it" → Preview tools, "Annotations") |
| A3 | Stickers gallery (4 packs, keyword search, Recent, 160 px, Replace / Flip) | ✅ `/_api/stickers`, `/_stickers/` | ❌ | ❌ | no | **GAP G-AN-1** `annotate` sticker element `{pack, stickerId, flip}` + search |
| A4 | Vote stamps + vote sessions (timer, hidden ballots, result section) | ❌ new | ❌ | ❌ | no | **GAP G-AN-2**. Agent may *start* and *summarise* a vote; must **not** read hidden ballots before the end (server-side secrecy also binds the agent) |
| A5 | Resolve sticky (struck through), ⌘K "Hide resolved stickies" | ❌ new | ❌ | ❌ | no | G-AN-3 `annotate --resolve` (+ "one undo step covering design change + resolves") |
| A6 | Sticky ↔ comment conversion | ❌ new (cross-store) | ❌ | ❌ | no | G-AN-4 |
| A7 | Arrows bound to artboards/elements, live re-route, dangling | ◐ `annotations-bindings` (board hosts) | ◐ `annotate` bound ends | ◐ | verb | G-AN-5 extend bind targets `artboard-edge`/`element` |
| A8 | Annotations ride with their artboard (`parentArtboard`) | ❌ | ❌ | ❌ | no | G-AN-6 (agent-placed notes must re-parent like user ones) |
| A9 | Section Fold, video time-pinned stickies | ❌ | ❌ | ❌ | no | G-AN-7 |
| A10 | FigJam import | ✅ `figma/import` | ✅ `import-figma --from-figjam` | ✅ `/design:import` | verb/slash | UI entry new (Import from Figma…) |
| A11 | Lock (⇧⌘L, DDR-246), group/ungroup in Preview | ✅ | ✅ `annotate` honours locks | ✅ | verb | — |
| A12 | Show/hide annotations (⇧P), LOD | client (`view-annotations`) | ❌ | ❌ | no | UI channel (low) |

### 2.5 Comments, presence, share, roles (S9 · canvas 10)

| # | Capability | HTTP API | CLI | Plugin | ACP | Gap |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | Read comments (Open · Mine · Resolved · All) | ✅ `/_comments`, `/_comments-all` | ❌ | ✅ `design` `_guide-05`, edit step 3 | curl | ◐ Mine/unread ❌ |
| C2 | Reply / resolve / reopen / delete own; "Implement N comments" | ✅ `/_comments` CRUD | ❌ | ◐ edit reads them; ChatPanel "Implement N comments" seeds a prompt | ◐ curl (raw curl prompts) | **GAP G-CM-1** `comment.reply/resolve` tool; the AI answering in-thread is a natural v2 loop |
| C3 | @mentions → toast, Mac notification, Dock badge, e-mail | ❌ new | ❌ | ❌ | no | the agent must **not** be able to @mention (it would send e-mail on the user's behalf) → human-only or confirm |
| C4 | Comment on video frame / print mm anchors | ◐ / ❌ | ❌ | ❌ | no | G-CM-2 |
| C5 | Share sheet: invite (e-mail, role, scope), pending invites, resend | ❌ studio route (hub/cloud `invites.mjs`) | ❌ | ❌ | no | **human-only** (sends messages; changes access). Read-only `access.list` is ok |
| C6 | Roles Can view / comment / edit / Owner; per-canvas ACL; Ask to edit | ❌ new (V2-1.7) | ❌ | ❌ | no | human-only to change; read for context |
| C7 | Links: Copy link, who can open, expiry, revoke | ◐ client `share-link.js` | ❌ | ❌ | no | Copy existing link = read tier; create/widen/revoke = human-only |
| C8 | Presence, Follow, Go to, Bring everyone here + spotlight | ◐ awareness (client); AI presence via `ai/start` (file-level) | ❌ | ◐ edit banner | ◐ | AI as a presence peer at artboard granularity → G-ED-11; summon is human-only |
| C9 | Save status word (Saved / Syncing… / Offline / Local / Not saved) | ✅ `/_sync-status` | ◐ `design status` (hub link only), `doctor` | ❌ | verb | G-SY-1 `sync.status` read tool |
| C10 | Object-level conflict + Keep both | ◐ `project/conflict` (file-level) | ❌ | ❌ | no | G-SY-2 the agent should be able to resolve "Keep both" on request (confirm) |
| C11 | Local → cloud, link to a team server | ✅ `cloud/attach`, `hub/link` | ✅ `design link/adopt/detach/unlink` | ✅ `/design:hub-workspace`, `self-host` | ⚠ **auto-approved via `Bash(maude:*)`** | **RISK R-1**: must become confirm/human-only |
| C12 | Access ends / trashed-while-open / offline queues | hub + client | ❌ | ❌ | n/a | UI-only |

### 2.6 AI chat, runs, queue (S5 · canvas 03)

| # | Capability | HTTP API | CLI | Plugin | ACP | Gap |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | Multiple chats, run list, chat list grouped by canvas, full-text search, Move to trash | ✅ `acp/chat(s)`, `running`, `status` | ❌ | ❌ | n/a in-panel; **terminal: no** | G-AI-1 `chats.list/search` for terminal Claude ("what did AI do on Pricing yesterday?") |
| R2 | Open in terminal (`claude --resume <session>`, B8) and the reverse | ◐ persisted ids + `loadSession` exist | ❌ | ⚠ `/design:chat` only opens the panel | no | **GAP G-AI-2** |
| R3 | One AI per artboard queue, Run on a copy (A4) | ❌ new (run registry) | ❌ | ❌ | **no**: a terminal `/design:edit` would ignore the queue | **GAP G-AI-3** artboard claim API that every agent path must take (ACP, terminal, CLI) |
| R4 | Per-artboard rings/tags, "Made by AI" provenance | ◐ `ai/start` (file-level, used by edit via raw curl) | ❌ | ◐ edit step 4.5 | ◐ | G-AI-4 = G-ED-11 + provenance in `.meta.json` |
| R5 | One AI run = one version / one undo step; Undo this chat | ◐ held AI stage `project/ai-action`, `sync/action-stage.ts` | ❌ | ❌ | no | = G-UNDO-1 |
| R6 | Progress words in CONTRACT voice ("AI is drawing the footer"; result describes itself, no "I") | — | — | ❌ (brief says "Assistant chat"; commands print first-person summaries) | — | **GAP G-AI-5** voice contract in the brief + every command's "tell user" step |
| R7 | Attachments, folder consent | ✅ `acp/attachment` | — | — | panel | — |
| R8 | Permission / choice cards, Needs you | ✅ bridge | — | — | panel | — |
| R9 | Offline queue, "used up until HH:MM", connect sheet | ❌ / ✅ `claude/*` | — | — | panel | UI-only |
| R10 | Suggestion chips with why | ❌ new | ❌ | ❌ | — | could be produced by an agent prompt; design choice |
| R11 | ⌘/ Ask AI with selection attached; AI writes restricted to selected ids | ◐ context attach ✅; restriction ❌ | — | ◐ edit scopes by selection | soft | G-AI-6 enforce scope (PreToolUse hook, §3.4) |

### 2.7 Create, Home, onboarding, projects, tabs (S6 · canvas 01, 02, 05, 11)

| # | Capability | HTTP API | CLI | Plugin | ACP | Gap |
| --- | --- | --- | --- | --- | --- | --- |
| H1 | New canvas ⌘N ("Untitled canvas" naming, C4), in a folder | ✅ `/_api/canvas` POST | ❌ | ◐ `/design:new` (always generates) | file (bypasses `canvas-create.ts` scaffold/meta) | **GAP G-CR-1** thin `canvas.create(name, folder, ds)` |
| H2 | Create from Home prompt in a chosen project, AI drafts artboard by artboard | ❌ (cross-project) | ❌ | ◐ `/design:new` (batch, no per-artboard streaming events) | ◐ | G-CR-2 per-artboard progress events from `/design:new` |
| H3 | Render-error card, "Go back to 14:05", Ask AI to fix it | ❌ (Bun.build error surface) | ◐ `runtime-health`, `smoke` | ❌ | ◐ | G-CR-3 `canvas.errors` read tool + "fix it" seeds a run with the error |
| H4 | New project (local/cloud), open project, move to cloud | ✅ `project/create-local`, `projects/prepare`, `cloud/*` | ◐ `maude init`, `design init` | ✅ `/design:init` | no (session is per-project) | stays UI/CLI; agent may *suggest* |
| H5 | Native tabs, Home window, identity profiles, sign-in | native ❌ new | ❌ | ❌ | no | UI-only (correct; credentials) |
| H6 | Install CLI + Claude Code plugin sheet | ❌ new native | — | — | — | must state the version handshake (§5) |
| H7 | Tours, What's new, Set up Maude checklist | client | ❌ | ❌ | no | UI-only |
| H8 | Empty states' "one next step" (05) — often "Ask AI …" | — | — | — | — | each must map to a real agent action (registry `askAI` template) |

### 2.8 Video timeline, captions, beat, linked formats (S7 · canvas 07)

| # | Capability | HTTP API | CLI | Plugin | ACP | Gap |
| --- | --- | --- | --- | --- | --- | --- |
| V1 | Trim / split / reorder / retime clips | ✅ `insert|remove|reorder|retime-sequence`, `clip-edit`, `comp-clips` | ❌ | ✅ `video-comp`, `/design:reel` (call routes via curl) | ◐ curl (raw curl prompts) | G-VID-1 `timeline.*` tools |
| V2 | Four tracks + "+ track"; overlay lanes migrate to Video 2 (C35) | ❌ new model | ❌ | ⚠ `video-comp` authors the old lane model | file | **GAP G-VID-2** update the skill + a migration verb |
| V3 | Captions word by word, edit by transcript, .srt/.vtt | ◐ | ✅ `transcribe` (SRT/VTT) | ◐ reel captions | verb | G-VID-3 captions model on the comp; transcript-edit → cuts |
| V4 | Beat detection + Cut to the beat; music ducking | ❌ new | ❌ (`audio-search` is search only) | ❌ | no | G-VID-4 `beats` verb (spike V2-1.10) |
| V5 | Poster frame; video cap / "Allow longer" (maxFrames per artboard, C22) | ❌ / exporter option ✅ | ❌ | ❌ | file once in meta | G-VID-5 |
| V6 | Linked formats + per-format framing (subject tracking / manual focus) | ❌ new | ❌ | ❌ | no | G-VID-6 |
| V7 | AI cut streaming (shots placed live, Stop keeps them, one undo step) | ❌ | ❌ | ◐ `/design:reel` writes the EDL at the end | ◐ | **GAP G-VID-7** reel emits incremental placement events through the run registry |
| V8 | Other takes; footage ingest/proxies; clip inspector (Speed, Audio, Crop, Grade, Transition) | ◐ `footage`, `clip-edit` | ✅ `ingest/probe-footage`, `smart-frames` | ✅ `video-analyze`, `footage-*` | verb | ◐ clip inspector props as `clip.set` tool |

### 2.9 Artboard kinds (S7 · canvas 08)

| # | Capability | HTTP API | CLI | Plugin | ACP | Gap |
| --- | --- | --- | --- | --- | --- | --- |
| K1 | New artboard picker (App · Web page · Social · Print · Video; "Fixed size"), preset catalogue | ✅ `insert-artboard`; catalogue ❌ | ❌ | ◐ `ui-kit` (desktop/mobile/tablet/print) | slash | **GAP G-KD-1** one preset catalogue (data) shared by the picker, ⌘K and plugins |
| K2 | Change kind (makes a copy, "Made from") | ✅ `set-artboard-kind` (+ iframe `freeze-and-set-kind`) | ❌ | ❌ | file | G-KD-2 |
| K3 | Print sheet (paper, bleed, safe margin, RGB line), Print guides | ✅ `set-artboard-print`, `set-artboard-guides` | ❌ | ◐ export.md | curl | ◐ |
| K4 | Safe zones and warnings (trim crossing, too-long video, px vs paper) | ❌ new lint pass | ❌ | ❌ | no | **GAP G-KD-3** `artboards.lint` read tool (the agent must see the same warnings and fix them) |
| K5 | Kind filter chips / counts | ❌ (index extension) | ❌ | ❌ | file | low |

### 2.10 Export and handoff (S8 · canvas 09)

| # | Capability | HTTP API | CLI | Plugin | ACP | Gap |
| --- | --- | --- | --- | --- | --- | --- |
| X1 | PNG/SVG/PDF/HTML/PPTX/Canva/ZIP/MP4/WebM/GIF | ✅ `/_api/export` | ✅ `design export` | ✅ `/design:export` | verb/slash | — |
| X2 | JPG (+quality), Sound only (.m4a; .wav Advanced), captions file (.srt; .vtt) | ❌ | ❌ (`VALID_FORMATS` lacks them) | ❌ | no | **GAP G-EX-1** |
| X3 | Scope Selection · This canvas · Folder · Whole project + estimate | ◐ scopes `selection/artboard/canvas-as-separate/canvas-whole/selection-bounds/project-raw`; folder ❌; estimate ❌ | ⚠ old scope words | ⚠ | verb | G-EX-2 map v2 scope words; add folder + estimate |
| X4 | File-name tokens, Save to, cloud vs this Mac lane, colour profile, font-licence check, export a past version, 300 dpi print default | ❌ (B4/B5) | ❌; `--option marks=crop` and numeric options dropped (bug V2-2.8) | ❌ | no | **GAP G-EX-3** |
| X5 | Exports panel: history, Export again, Retry <name>, partial "114 of 115" | ✅ `export-history`, `export-jobs` | ❌ | ❌ | no | G-EX-4 `exports.list/again/retry` |
| X6 | Inspector Export section, Copy as PNG ⇧⌘C | client → export | — | — | — | covered by X1 |
| X7 | Handoff sheet ⇧⌘H with targets, hosted registry, AI review lookup | ◐ `handoff.ts` (no route listed for targets) | ✅ `handoff` (shadcn only) | ✅ `/design:handoff` | verb/slash | G-EX-5 targets catalogue shared with UI |
| X8 | Lottie / React-Native motion handoff | ❌ | ✅ `to-lottie` | ✅ `/design:to-lottie`, `/design:to-rn` | slash | **reverse gap**: agent-only. Give it a UI home (Handoff target) or label it agent-only in the registry |

### 2.11 Import, assets, photo, generate, search in pictures (S8 · canvas 12)

| # | Capability | HTTP API | CLI | Plugin | ACP | Gap |
| --- | --- | --- | --- | --- | --- | --- |
| I1 | Assets tab: groups, usage ("Used in N canvases"), Not used | ◐ `/_api/assets` (list); usage ❌ | ❌ (`asset-sweep` is DS-bootstrap only) | ❌ | file (Glob) | **GAP G-AS-1** `assets.list/usage` |
| I2 | Place asset on artboard (↵ / Place) | ✅ `insert-element`; iframe `insert-image` | ❌ | ◐ `generate` places | file | G-AS-2 `asset.place(artboard)` |
| I3 | Upload / drop / paste, converters PSD/HEIC/PDF | ✅ `/_api/asset` (+chunked), `import-asset` | ✅ `import-asset` (SVG/PDF), `fetch-asset` | ◐ | verb | G-AS-3 PSD/HEIC converters |
| I4 | Asset to trash | ❌ | ❌ | ❌ | no | G-AS-4 (= trash model) |
| I5 | Search in pictures (opt-in AI descriptions, B6) | ❌ new | ❌ | ❌ | no | **GAP G-AS-6**. This *is* an AI job using the user's Claude account, so it should run as a headless agent run (new read-only, egress-free `asset-describer` agent, modelled on `footage-analyst`), not as server code calling an API |
| I6 | Figma import (frames as pictures + Make editable; comments → pins, FigJam → stickies) | ✅ `figma/*` | ✅ `import-figma` | ⚠ `/design:import` | verb/slash | update to the C23/C24 rules |
| I7 | Brand import: logo + website (B7) | ◐ `import-brand` (SVG cues) | ◐ | ◐ `setup-ds --from-brand` | verb | **GAP G-AS-7** website reader; result must enter the DS review, not write tokens directly |
| I8 | Photo edits per use + "Apply to every use", looks | ◐ `photo-edit` (per asset) | ◐ `photo-adjust` | ⚠ `/design:photo` (per asset) | verb | **GAP G-AS-5** per-use sidecar key |
| I9 | Generate with N takes, take cycling, model select | ✅ `generate-jobs`, `generate/*` | ✅ `generate` | ✅ `/design:generate`, `ai-generation`, `media-generation-director` | verb/slash | ◐ N takes + best-pick |
| I10 | Import tokens (W3C / Style Dictionary / CSS) | ❌ (CLI-only by DDR-172) | ✅ `import-tokens` | ◐ setup-ds | verb | **reverse gap** — needs a v2 home (DS canvas › Advanced "Import tokens…"); must go through the outside-change review |

### 2.12 Design systems — DS canvas, several per project, switch, review, migration (S10 · canvas 13)

| # | Capability | HTTP API | CLI | Plugin | ACP | Gap |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | Make a design system (AI: 3 inputs → three directions → pick/mix → section streaming) | ❌ | ◐ `design init --discovery-payload` | ⚠ `/design:setup-ds` produces a `system/<ds>/` **folder**, not a "Design system" canvas; no streaming | slash | **GAP G-DS-1** retarget setup-ds output to the DS canvas (Brand · Colour · Type · Space & shape · Motion · Components · Patterns) |
| D2 | Pinned "Design system" row(s); several systems; default for new canvases; folder inheritance | ◐ `/_system-data`, `config.designSystems[]` | ❌ | ◐ `new` resolve-config-ds picks one DS | file | **GAP G-DS-2** "default DS" + folder rule must be the same resolver for UI and `/design:new` |
| D3 | Edit tokens in place (Light + Dark per token, live contrast) | ❌ (`tokens.json` model, C1) | ❌ | ❌ (agent edits CSS directly) | file — becomes an "outside change" | **GAP G-DS-3** `ds.token.set` tool through the canvas model, so agent edits are first-class rather than outside changes |
| D4 | "Update N canvases" review with ticks, per-canvas `dsRev` pinning, update dot | ❌ new | ❌ | ❌ | **no** | **GAP G-DS-4** propose (agent) vs apply (confirm tier) |
| D5 | Outside-change review (Keep / Undo) + conflict pick ("2 tokens changed outside the app") | ❌ new | ❌ | ❌ | n/a | Terminal Claude **is** the "outside". Attribution must say "Claude Code" (needs the actor header / hook, §3.4) |
| D6 | Switch canvases to another system (Scope: This canvas · Folder · Whole project), drafts | ❌ new | ❌ | ❌ | file (relink by hand) | **GAP G-DS-5** `ds.switch(scope)` |
| D7 | Migration of `system/<ds>/` folders → DS canvases (files stay) | ❌ new | ❌ | ❌ | no | G-DS-6 migration verb (deterministic, data-driven map) |
| D8 | Components masters (variants × states × sizes) | ❌ | ❌ | ◐ preview specimens | file | = G-ED-7 |
| D9 | Check the system (critic panel headless) | ❌ | ❌ | ✅ `/design:critic --system-only`, completeness critic | slash | UI button must start an **AI run** (ACP) — no server re-implementation |
| D10 | Contrast fix ("Lighten to 4.5:1"), nearest-token resolver, token to trash with replacement, off-system colour question | ❌ | ❌ (engine `palette` has WCAG/OKLCH) | ◐ a11y-critic | no | G-DS-7 expose solver as a tool shared by UI and agent |
| D11 | Team library on cloud.maude.sh, linked "view only" | ❌ new (hub) | ❌ | ❌ | no | publish = human-only; link = confirm |
| D12 | Usage index ("Used in 12 canvases", "14 places") | ❌ | ❌ | ◐ ds-keeper grep | file | G-DS-8 shared index |
| D13 | Hand off tokens; CSS / JSON under Advanced | ◐ | ◐ `handoff` | ◐ | verb | — |

### 2.13 Advanced, Diagnostics, Settings, sync (S11 · canvas 06)

| # | Capability | HTTP API | CLI | Plugin | ACP | Gap |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | Diagnostics: Sync / Server / AI setup status words | ✅ `/_sync-status`, `/_health`, `setup-readiness`, `preflight` | ✅ `doctor`, `preflight`, `runtime-health`, `design status` | ✅ `/design:init` | verb | — (good parity) |
| S2 | Logs (per source, 7 days), Copy diagnostic report | ◐ `debug-bundle`; log store ❌ (V2-2.9) | ❌ | ❌ | no | **GAP G-DG-1** `logs.tail(source)`. The agent needs this to self-diagnose "why did export fail" |
| S3 | Reload canvas, Resync now, Download all | ✅ `sync/resync` | ❌ | ❌ | no | G-DG-2 (confirm tier for resync) |
| S4 | Report a bug… | ✅ `/_api/report` | ❌ | ❌ | no | human-only (sends data off-device) |
| S5 | Settings General / Connections (keys, Figma token, accounts) / Advanced | ✅ `ui-prefs`, `generate/keys`, `figma/connect` | ⚠ `maude config` is **flow** config, not studio settings | ❌ | no | keys/accounts **human-only**; non-secret prefs read-only to agent |
| S6 | Code view read-only, artboard → line mapping, syntax error + Ask AI to fix it | ✅ `canvas-source` | — | — | file (native) | = G-CR-3 |
| S7 | Version history › Advanced (git: branch, commit, push, PR) | ✅ `git/*`, `github/*` | git | ◐ flow `/flow:quick` etc. (**not loaded in ACP**) | Bash(git) prompts | G-DG-3 decide: commit/push from AI chat = confirm tier |
| S8 | Fold state, Pin panels, View toggles (minimap, zoom controls, print guides, hidden files), Theme | ✅ `ui-prefs` | ❌ | ❌ | no | UI channel (low) |
| S9 | Decision memory (kgai) row | — | ✅ `maude kg` | ✅ `kgai-backend` | verb | — |
| S10 | Engines (whisper, Gemma) download/status | ✅ `generate/whisper-model`, `keyframe-model` | ◐ | ◐ `footage-keyframes` | ◐ | — |

### 2.14 Score (141 rows above; approximate tallies)

| Column | ✅ | ◐ | ❌ / ⚠ |
| --- | --- | --- | --- |
| HTTP API | ~60 | ~25 | ~56 |
| CLI verb | ~22 | ~18 | ~101 |
| Plugin cmd/skill | ~32 | ~33 | ~76 |
| ACP-callable (yes via file/verb/slash) | ~50 | ~25 | ~66 "no" |

About half of v2's capabilities are unreachable by the agent. Most of the reachable half are reachable only through a raw file edit that bypasses v2 invariants (trash, versions, locks, DS review, attribution). The un-reachable half clusters exactly where v2 adds value: history, trash, DS-as-canvas, run queue, modes/present, comments resolution, exports, assets.

---

## 3. Architectural recommendation — one action registry, four surfaces

**Goal:** "what's on the surface matches what's under it" *by construction*. Every v2 capability is a registry action. The UI menus, ⌘K, "?", native menu, CLI, MCP tool surface and docs are **generated** from it, and a test fails when an action has no agent surface and no written exemption.

### 3.1 Extend the V2-1.3 / V2-2.4 registry schema (amend the spike before Phase 2)

Today's plan spec is `id, label, where-path, keys, visibility predicate (role/shell/mode/focus)`. Add:

```ts
interface ActionDef {
  id: 'canvas.create' | 'history.restore' | 'ui.mode.set' | …;   // stable, dotted, never renamed (aliases on rename)
  label: string; where: string; keys?: KeySpec[]; scope?: FocusScope;   // existing
  visible(ctx): boolean; enabled(ctx): boolean;                      // existing predicate set — rule 12
  params?: JSONSchema;          // NEW — one schema for the ⌘K argument UI, CLI flags and MCP inputSchema
  kind: 'ui' | 'read' | 'write';                                     // NEW — where it executes
  effect: 'project' | 'shared' | 'external' | 'destructive' | 'none'; // NEW — what it touches
  tier: 'auto' | 'confirm' | 'human';                                 // NEW — agent permission tier (derived default from kind+effect, overridable only downward)
  minRole: 'view' | 'comment' | 'edit' | 'owner';                    // NEW — enforced server-side
  server?: { route: string; method: 'POST'|'GET'|… };                // NEW — the ONE implementation for write/read actions
  undo?: 'step' | 'version' | 'none';                                 // NEW — how it lands in history (V2-1.5)
  agent?: { mcp: boolean; cli?: string /* friendly alias */; exempt?: string /* why not */ };
  askAI?: string;               // NEW — prompt template for empty states / "Ask AI to …" rows
}
```

Rules:
- **Write and read actions execute on the server** (`apps/studio/routes/<area>.ts`, V2-2.5). The client menu item and the agent tool call the *same* route. No client-only mutation of project state. This is already the norm for edits; it must become the norm for trash, versions, DS review, exports and comments.
- **UI actions** (open canvas, reveal, select, zoom, mode, present, panels, theme) execute in the shell. Agents reach them through a **UI command channel**: `POST /_api/ui/command {actionId, params}` → server bus → the shell of *that* project window → result echo (generalise today's `acp-focus`). The shell runs the same registry handler a keystroke would. It is refused if no shell is attached, or if the action's `visible(ctx)` is false for that shell or role.

### 3.2 Generated surfaces (build step, committed manifest like `site/lib/roadmap.json`)

`scripts/gen-actions.mjs` → `apps/studio/actions.manifest.json` (id, label, where, keys, params, kind, effect, tier, minRole, server, agent, askAI, `manifestVersion`). From it:

| Surface | Generated how | Who uses it |
| --- | --- | --- |
| Menus, ⌘K, "?", native menu | runtime read of the registry (V2-2.4 already) | people |
| **MCP server `maude mcp`** (stdio, Bun, bundled per DDR-177) | one tool per action with `agent.mcp` (`maude.canvas_create`, `maude.history_restore`, `maude.ui_open`, …), `inputSchema = params`, structured result. Talks to the running studio over loopback with a capability token (§3.3) | **ACP session**: bridge passes it in `mcpServers` (today `[]`). **Terminal Claude**: a `.mcp.json` shipped in the design plugin, or `claude mcp add maude -- maude mcp`. **Codex/OpenCode**: `maude harness` lowers it (it already lowers plugin envs) |
| **CLI `maude act <id> [--param v]…`** + friendly aliases (`maude design history`, `maude design trash restore …`) | generic dispatcher validated against `params`; `--json` output | scripts, CI, harnesses without MCP, humans |
| Docs | `site/content/docs/actions.mdx` + `/design:help` + `maude design help` generated (ends today's drift in the help text) | people + agents |
| Plugin index | `plugins/design/skills/studio-actions/SKILL.md` generated: one line per agent tool with "use when…"; commands reference **action ids**, never raw routes or curl | agents |

**Why MCP as the primary agent surface rather than more `maude` verbs:**
- **Per-tool permission granularity.** The ACP `allowedTools` can list `mcp__maude__ui_open` and leave `mcp__maude__trash_move` to the permission card. A `maude` verb lives under the one blanket `Bash(maude:*)` rule.
- Typed schemas and structured results, so there is no shell-quoting injection surface.
- Discoverable in every Claude session without reading docs.
- Portable to Codex/OpenCode through the existing harness.

The CLI stays as the scriptable fallback, generated from the same source.

### 3.3 Trust boundaries — keeping DDR-054/088, DDR-184/185 and write-scope intact

1. **Canvas origin never reaches the action surface.** Generated agent routes are main-origin privileged routes. `CANVAS_SAFE_API` and the `server.ts` routes map stay **hand-curated** (DDR-088). A test asserts no manifest route with `kind != read-public` appears in either list unless the action declares `canvasSafe: true` with a DDR reference. The UI command channel is main-origin only; the canvas iframe keeps talking `postMessage` to the shell, never to `/_api/ui/command`.
2. **Capability token instead of "any loopback client is privileged".**
   - The sidecar mints a per-launch random token; the MCP server requires it.
   - For ACP, the bridge passes it in the MCP child's env (never in a file the agent can `Read`).
   - For the terminal, `maude mcp` reads it from the keychain/`~/.config/maude/` (0600), keyed per project.
   - `_server.json` stays token-free (the agent can read it).
   - Today's CLI-without-Origin path stays for backward compatibility, but new routes require the token or a same-origin browser.
3. **Tiers map onto the existing ACP permission gate (DDR-179), not a parallel one:**
   - `auto` (UI navigation, reads, project-local writes equivalent to an in-root `Edit`): listed in `allowedTools`.
   - `confirm` (shared-state writes: post a comment as you, move to trash, restore a version, apply "Update N canvases", export outside the project, resync, git commit/push): **not** in `allowedTools`, so the existing PermissionPrompt card fires. "Always for this canvas" works as today.
   - `human` (invite, change role, create/widen/revoke a link, clear out trash, sign-in/keys/accounts, link/unlink hub, report a bug, billing, delete account, summon "Bring everyone here", @mention delivery): **never** generated into MCP. The CLI exposes it only with an interactive TTY confirmation, or not at all.
   - Tier defaults derive from `effect` and may only be lowered by a DDR.
4. **Narrow `Bash(maude:*)`** (existing risk R-1).
   - Replace it with `Bash(maude design <helper>:*)` entries generated from `BIN_VERBS` minus the lifecycle verbs, plus `Bash(maude kg:*)` read verbs.
   - Move `maude design link/adopt/unlink/detach`, `maude hub *`, `maude config set`, `maude init`, `maude harness` and `maude codex` off auto-approve.
   - Extend `acp-session-allowed-tools.test.ts` to assert it.
5. **Write-scope (`write-scope.ts`) stays authoritative for file tools.** The MCP tools never take arbitrary filesystem paths; params are canvas ids, artboard ids and element ids resolved server-side under `designRoot` (reuse `safePathUnderRoot`). Tools that *return* canvas content tag it as untrusted data (same fence as `chat-context.js`).
6. **Roles are enforced on the server** (rule 12). The MCP/CLI caller acts with the signed-in user's hub role. `minRole` is checked in the route, not only by tool hiding. C30: when the role is Can view or Can comment, the MCP server reports zero write tools and the ACP session isn't offered at all.

### 3.4 Making file-editing agents obey v2 invariants (attribution, locks, queue, trash, undo)

Agents will keep editing TSX directly (it's the most capable path; DDR-184). So the invariants must also hold on the file path:

- **Actor header.** Every MCP/CLI call carries `x-maude-actor: ai; session=<id>; run=<runId>`, set by the bridge or `maude mcp`, never by the model. The server attributes the version, "Made by AI" and presence.
- **Run bracketing** (V2-1.5).
  - `run.begin({artboards})` → claim (A4 queue: returns `queued` or `granted`, or offers "Run on a copy").
  - `run.end()` → one version, one undo step.
  - The ACP bridge wraps each prompt turn automatically.
  - Terminal Claude gets the same through design-plugin **hooks**: `UserPromptSubmit`/`Stop` → `maude act run.begin/end`.
- **PreToolUse hook (Edit|Write|MultiEdit|Bash rm/mv)** in the design plugin → `maude act edit.check --file … --ids …`:
  - refuses edits to artboards claimed by another run or soft-locked by a person (A10);
  - refuses removal of a canvas file (redirects to `trash.move`);
  - refuses edits outside the ⌘/ selection scope when the run was scoped (G-AI-6).
  - Fail-open when no studio is running (pure CLI repo work), so terminal-only users aren't blocked.
- **PostToolUse hook** → `maude act edit.touched --file …`. The server maps changed line ranges to artboard ids, which drives rings and "AI works here" at artboard granularity, Made-by-AI, and the DS outside-change review attribution "Claude Code" instead of an anonymous outside change.
- **Element-id contract** (V2-1.4): `design` skill rule — "never drop or reassign `data-cd-id` on an element you keep". A PostToolUse check reports lost ids so locks, arrows and history scopes don't orphan.

### 3.5 What stays agent-only, CLI-only, or UI-only (explicit in the registry via `agent.exempt` / no menu)

- **Agent/CLI-only (dev tooling; no v2 UI home needed — mark `ui: false`):** `smoke`, `perf`, `runtime-health`, `visual-sanity`, `bootstrap-check`, `prep`, `slug`, `draw-build`/`draw-proof`/`svg-optimize`, `canvas-rects`, `ensure-browser`, `agent-browser-safe`, `curl-local`, `scenario-report`, `harness`, `codex`, `cache`, `kg` writes, `hub serve/deploy/workspace-up`, `doctor --fix`, the critic agents and research agents (reached from the UI only as *AI runs*: "Check the system", "Ask AI to fix it").
- **Agent-only today but needs a v2 UI home or an explicit label:** `to-lottie`, `to-rn` (Handoff target?), `import-tokens` (DS canvas › Advanced), `/design:draw` (Pen/Insert › "Draw with AI"), `/design:reel` (File › "Assemble clips into a video" exists in CONTRACT §1 — wire it to the reel run).
- **UI-only by design:** native tabs/windows/Home cross-project index, identity profiles and sign-in, tours/onboarding, pan/zoom gestures, presenter view on a display, connect-Claude sheet, Settings › keys and accounts, everything `tier: human`.

### 3.6 Plan amendments (concrete)

- **V2-1.3 spike** must answer: extended `ActionDef` schema, UI command channel, manifest format, MCP transport and token, tier mapping to DDR-179 modes.
- **New task V2-2.4b** "Agent surface from the registry": `gen-actions.mjs`, manifest, `maude act`, `maude mcp`, bridge `mcpServers` wiring, `Bash(maude:*)` narrowing, design-plugin hooks (run bracketing, edit.check/touched), generated `studio-actions` skill. Done when the parity test (§5) is green for the actions that exist at Phase 2.
- **Every S-package's Done-when** gains: "each new action has `agent.mcp` or an `exempt` reason; MCP contract test green; plugin command/skill updated in the same change".
- **Lane note:** the manifest and generator are **shared files**, so the lead owns them, like the registry.
- **Gate 0 addition** (not signed yet; needs Michal): G0-A13 "Every v2 capability is operable by AI (MCP + CLI) unless exempt; tiers auto/confirm/human as in §3.3".

---

## 4. Plugin evolution list

### 4.1 Existing items that must change

| Item | Change for v2 |
| --- | --- |
| **ACP studio brief** (`acp/bootstrap-brief.ts`) | "Assistant chat" → "AI chat panel"; add CONTRACT §4 voice for AI messages (describe the result, no "I"); name the MCP tools / `studio-actions` skill; "board" wording → Preview annotations; state one-AI-per-artboard and trash semantics as capability facts (not policy) |
| **ACP bridge** (`acp/bridge.ts`, `plugin-bootstrap.ts`) | wire `mcpServers: [maude mcp]` with the token in env; generated `allowedTools` from manifest tiers; narrow `Bash(maude:*)`; derive the `enabledPlugins` suppression literal from the injection set (kill the drift trap); decide flow-in-ACP (keep off; git actions via the action surface instead) |
| **Client `slash-commands.js` STATIC_COMMANDS** | generate from the plugin manifest (missing board/generate/photo/reel/import/video-analyze/chat/hub-workspace) |
| `/design:edit` + `references/edit/*` | run bracket + artboard claim instead of the raw-curl `ai/start` (step 4.5 stalls in ACP today); snapshot step → Version history (not `_history`); id preservation; respect locks/queue; Czech typography pass; voice of "tell user" (step 10); tips (`24-tips.md`) rewritten (no status bar, no Cmd+click wording → v2 select model) |
| `/design:new` + `references/new/*` | per-artboard streaming events (placeholder → drawing → done); "Untitled canvas" naming rule (C4); artboard kinds/presets from the shared catalogue (08); default DS + folder inheritance (A12); canvas create via `canvas.create` so meta/scaffold match the UI |
| `/design:rollback` | ⚠ re-base on Version history (`history.list/restore`, restore one artboard, creates a new version per C5) or deprecate with an alias to `/design:history` |
| `/design:setup-ds` + `design-system` skill + `_bootstrap.md` | output the **Design system canvas** (7 sections, Light/Dark per token, `tokens.json` + generated CSS per C1); several systems: set default, drafts; three-directions streaming; brand-from-website (B7); every token write goes through the review model |
| `design-system-completeness-critic` | check DS-canvas sections and `tokens.json` ↔ generated CSS determinism, not only folder tiers |
| `design-system-keeper` | read tokens/components from the DS canvas model; use the usage index; respect per-canvas `dsRev` (left-out canvases aren't drift) |
| `brand-critic` | brand section of the DS canvas is the canonical mark source (DDR-141 path changes) |
| `copy-critic` | load CONTRACT §3–§4 as the rule set when the canvas is Maude's own UI; generally keep project voice |
| `/design:critic` | callable headless for "Check the system" (UI-started AI run); result summary format for the UI card |
| `/design:board` + `whiteboard` skill + `annotate`/`read-annotations` | vocabulary: Preview tools, stickies, Stickers (E), sections; new elements: stickers `{pack, stickerId, flip}`, vote stamps/sessions (start + summarise only; no ballot reads), `resolved`, `parentArtboard`, section `folded`, `timeRange`, bind targets artboard-edge/element; sticky ↔ comment. Consider alias `/design:annotate` (CONTRACT §3 bans "board" for canvas) |
| `/design:export` + CLI `export` | v2 scope words (Selection · This canvas · Folder · Whole project), JPG, Sound only (.m4a), .srt, file-name tokens, Save to, lane, colour profile, font check, past version, estimate; fix `--option marks=crop`/numeric coercion; Exports history/again/retry; "⌘E dialog" wording → ⇧⌘E sheet |
| `/design:handoff` | target catalogue shared with the Handoff sheet (⇧⌘H); queued handoff in Exports |
| `/design:import` | frames arrive as pictures, "Make editable" per artboard (C24); Figma comments → pins, FigJam → stickies (C23); entry = Menu › File › Import from Figma… |
| `/design:photo` + `photo-adjust` | per-use edits keyed `canvas#artboard/element`, "Apply to every use" explicit (§7) |
| `/design:generate` + `ai-generation` + `media-generation-director` | N takes, take cycling, aspect from the target artboard, cost estimate; place via `asset.place` |
| `/design:reel` + `footage-director` agent/skill + `video-comp` skill | four tracks + "+ track" (C35) and lane migration; captions items on the comp, edit-by-transcript; beat grid/Cut to the beat; ducking; poster frame; linked formats + framing; streaming shot placement via the run registry, Stop keeps placed shots; "View → Timeline" wording → timeline appears on video artboard select / ⇧⌘T |
| `/design:video-analyze`, `footage-keyframes` | "other takes" output shape for the timeline |
| `/design:chat` + `chat-open` | becomes "Open in AI chat panel" + **attach**: open the in-app chat for this terminal session, or print `claude --resume <id>` for an in-app chat (B8); drop "Assistant panel / ⌘⇧A" |
| `/design:browse` | v2 shell words (no "status bar"); optional `ui.open` to a canvas/artboard |
| `/design:screenshot`, `smoke` | v2 shell landmarks/testids for `--studio` captures; annotations hidden in exports per mode rules |
| `/design:init`, `/design:setup-docs` | new-project-without-canvases valid (05); INDEX includes DS canvases pinned and folders |
| `/design:hub-workspace`, `self-host` | roles Can view/comment/edit/Owner, capability report for self-hosted hubs (A6) |
| `/design:help`, `maude design help` | generated from the manifest (fixes today's missing verbs) |
| `design` skill `_guide-05` (comments), `_guide-08` (routing), `_guide-25` (failure modes) | comments via `comment.*` tools (reply/resolve, Mine), no "status bar"; routing table gains history/trash/DS/present actions; raw curl → action tools |
| `ui-kit` skill | artboard kinds (App · Web page · Social · Print · Video · Fixed size) and presets catalogue |
| `source-command-*` mirrors (design + flow) | regenerate on every command add/rename (generator, not by hand) |
| design `hooks.json` | add UserPromptSubmit/Stop (run bracket), PreToolUse (edit.check), PostToolUse (edit.touched); SessionStart adds a manifest/app version handshake |
| flow `scenario` / `agent-browser` skills, `scenario-runner`, `a11y-auditor`, `design-system-guard` | v2 testids (`TESTIDS.md`), v2 landmarks, maude-v2 tokens (no hex); scenarios can drive the app through `maude act ui.*` instead of pixel clicks |
| flow `security-auditor` / `ethical-hacker` | checklist: every new action's tier/minRole/canvas-safe status; MCP tool poisoning via untrusted canvas text in tool results |
| flow in ACP | keep off; expose git commit/push as `confirm`-tier actions under Version history › Advanced instead of loading flow |

### 4.2 New commands / skills / agents / tools needed

| New | Purpose |
| --- | --- |
| **`maude mcp`** (CLI) + **`maude act`** (CLI) | the generated agent surface (§3.2) |
| skill **`studio-actions`** (generated) | how and when to use each tool; tiers; ids not paths |
| skill **`contract-voice`** | CONTRACT §3–§4 words + voice for AI messages and anything written into the Maude UI |
| `/design:history` | list versions, name a version, what changed in words (the agent writes the summary), restore canvas/one artboard, compare |
| `/design:trash` | list/restore (move-to-trash is a tool; clear-out human-only) |
| `/design:comments` | "implement the open comments" loop: read → edit → reply + resolve each, one run = one version (replaces the ChatPanel-only "Implement N comments") |
| `/design:system` | DS-canvas ops: set default, switch canvases (scope), propose "Update N canvases" (apply = confirm), review outside changes, migrate `system/<ds>/`, import tokens, publish/link library (human/confirm) |
| `/design:present` | write order, skip and speaker notes (C31), check links between artboards, start Present (UI channel) |
| `/design:assets` | find (names/tags; pictures if opted in), usage / Not used, place, move to trash |
| `/design:open` (or fold into `ui.*` tools) | navigate the user's window: open canvas, jump to artboard, select element, switch mode |
| agent **`asset-describer`** | read-only, egress-free vision agent for "Search in pictures" (B6), modelled on `footage-analyst`; batch runs on the user's Claude account |
| agent **`ds-migrator`** (optional) | map 42 specimen pages → 7 DS-canvas sections when the deterministic map is ambiguous |
| verbs/tools **`artboards.lint`**, **`canvas.errors`**, **`logs.tail`**, **`beats`** | v2 warnings, render errors, diagnostics and beat grid as agent-readable data |

---

## 5. Risks

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| **R-1 Blanket `Bash(maude:*)` auto-approve** | Every new or existing `maude` subcommand (link/unlink hub, hub tokens, config set) is a zero-prompt capability in a session that reads untrusted canvas content (DDR-054). Parity work done as "more verbs" multiplies it | Narrow per §3.3.4; tiered MCP tools; test that no `effect ∈ {shared, external, destructive}` action is reachable via an auto-approved rule |
| **R-2 Confused deputy via tool results** | Canvas text, comments, sticky text and Figma names flow back as tool results and can steer the agent into `confirm`-tier calls | Results fenced as untrusted (chat-context sanitizer); `confirm`/`human` tiers never auto; `ethical-hacker` MCP checklist; no tool that both reads untrusted content and sends data off-device in one call (DDR-130 trifecta) |
| **R-3 Loopback = privileged** | Any local process can drive privileged routes today; an MCP surface makes that more attractive | Per-launch capability token; tokens never in agent-readable files; DNS-rebind/CSRF gates unchanged |
| **R-4 Hidden in UI ≠ refused** | Generating tools from the registry without server checks would let the agent do what the role hides (rule 12) | `minRole` enforced in routes; per-role MCP contract tests (viewer → write tools refused; C30 → no AI) |
| **R-5 Canvas-origin leak** | A generated route accidentally added to `CANVAS_SAFE_API` gives untrusted canvas JS the action surface | Hand-curated allowlists stay; test that manifest routes ∉ canvas-safe set unless DDR-declared; `GET → 405` tests (DDR-088) |
| **R-6 App ↔ plugin ↔ CLI version skew** | ACP uses the bundled plugin + CLI (DDR-168), but terminal users run the marketplace plugin and npm CLI at other versions. A plugin calling `history.restore` against a v1 studio, or an old plugin against a v2 studio with renamed actions, fails in confusing ways | `manifestVersion` in `/_health` + MCP `initialize`. Plugin SessionStart hook compares and warns ("this plugin is older than the app — update with /plugin marketplace update maude"). Action ids are append-only, with aliases on rename. `check-version-parity.sh` asserts the bundled plugin manifest hash matches the generated manifest. `bump-version.sh` regenerates |
| **R-7 Two undo/history systems** | `/design:rollback` (`_history/`) vs Version history (project/git) vs client undo stacks: an agent "undo" and the user's ⌘Z disagree | V2-1.5 single op log; rollback re-based or deprecated; the agent run is one step |
| **R-8 Agents bypass v2 invariants via raw file edits** | Hard deletes, ignored locks/queues, DS edits as anonymous outside changes, lost element ids | Plugin hooks (§3.4), actor header, id-preservation check; fail-open only when no studio runs |
| **R-9 Vote secrecy / presence privacy** | An agent that can read annotations could read hidden ballots or summarise others' private chats (C27: chats are personal) | Server never returns ballots before the end, to anyone including AI; `chats.*` tools return only the caller's chats |
| **R-10 Scope creep / lane conflicts** | The manifest, generator and bridge wiring are shared files across all lanes | Lead-owned (like the registry); one task V2-2.4b; S-packages only add registry entries |
| **R-11 Cost / runaway runs** | `confirm` cards in a long `/design:comments` loop are noisy; "Always for this canvas" grants could over-grant | Reuse DDR-179 "always for this canvas" scope; never grant `human` tier; grants listed under AI chat panel › Advanced with Reset |

### Tests that prove parity (add to Phase 2 and every gate)

1. **Manifest drift gate:** `gen-actions.mjs --check` (committed manifest == generated), like the site-content/roadmap gates.
2. **Coverage test:** every registry action has `agent.mcp === true` or a non-empty `agent.exempt`. The count of exempt actions is ratcheted (it can only go down without a DDR). This is the agent column of the nothing-deleted audit (`check-v2-nothing-deleted.mjs`, extended).
3. **MCP contract tests:** boot a fixture studio (`NO_OPEN=1`, `MAUDE_NO_AUTOBUILD=1`, unlinked copy, run alone per memory). For each tool, call it via MCP and assert the same server-side effect as the UI path (file diff / history entry / trash row / version author = AI). These are red-first per memory: revert the handler and watch the test fail.
4. **Tier tests:** `human` actions absent from `tools/list`; `confirm` actions absent from ACP `allowedTools` (extend `acp-session-allowed-tools.test.ts`); `Bash(maude:*)` no longer present; lifecycle verbs not auto-approved.
5. **Role tests:** a viewer/commenter token → write tools refused by the route (not just hidden); C30 → `tools/list` has no write tools.
6. **Canvas-origin test:** no manifest route reachable from the canvas origin (`GET → 405`/403), allowlists unchanged unless a DDR is referenced.
7. **Plugin reachability:** extend `cli/lib/plugin-cli-reachability.test.mjs` so plugin markdown may reference only action ids present in the manifest, and bans raw `curl http://localhost` in plugin markdown (use tools or `curl-local`).
8. **Hook tests:** PreToolUse refuses an edit to a claimed artboard and a canvas `rm`; PostToolUse attributes to "Claude Code"; both fail-open with no studio.
9. **E2E:** one desktop scenario per S-package driven *only* through `maude act` / MCP (e.g. create canvas → add artboard → restore version → move to trash → restore), proving the agent can do the journey the UI scenario does.
