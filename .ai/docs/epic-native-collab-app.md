# Epic: Maude as a native collaborative app — Tauri shell + in-UI Git/GitHub + zero-setup hub + ACP

> **Scope update — 2026-09-13:** [Reliable project multiplayer](../plans/feature-reliable-project-multiplayer.md)
> now owns invitation → managed project opening, bidirectional live editing,
> logical history and peer-safe personal undo on cloud and self-hosted hubs.
> Its mandatory local UI/native/media baseline protects today's working product.
> The historical Git/folder-led entry described below is not the target designer
> onboarding contract. Implementation and product acceptance remain incomplete.

> **This is an epic, not a single feature.** It decomposes into 8 sequenced phases (E0–E7), each of which becomes its own `/flow:plan` when scheduled. This document is the strategic spine: it fixes the architecture, records the crux decisions, inventories what already exists (so future phase-plans never reinvent it), and scopes each phase enough to plan in detail later.
>
> Validate docs and codebase patterns before implementing each phase. Pay attention to existing naming, utils, imports, and the DDR record.

## Original idea (verbatim — user, 2026-06-03)

> "mam takovy napad, ze bychom celou aplikaci zabalili do electron nebo cehokoliv aby bezela jako native a uzivatel by mel realne moznost v ui pripojit se na nejake github repo, nekde na pozadi by se stahlo, pripojit se na remote hub tim ze vlozim token a v podstate by nemusel resit zadny setup nikde. Nebo rovnou treba i zalozit novy projekt (github) a sharenout to s ostastimi a pak v ui i moznost commits push atd. Proste bysme nad celym maude udelali vrstvu, ktera by resila maintanance problemy a dala uzivatelum vic figma like experience bez toho aniz by museli neco psat do claude code. Bude to pro non-technical peoples kteri chteji jen nad necim spolecne kolaborovat. Do tohoto planu by pak perfektne zapadal i ten ACP sidepanel kde si pripojim lokalni claude code a muzu vse ovladat v jednom prostedi"

## Description

Build a **native desktop application layer over the whole of Maude** so non-technical collaborators can run, connect, and co-edit design projects **without ever touching a terminal or typing into Claude Code**. The shell wraps the existing dev-server, adds in-UI Git/GitHub (clone, commit, push, create repo, share), surfaces the already-shipped hub + Yjs collaboration as zero-setup onboarding (paste a token → connected), and folds in the ACP chat sidepanel so a connected local Claude Code can be driven from inside the same window.

The strategic framing: **Maude pivots from a developer plugin-toolkit into a standalone, Figma-like collaborative product** — while reusing the substantial collaboration backbone that already exists (hub, linked mode, Yjs, presence). The native shell is the missing distribution + zero-setup + git-plumbing layer.

## User Story

As a **non-technical collaborator** (PO, designer, founder), I want to **install one app, sign in / paste a token, and start co-editing a design project with my team** — opening or creating a GitHub repo, saving and publishing changes, and seeing teammates' cursors live — **without a terminal, CLI, or knowing what git is**, so that collaborating on design in Maude feels like opening Figma.

Secondary (technical peer): As a developer paired with that collaborator, I want a **chat sidepanel that connects to my local Claude Code** so I can drive design edits (`/design:edit`, critics, screenshots) from inside the same window the team is looking at.

## Problem

Today Maude is powerful but **gated behind developer tooling**:

- It runs only as a **CLI + Claude Code plugins + a localhost dev-server you open in a browser**. There is no native app; launch requires `maude design serve` / a `/design:*` slash command from a terminal.
- **Git is 100% manual** via terminal/Claude Code. There is **no in-UI clone, commit, push, repo-create, or share** (no `octokit`, no git library — only incidental `git hash-object` shell-outs in `cli/lib/cache.mjs`).
- **Hub connect requires the CLI** — `maude design link <url> --token <hex>`. There is **no onboarding / welcome / auth UI** in the client (`app.jsx` has zero `token`/`sign-in`/`onboard` surface).
- The target audience — **non-technical people who just want to collaborate** — is excluded by every one of the above.

## Solution (architecture)

```
┌──────────────────────────────────────────────────────────────────┐
│ Tauri v2 native app  (Rust core + OS webview)                      │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  OS webview  →  http://127.0.0.1:<port>  (existing UI)     │    │
│  │   • first-run onboarding wizard (NEW — E4)                 │    │
│  │   • Projects / Git panel: clone·commit·push·share (NEW—E2/E3)│  │
│  │   • Canvas + collab + presence (EXISTS — Yjs/hub)          │    │
│  │   • ACP chat sidepanel (de-icebox phase-7 — E6)            │    │
│  └──────────────────────────────────────────────────────────┘    │
│        ↑ sidecar spawn + lifecycle (Tauri sidecar)                 │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  maude dev-server  (existing Bun-compiled binary, DDR-009) │    │
│  │   + NEW endpoints: /_api/git/* · /_api/github/* · /_api/onboard│ │
│  │   reuses: boot-self-heal · canvas-create · history · hmr   │    │
│  └──────────────────────────────────────────────────────────┘    │
│        │ git (isomorphic-git, pure-JS) │ OS keychain (Tauri)       │
└────────┼──────────────────────────────┼───────────────────────────┘
         │                              │
   GitHub REST/OAuth          Maude hub (EXISTS — hocuspocus + SQLite
   (clone/create/push/share)   + HMAC tokens + linked mode + Yjs sync)
```

