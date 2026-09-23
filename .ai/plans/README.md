# Plans

Feature implementation plans. One file per feature. The current open set is
listed below; the long v1.0 execution roadmap later in this file is retained as
historical context and is not an active task list.

## Current open plans — audited 2026-09-22

| Plan | Real status |
| ---- | ----------- |
| [`cloud-live-payments-rollout.md`](./cloud-live-payments-rollout.md) | Open; L1–L8 remain gated on legal/accounting, Stripe live-mode setup, and live proofs. |
| [`feature-desktop-project-tabs-and-identity-profiles.md`](./feature-desktop-project-tabs-and-identity-profiles.md) | Planned; implementation not started. |
| [`feature-harness-environment-projection.md`](./feature-harness-environment-projection.md) | Partial; T0–T9 released, T10–T13 cutover/soak/retirement remain. |
| [`feature-local-media-generation.md`](./feature-local-media-generation.md) | Planned; native keychain, local adapters, and desktop E2E not started. |
| [`feature-post-1.0-hardening-backlog.md`](./feature-post-1.0-hardening-backlog.md) | Open backlog; resolved entries stay as evidence, remaining program is not empty. |
| [`feature-video-tracking-and-stabilization.md`](./feature-video-tracking-and-stabilization.md) | Planned; even the `s3Assets` JSON-sidecar prerequisite remains open. |
| [`followup-reliable-project-multiplayer.md`](./followup-reliable-project-multiplayer.md) | Partial; F2 real R2 proof and F5–F7 complete. F1 full native matrix, F3 full backend scenarios and F4 latency remain open. |

Rejected or completed plans live under [`archive/`](./archive/), including the
unimplemented, stale `/goal` integration proposal rejected on 2026-09-22.

## Reliable project multiplayer — planned 2026-09-13

[`archive/feature-reliable-project-multiplayer.md`](./archive/feature-reliable-project-multiplayer.md) (closed 2026-09-16, shipped in v1.4.2; T1 certified with one reservation) turned the [hub/desktop audit](../../docs/audits/2026-09-13-hub-sync/README.md) into 35 ordered tasks across seven milestones: loss containment → accepted transactions/durability → all writers/offline → media/project entry → logical history/undo → migration evidence → both-backend rollout and retirement. Full designer workflow on Cloudflare and self-hosted hubs is the completion boundary; the initial pilot is not the whole feature.

Scenario: [`reliable-project-multiplayer/spec.md`](../scenarios/reliable-project-multiplayer/spec.md). **T1 first captures the unchanged working product through the mandatory [local surface E2E matrix](../scenarios/reliable-project-multiplayer/local-e2e.md)**: 24 surface groups, explicit CRUD/gesture variants, both peer UIs, decoded photo/video checks and baseline latency comparison. All milestones protect existing working flows from regression. What it deferred lives in [`followup-reliable-project-multiplayer.md`](./followup-reliable-project-multiplayer.md) (F1–F7).

## Lifecycle (per-plan convention)

1. `/flow:plan <feature>` — drafts the plan with task list, file-touch map, scenarios.
2. `/flow:execute` — works through tasks, ticking `[x]`.
3. `/flow:done` — finalizes, runs validation, moves the file to `archive/`.

**Conventions:** front-matter `name | status | created | decisions`; task IDs `T1..Tn` so `/flow:resume` can re-enter mid-flow; archive on `/flow:done`, not on last task tick.

---

# Maude v1.0 → v1.2+ — Execution roadmap

> 8 active v1.0 phases + 1 icebox + 1 late-v1.0 + 3 post-v1.0 plans, all implementing [`../docs/PRD.md`](../docs/PRD.md). Config reference at [`../docs/config-schema.md`](../docs/config-schema.md). Architecture research at [`../docs/research-runtime.md`](../docs/research-runtime.md) + [`../docs/research-collab.md`](../docs/research-collab.md).

## Dependency graph (v1.0 ship line)

