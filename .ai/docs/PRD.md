# Maude — Product Requirements Document

> **Status:** v0.4 shipped → roadmap to v1.0
> **Owner:** Michal Dovrtěl (`1aGh`)
> **Last updated:** 2026-05-12

> **Current collaboration scope — 2026-09-13, updated 2026-09-16:** The
> historical roadmap below predates the cloud/native product. The requirement is
> designer invite → desktop project selection → live browser/desktop/local-file
> collaboration on both self-hosted and Cloudflare hubs, with logical history,
> personal undo/redo and rendered photo/video parity. The implementation
> contract is
> [Reliable project multiplayer](../plans/archive/feature-reliable-project-multiplayer.md).
>
> **What is live.** Both named deployments run accepted revisions: every change
> is confirmed before anyone is told it is saved, history lists each action with
> its author, and Undo takes back only your own. An invited designer opens the
> project in the desktop app with an email and a password — no token, no
> terminal, no Git, no folder to choose — and that whole path is exercised
> against the live deployment on every release (`s20-deployment.e2e.ts`).
>
> **What is not.** Editing in the browser saves through the project's cloud
> workspace, so history names the workspace rather than each person and there is
> no personal undo there. Code modules travel only with a per-hub consent the
> product has no control for yet. Genuinely large media still has no path into a
> hub. The plan's own task table carries the rest, and is kept current rather
> than tidied.

## 1. Executive Summary

`maude` is a Claude Code marketplace that turns Claude Code into a **complete AI-driven product workshop**: a generic agentic workflow loop (`flow`) for building stable, well-tested apps, paired with a canvas-first design tool (`design`) that replaces rapid prototyping in Figma / Claude Design for repo-local work. The two plugins share one `maude` CLI for scaffolding and tooling. Everything is project-agnostic — installed once, drives any repo via `.ai/workflows.config.json` + `.design/config.json`.

The value proposition: instead of bouncing between Figma (designs), GitHub (issues / PRs / CI), an IDE (code), and a separate AI assistant, the user works inside Claude Code with a unified second-brain (`.ai/`), versioned design canvases (`.design/`), and a single AI agent that owns plan → design → execute → validate → ship.

**v1.0 goal:** A polished, well-documented, easily-contributable marketplace where individual indie developers and small teams can run the full plan-design-execute-ship loop with FigJam-grade canvas UX, multi-agent collaboration, and live presence — all from their own repo with no SaaS dependency.

## 2. Mission

Make Claude Code a first-class environment for **end-to-end product development** — not just a coding assistant but a fully agentic design + delivery system that lives in the repo.

**Core principles:**

1. **Repo IS the source of truth.** No external state. `.ai/` and `.design/` are git-tracked artifacts.
2. **Project-agnostic via config.** `<project>` placeholders + JSON schemas; never hardcode downstream specifics.
3. **Compose, don't re-implement.** Defer to Anthropic's `/init`, `frontend-design`, `agent-browser` rather than duplicating.
4. **Zero runtime dependencies where possible.** The dev server is pure Node; the CLI ships nothing transitive.
5. **Dogfooded.** Maude uses its own plugins to build itself.

## 3. Target Users

| Persona | Technical level | Pain point Maude solves |
| ------- | --------------- | --------------------------- |
| **Indie developer / "vibe coder"** | Mid-senior, JS/TS-heavy, ships solo or in pairs | Tired of context-switching between Figma + IDE + GitHub; wants AI to drive the whole loop from idea to PR. |
| **Small product team (2-6 people)** | Mixed (design + eng + PM) | Needs cheap, repo-local Figma alternative for early-stage exploration without paying per-seat for Figma + Slack-style review tooling. |
| **OSS plugin author** | Senior, contributes back | Wants a stable contribution path: clear docs, predictable releases (changesets), CI checks that don't gate on flaky tests. |
| **AI-curious solo founder** | Junior-mid technical | Wants an opinionated end-to-end loop where Claude makes most decisions — they steer with feedback, not by hand-coding boilerplate. |

## 4. MVP Scope

> **MVP = v1.0 release line.** v0.4 already ships the foundation; the roadmap below brings it to v1.0.

### ✅ In scope (v0.x → v1.0)