**Decisions taken (this planning session, 2026-06-03):**

1. **Shell = Tauri v2 (sidecar).** Rust core + OS webview; the existing compiled Bun dev-server binary runs as a Tauri **sidecar** (Tauri's built-in mechanism for bundling + spawning an external executable). ~10 MB, OS webview, good auto-updater + code-signing. Reuses 100% of the dev-server and client — the shell's job is process lifecycle, native chrome, OS keychain, deep links, and auto-update.
2. **AI agent runtime = ACP to a local Claude Code (phase-7 as-is).** The agent runs locally per technical peer. **Product consequence (must be stated in UI + docs):** non-technical peers collaborate on the canvas (presence, comments, annotations, version save/publish — all of which work without an agent) but **cannot drive AI edits solo**; AI editing is driven by a paired technical collaborator's local Claude Code through the ACP sidepanel. True non-technical-solo AI is the **de-icebox trigger** for a later cloud/hub-hosted-agent phase (explicitly out of scope here).
3. **Scope = full phased epic.** This doc; each phase → its own `/flow:plan`.

**Decisions still to record as DDRs (front-loaded in E0 — see Design Decisions):** git engine (lean: isomorphic-git, pure-JS, zero system-git dependency — matches "zero setup"); GitHub auth model (lean: "Sign in with GitHub" OAuth in system browser, token → OS keychain — **not** PAT-paste; GitHub App as a later upgrade for org/collaborator management); native-shell security model (sidecar loopback-only, CSP, deep-link allowlist); the two-layer collaboration/sync model + repo/branch IA (already decided this session — E0 just formalizes them as DDRs, including the scoped DDR-054 iframe gate for live-syncing peer canvas *code*).

## Metadata

- **Type:** New Capability (epic / product layer)
- **Complexity:** High (new native-shell surface, new git/GitHub surface, security-critical multiplayer GA)
- **App/Package:** new `apps/desktop/` (Tauri) + `apps/studio/` (new endpoints) + `cli/` (reuse `design-link.mjs`, hub plumbing) + `site/` (download/landing)
- **Affected Systems:** dev-server, hub, linked mode, CLI, release/CI (`build-binaries.yml`), site
- **Dependencies (external, by phase):** Tauri v2 (Rust toolchain), `isomorphic-git` (TBD in E0), `@octokit/*` (TBD in E0), `@agentclientprotocol/*` or hand-rolled ACP (E6). Hub deps (`@hocuspocus/*`, `yjs`, `better-sqlite3`) already present.
- **Crux tension:** "zero setup, non-technical" vs. "ACP needs a local agent" — resolved for this epic by the agent-runtime decision above; revisited as a later cloud-agent phase.

---

## Context References

> The single most important section: **most of the collaboration backbone already exists.** Future phase-plans MUST read these before scoping, to reuse instead of reinvent (per CLAUDE.md "Pattern priors come first").

### Must-Read Files / Assets (reuse inventory)

- `apps/studio/server.ts` + `server.mjs` — dev-server entry; the binary the Tauri sidecar spawns. Lifecycle, port resolution (`--root` → `$CLAUDE_PROJECT_DIR` → cwd).
- `apps/studio/boot-self-heal.ts` (DDR-044) — first-launch `bun install` + `build.ts`; the "maintenance" foundation. Shell wraps this with a native "updating…" affordance.
- `apps/studio/canvas-create.ts` + `api.ts` `createCanvas` + `test/canvas-create-api.test.ts` — **the security pattern to mirror for all new write endpoints**: main-origin-only (absent from `startCanvasServer` allowlist per DDR-054), strict name allowlist, designRoot containment, 409. New `/_api/git/*` + `/_api/github/*` endpoints follow this exactly.
- `apps/studio/http.ts` — route table; where new endpoints register.
- `apps/studio/client/app.jsx` + `client/styles/3-shell.css` — the React UI; where onboarding wizard + Projects/Git panel mount. Note the recent "+ board" composer in the tree header as the precedent for a new UI write-affordance.
- `cli/lib/design-link.mjs` + `cli/commands/design.mjs` (`runLink`/`runAdopt`/`runUnlink`/`runStatus`) — **hub-connect plumbing already built.** Today CLI-only; E4 surfaces it as UI actions (server calls into this logic). Token stored at `~/.config/maude/hubs.json` (never committed); E3/E4 move secrets to the OS keychain via Tauri.
- `apps/hub/` (README + `src/server.mjs` + `src/tokens.mjs` + `src/admin/`) — **the collab backbone:** hocuspocus + SQLite, HMAC-SHA256 tokens, scope-bound tokens, rate limiting, admin UI, deploy templates (`maude hub deploy fly|docker`). Phase 9 complete. The "paste a token → connect to remote hub" pillar is largely a UI over this.
- `apps/studio/sync/agent.ts` + `sync/connection-state.ts` + `sync/status.ts` — bidirectional file-sync agent, offline state machine, `_sync.json`. Linked-mode plumbing.
- `.ai/plans/phase-7-acp-chat-sidebar.md` — **the ACP sidepanel plan, iceboxed.** E6 de-iceboxes it largely as-written (the chosen agent model matches its "solo-only / local-per-peer" scope). Note the `/design` → `/design:edit` rename TODO at its top.
- `cli/commands/hub.mjs` + `hub.test.mjs` — hub CLI (token generate/rotate, deploy, serve).

### Files to Create (by phase — high level)

- `apps/desktop/` — new Tauri v2 app (Rust `src-tauri/` + minimal JS glue). [E1]
- `apps/studio/git/` — git service module (clone/status/commit/push/pull/branch) over the chosen engine. [E2]
- `apps/studio/github/` — GitHub identity + repo create + collaborator/share over OAuth + REST. [E3]
- `apps/studio/client/panels/ProjectsPanel.tsx` + `OnboardingWizard.tsx` + `GitPanel.tsx`. [E2–E4]
- `apps/studio/client/panels/ChatPanel.tsx` + `client/acp/` + `acp-bridge.mjs` (per phase-7). [E6]
- `.ai/archive/decisions/DDR-086..0NN-*` — the decisions front-loaded in E0 + per-phase.
- `site/content/docs/desktop/*.mdx` + download page. [E7]

### Design canvases

| Canvas | Status | Tags | Notes |
| ------ | ------ | ---- | ----- |
| `.design/ui/Sync Hub Admin.tsx` | (read its sidecar) | hub | Closest existing mockup — the hub admin surface. Reference for E4 hub-connect UI styling/tone. |
| _(none)_ | — | — | **Onboarding wizard, Projects panel, and Git panel are net-new screens.** Each owning phase MUST mock them with `/design:new` first (Figma-like target persona ⇒ design quality is load-bearing), then implement against the approved canvas. |

### Documentation / research to read per phase

- Tauri v2 sidecar + updater + signing docs (E0/E1). — Why: shell lifecycle, code-signing/notarization for non-technical distribution.
- `isomorphic-git` docs (E0/E2). — Why: pure-JS git, clone/commit/push auth model, LFS/submodule limits vs. design-repo reality.
- GitHub OAuth (device flow / PKCE) + REST `repos`/`collaborators` (E0/E3). — Why: sign-in + create-repo + share without PAT paste.
- Agent Client Protocol spec — https://agentclientprotocol.com/get-started/introduction (E6). — Why: ACP subset (already scoped in phase-7 Task 1).
- `.ai/archive/decisions/DDR-054` (linked-mode trust) + `DDR-064` (shared Y.Doc) + `DDR-076` (empty doc never clobbers) — Why: E5's live-sync reuses the shared-Y.Doc machinery; the DDR-054 iframe sandbox/CSP is the scoped gate for live-syncing peer canvas *code* (not a broad GA gate anymore).

### Patterns to Follow

- **Every new server write-endpoint mirrors `canvas-create.ts`**: main-origin-only, strict allowlist, path containment, explicit 4xx, single-source template via build-time text-import (DDR-045-safe), plus a `test/*-api.test.ts` validator matrix + a `canvas-origin-gate.test.ts` entry asserting the untrusted iframe 403s it.
- **Disk paths via `paths.ts`** (DDR-045) — never `dirname(fileURLToPath(...))`; the sidecar runs inside a compiled binary.
- **Plugins reach executables via `maude design <verb>`** (DDR-062) — any new bin helper registers as a verb; `plugin-cli-reachability.test.mjs` bans raw `.sh` paths.
- **Secrets never committed** — hub tokens already go to `~/.config/maude/hubs.json`; the native shell upgrades this to the OS keychain (Tauri). Mirror `gitignore-block.mjs` for anything that must stay out of git.

---

## Design Decisions

> Front-loaded DDRs (record in **E0** before building) + the standing decisions taken this session. Per-phase DDRs noted in each phase block.

### Decisions taken this session

| Decision | Choice | Rationale |
| -------- | ------ | --------- |
| Native shell tech | **Tauri v2 (sidecar)** | OS webview (~10 MB) + sidecar bundling fits the already-compiled Bun binary; reuses 100% of dev-server/client; mature signing/updater for non-technical distribution. |
| AI agent runtime | **ACP → local Claude Code (BYO, per-peer)** | Lowest lift; matches phase-7's solo/local-per-peer scope. Product limit: non-technical peers can't drive AI solo (de-icebox trigger for cloud agent). |
| **Collaboration / sync model (two layers)** | **(1) Git = canvas *lifecycle & distribution*:** a new canvas reaches a teammate by **push → pull**, never by auto-sync — no hub-propagation of create/delete (**Phase 26 out**), no cold-start materialization, no untrusted inbox. **(2) Yjs/hub = live *co-editing of canvases both peers already have*:** edits, annotations, and comments **sync live and persist**; cursors / selection / viewport / who's-here are **ephemeral awareness** (gitignored — the `_active.json`-style state — never committed). | The flow the user wants: *"I create something → push → you pull → and only then do we see live edits together."* This keeps true real-time collaboration (you watch each other's edits/annotations/comments) **while** git remains the explicit gate for *which canvases exist on your disk* — so there's no cold-start clobber, no canvas you didn't ask for, no conflict ambush. Ephemeral "where I am / what I selected" never pollutes git. |
| **Navigation / IA model** | **Repo + branch switching is the organizing primitive; one project = one repo. The maude UI _and_ the hub UI organize around "switch repo / switch branch" — NOT a hub multiplexing many repos** | User: it's easier to understand switching between repos + branches than a hub wired to many different repos that turns into a mess. Maps 1:1 onto the git-as-source-of-truth model and onto how IDEs/Figma present "projects". A repo switcher + branch switcher is the top-level nav; the hub (if used at all) attaches to **one repo/branch context at a time**, it does not become a parallel multi-repo directory. **Both the maude UI and the hub admin UI must adopt this framing.** |
| Epic shape | **Full phased epic** | This doc; phases E0–E7, each a future `/flow:plan`. |