```
                  ┌──────────────────────────────────┐
                  │ Phase 1: Contribute infra        │
                  │ + Changesets + monorepo          │
                  │ (incl. hub/ workspace reservation)│
                  │ (foundation — blocks everything) │
                  └────────────────┬─────────────────┘
                                   │
                ┌──────────────────┼──────────────────┐
                │                  │                  │
                ▼                  ▼                  ▼
        ┌───────────────┐  ┌───────────────┐  ┌──────────────────┐
        │ Phase 2:      │  │ Phase 3:      │  │ Phase 4:         │
        │ Docs site     │  │ release-       │ │ Canvas v2 engine │
        │ (Fumadocs)    │  │ changelog/cut  │ │ + infinite canvas│
        └───────────────┘  └───────────────┘  └────────┬─────────┘
                                                       │
                          ┌────────────────────────────┴───────────────┐
                          │                                            │
                          ▼                                            ▼
                  ┌────────────────┐                       ┌──────────────────┐
                  │ Phase 5:       │                       │ Phase 6:         │
                  │ Multi-DS       │                       │ Comments +       │
                  │ (gen-time) +   │   parallel            │ presentation    │
                  │ draw tools     │                       │                  │
                  └────────────────┘                       └──────────────────┘

                                                           ┌──────────────────┐
                                                           │ Phase 6.5:       │
                                                           │ Export (PNG/PDF/ │
                                                           │ SVG/HTML/Canva/  │
                                                           │ ZIP) — UI-first  │
                                                           │ parallel with 5+6│
                                                           └────────┬─────────┘
                                                                    │
                                                                    ▼
                                                        ┌──────────────────────────┐
                                                        │ Phase 8: Live collab     │
                                                        │ LAN ("ambient multi-     │
                                                        │ player") — Yjs + Aware   │
                                                        │ Depends on 4 + 6         │
                                                        └────────────┬─────────────┘
                                                                     │
                                                                     ▼ (late v1.0 or v1.1)
                                                        ┌──────────────────────────┐
                                                        │ Phase 11: Flow ↔ Design  │
                                                        │ integration (extracted   │
                                                        │ from old Phase 3)        │
                                                        └──────────────────────────┘

Phase 7 (ACP chat sidebar): ❄️ ICEBOX — deferred to v1.1+ if user feedback validates
```

## Roadmap beyond v1.0

```
v1.1 (post-v1.0, ~6-8 weeks)
└─ Phase 9: Self-hostable hub + bidirectional file sync (Hocuspocus)
   Depends on Phase 8 (Yjs runtime) + Phase 1 (hub workspace pre-reserved)

v1.2 (conditional, only if v1.1 incidents prove need)
└─ Phase 10: Structured CRDT HTML co-editing (data-cd-id + Y.XmlFragment)
   Depends on Phases 4, 5, 6, 8, 9

v1.3+ (conditional on user-feedback survey)
└─ Phase 12: In-canvas CSS editor + Layers panel (Webflow-style direct manipulation)
   Depends on Phases 4, 5 (and ideally 10 for multi-peer ops)
```

## Execution order