- ✅ Contribute infrastructure — `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, PR / issue templates, dependabot, branch-protection docs, basic CI quality gates beyond version parity.
- ✅ Changesets bootstrapped in **this** repo + a **reusable `integrations.changelog` abstraction** (`/flow:release-changelog` for authoring, `/flow:release` for walking a project-owned release runbook) for downstream repos to opt into Changesets, git-cliff, conventional-changelog, or roll their own.
- ✅ Docs site (Fumadocs) at `maude.sh` (subdomain of team-owned `iagh.cz`) — CLI reference, every workflow command, config schema docs with copy-paste examples. AI-readable so future agents can self-onboard.
- ✅ `flow` ↔ `design` automatic integration — flow plans auto-detect `.design/` and pull canvas references; `/flow:done` surfaces `/design:handoff` when canvases exist.
- ✅ Canvas v2 rendering engine — replace iframe-only model with a hybrid Canvas2D / WebGL layer for FigJam-grade pan / zoom / smooth scrolling at 60fps on 1k+ elements.
- ✅ FigJam-style infinite canvas — free-form screen positioning, multi-screen layouts, zoom-to-fit, mini-map.
- ✅ Comments UX — pin-comments anchored to elements with threading, resolve, @mentions; persisted in `.design/_comments/<canvas-slug>.json`.
- ✅ Multi design-system support — multiple `.design/system/<name>/` folders, each scaffolding canvases via `/design:new --ds=<name>`. Per-canvas `.meta.json.designSystem` records membership; `design-system-guard` subagent scopes per canvas. **Generation-time** concern, not a runtime canvas switcher (revised interpretation 2026-05-12).
- ✅ Presentation mode — full-screen slideshow walkthrough of selected canvases with keyboard nav.
- ✅ Exporters — PDF (multi-page), PNG (per canvas or screen), HTML (zip with inlined assets), `.canva` (best-effort archive).
- ✅ Draw / annotation tools — circle / arrow / freehand pen overlay layer per canvas, persisted as SVG sidecar.
- ✅ Live collaboration **— "Ambient multiplayer"** (local-first, v1.0 LAN scope) — Yjs + Awareness over the existing dev server. Multi-cursor + presence + selection sync + CRDT-backed comment / annotation sync; **HTML co-editing NOT in v1.0** (see v1.2 below — Phase 10). AI agent (`/design:edit`) emits "I'm editing this canvas" awareness banner during runs. Participants pair via LAN URL + shared token, or user-provided Tailscale / Cloudflare Tunnel. v1.1 (Phase 9) adds a self-hostable hub (`mdcc hub deploy`) + bidirectional file sync so peers across the internet collaborate without VPN. Architecture grounded in `.ai/docs/research-collab.md`.

### ❌ Out of scope (v1.0)

- ❌ Cloud-hosted SaaS variant of the design plugin — Maude stays repo-local; users self-host.
- ❌ Native iOS / Android / desktop apps — browser-based canvas only.
- ❌ Vector drawing (Sketch / Figma replacement) — Maude is HTML/JSX-first, not SVG vector editor.
- ❌ Built-in authentication / user accounts — collab piggybacks on git identity + LAN trust.
- ❌ Plugin marketplace for the design plugin itself (third-party canvas extensions) — explicit non-goal in v1.0.
- ❌ AI image generation directly in canvas (let users compose with `frontend-design` upstream).
- ❌ Mobile-first canvas authoring on touch devices — canvas v2 targets desktop browsers.
- ❌ Real-time co-editing of the same HTML node (structured CRDT over DOM tree) — **scheduled for v1.2 as Phase 10** (`.ai/plans/phase-10-structured-crdt-html-coediting.md`), only if v1.1 surfaces real-world incidents of garbled inspector edits. v1.1 hub mode treats HTML body as opaque `Y.Text` (no element-level merge); structured CRDT is the v1.2 upgrade. Decision trigger: ≥3 user reports of clobber after Phase 9 ships.
- ❌ Hosted SaaS hub. **v1.1 hub is always self-hosted** — `mdcc hub deploy fly|docker|systemd|tailscale|cloudflare` recipes, user owns the box. No "maude cloud" managed offering.
- ❌ ACP local chat sidebar in v1.0 — **moved to icebox 2026-05-12** (`.ai/plans/phase-7-acp-chat-sidebar.md`). Inherent local-per-peer limitation + marginal value-add in hub federation. Re-evaluate at v1.1+ if user feedback validates browser-based agent chat as a designer need.
- ❌ In-canvas CSS editor + layers panel in v1.0 — **deferred to Phase 12** (end-of-roadmap, v1.3+ conditional). Value uncertain vs. `/design:edit "<feedback>"` AI loop; gate on user-feedback survey. Plan retained at `.ai/plans/phase-12-in-canvas-css-and-layers.md`.
- ❌ Flow ↔ design integration in v1.0 core — extracted to **Phase 11** (separate work, late v1.0 or early v1.1 ship). `.ai/plans/phase-11-flow-design-integration.md`. Reasoning: most useful when canvas + DS structure is mature post Phase 4-6 and ideally Phase 8.
- ❌ Backwards-compat shim for v0.x dev-server runtime files — v1.0 may rev `_server.json` / `_active.json` schemas.

## 5. User Stories

1. **Indie dev shipping a new feature.** "As an indie dev, I want to type `/flow:plan dark-mode` and have Claude read my `.design/` canvases for current screens, propose a phase plan, and execute it — so that I never re-explain context between sessions."
2. **OSS contributor.** "As a first-time contributor, I want clear `CONTRIBUTING.md`, predictable PR templates, and a `pnpm changeset` step in CI — so that my PR doesn't bounce on style nitpicks."
3. **Designer pairing with a developer.** "As a designer reviewing a canvas, I want to drop a pin-comment on a button, @mention the dev, see them present a fix in real-time via cursors, and resolve the thread — so that we don't switch to Slack mid-review."
4. **Product owner doing stakeholder review.** "As a PO, I want presentation mode that walks stakeholders through 6 canvases full-screen — so that we don't need a separate Loom recording."
5. **Designer handing off to engineering.** "As a designer, I want `/design:handoff` to convert the active canvas into production code under `apps/web/` mapped to my project's component library — so that I don't write code translations by hand."
6. **Solo dev tweaking a component.** "As a developer reviewing a canvas, I want to Cmd+click a button, change its `border-radius` and `padding` in a side panel, and have the source HTML update — so that small tweaks don't require a full `/design:edit "feedback"` round-trip."
7. **Team adopting Maude.** "As a tech lead, I want a docs site with copy-paste config recipes for monorepos / Expo / Next.js — so that I can convince two skeptical engineers to install the marketplace without a 30-minute walkthrough."
8. **Plugin author releasing v1.1.** "As Michal, I want `scripts/bump-version.sh` + `pnpm changeset publish` to do the same thing — so that contributors don't have to learn my custom release flow."

## 6. Core Architecture & Patterns

### Top-level layout (current + target)

```
maude/
├── .claude-plugin/marketplace.json     # marketplace manifest
├── cli/                                # maude CLI (entry: bin/mdcc.mjs)
├── plugins/
│   ├── design/                         # canvas-first iteration plugin
│   │   ├── commands/                   # /design:edit, /design:new, …
│   │   ├── agents/                     # 10 critic agents
│   │   ├── skills/                     # 3 skills (design, design-system, ui-kit)
│   │   └── dev-server/                 # zero-dep Node http+ws + React client
│   │       ├── server.mjs              # current
│   │       ├── client/                 # React UI (will absorb canvas v2)
│   │       └── runtime/                # injected canvas / panel components
│   └── flow/                           # agentic workflow loop
│       ├── commands/                   # 26 commands (plan, execute, …)
│       ├── agents/                     # 4 subagents
│       ├── skills/                     # 15 skills (rules + capability bundles)
│       └── templates/ai-skeleton/      # maude init source
├── scripts/                            # bump-version, parity check, install
├── site/                               # NEW — Fumadocs docs site (v1.0)
├── .changeset/                         # NEW — changesets state (v1.0)
└── .github/                            # workflows + templates (extended in v1.0)
```

### Key patterns (preserve in v1.0)

- **Single-version multi-package release line.** `package.json` + every `plugins/*/.claude-plugin/plugin.json` move together. Enforced by `scripts/check-version-parity.sh`. Changesets layered on top must respect parity.
- **Zero runtime deps.** Dev server uses only `node:http` + `node:crypto`. Canvas v2 may add Pixi.js / Konva.js for the render layer — accept as the only runtime dep, vendor or bundle carefully.
- **`<project>` placeholder.** Every flow command reads `.ai/workflows.config.json` to resolve project specifics; never hardcode this repo's choices into `plugins/flow/`.
- **Repo-local runtime files.** `.design/_server.json`, `_active.json`, `_history/`, `_comments/` are all repo-local, gitignored except the data the user authored (canvas HTML, comment threads). Collab presence state stays ephemeral (in-memory + LAN broadcast).
- **Compose-don't-fork.** Defer to upstream Anthropic plugins (`frontend-design`, `playground`) for what they own.

### Key technology choices

> **Runtime decision:** stay on Node 20+ for v1.0; defer Bun binary distribution to v1.1. Research at `.ai/docs/research-runtime.md` (2026-05-12) — perf delta is invisible at our workload, but `bun build --compile` is the right packaging strategy once Phase 4 lands and non-engineer users start running `maude design serve`. Write Phase 4-8 code runtime-agnostically (no internal `_*` access, plain `node:http`, `crypto.createHash` only) so the future swap is mechanical, not a rewrite.

| Layer | Current | v1.0 |
| ----- | ------- | ---- |
| Dev server transport | `node:http` + raw WS | unchanged |
| Canvas rendering | iframes per artboard | **Hybrid:** iframes for true HTML preview + Canvas2D/WebGL overlay for pan/zoom/cursors |
| Canvas overlay lib | (none) | **Pixi.js** (WebGL fallback to Canvas2D, ~150KB gz, MIT) |
| Comments persistence | (none) | **Yjs Y.Array** (v1.0); JSON sidecar snapshotted at quiescence for git diff visibility |
| Collab presence + sync (v1.0) | (none) | **Yjs + y-protocols over existing dev-server WS** (LAN-only, 32KB gz, pure JS — no SaaS) |
| Collab hub (v1.1, Phase 9) | (none) | **Hocuspocus** (`@hocuspocus/server`, MIT, Node-native; SQLite extension) — self-hosted. NOT PartyKit (research-collab.md rejects: `partyserver` is CF Workers-only). Wrapped behind `mdcc hub serve|deploy`. |
| Cross-machine file sync (v1.1) | (none) | **Bidirectional fs watcher + Yjs client** in dev server. Echo prevention via SHA-256 origin tags + 1500ms windows. HTML body is opaque `Y.Text` in v1.1 (defer structured to v1.2). |
| Hub deploy targets (v1.1) | n/a | `fly` (primary, ~$0.45-5/mo), `docker-compose` (Caddy + auto-TLS), `systemd` (raw VPS), `tailscale-funnel`, `cloudflare-tunnel` (home server / no public IP) |
| HTML co-editing (structured CRDT) | (none) | **NOT in v1.0 or v1.1.** Phase 10 (v1.2) — `data-cd-id` + `Y.XmlFragment` after fidelity spike, only if v1.1 incidents prove it's needed |
| ACP transport | (none) | **[ICEBOX]** Phase 7 deferred; re-evaluate v1.1+ |
| In-canvas CSS editor + layers | (none) | **NOT in v1.0.** Phase 12 (v1.3+, conditional on user feedback survey) |
| Flow ↔ design integration | (none) | **Phase 11** — late v1.0 or v1.1; standalone work after canvas + DS mature |
| Docs site | README only | **Fumadocs** (Next.js-based, AI-readable MDX) |
| Release tooling | bash scripts | **Changesets** (+ retained parity script as guard rail) |
| CI checks | parity + publish | + lint (biome), + test (node:test), + a11y smoke, + link check |

## 7. Implementation Phases

```
                ┌─ Phase 1: Contribute infra + Changesets bootstrap (+monorepo)
                │  (foundation; blocks everything)
                │
                ├─ Phase 2: Docs site (Fumadocs)
                │  (parallel with Phase 3 after Phase 1)
                │
                ├─ Phase 3: integrations.changelog + /flow:release-changelog + /flow:release
                │  (parallel with Phase 2)
                │
                └─ Phase 4: Canvas v2 rendering engine + infinite canvas
                          │
                          ├─ Phase 5: Multi-DS + draw tools (layers + CSS moved to Phase 12)
                          │  (parallel with Phase 6)
                          │
                          ├─ Phase 6: Comments + presentation + export
                          │  (parallel with Phase 5)
                          │
                          └─ Phase 8: Live collaboration LAN ("ambient multiplayer")
                             (depends on Phase 4 + Phase 6 comments)

Phase 7: ACP chat sidebar — [ICEBOX] deferred to v1.1+
Phase 11: Flow ↔ Design integration — late v1.0 / early v1.1 (extracted from Phase 3)
Phase 9 (v1.1): Self-hosted hub + bidirectional file sync (Hocuspocus)
Phase 10 (v1.2 conditional): Structured CRDT HTML co-editing
Phase 12 (v1.3+ conditional): In-canvas CSS editor + layers panel (extracted from Phase 5)
```

| Phase | Deliverable | Depends on | Parallel with | MVP? |
| ----- | ----------- | ---------- | ------------- | ---- |
| 1 | Contribute infra + Changesets + monorepo (incl. hub workspace reservation) | — | — | ✅ |
| 2 | Docs site (Fumadocs) | 1 | 3 | ✅ |
| 3 | `integrations.changelog` + `/flow:release-changelog` + `/flow:release` | 1 | 2 | ✅ |
| 4 | Canvas v2 rendering engine + infinite canvas | 1 | — | ✅ |
| 5 | Multi-DS (gen-time, as attachment) + draw tools | 4 | 6 | ✅ |
| 6 | Comments + presentation + export | 4 | 5 | ✅ |
| 7 | ACP local chat sidebar | 4 | — | ❄️ ICEBOX |
| 8 | Live collaboration LAN (Yjs + Awareness) | 4, 6 | — | ✅ |
| 11 | Flow ↔ Design integration | 4, 5, 6 | — | ✅ late v1.0 / early v1.1 |
| 9 | Self-hosted hub + file sync (Hocuspocus) | 8, 1 | — | 🔵 v1.1 |
| 10 | Structured CRDT HTML co-editing | 4, 5, 6, 8, 9 | — | 🟣 v1.2 conditional |
| 12 | In-canvas CSS editor + layers panel | 4, 5 | — | ⚪ v1.3+ conditional |

## 8. Non-Functional Requirements

- **Performance.** Canvas v2 must hold 60fps pan / zoom on ≤ 50 artboards / 1k DOM nodes total on a M-class laptop. Collab WS messages target < 100ms local round-trip (LAN) or < 500ms via hub on commodity internet.
- **Accessibility.** Docs site WCAG 2.1 AA. Canvas chrome (toolbar, layers panel, comment threads) keyboard-navigable. Iframe content is user-authored — out of scope to enforce.
- **Security.** Dev server already LAN-only (binds `127.0.0.1`). Collab gateway must stay LAN-only unless user opts in via `MDCLAUDE_LAN=1` env + `--collab-token` (Phase 8) or self-hosts a hub with TLS + token auth (Phase 9). Never expose to public internet by default. v1.1 hub mandates token verification + rate limiting.
- **Testing.** Adopt `node:test` for CLI + server unit tests. Smoke test fleet: `agent-browser` against the dev server for canvas v2 regression. Visual regression via `playwright` (dev-only — not a runtime dep).
- **CI/CD.** Extend `.github/workflows/`: add `lint.yml`, `test.yml`, `changesets.yml` (auto-PR for version bumps). Keep version-parity check as a guard rail.
- **Backwards compat.** v0.x → v1.0 is a major rev. Document migration in `docs/MIGRATING-v0-to-v1.md`. Provide a `mdcc migrate` codemod if file formats change.

## 9. Success Criteria

1. **v1.0 release ships** with Phases 1-6 + 8 (+ optionally Phase 11) merged, single tag `v1.0.0`, npm + plugin marketplace updated in lockstep. Phase 7 (ACP) icebox. Phase 11 (flow⇄design) may slip to v1.0.x patch if not ready in time.
2. **Docs site live** at a public URL with ≥ 90% of commands / configs documented, including copy-paste recipes for Next.js / Expo / monorepo.
3. **First external contributor PR merged** following the new `CONTRIBUTING.md` + changesets flow.
4. **Canvas v2 perf benchmark**: 50 artboards / 1k nodes hold 60fps pan + zoom on a 2-year-old MacBook Air.
5. **Live collab demo**: two participants on the same LAN both see cursors + selections + can drop synced pin-comments within 5s of session join.
6. **Self-dogfood**: this repo's own design canvases (added during phases 4-6) drive the docs site UI work via `/flow:plan` → `/flow:execute` → `/flow:done`.
7. **Zero critical regressions** in v0.x → v1.0 migration (existing `.design/` projects keep working with `mdcc migrate`).

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| Canvas v2 perf budget missed on Pixi.js | High — UX regresses vs. iframe-only | Prototype perf early (Phase 4 Task 1). Fall back to plain Canvas2D + virtualized scroll if WebGL doesn't pan out. |
| Changesets workflow conflicts with version-parity script | Medium — release infra confusion | Wrap changesets: custom `pnpm version-packages` runs `bump-version.sh` after changesets writes versions, so parity stays enforced. |
| PartyKit-style collab requires a hosted relay for cross-NAT users | Medium — "local-first" promise weakened | Phase 8 ships LAN-only first. Cross-NAT becomes a documented opt-in via user-provided tunnel (Tailscale / Cloudflare Tunnel). |
| ACP spec evolves and breaks integration | Low-medium | Pin to a tagged ACP version; bump deliberately in a changesets release. |
| Fumadocs Next.js dep bloats install | Medium | Keep `site/` as a separate workspace with its own deps; `pnpm i` at repo root never installs it unless `--filter=site`. |
| Comments / collab encourage opening the dev server beyond LAN | High — security | Document network model loudly. Server refuses non-loopback bind unless `MDCLAUDE_INSECURE_BIND=1` is set. |
| Too many phases in flight in parallel | Medium — half-merged features | Use changesets pre-releases for v1.0-rc; each phase lands in a `next` branch first, only `main` after passing /validate. |
| Multi-DS support breaks `design-system-guard` subagent assumptions | Medium | Phase 5 must update the subagent in lockstep — covered in tasks. |

## Optional sections

### Configuration evolution

- `.ai/workflows.config.json` — extend with `integrations.changelog` (provider + scope + releaseGuide), `integrations.docsSite`.
- `.design/config.json` — extend with `designSystems[]` (array, not just root path), `collab.enabled`, `comments.enabled`, `acp.enabled`, `exporters.formats[]`.

### Release process (v1.0 onwards)

1. PR with `pnpm changeset add <type>` containing user-facing notes.
2. `changesets.yml` opens an auto-PR bumping versions + collecting CHANGELOG entries.
3. Merging the auto-PR triggers `publish.yml`: parity check → `pnpm changeset publish` → npm + tag + GitHub Release.
4. Plugin marketplace consumers run `/plugin marketplace update maude` to pick up the new tag.

### Out-of-scope ideas for future consideration (Phase 9+)

The user asked for additional improvements beyond their list. Captured here as "icebox" — not in v1.0, but worth tracking:

0. **Bun standalone binary distribution (v1.1 — first off the icebox).** `bun build --compile` produces a ~60MB single-file binary per platform; ship via GitHub Releases + thin npm wrapper using the `optionalDependencies` pattern (proven by esbuild). Removes the "Node 20+ required" friction for designer / PM personas who installed `maude design serve` to run a stakeholder review. Prerequisites: macOS notarization ($99/yr Apple Developer ID), Windows code-signing optional, 4-platform CI matrix. Decision checklist + benchmark plan in `.ai/docs/research-runtime.md` §7 + §9.

1. **`mdcc plugin new <name>`** — scaffold a third-party plugin against the marketplace template.
2. **Storybook export** — generate `*.stories.tsx` from canvases for component libraries.
3. **Design tokens bidirectional sync** — read tokens from `style-dictionary` / `tokens.studio` JSON; write back when in-canvas edits change a token.
4. **AI-assisted commit-message generator** integrated into `/flow:done` (compose-style: feeds diff + DDR refs to a tiny model).
5. **Slack / Discord / Linear notifications** from `/flow:done` (opt-in, configured via `integrations.notify`).
6. **Marketplace catalog site** — discoverable index of community-contributed plugins beyond what fits in the JSON manifest.
7. **VS Code / JetBrains companion extension** — surface canvases inline in the editor, not just in the browser.
8. **Voice / push-to-talk in ACP sidebar** — speak feedback, transcribed and sent to the agent.
9. **Snapshot-based visual regression bot** that opens a PR comment with before / after canvas screenshots when `.design/` files change.
10. **Component → canvas reverse generator** — point at `src/components/Button.tsx` and produce a canvas demonstrating its variants.
11. **Privacy-respecting telemetry** (DNT honored, no PII, opt-in) for understanding which commands actually get used.
12. **Theme switcher in canvas chrome** — preview light / dark / high-contrast variants side-by-side.
13. **Performance budget enforcement** at canvas level (FPS / paint time) and code level (bundle size deltas) surfaced in `/flow:utils-verify`.
14. **Localization of canvas content** — i18n keys baked into HTML, switcher in chrome.
15. **Conflict-resolution UI** for when two agents edit the same canvas simultaneously (until full CRDT lands).
16. **AR / spatial canvas mode** — pinch / zoom on iPad with Apple Pencil for whiteboard-style ideation.
17. **AI design suggestions in canvas** — small button "improve this layout" that pipes the selected element back through the design-critic panel and proposes a diff.
18. **Cross-repo design system reuse** — symlink / git-subtree another repo's `.design/system/` into the current project.
19. **Replay mode** — scrub backwards through `_history/` snapshots like a Git time-lapse to see how a canvas evolved.
20. **Stress-test scenario for collab** — `mdcc collab fuzz` spawns N simulated cursors to verify perf and conflict handling.