### DDRs to record in E0 (leans noted; confirm during E0 spike)

> **✅ Recorded 2026-06-16 (phase-26 Task 1).** All front-loaded decisions are now formal DDRs — [DDR-106](../archive/decisions/DDR-106-tauri-v2-native-shell-architecture.md) (Tauri shell architecture, incl. the apps/studio + binary→triple corrections), [DDR-107](../archive/decisions/DDR-107-git-engine-isomorphic-git.md) (git engine), [DDR-108](../archive/decisions/DDR-108-github-auth-oauth-device-flow.md) (GitHub auth), [DDR-109](../archive/decisions/DDR-109-native-shell-security-model.md) (shell security), [DDR-110](../archive/decisions/DDR-110-three-lane-collaboration-model.md) (three-lane collaboration + mental model + repo/branch IA). The leans below were all confirmed as decided; the DDRs are authoritative from here.

| DDR | Question | Lean (→ confirmed) | Why |
| -------------- | -------- | ---- | --- |
| [DDR-107](../archive/decisions/DDR-107-git-engine-isomorphic-git.md) — git engine | System git vs. `isomorphic-git` vs. Tauri git plugin | **isomorphic-git** (pure-JS, zero system-git dep) | Non-technical users may not have git installed; design repos are small. Detect + prefer system git when present; iso-git otherwise. |
| [DDR-108](../archive/decisions/DDR-108-github-auth-oauth-device-flow.md) — GitHub auth | PAT-paste vs. OAuth (device/PKCE) vs. GitHub App | **OAuth "Sign in with GitHub"** in system browser → OS keychain | PAT-paste is too technical + over-scoped. GitHub App is the later upgrade for org installs + fine-grained collaborator mgmt. |
| [DDR-109](../archive/decisions/DDR-109-native-shell-security-model.md) — shell security model | Sidecar exposure, CSP, deep-link allowlist | loopback-only sidecar; strict CSP; `maude://` deep-link allowlist; keychain for secrets | The shell broadens attack surface; lock it down before E3 ships real GitHub tokens. |
| [DDR-110](../archive/decisions/DDR-110-three-lane-collaboration-model.md) — collaboration sync model (→ **three** lanes) | What syncs via git vs. via the hub, and what's ephemeral | **Git = canvas lifecycle/distribution (push→pull, no cold-start, no create/delete propagation). Yjs/hub = live co-edit + annotations + comments for shared canvases (persisted). Cursors/selection/viewport = ephemeral, gitignored. + Lane 3: artboard lock for the un-mergeable TSX code body.** | Decided this session; refined to three lanes per `collab-model-design.md`. **Consequence:** the former **Phase 26** idea (hub create/delete propagation + untrusted-inbox consent — **plan dropped/deleted**) is **out**; DDR-054 iframe hardening returns only as a **scoped gate for live-syncing peer canvas *code* (TSX)** — annotations/comments (data) don't need it; the broad untrusted-inbox trust burden is gone. |