| Step | Phase | File | Can parallelize? | Ship | Command |
| ---- | ----- | ---- | ---------------- | ---- | ------- |
| 1 | Contribute infra + Changesets + monorepo | `phase-1-contribute-infra-changesets.md` | — | v1.0 | `/flow:execute .ai/plans/phase-1-contribute-infra-changesets.md` |
| 2 | Docs site (Fumadocs) | `phase-2-docs-site-fumadocs.md` | with Phase 3 | v1.0 | `/flow:execute .ai/plans/phase-2-docs-site-fumadocs.md` |
| 3 | `integrations.changelog` + `/flow:release-changelog` + `/flow:release` | `phase-3-flow-changelog.md` | with Phase 2 | v1.0 | `/flow:execute .ai/plans/phase-3-flow-changelog.md` |
| 13 | Flow command categorization (naming + index, no subfolders) | `phase-13-flow-command-categorization.md` | with Phase 2 | v1.0 | `/flow:execute .ai/plans/phase-13-flow-command-categorization.md` |
| 4 | Canvas v2 rendering engine | `phase-4-canvas-v2-rendering-engine.md` | — | v1.0 | `/flow:execute .ai/plans/phase-4-canvas-v2-rendering-engine.md` |
| 5 | Multi-DS + draw tools | `phase-5-multi-ds-and-draw-tools.md` | with Phase 6 | v1.0 | `/flow:execute .ai/plans/phase-5-multi-ds-and-draw-tools.md` |
| 6 | Comments + presentation | `phase-6-comments-presentation-export.md` | with Phase 5 + 6.5 | v1.0 | `/flow:execute .ai/plans/phase-6-comments-presentation-export.md` |
| 6.5 | Canvas export (PNG/PDF/SVG/HTML/PPTX/Canva-editable/ZIP) — UI-first | `phase-6.5-export.md` | with Phase 5 + 6 | v1.0 | `/flow:execute .ai/plans/phase-6.5-export.md` |
| 7 | ACP chat sidebar | `phase-7-acp-chat-sidebar.md` | ❄️ skipped | ICEBOX | (not in v1.0) |
| 8 | Live collaboration LAN | `phase-8-live-collaboration-yjs-lan.md` | — | v1.0 | `/flow:execute .ai/plans/phase-8-live-collaboration-yjs-lan.md` |
| 11 | Flow ↔ Design integration | `phase-11-flow-design-integration.md` | — | v1.0 late / v1.1 | `/flow:execute .ai/plans/phase-11-flow-design-integration.md` |
| 9 | Self-hosted hub + file sync (Hocuspocus) | `phase-9-self-hosted-hub-file-sync.md` | post-v1.0 | v1.1 | `/flow:execute .ai/plans/phase-9-self-hosted-hub-file-sync.md` |
| 10 | Structured CRDT HTML co-editing | `phase-10-structured-crdt-html-coediting.md` | post-v1.1, conditional | v1.2 conditional | `/flow:execute .ai/plans/phase-10-structured-crdt-html-coediting.md` |
| 12 | In-canvas CSS editor + Layers | `phase-12-in-canvas-css-and-layers.md` | post-v1.2, conditional | v1.3+ conditional | `/flow:execute .ai/plans/phase-12-in-canvas-css-and-layers.md` |

## Copy-paste execution blocks (v1.0)

### Phase 1 — Contribute infra + Changesets + monorepo

```
/flow:execute .ai/plans/phase-1-contribute-infra-changesets.md
```

> **What to build:** `CONTRIBUTING.md` / COC / `SECURITY.md`, PR + issue templates, Dependabot, bootstrap Changesets in this repo via a wrapper script that preserves `scripts/check-version-parity.sh`, add `.github/workflows/quality.yml` (Biome + `node:test` + link-check), document recommended branch protection. Adopt `pnpm changeset add` as the contributor release flow; keep `scripts/bump-version.sh` as emergency manual fallback. **Plus: monorepo bootstrap** with `pnpm-workspace.yaml` listing `[site, plugins/design/dev-server, plugins/design/hub]` — `hub/` is Phase 9 territory but reserved here. GitHub repo setup via `gh` CLI (`scripts/setup-github.sh`).

### Phase 2 — Docs site (Fumadocs)

```
/flow:execute .ai/plans/phase-2-docs-site-fumadocs.md
```

> **What to build:** `site/` Next.js workspace (excluded from default `pnpm install` via `--filter`). Author core MDX pages (getting-started, cli, flow, design, config, recipes/{nextjs,expo,monorepo}). Auto-generate command + schema reference from `plugins/*/commands/*.md` frontmatter and `config.schema.json`. Enable Fumadocs search; add `llms.txt`. Deploy via Vercel (DDR for hosting choice). Link from README; de-duplicate.

### Phase 3 — `integrations.changelog` + `/flow:release-changelog` + `/flow:release`

```
/flow:execute .ai/plans/phase-3-flow-changelog.md
```