### Tokens / icons / density

UI work in E2–E6 follows the **project design system** (`.design/system/project/`) and the existing client styles. No hardcoded colors. Density: desktop = command-center, keyboard-first; the onboarding wizard is the one place that should feel generous/welcoming (non-technical first impression). Each UI phase runs `/design:new` → critic panel before implementation.

---

## Phases (each → its own `/flow:plan`)

> Sequencing: **E0 → E1** are the spine. **E2 → E3** chain (git → GitHub). **E4** depends on E1 (+ hub already exists). **E5** depends on E1 and gates the "share" promise. **E6** depends on E1 (independent of git). **E7** spans E1+.

### E0 — Decisions & de-risk spike *(Complexity: Low–Med)*

- **Goal:** Record the four front-loaded DDRs and prove the riskiest seam in a throwaway spike before committing the epic.
- **Spike acceptance:** A Tauri v2 window on macOS that (a) spawns the existing compiled dev-server binary as a sidecar, (b) allocates a free port + manages its lifecycle (heals/kills on quit), (c) loads the existing UI in the OS webview, and (d) **renders an existing multi-artboard canvas inside the Tauri window** with HMR intact.
- **Also de-risk:** isomorphic-git `clone` of a small real repo from inside the sidecar; a GitHub OAuth device-flow round-trip to a scratch app (token to keychain).
- **DDRs:** git engine · GitHub auth · shell security model · two-layer collaboration/sync model · repo/branch IA. (Detailed plan: `epic-native-collab-e0-decisions-spike.md`.)
- **Out of scope:** any UI polish, Windows/Linux builds (E1).

### E1 — Tauri native shell *(Complexity: High)*

- **Goal:** Production-grade shell wrapping the dev-server. The "zabalit do native" pillar.
- **Scope:** sidecar lifecycle (spawn/respawn-on-crash/kill-on-quit, single-instance, port allocation); native window chrome + OS menus; `maude://` deep-link scheme; **auto-update** (Tauri updater + signed release feed); **code-signing + notarization** (macOS) and signing (Windows); packaged installers (`.dmg`/`.msi`/AppImage); wrap `boot-self-heal` with a native "preparing…" splash; crash recovery.
- **Reuses:** boot-self-heal (DDR-044), runtime-health, the compiled binary build (DDR-009/084).
- **CI:** extend `.github/workflows/build-binaries.yml` (or a sibling) to produce signed desktop artifacts per-platform; respect `MAUDE_SKIP_RUNTIME_BUILD=1` and the committed runtime-bundle invariant.
- **DDRs:** updater channel + signing identity management.

### E2 — Project & Git layer (local) + **git-awareness UI** *(Complexity: High)*

- **Goal:** In-UI open/clone/save/publish **with always-visible git state** — the "v ui možnost commits push" pillar, in non-technical language. The user must always be able to answer "what have I changed and not saved?" and act on it with one button.
- **Server scope:** `/_api/git/*` endpoints (`status`/`clone`/`commit`/`push`/`pull`/`branch`/`diff`/`log`) over the chosen engine; a managed projects directory (clone target); background clone with progress. A lightweight **status poll / fs-watch** (reuse `fs-watch.ts` + the `activity.ts` debounce) so the UI's dirty-state stays live without manual refresh.
- **Git-awareness UI (the explicit answer to "vidět necommitnuté soubory + commit tlačítko"):**
  - **Changes panel** — a dedicated panel listing every changed file grouped as **Modified / Added / Deleted / Untracked**, each with its path and a per-file action (stage/unstage, discard). This is the "which files aren't committed yet" view.
  - **Dirty indicators in the file tree** — a colored dot / "M·A·D" badge on each changed canvas row in the existing tree (mirror the just-shipped activity-overlay badge style), plus a **count badge on the Changes panel tab** ("3 unsaved"). At a glance, no panel needed.
  - **Commit affordance** — message field + **"Save version" button** (= `commit`), with select-all / per-file checkboxes. Empty-message and no-selection states handled. Optional quick "Save all" one-click.
  - **Share = push, collaborate = pull** (the collaboration model — see Decisions). **"Publish changes" button** (= `push`) sends your work to the shared repo. There is **no hub file-sync** — you publish when *you* decide, nobody's edits land on your disk unasked.
  - **Live "there are new changes → Get latest" nudge** — the app **polls the remote** (GitHub `compare` / `git ls-remote` on focus + interval) and, when the shared repo is ahead, shows a quiet banner: *"Anna published 2 changes — Get latest"* with a one-click **"Get latest"** (= `pull`). This is the entire "live collaboration" surface for files: *show* that changes exist, let the user pull on their terms. No auto-apply, no conflict ambush. Reuses the `<SyncBanner>` idiom.
  - **Visual diff (Maude-specific differentiator — user-loved)** — for a changed *canvas*, a **before/after rendered comparison** (re-render committed `HEAD` vs. working tree via the screenshot pipeline) instead of a raw text diff. Far more meaningful for non-technical users; this is the primary diff view, not a fallback.
  - **Version switching** — switch between saved versions (and shared branches) from a simple picker; selecting one previews/loads it. Built on git refs/log; restore reuses the `_history` snapshot idiom where it overlaps. This is the "Mělo by tam být switchování verzí" requirement.
  - **History** — a simple version timeline, each entry click-to-preview (uses the visual-diff render).
  - **Clean & simple, single register** — plain verbs only (Save version / Publish / Get latest / History / Versions). **No "developer view" / no raw git jargon toggle** (dropped per user: keep it clean). Real git is the engine, never the vocabulary.