> **What to build:** Generic `integrations.changelog` block in `config.schema.json` (provider enum: `changesets` | `git-cliff` | `conventional` | `custom` | `none`; sibling of `tracker` / `analytics` / `ci` / `design`). New `/flow:release-changelog` command authors entries (Changesets provider implemented; others stub with TODO). New `/flow:release` walks a project-owned `.ai/release-guide.md` runbook step-by-step with `[run]/[skip]/[edit]/[abort]` confirmations. `/flow:init` auto-detects provider from filesystem markers, asks Q7, scaffolds provider-appropriate runbook stub. `/flow:validate` + `/flow:done` add non-blocking changelog-hygiene warnings. `/flow:execute` + `/flow:quick` de-hardcoded. Commands ship under `release-*` group per Phase 13 naming convention. Flow⇄design seam **moved to Phase 11**.

### Phase 4 — Canvas v2 rendering engine

```
/flow:execute .ai/plans/phase-4-canvas-v2-rendering-engine.md
```

> **What to build:** Replace iframe-only canvas with hybrid Pixi.js (WebGL) viewport over positioned iframes. Pan / zoom / pinch / spacebar-drag. Mini-map, zoom controls, fit-to-screen. Per-canvas `.layout.json` for spatial state. Migrate v0.x canvases on first load. Introduce esbuild bundler; pre-build client dist for shipping. Perf gate: 50 artboards × 30 nodes ≥ 55fps on M1 Air. **Big DDR: Pixi vs fallback** based on perf prototype in Task 1.

### Phase 5 — Multi-DS + draw tools

```
/flow:execute .ai/plans/phase-5-multi-ds-and-draw-tools.md
```

> **What to build:** Multi design-system **as attachment** (revised interpretation 2026-05-12): multiple `.design/system/<name>/` folders, each scaffolds canvases via `/design:new --ds=<name>`. Per-canvas `.meta.json.designSystem` records membership; `design-system-guard` subagent scopes per canvas. **Not** a runtime canvas switcher. Plus: draw / annotation tools (pen / circle / arrow as SVG sidecar). Layers panel + in-canvas CSS editor explicitly NOT in this phase — moved to Phase 12.

### Phase 6 — Comments + presentation

```
/flow:execute .ai/plans/phase-6-comments-presentation-export.md
```

> **What to build:** Pin-comments anchored to element or world coords, threading + resolve + @mention (git committer autocomplete), persisted to `.design/_comments/<slug>.json`. Presentation mode (full-screen, arrow keys, Esc). **Export was extracted to Phase 6.5** (2026-05-19) — too big to share a plan after scope ladder + SVG + raw-source ZIP were added.

### Phase 6.5 — Canvas export (UI-first, multi-format, scope-aware)

```
/flow:execute .ai/plans/phase-6.5-export.md
```

> **What to build:** First-class export feature with toolbar button + `⌘E` dialog + context-menu entries. **7 formats** (PNG, PDF, SVG, HTML standalone zip, **PPTX**, **Canva handoff bundle**, project-raw ZIP) × 4 scopes (selection, artboard, canvas-as-separate, project-raw). `POST /api/export` is the single engine; `maude design export` CLI + `/design:export` slash are thin clients. SVG via `<foreignObject>` (DDR with Safari + Illustrator caveats). **PPTX** via `pptxgenjs` driven from a normalized canvas model (not DOM walker), producing native editable shapes/text frames. **Canva handoff** = PPTX payload + sibling `.canva-handoff.md` artifact (drag-drop steps for humans + MCP-ready prompt block for users with a Canva MCP server connected). No OAuth, no Enterprise tier dependency — Maude emits the artifact, the user's MCP handles auth. Project-raw ZIP streams `<designRoot>/` minus runtime files. Recent-exports list + `⌘⇧E` re-runs the latest. Export entry point gets duplicated into the [Phase 12 Inspector Panel](./phase-12-in-canvas-css-and-layers.md) toolbar (same dialog, no new endpoint). Bundle delta ≤ 650KB.

### Phase 7 — ACP chat sidebar [❄️ ICEBOX — skip for v1.0]