- **Non-technical vocabulary map:** Save version = `commit` · Publish changes = `push` · Get latest = `pull` · History = `log` · Unsaved changes = working-tree dirty.
- **Reuses:** the `canvas-create.ts` security pattern for every write endpoint; `gitignore-block.mjs` for managed ignores; `fs-watch.ts` + `activity.ts` for live dirty-state; the screenshot pipeline for visual diff; `<SyncBanner>` idiom for the publish/sync bar; the tree-badge style from the activity overlay (DDR-075).
- **Mock first:** `/design:new` for the Changes panel, commit/publish bar, tree dirty-badges, and visual-diff view — plus loading/empty ("nothing to save")/error/conflict states. This is core surface the persona lives in daily; spend the design budget.
- **DDRs:** managed projects-dir layout ([DDR-111](../archive/decisions/DDR-111-managed-projects-directory.md)); staging model (full git index vs. simplified "select files to save") → [DDR-112](../archive/decisions/DDR-112-simplified-staging-model.md) (simplified, file-level, no index; metadata sidecars auto-staged). **Conflict handling stays minimal by design:** the only conflict path is "you tried to Publish but the shared repo moved" → reject push → prompt "Get latest first". On the rare true content conflict, offer a simple **per-file "keep yours / take theirs"** (never a 3-way merge UI). The whole point of the git-not-file-sync model is that this is an edge case, not the daily path.

### E3 — GitHub identity & remote *(Complexity: High)*

- **Goal:** "Sign in with GitHub", create a new repo, set remote, push, and **share with collaborators** — the "založit nový projekt (github) a sharenout to s ostatními" pillar.
- **Scope:** OAuth sign-in (per E0 DDR) → token in OS keychain; `/_api/github/*` for create-repo (public/private), set-remote, invite collaborator (by GitHub username) / manage access; identity surfaced in UI (avatar, signed-in state). Repo-create wires straight into E2's clone/open so "new project" lands as a working local clone.
- **Reuses:** E2 git layer for the push after create.
- **DDRs:** OAuth App vs GitHub App boundary (App later, for org installs + fine-grained collaborator mgmt); private-repo default for non-technical safety.

### E4 — Zero-setup onboarding + **repo/branch switcher** *(Complexity: Med)*

- **Goal:** First-run wizard that removes all CLI, organized around the repo/branch model — the "nemusel by řešit žádný setup" pillar.
- **Scope:** first-run wizard, **GitHub-first** — **(a) Sign in with GitHub → open an existing shared repo or create a new one** (E3) is the primary door; **(b) open a local folder / start solo**; **(c) advanced: paste a hub token** (surfaces `runLink`/`runAdopt` for self-hosted real-time, demoted to an "advanced" affordance, not the headline). Persistent **repo switcher + branch switcher** as the top-level nav (the IA primitive — see Decisions): a clear "you are in **repo X** on **branch Y**" header with one-click switch; switching repo/branch reloads the canvas tree for that context. This is the "switchování mezi repos a branches" the user wants — simple, IDE/Figma-like, never a multi-repo hub soup. Secrets → OS keychain.
- **Reuses:** **almost entirely existing** — `design-link.mjs` + hub token store (for the advanced door only), `runStatus` health probe, `_sync.json` + `<SyncBanner>`. The repo/branch context layers on E2's git engine.
- **Mock first:** `/design:new` for the wizard **and** the repo/branch switcher header (make-or-break first impression + the nav users live in; aspiration bar applies).

### E5 — Live multiplayer (Yjs) + git as the share boundary + hub UI realignment *(Complexity: Med–High)*

> **Re-scoped by the collaboration + IA decisions, but presence and live co-editing STAY.** Two people working together must see each other's **live edits, annotations, and comments** — that's kept. What's removed is the *distribution* burden: no hub-propagation of canvas create/delete (Phase-26 untrusted-inbox **out**), no cold-start auto-materialization. New canvases travel by **git push→pull**; live collaboration then runs on canvases both sides already have.

- **Goal:** Real-time Figma-like co-working — see cursors, selections, live edits, live annotations, live comments — **with git as the explicit gate for which canvases land on your disk**. The "figma like experience" + "spolecne kolaborovat" pillars.
- **Scope:**
  - **Live content sync (Yjs/hub) for shared canvases** — edits + **annotations** (the FigJam layer) + **comments** sync live between peers **and persist** (Y.Doc → disk projection, reuse DDR-064). This is real co-editing, not just a nudge. Annotations + comments are *data* overlays → lowest-risk, ship first; live sync of the canvas *TSX* itself (peer-authored code) ships behind the iframe hardening below.
  - **Ephemeral awareness** — cursors, the other person's selection, viewport/"where I am", who's-here, plus DDR-078 agent presence. **Never persisted, gitignored** (the `_active.json`-style state). This is the layer that's purely transient.
  - **Git is the share boundary (no cold-start sync)** — a freshly created canvas does **not** appear on a peer until **push → pull**. Honors the DDR-076 spirit (an empty/absent hub doc never clobbers or fabricates a local canvas) and keeps Phase-26 create/delete propagation out. Pair this with E2's "changes available → Get latest" nudge for peers not in a live session.
  - **Hub UI realignment (IA decision)** — rework the hub admin (`Sync Hub Admin` canvas + `src/admin/`) to present **one repo/branch context**, not a multiplexed directory of many repos. A hub instance attaches to a repo/branch; its UI speaks repos+branches, matching the maude UI.
- **Reuses:** Yjs awareness **and** the shared-Y.Doc live-sync machinery (DDR-064) from Phase 8/9; annotation + comment layers (Phase 5.1/21/24); offline state machine; `_history`.
- **Security (returns, but scoped):** live-syncing a peer's canvas **TSX is peer-authored code rendered in your iframe** → the DDR-054 **iframe sandbox + CSP** hardening (F1) gates the live-*code*-edit feature. Scope is far narrower than the old untrusted-inbox: in-session, with peers you invited, on a canvas you explicitly pulled. Annotations + comments (data) don't carry this and can ship ahead of it.
- **Explicitly OUT (decided):** hub-propagation of canvas **create/delete** (Phase 26); cold-start auto-materialization of canvases you didn't pull; receiving any canvas you didn't ask for. The *distribution* path is git-only; the hub only ever live-syncs canvases that already exist on both sides.
- **DDRs:** CRDT↔git reconciliation for canvases edited live then committed (live peers already share content; how does push/pull stay sane vs. the Y.Doc — fast-forward, single-committer convention, etc.); presence/live-sync transport when no hub is deployed (tiny built-in relay vs. degrade to solo); annotations+comments-first vs. TSX-live-edit sequencing behind the iframe gate.

### E6 — ACP sidepanel (de-icebox phase-7) *(Complexity: High)*