> **Deferred 2026-05-12.** ACP is inherently local-per-peer (hub doesn't proxy cross-peer). Marginal value-add in hub federation; saves ~2 weeks of v1.0 scope. Plan retained at `phase-7-acp-chat-sidebar.md` with icebox header. Re-evaluate at v1.1+ if user feedback validates browser-based agent chat as designer need.

### Phase 8 — Live collaboration LAN ("ambient multiplayer")

```
/flow:execute .ai/plans/phase-8-live-collaboration-yjs-lan.md
```

> **What to build:** Yjs + Awareness over existing dev-server WS. Cursors / selections / viewport sync (ephemeral). Y.Doc-backed comment threads + annotations (persisted to JSON snapshots at quiescence). "Claude is editing" awareness banner during `/design` runs. NO HTML co-editing (deferred to Phase 10). `--bind 0.0.0.0` opt-in via `MDCLAUDE_LAN=1` + `--collab-token`. Cross-NAT recipes documented (Tailscale, Cloudflare Tunnel). v1.0 release blocker: this is the last v1.0 phase before final `/flow:validate` + tag.

### Phase 11 — Flow ↔ Design integration (late v1.0 / early v1.1)

```
/flow:execute .ai/plans/phase-11-flow-design-integration.md
```

> **What to build:** Close the seam between flow + design plugins. `/flow:plan <feature>` auto-detects matching canvases in `.design/` (slug + `.meta.json.tags` heuristic), surfaces them as plan context. `/flow:done` inventories canvases with `status: ready-for-handoff` and offers `/design:handoff` sweep. `codebase-intelligence` skill includes Design artifacts in `.ai/context/codebase-map.md`. `ddr-keeper` prompts for `relatedCanvas` on UI-themed DDRs. DDR for soft vs. hard handoff prompt.

## Copy-paste execution blocks (post-v1.0)

### Phase 9 — Self-hostable hub + bidirectional file sync (v1.1)

```
/flow:execute .ai/plans/phase-9-self-hosted-hub-file-sync.md
```

> **What to build:** `maude hub serve|deploy|token|status` + `maude design link|unlink|status|adopt`. Hocuspocus-based hub (`@hocuspocus/server` + `@hocuspocus/extension-sqlite`) bundled as `dist/hub.bundle.mjs`. Deploy recipes: Fly (primary), Docker Compose + Caddy, systemd, Tailscale Funnel, Cloudflare Tunnel. Bidirectional fs watcher with echo prevention (SHA-256 origin tags + 1500ms windows). Per-peer local `.design/` is mirror of hub canonical Yjs state. v1.1 treats HTML body as opaque `Y.Text` (structured CRDT deferred to Phase 10). `collab.commitStrategy: full | hub-only | manual` gitignore mode. Token UX: `generate / rotate / list / revoke` with HMAC storage on hub side. Phase 8 → Phase 9 migration documented.

### Phase 10 — Structured CRDT HTML co-editing (v1.2 conditional)

```
/flow:execute .ai/plans/phase-10-structured-crdt-html-coediting.md
```

> **What to build (only if v1.1 incidents prove need):** Stable element identity via `data-cd-id` injection. HTML ↔ Y.XmlFragment round-trip codec. Tree-edit-distance diff engine for `/design` Write-tool output. Inspector + layers panel rebind to Y.XmlElement ops (cross-peer concurrent edits). Stash-on-branch-switch reconciliation. Task 0 fidelity spike is go/no-go gate.

### Phase 12 — In-canvas CSS editor + Layers panel (v1.3+ conditional)

```
/flow:execute .ai/plans/phase-12-in-canvas-css-and-layers.md
```

> **What to build (only if user-feedback survey validates):** Layers panel (DOM tree, drag-to-reorder). Inspector panel for top-10 CSS properties → rewrite source HTML. Source-rewrite strategy DDR (inline / class / smart). Keyboard shortcuts `L / I`. Gates on Task 0 survey ≥30% "I want this frequently."

## Validation commands

After every phase: `/flow:utils-verify` for touched files; before merge: `/flow:validate` for the full gate (lint + tests + build + scenarios + a11y + DS).

Before tagging `v1.0.0`:

```
/flow:validate                                # full gate
scripts/check-version-parity.sh               # belt-and-suspenders
pnpm changeset status                         # confirm no pending changesets unpublished
node --test cli/**/*.test.mjs                 # explicit
```

Plus schema validation (after Phase 1):

```
npx ajv-cli validate -s plugins/flow/.claude-plugin/config.schema.json -d .ai/workflows.config.json
npx ajv-cli validate -s plugins/design/dev-server/config.schema.json -d .design/config.json
```

## Final release (v1.0)

```
pnpm changeset version       # bumps via the new wrapper (Phase 1 Task 5)
pnpm changeset publish       # publishes + tags v1.0.0
git push --follow-tags       # triggers .github/workflows/publish.yml
```

Then in Claude Code (against every consumer repo):

```
/plugin marketplace update maude
/plugin install design@maude
/plugin install flow@maude
```

## Tracking

Workflow state for this roadmap lives at `../state/STATE.md`. Each phase opens a feature branch, lands a changeset, and gets merged behind a `next` branch. Final v1.0 squash to `main` only after Phase 8 ships (+ optionally Phase 11) and `/flow:validate` is clean across all phases. Phase 9 starts its own development line post-tag.

---

# Sync completion fixes 4–8 — execution guide (2026-08-10)

> Implements [`feature-sync-completion-fixes-4-8.md`](./archive/feature-sync-completion-fixes-4-8.md) (PRD) — the remaining five fixes from the desktop↔cloud sync RCA. Separate mini-roadmap from the v1.0 phases above; phase files use the `phase-sync-*` prefix to avoid colliding with the archived `phase-1..13` numbering.

## Dependency graph

```
 sync-1 CloudBar "Connected"     sync-2 pathIndex stamp race     sync-4 asset transport      sync-5 commit posture
 (client, trivial)               (sync + hub — MVP core)         (DDR 6a → impl 6)           (DDR 8a → impl 8)
        │                               │                              │                          │
        │                               ▼                              │                          │
        │                        sync-3 flat-fallback                  │                          │
        │                        migration (needs the                  │                          │
        │                        recurrence closed first)              │                          │
        └───────────────────────────────┴──────────────────────────────┴──────────────────────────┘
                                                       │
                                                       ▼
                                     sync-5 Task 3: single release-minified
                                     client-bundle rebuild (covers sync-1 + sync-5)
                                                       │
                                                       ▼
                                     End-to-end sync verification (PRD §9)
                                     against a live cloud-linked project
```

Only hard edge: **sync-2 → sync-3**. Everything else can parallelize; recommended serial order (cheap→expensive, per the RCA plan): 1 → 2 → 3 → 4 → 5.

## Execution order

| Step | Phase | Fix | File | Can parallelize? | Command |
| ---- | ----- | --- | ---- | ---------------- | ------- |
| 1 | CloudBar "Connected" label | 7 | `archive/phase-sync-1-cloudbar-connected.md` | with any | `/flow:execute .ai/plans/archive/phase-sync-1-cloudbar-connected.md` |
| 2 | pathIndex stamp race (MVP core) | 5 | `archive/phase-sync-2-pathindex-stamp-race.md` | with 1, 4 | `/flow:execute .ai/plans/archive/phase-sync-2-pathindex-stamp-race.md` |
| 3 | Flat-fallback migration | 4 | `archive/phase-sync-3-flat-fallback-migration.md` | after 2; with 4, 5 | `/flow:execute .ai/plans/archive/phase-sync-3-flat-fallback-migration.md` |
| 4 | Cloud asset transport (DDR-gated) | 6a+6 | `archive/phase-sync-4-cloud-asset-transport.md` | with 1–3, 5 | `/flow:execute .ai/plans/archive/phase-sync-4-cloud-asset-transport.md` |
| 5 | Cloud commit posture (DDR-gated, bundle close-out) | 8a+8 | `archive/phase-sync-5-cloud-commit-posture.md` | last | `/flow:execute .ai/plans/archive/phase-sync-5-cloud-commit-posture.md` |

## Copy-paste execution blocks

### Phase sync-1 — CloudBar "Connected"

```
/flow:execute .ai/plans/archive/phase-sync-1-cloudbar-connected.md
```

> **What to build:** In `CloudBar.jsx` project rows (~L786-817), match `p.url` against `local.linkedHub?.url` via `projectFromHubUrl`/`hostOf` (reuse the L234-237 reassurance logic). Linked+credentialed → non-action "Connected" (check icon, muted) + Disconnect; linked-uncredentialed or unrelated → keep Connect. Test in `cloud-endpoints.test.ts`.

### Phase sync-2 — pathIndex stamp race

```
/flow:execute .ai/plans/archive/phase-sync-2-pathindex-stamp-race.md
```

> **What to build:** (1) `sync/index.ts`: stamp `stampCanvasPath` BEFORE the first body apply (in `connectCanvas` setup), not only post-reconcile (~L884). (2) `workspace-agent.mjs`: `pathIndex` stores `{rel, fromPath}`; a validated `syncMeta.path` supersedes a memoised fallback via containment-checked in-tree relocation (never relocate a checkout-decided path). Regression test: body-before-stamp → nested path, no flat stub, no second document (DDR-064 A4). New hub-write surface → DDR-054 adversarial review.

### Phase sync-3 — flat-fallback migration

```
/flow:execute .ai/plans/archive/phase-sync-3-flat-fallback-migration.md
```

> **What to build:** `sync/migrate-flat-fallback.ts` mirroring `migrate-seed.ts` (idempotent, best-effort, never throws into boot): design-root `<slug>.tsx` colliding (via `canvasSlugFromRel`) with a grouped twin → move + siblings to `_trash/<slug>-flat-<ts>/`; lone flat file untouched. Wire into sync boot before first reconcile. Tests: collision trashed / lone kept / second run no-op.

### Phase sync-4 — cloud asset transport

```
/flow:execute .ai/plans/archive/phase-sync-4-cloud-asset-transport.md
```

> **What to build:** DDR first (`/flow:record-ddr`): options A git-remote pull (recommended — assets already git-tracked; confirm whose remote the cell checkout tracks, that gates A) / B content-addressed lane / C lazy fetch. Then implement per DDR — bytes onto the cell so `/assets/` (server.mjs:649) serves them. Must STREAM (videos to ~108 MB), stay inside design root (DDR-054). Acceptance: cloud canvas shows `${PC}/park-catch.jpg`, hub/cell test for asset presence.

### Phase sync-5 — cloud commit posture

```
/flow:execute .ai/plans/archive/phase-sync-5-cloud-commit-posture.md
```

> **What to build:** DDR first: linked+credentialed repo = cloud-managed; recommendation de-emphasise (hide commit UI, `.git` untouched), escape hatch = disconnect. Then gate `GitPanel` on `linkedHub && credentialed` → History + "Cloud is saving" note, reacting LIVE to `sync:status`. Close-out: `cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release`, commit `dist/client.bundle.js` + `dist/styles.css`.

## Validation commands

Per phase: `/flow:utils-verify`. Full gate before closing the feature: `/flow:validate`, plus this bundle's own §Validation — `pnpm lint`; `pnpm test` + `cd apps/studio && bun test` + `cd apps/hub && node --test` (guard `git status apps/studio/dist/` around every bun run); `pnpm --filter @maude/site build`; `check-import-coherence.sh` + `check-version-parity.sh`; `maude design smoke --changed-only`; `security-auditor` + `ethical-hacker` on the two new hub-write surfaces. The acceptance test for the whole bundle is the live end-to-end verification (PRD §9) against a cloud-linked project.

## Final close-out

`/flow:done` on the feature — DDR sweep (two DDRs must exist), commit, What's New entry (user-visible: Connected state + cloud images + single save mechanism), roadmap regen (`pnpm --filter @maude/site gen:roadmap`), archive the plans.