- **Goal:** "Připojím lokální Claude Code a můžu vše ovládat v jednom prostředí" — the ACP chat sidepanel, for the technical peer.
- **Scope:** revive `phase-7-acp-chat-sidebar.md` largely as-written (the chosen agent model = its "solo/local-per-peer" scope): right-side chat panel speaking ACP to a local Claude Code; **loopback-only `acp-bridge`** (rejects non-loopback — mirrors the dev-server's own model); active-canvas + selected-element auto-attached as context; streaming + cancel; quick actions (`/design:edit`, `/design:critic`, `/design:screenshot`); per-canvas transcript at `.design/_chat/<slug>.jsonl`; `/design:chat` slash command opens the panel. In the native shell, the app can **detect/launch** a local Claude Code (still local-per-peer — non-technical peers see the panel disabled with an explainer).
- **Reuses:** phase-7 plan (Tasks 1–7) verbatim as the starting point; apply its `/design` → `/design:edit` rename TODO.
- **DDRs:** ACP subset (phase-7 Task 1 already scopes it); native shell agent-discovery/launch behavior.

### E7 — Maintenance, auto-update & distribution *(Complexity: Med — spans E1+)*

- **Goal:** The "řešila by maintenance problémy" pillar — make the app self-maintaining and distributable to non-technical users.
- **Scope:** release pipeline for signed desktop builds (channels: stable/beta); auto-update UX (download in background → "restart to update"); opt-in crash reporting + minimal telemetry; in-app "what's new"; dev-server self-heal surfaced as native status; download/landing page + docs (`site/content/docs/desktop/`).
- **Reuses:** existing release flow (`scripts/bump-version.sh`, version parity, `build-binaries.yml`), boot-self-heal, runtime-health.
- **DDRs:** telemetry posture (privacy — non-technical users, opt-in only); update channel governance.

---

## Validation (epic level)

Each phase produces its own `/flow:plan` with a full validation block (`/flow:validate`: static → tests → build → cross-platform scenario → a11y → design-system-guard). Epic-level gates:

1. **No regression to the existing dev-server / hub / CLI** — the shell is additive; the binary, CLI, and plugin paths keep working standalone (a non-shell user is unaffected). Mirror the `feedback-no-break-exhaustive-verify` posture for any dev-server refactor.
2. **Security pass per write-endpoint** — every new `/_api/git/*` + `/_api/github/*` + onboarding endpoint gets defender + adversarial review (mirror the canvas-create F1/F2 pass); main-origin-only asserted in `canvas-origin-gate.test.ts`.
3. **Two-layer collaboration is honored (E5)** — canvas *distribution* is git-only (a canvas you didn't pull never materializes; no create/delete propagation); *live co-editing* of canvases both peers hold (edits + annotations + comments) syncs and persists via Yjs; cursors/selection/viewport stay ephemeral + gitignored. Live-syncing peer canvas **code** is gated behind the DDR-054 iframe sandbox/CSP; annotations + comments (data) may ship ahead of it.
4. **Signed, notarized installers** verified on real macOS + Windows before any public download link (E1/E7).
5. **Zero-terminal acceptance** — a fresh non-technical user can install → onboard → co-edit → publish, never opening a terminal (scripted scenario in E4/E7).

---

## Risks

- **Scope/timeline** — this is months of work across 8 phases. Mitigation: phases are independently shippable; E1+E4 alone (shell + hub-connect onboarding, reusing everything) is a coherent first public milestone.
- **Two runtimes in the bundle** — Tauri (Rust) shell + Bun (sidecar) binary. Build/CI complexity + signing both. De-risked in E0; isolate Rust to `apps/desktop/src-tauri/`.
- **Security surface** — local git creds, GitHub OAuth tokens, a new write API, a local agent bridge, and **live-synced peer canvas code rendered in your iframe**. **Reduced** by the two-layer decision: no untrusted-inbox / cold-start materialization, so the broad DDR-054 trust burden is gone. What remains scoped: live-syncing a peer's canvas TSX means rendering their code → the DDR-054 **iframe sandbox + CSP** must be in place before TSX-live-edit ships (annotations/comments are data and ship ahead of it). Each item is a documented pattern (canvas-create, loopback, OS keychain, DDR-054 iframe gate) — the risk is *forgetting* to apply them. (Pulling a malicious shared *repo* is the residual git-native risk — same trust decision as cloning any repo.)
- **The agent contradiction** — "non-technical, zero setup" users still can't drive AI solo under the chosen ACP-local model. Mitigation: state it plainly in UI + docs; treat cloud-agent as a named future phase, not a silent gap.
- **Code-signing logistics** — Apple Developer ID + notarization, Windows cert; real money + identity management, not just code. Front-load in E1.
- **isomorphic-git edge cases** (LFS, huge repos, submodules) — acceptable for small design repos; detect+prefer system git when present; document limits.

---

## Acceptance Criteria (epic)

- [ ] E0 DDRs recorded (git engine, GitHub auth, shell security, two-layer collaboration/sync, repo/branch IA) + spike proves Tauri-sidecar-renders-canvas.
- [ ] Each phase E1–E7 has its own approved `/flow:plan` before execution.
- [ ] Existing CLI / dev-server / hub paths regress zero (additive-only shell).
- [ ] Every new write-endpoint passes the per-endpoint security gate (main-origin-only + adversarial review).
- [ ] Canvas distribution is git-only (no cold-start / create-delete propagation); live edit+annotation+comment sync works for canvases both peers hold; ephemeral awareness (cursors/selection/viewport) never committed; live peer-*code* sync gated by iframe sandbox/CSP (E5).
- [ ] Signed/notarized installers verified on macOS + Windows.
- [ ] Zero-terminal scenario passes: install → onboard → co-edit → publish, no terminal.
- [ ] Roadmap regen (`pnpm --filter @maude/site gen:roadmap`) run when this plan + each phase plan lands.
- [ ] No DDR-worthy decision left unrecorded.

---

## Notes for whoever schedules a phase

- Run `Skill(flow:skill-loader)` at the start of each phase's `/flow:plan` — Tauri/Rust (E0/E1), isomorphic-git (E2), octokit/OAuth (E3), ACP (E6) are libraries with no loaded built-in skill yet.
- Read the **reuse inventory** above before scoping — the biggest failure mode is rebuilding the hub/linked-mode/Yjs backbone that already exists.
- This epic sits **outside** the current Maude v1.0 roadmap line (STATE.md is mid Phase 9.1 / 22). Confirm with the user whether this becomes the v2.0 line or runs parallel before allocating phase numbers in STATE.md.
