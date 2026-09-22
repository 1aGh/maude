---
name: feature-harness-environment-projection
status: partial — implementation released; active-machine cutover and retirement pending
created: 2026-08-31
decisions:
  - Claude Code and the Maude Claude plugin corpus remain the canonical authoring source; Codex and OpenCode receive generated target-native projections.
  - One provenance-aware intermediate representation feeds both target adapters; target-specific logic does not rediscover Claude inputs independently.
  - Every source capability is classified per target as native, degraded, or unsupported; there is no aggregate parity claim.
  - Projection is one-way and fail-closed for permissions, hooks, secrets, and user-owned target configuration.
  - Generated state uses ownership manifests, source and output hashes, managed merge, atomic replacement, rollback, and explicit adoption.
  - The existing Dotfiles adapter remains a temporary operational shim; the redundant studyfi-design copy is removed only after a released Maude cutover passes the retirement gate.
  - This plan owns environment projection only; OpenCode remote sessions and orchestration remain in feature-opencode-remote-sessions.
---

# Feature: Harness environment projection

> **Checkpoint 2026-09-22:** T0–T9 shipped in v1.2.0 and remain present in
> v1.4.4. The plan stays open for T10–T13: the active Dotfiles installation
> still loads `opencode/claude-parity.ts`, the redundant `studyfi-design` copy
> still exists, and `maude harness status --json --global` reports no adopted
> targets. Do not describe the migration or retirement as complete.

Validate current Claude Code, OpenCode, and Codex schemas before implementing. Never infer target behavior from the existing best-effort adapter when the current target documentation or executable disagrees.

## Description

Make a developer's effective Claude Code and Maude environment reproducible in stock OpenCode and Codex without maintaining three hand-authored setups. Maude will discover global and repository-local Claude configuration, normalize it into one typed and provenance-carrying model, and lower that model into target-native artifacts.

The projector covers the complete environment surface: settings, instructions, MCP servers, enabled plugins, commands, agents, skills, hooks, rules, permissions, environment references, `.ai`, `.design`, and kgai integration. It does not promise that every Claude feature has an equivalent. Every item receives a target status of `native`, `degraded`, or `unsupported`, with an exact explanation and a strict-mode failure policy.

This replaces two copies of a hand-written OpenCode bridge:

- `~/Dotfiles/opencode/claude-parity.ts`, which is currently active through `~/.config/opencode` symlinks.
- `~/git/studyfi/studyfi-design/plugins/opencode-claude-parity/`, which has no active caller and is a redundant copy in the wrong repository.

## User Story

As a Maude user, I want Claude Code to remain my one authoring source while Codex and OpenCode receive safe, inspectable, target-native projections, so I can switch harnesses without manually synchronizing configuration or weakening security controls.

## Problem

- The effective Claude environment is layered across global settings, project settings, local overrides, MCP files, installed marketplace plugins, plugin assets, repository instructions, and Maude state directories.
- The current OpenCode adapter reimplements discovery and conversion in one runtime plugin, silently drops unsupported semantics, broadens some permissions, and executes hooks on only approximate lifecycle matches.
- The active adapter lives in personal Dotfiles while a less complete duplicate lives in `studyfi-design`; neither is tested as part of Maude or versioned with Maude's compatibility contract.
- Codex has its own global/project config precedence, `AGENTS.md` discovery, native agents, skills, hooks, MCP schema, sandbox, and approval model. Copying Claude-shaped files into Codex would not produce a trustworthy environment.
- Directly rewriting `~/.config/opencode/opencode.json`, `~/.codex/config.toml`, `AGENTS.md`, or project target directories can clobber user-owned configuration.
- Interpolating Claude environment variables during migration can materialize credentials into generated files, logs, backups, fixtures, or diffs.
- The OpenCode remote-sessions plan currently proposes its own project-local installer. Without an ownership boundary, both features would write overlapping `.opencode` state.

## Solution

### 1. One compiler pipeline

```text
Claude global inputs       Claude project inputs       installed plugins
         \                         |                         /
          +---------------- discovery + precedence --------+
                                      |
                                      v
                         provenance-aware environment IR
                                      |
                         capability + safety analysis
                                      |
                       +--------------+--------------+
                       |                             |
                       v                             v
               OpenCode lowerer                Codex lowerer
                       |                             |
                       +-------- managed writer ----+
                                      |
                     manifest + report + target-native files
```

Discovery runs once. The intermediate representation records each item's source path, scope, precedence layer, stable identity, secret-reference posture, and target-independent meaning. OpenCode and Codex lowerers consume only this model and emit a capability result for every item.

### 2. Safety contract

- **No secret values:** preserve `{env:NAME}`, `${NAME}`, keychain identifiers, and variable names. Never resolve or copy the current value. Reject known credential-shaped literals in migratable fields unless the user first moves them behind an environment reference.
- **No permission widening:** a mapped target policy must be no broader than the source for every expressible dimension. A scoped or conditional rule without a safe target equivalent is `degraded` or `unsupported`, not promoted to blanket allow.
- **No approximate hook execution:** map a hook only when trigger timing, blocking behavior, input, output, timeout, and failure semantics are compatible. Otherwise report it and leave it disabled.
- **No unmanaged overwrite:** the writer may create new owned files, update output whose current hash matches the previous manifest, or modify an explicitly adopted target after preview. Any external edit causes a conflict and no write.
- **No partial generation:** lock per scope, read a stable source snapshot, stage every target output, parse and validate it, fsync where supported, then atomically replace the complete generation. Keep the last valid generation and pre-adoption backup for rollback.
- **No target masquerading:** reports use `native`, `degraded`, and `unsupported`; product copy never calls the result full parity.

### 3. Scope and state

The projector supports two explicit scopes:

- `--global`: Claude user-level configuration into the target's user-level configuration.
- `--project <root>`: repository-specific configuration and enabled project plugin state.

Machine-local ownership state lives under `~/.config/maude/harness/`, keyed by canonical project-root hash. It contains manifests, previous generated hashes, backups, reports, and lock files; it never lands in a repository. Optional reviewed target overrides live in the repository:

- `.maude/targets/opencode.json`
- `.maude/targets/codex.toml`

Overrides apply after normalization and before lowering. They may narrow permissions, exclude capabilities, choose a supported target-native representation, or assign ownership of an existing target entry. They may not contain literal secrets, claim files outside the allowlisted target surface, or turn `unsupported` into `native` without a registered lowerer.

`.ai/` and `.design/` remain in place and keep their existing ownership and synchronization semantics. The projector registers or references their instructions, skills, and runtime integration where a target supports that behavior; it never clones either state tree into target config directories. kgai remains one store and one CLI, with target-native prompt/hook wiring generated from the same source contract.

### 4. Command surface

Add one CLI family:

```text
maude harness migrate --from claude --targets opencode,codex [--global] [--project <root>]
maude harness sync --targets opencode,codex [--global] [--project <root>]
maude harness check --targets opencode,codex [--strict] [--json]
maude harness diff --targets opencode,codex [--json]
maude harness status [--json]
maude harness adopt --target <target> --path <owned-path>
maude harness remove --target <target> [--global] [--project <root>]
```

`migrate` is the first-run preview/adoption flow. `sync` updates already-owned output. `check` is read-only and suitable for CI or diagnostics. `diff` explains source and output changes with secrets redacted. `remove` removes only manifest-owned output and restores an adopted pre-migration backup when one exists.

The CLI is explicit and idempotent; npm `postinstall`, `maude init`, and a plugin hook must not silently project a user's home directory. A later opt-in convenience may call `check` and suggest `sync`, but may not mutate automatically without a separately recorded decision.

### 5. Target boundaries

#### OpenCode

- Respect current OpenCode precedence: global config, project config, then `.opencode` assets, with more specific configuration applied later.
- Install one Maude-owned thin plugin entry rather than replacing the entire global `opencode.json`.
- Generate target-native commands, agents, skill paths, MCP definitions, permission rules, and environment references where current OpenCode schemas support them.
- Use a runtime plugin only for behavior that is inherently session/project dynamic, such as project-root discovery and exact compatible lifecycle hooks. The plugin consumes generated inventory; it does not contain a second Claude discovery implementation.
- Existing target-owned plugins and exclusions remain untouched unless explicitly adopted or overridden.

#### Codex

- Respect `~/.codex/config.toml`, trusted project `.codex/config.toml`, profile restrictions, and the keys Codex refuses from project scope.
- Use Codex's native `agents`, skills, hooks, MCP, approval/sandbox rules, and instruction discovery where semantically compatible.
- Preserve the global-to-project `AGENTS.md` chain. Prefer configuring `CLAUDE.md` as a documented fallback when that preserves precedence; generate or adopt `AGENTS.md` only when fallback behavior is insufficient and ownership is explicit.
- Never write provider credentials, auth stores, model-provider keys, telemetry routing, or other user-level-only settings from project input.
- Parse and preserve TOML comments/order outside managed keys. The implementation spike must select a maintained TOML parser/editor or stop; regex mutation is prohibited.

### 6. Relationship to OpenCode remote sessions

This plan owns environment discovery, target projection, target config ownership, and the shared OpenCode plugin registration point. `.ai/plans/feature-opencode-remote-sessions.md` continues to own remote transport, sessions, node gateways, worktrees, and orchestration workflows.

Before either plan executes its OpenCode installer task, amend the remote-sessions plan so its templates register through `maude harness`'s OpenCode lowerer instead of independently copying or overwriting `.opencode` files. The environment projector must not absorb the remote gateway or session SDK.

## Metadata

- **Type**: New Capability / Migration
- **Complexity**: High
- **App/Package**: `cli`, plugin distribution, documentation; final cleanup in personal Dotfiles and `studyfi-design`
- **Affected Systems**: Claude Code settings and marketplace cache, OpenCode global/project config and plugins, Codex global/project config, MCP, hooks, permissions, instructions, Maude npm package, kgai prompt integration
- **Dependencies**: maintained TOML parser/editor selected by T0 if no safe zero-dependency option exists; installed `opencode` and `codex` CLIs are optional conformance executables, not runtime dependencies
- **Scope**: all enumerated environment categories for both global and project scopes; no remote execution, chat UI, session federation, provider authentication migration, or bidirectional target-to-Claude sync

---

## Context References

### Must-Read Files

> During `/flow:execute`, read every file in this subsection in parallel before editing.

- `CLAUDE.md` (lines 5-17, 64-80, 131-161, 184-186, 203-217, 227-229) - Repository architecture, plugin naming, npm surface, quality gates, debate, packaging, and local plugin testing.
- `.ai/workflows.config.json` - Maude's current stack, quality commands, and kgai scope.
- `cli/bin/maude.mjs` - Lazy command dispatch and error behavior for the new `harness` family.
- `cli/commands/init.mjs` - Existing CLI argument, dry-run, idempotence, and user-summary conventions; do not couple projection to init.
- `cli/commands/config.mjs` - Existing small config command style; its whole-file JSON writer is not safe enough for target managed merge.
- `cli/lib/copy-tree.mjs` - Existing create/skip/replace semantics; useful for fixtures, insufficient for ownership-aware transactional output.
- `cli/lib/argv.mjs` - Canonical CLI argument parser.
- `cli/commands/help.mjs` - Top-level command documentation to update.
- `cli/lib/plugin-cli-reachability.test.mjs` - Test style for shipped plugin-to-CLI contracts.
- `scripts/check-tarball-shape.sh` - Published surface and no-leaked-workspace gate.
- `package.json` - npm `files`, scripts, dependency policy, and release surface.
- `plugins/flow/.claude-plugin/config.schema.json` - Claude/Maude project config schema and any future `harness` override declaration boundary.
- `.ai/plans/feature-opencode-remote-sessions.md` (T2, Context References, Scope Cuts) - Adjacent plan whose `.opencode` ownership must be revised, not duplicated.
- `~/Dotfiles/opencode/claude-parity.ts` - Active operational adapter and behavioral inventory; treat as prior art, not a correctness oracle.
- `~/Dotfiles/opencode/opencode.json` - Current active plugin registration and target-owned MCP exclusions.
- `~/Dotfiles/opencode/install.sh` - Current symlink cutover and backup behavior.
- `~/git/studyfi/studyfi-design/plugins/opencode-claude-parity/claude-parity.ts` - Redundant, less complete copy to remove only after retirement gates.
- `~/git/studyfi/studyfi-design/plugins/opencode-claude-parity/install.sh` - Current destructive whole-file symlink installer to retire.
- `~/git/studyfi/studyfi-design/README.md` (lines 18-24) - Documentation reference removed with the redundant adapter.

### Files to Create

- `cli/commands/harness.mjs` - `migrate`, `sync`, `check`, `diff`, `status`, `adopt`, and `remove` orchestration.
- `cli/lib/harness/discover-claude.mjs` - Global/project/plugin source discovery and precedence resolution.
- `cli/lib/harness/model.mjs` - Validated environment IR, stable identities, provenance, scope, and deterministic serialization.
- `cli/lib/harness/capabilities.mjs` - Target capability registry and `native|degraded|unsupported` diagnostics.
- `cli/lib/harness/secrets.mjs` - Reference preservation, literal-secret refusal, and redaction.
- `cli/lib/harness/managed-state.mjs` - Ownership manifests, source/output hashes, adoption, orphan detection, and rollback metadata.
- `cli/lib/harness/transaction.mjs` - Scope locks, staging, validation, atomic replacement, rollback, and stale staging cleanup.
- `cli/lib/harness/targets/opencode.mjs` - OpenCode lowering and target validation.
- `cli/lib/harness/targets/codex.mjs` - Codex lowering and target validation.
- `cli/templates/harness/opencode/maude-projector.ts` - Thin OpenCode runtime plugin for truly dynamic, compatible behavior only.
- `cli/commands/harness.test.mjs` - CLI contract, exit code, dry-run, status, and removal tests.
- `cli/lib/harness/discover-claude.test.mjs` - Discovery, precedence, provenance, and malformed-source tests.
- `cli/lib/harness/capabilities.test.mjs` - Complete inventory and classification tests.
- `cli/lib/harness/managed-state.test.mjs` - User-edit conflict, adoption, stale-owned output, rollback, and removal tests.
- `cli/lib/harness/transaction.test.mjs` - crash, concurrent run, validation failure, and all-target atomicity tests.
- `cli/lib/harness/targets/opencode.test.mjs` - OpenCode golden and semantic conformance tests.
- `cli/lib/harness/targets/codex.test.mjs` - Codex golden and semantic conformance tests.
- `cli/fixtures/harness/claude-home/` - Synthetic global Claude settings, assets, plugins, hooks, and MCP inputs with sentinel secrets.
- `cli/fixtures/harness/project/` - Synthetic project settings, local overrides, instructions, `.ai`, `.design`, and kgai inputs.
- `cli/fixtures/harness/expected/opencode/` - Target-native golden output and capability report.
- `cli/fixtures/harness/expected/codex/` - Target-native golden output and capability report.
- `docs/harness-environment-projection.md` - User/operator guide, trust model, statuses, commands, override format, recovery, and cleanup.
- `docs/harness-capability-matrix.md` - Versioned source-to-target semantic contract generated or checked from the capability registry.

### Files Likely to Update

- `cli/bin/maude.mjs` - Add lazy `harness` dispatch.
- `cli/commands/help.mjs` - Document the command family and examples.
- `package.json` - Ship projector templates and, only if T0 proves necessary, add the selected TOML dependency.
- `scripts/check-tarball-shape.sh` - Assert projector templates, capability metadata, and runtime closure are present while secrets/fixtures are absent from the tarball.
- `README.md` - Add multi-harness setup and one-way-source statement.
- `CLAUDE.md` - Record source-of-truth, target ownership, packaging, and update rules after implementation.
- `.ai/plans/feature-opencode-remote-sessions.md` - Make its OpenCode templates consume this projector's ownership and registration seam.
- `site/lib/roadmap.json` - Regenerated when this plan is added or archived.
- `~/Dotfiles/setup.sh` - Replace direct OpenCode parity installer with the released `maude harness` bootstrap after cutover.
- `~/Dotfiles/opencode/install.sh` - Reduce to a temporary compatibility wrapper, then remove projection ownership after soak.
- `~/Dotfiles/opencode/claude-parity.ts` - Delete after the active machine no longer references it and rollback is proven.
- `~/Dotfiles/opencode/opencode.json` - Stop owning the Maude projector entry after adoption; retain unrelated user-owned OpenCode choices.
- `~/git/studyfi/studyfi-design/README.md` - Remove the optional OpenCode plugin section after retirement.

### Files to Delete After Gate R

- `~/git/studyfi/studyfi-design/plugins/opencode-claude-parity/claude-parity.ts`
- `~/git/studyfi/studyfi-design/plugins/opencode-claude-parity/opencode.json`
- `~/git/studyfi/studyfi-design/plugins/opencode-claude-parity/install.sh`
- `~/git/studyfi/studyfi-design/plugins/opencode-claude-parity/README.md`

The Dotfiles files are not included in this unconditional list. Their projection logic is removed only after the active machine cutover and soak; unrelated Dotfiles ownership remains.

### Documentation

- [OpenCode source and configuration](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/config.ts) - Current global/project/`.opencode` discovery and precedence.
- [OpenCode plugins](https://opencode.ai/docs/plugins/) - Native plugin loading, options, hooks, and local plugin paths.
- [OpenCode configuration](https://opencode.ai/docs/config/) - Commands, agents, skills, MCP, permissions, environment, and global/project schema.
- [Codex configuration reference](https://developers.openai.com/codex/config-file/config-reference) - Current global/project TOML keys, scope restrictions, agents, hooks, MCP, approvals, and sandbox.
- [Codex AGENTS.md](https://developers.openai.com/codex/agent-configuration/agents-md) - Global and root-to-CWD instruction discovery, override precedence, fallback filenames, and size limits.
- [Codex hooks](https://developers.openai.com/codex/hooks) - Lifecycle trigger and handler compatibility contract.
- [Codex skills](https://developers.openai.com/codex/build-skills) - Native skill packaging and discovery.

### Patterns to Follow

- Mirror `cli/bin/maude.mjs` lazy command loading and `cli/commands/*.test.mjs` Node test conventions.
- Mirror `maude init --dry-run`'s explicit preview posture, but do not reuse its force-overwrite semantics for user-owned config.
- Reuse `~/.config/maude` for machine-local state, following existing hub config placement; never add generated ownership state to a repository.
- Keep all target-specific schema knowledge under `cli/lib/harness/targets/`; discovery and safety logic remain target-independent.
- Keep executable target adapters in `cli/templates/harness/` so npm packaging is explicit and testable.
- Treat source files, installed plugin metadata, hook output, MCP descriptions, and target config as untrusted data. They never become shell commands during projection.

---

## Architecture Decisions

### Capability Contract

Every discovered item produces one record per requested target:

```json
{
  "sourceId": "plugin:flow@maude/command:plan",
  "source": ".../plugins/flow/commands/plan.md",
  "scope": "project",
  "target": "codex",
  "status": "degraded",
  "representation": "skill",
  "reason": "Codex has no equivalent namespaced slash-command registration",
  "ownedOutputs": ["..."],
  "sourceHash": "sha256:..."
}
```

The capability matrix is exhaustive: a source item missing from the report is a test failure. `--strict` exits non-zero on all `unsupported` items and on security-relevant `degraded` items; users may allowlist understood non-security degradations in target overrides.

### Precedence

Normalize these Claude layers from least to most specific, while retaining provenance for conflicts:

1. Global Claude instructions, settings, commands, agents, skills, and MCP.
2. User-scoped enabled marketplace plugin assets.
3. Project Claude instructions, settings, commands, agents, skills, and MCP.
4. Project-scoped enabled marketplace plugin assets.
5. `.claude/settings.local.json` machine-local overrides.

Do not assume two sources use identical merge semantics. T0 must document array, map, deny/allow, plugin enablement, and hook precedence from Claude's current behavior. The IR stores both effective values and contributing sources so `diff` can explain why an item won.

### Managed Merge

The manifest records each owned file or managed config entry, its previous generated hash, and any pre-adoption backup. On sync:

1. Re-read and hash sources into a stable snapshot.
2. Re-read target config and compare managed output hashes.
3. Refuse if an owned output changed externally or an unmanaged entry collides.
4. Render both targets into staging from the same IR generation ID.
5. Parse target JSON/TOML/Markdown and run semantic validators.
6. Commit all requested outputs or none; update the manifest last.

`--force` is deliberately absent from mutating harness commands. `adopt` is the only way to claim existing state and always emits a preview plus backup.

### Security Invariants

- Source input must not control output paths outside explicit target roots.
- Resolve canonical paths and reject symlink escapes for source traversal, staging, backup, and deletion.
- Never spawn commands found in MCP or hook configuration during discovery, render, diff, or static validation.
- Conformance execution uses committed safe fixtures or an explicit manual dogfood step, never arbitrary discovered hook commands.
- Reports and errors redact values by key and by known sentinel/credential patterns.
- Generated permissions must be equal or narrower. Unknown mappings fail closed.
- `remove` follows the manifest only, validates current hashes, and refuses modified files.
- Backups inherit owner-only permissions and exclude resolved credentials.

### Debate Resolution

The divergent planning panel converged on a shared IR and thin adapters. BUILDER argued for exhaustive semantic projection; SHIPPER constrained delivery to a project/global pilot with no lifecycle emulation; BREAKER blocked implementation until permission monotonicity, hook equivalence, secret preservation, managed merge, and retirement gates are explicit. This plan adopts the shared IR and complete inventory while sequencing implementation through strict safety gates before migration or deletion.

---

## Tasks

Execute in order. Tasks are atomic and testable. T9-T12 may touch sibling repositories and must be committed independently in their owning repositories.

### T0: SPIKE current harness contracts and freeze the capability matrix

- **Execution**: ✅ Task 0 completed 2026-08-31 — matrix frozen for Claude Code 2.1.241, OpenCode 1.18.25, and Codex 0.151.0; red inventory scaffold recorded.

- **Do**: On pinned/current Claude Code, OpenCode, and Codex versions, enumerate exact global/project paths, precedence, merge behavior, command/agent/skill formats, MCP schemas, hook events, permission/sandbox semantics, instruction discovery, environment references, and config validation commands.
- **Do**: Compare the active Dotfiles adapter behavior to current target schemas. List every silent loss or widening; specifically test scoped Bash rules, read denies, unknown tools, disabled MCP, OAuth, local/project plugin selection, hook timing, hook output, and malformed frontmatter.
- **Do**: Decide whether a maintained TOML parser/editor is required. If no candidate can round-trip comments and unmanaged keys safely under Node 20 and package constraints, stop and amend the plan; regex TOML edits are forbidden.
- **Do**: Write `docs/harness-capability-matrix.md` with every source category and each target's intended `native|degraded|unsupported` representation. Include tested target versions and review date.
- **Gate C0**: No implementation begins until every source category has an explicit row and every security-relevant degraded/unsupported mapping has fail-closed behavior.
- **Validate**: Manual contract transcript plus a failing inventory test scaffold that becomes green only as lowerers land.

### T1: BUILD Claude discovery and the deterministic environment IR

- **Execution**: ✅ Task 1 completed 2026-09-01 — bounded descriptor-safe discovery, deterministic provenance-aware IR, complete skill/import content closures, and side-effect-free source inventory implemented.

- **Do**: Implement global/project root resolution, current Claude settings precedence, installed plugin selection, namespacing, Markdown frontmatter parsing, MCP parsing, instructions, rules, hooks, `.ai`, `.design`, and kgai integration discovery.
- **Do**: Record stable item ID, category, scope, source path, precedence, contributors, effective value, secret-reference metadata, and source hash. Sort all maps/lists deterministically.
- **Do**: Bound file count, file size, nesting depth, frontmatter size, and total inventory. Reject malformed JSON and symlink escapes with source-specific diagnostics rather than silently skipping them.
- **Do**: Keep discovery pure and side-effect free. It must not execute hooks, MCP commands, plugin scripts, or environment interpolation.
- **Validate**: `node --test cli/lib/harness/discover-claude.test.mjs` over global/project precedence, user/project plugin selection, disabled plugins, duplicate names, malformed inputs, missing paths, symlinks, bounds, and deterministic double-read.

### T2: ADD fail-closed capability and secret analysis

- **Execution**: ✅ Task 2 completed 2026-09-01 — exhaustive per-target registry and inert-safe generic analysis implemented; all security-relevant records remain disabled until target-specific proof in T4/T5, and literal secrets are removed before IR construction.

- **Do**: Implement the versioned per-target capability registry. Require exactly one classification for every IR item and emit machine-readable plus human-readable reports.
- **Do**: Preserve environment/keychain references without reading values. Reject literal sensitive values in MCP headers/env, target overrides, and generated config; redact diagnostics and diffs.
- **Do**: Encode permission monotonicity checks. Scoped rules, denies, approval modes, and sandbox constraints without a proven target equivalent cannot become broad allow rules.
- **Do**: Encode hook compatibility across event timing, sync/async behavior, timeout, failure policy, input schema, output semantics, and transcript availability. Non-equivalent hooks remain disabled and reported.
- **Validate**: `node --test cli/lib/harness/capabilities.test.mjs`; include sentinel credentials that must appear zero times in output, logs, manifests, backups, and error snapshots.

### T3: BUILD ownership manifests and transactional managed merge

- **Execution**: ✅ Task 3 completed 2026-09-01 — machine-local ownership, explicit adoption, descriptor-pinned transactions, durable rollback bundles, quarantine recovery, conflict-safe removal, and crash/concurrency handling implemented.

- **Do**: Store machine-local per-scope manifests under `~/.config/maude/harness/` with schema version, generation ID, canonical root hash, source hashes, output hashes, ownership, adopted backups, target versions, and capability summary.
- **Do**: Implement `adopt` as preview -> explicit confirmation -> owner-only backup -> managed ownership. Reject directories and paths outside the target allowlist.
- **Do**: Implement lock acquisition, stable-source recheck, same-filesystem staging, parse/semantic validation, atomic replacement, manifest-last commit, rollback, stale staging cleanup, and interrupted-run recovery.
- **Do**: Preserve unmanaged JSON/TOML/Markdown content and comments. Refuse collisions or externally modified managed entries without changing any requested target.
- **Do**: Implement `remove` from manifest ownership only. Restore adopted backups; remove generated entries/files only when current hashes still match.
- **Validate**: `node --test cli/lib/harness/managed-state.test.mjs cli/lib/harness/transaction.test.mjs`; include concurrent processes, crash before/after target replacement, target validation failure, external edit, symlink swap, cross-device staging refusal, rollback, stale orphan, and two-target all-or-none cases.

### T4: IMPLEMENT the OpenCode lowerer and thin runtime plugin

- **Execution**: ✅ Task 4 completed 2026-09-01 — deterministic target-native OpenCode lowering, effective-capability validation, one inventory-only projector entry, exact MCP/reference and scoped-Bash mappings, inert unsupported hooks, semantic validators, managed-merge conformance, and isolated executable smoke implemented.

- **Do**: Generate current target-native command, agent, skill, MCP, environment-reference, instruction, and permission representations from the IR. Preserve OpenCode's global/project/`.opencode` precedence.
- **Do**: Install one manifest-owned plugin entry into existing OpenCode config. Keep all user plugins and unrelated settings untouched, including the current `figma`, `github`, and `webflow` ownership exclusions unless explicitly migrated.
- **Do**: Move dynamic project/session behavior into `maude-projector.ts`, but make it consume generated inventory. It must not rediscover Claude settings or duplicate lowerer logic.
- **Do**: Run only hooks proven equivalent in T0/T2. kgai prompt injection must be bounded, target-native, and classified; transcript-dependent Stop behavior may not be claimed native when input is unavailable.
- **Do**: Remove the unsafe current mapping from any `Bash(...)` allow to blanket `bash = allow`; preserve or narrow scope instead.
- **Validate**: Golden tests, parse tests, semantic inventory assertions, byte-identical second sync, and `opencode debug config` in an isolated HOME when OpenCode is available. Verify every expected command/agent/skill/MCP appears once and unmanaged config survives.

### T5: IMPLEMENT the Codex lowerer

- **Execution**: ✅ Task 5 completed 2026-09-01 — deterministic Codex user/project TOML patching, trusted-project and user-only-key gates, native agents/skills/MCP/reference lowering, persisted-trust exact hooks, narrow approval/sandbox mapping, instruction-shadow diagnostics, semantic validators, idempotence, and isolated executable smoke implemented.

- **Do**: Generate compatible user/project TOML entries, native agents, skills, hooks, MCP servers, approvals/sandbox rules, and instruction discovery from the same IR.
- **Do**: Respect trusted-project loading and user-level-only keys. Project projection must never write provider/auth/notification/profile/telemetry keys.
- **Do**: Prefer `project_doc_fallback_filenames = ["CLAUDE.md", ...existing]` when it preserves intended instruction precedence. If an existing `AGENTS.md` shadows the fallback, report the conflict; generate/adopt an `AGENTS.md` only through managed ownership.
- **Do**: Preserve MCP bearer/header environment references using Codex's native env fields. Static header values that look sensitive are refused, not copied.
- **Do**: Map Claude commands to native Codex skills/plugins only where invocation and context semantics are documented; otherwise mark degraded and state the replacement interaction.
- **Validate**: Golden tests, TOML round-trip with comments and unknown keys, semantic inventory assertions, byte-identical second sync, and isolated `codex` config/instruction smoke when Codex is available.

### T6: ADD the `maude harness` CLI workflow

- **Execution**: ✅ Task 6 completed 2026-09-01 — lazy CLI dispatch, explicit scope and target selection, preview/confirmation gates, stable exits, redacted JSON status, target-specific validation, adoption/removal, and all-target transactional sync implemented and covered by isolated-home command tests.

- **Do**: Add command dispatch and help for `migrate`, `sync`, `check`, `diff`, `status`, `adopt`, and `remove` with explicit `--global` and `--project` scope.
- **Do**: Default `migrate`, `diff`, and `adopt` to preview. Require an explicit confirmation or `--yes` only after a complete diff; `--yes` must not bypass conflicts, unsupported security controls, or secret checks.
- **Do**: Define stable exit codes: clean, drift, degraded/unsupported strict failure, ownership conflict, invalid source, invalid target, and interrupted transaction.
- **Do**: `status --json` reports source generation, owned targets, drift, capability counts, last successful validation, target executable versions, and rollback availability without exposing values.
- **Do**: Do not add automatic mutation to npm `postinstall`, `maude init`, plugin SessionStart, desktop startup, or shell startup.
- **Validate**: `node --test cli/commands/harness.test.mjs`; test every verb, scope combination, JSON output, non-interactive behavior, confirmation, exit code, and no-op second sync.

### T7: ALIGN packaging and the remote-sessions ownership seam

- **Execution**: ✅ Task 7 completed 2026-09-01 — packed runtime closure, explicit forbidden-artifact gate, isolated tarball install/check, centralized schema/target compatibility guidance, and harness-only OpenCode registration ownership verified.

- **Do**: Ship runtime templates and capability metadata in the npm package. If projector discovery depends on Maude plugin assets, either resolve the installed Claude marketplace copy with a loud missing-source report or explicitly add the required canonical plugin directories to `package.json.files`; do not assume source-tree paths exist after npm install.
- **Do**: Extend `check-tarball-shape.sh` to prove required target adapter files ship, test fixtures and backups do not ship, no workspace metadata leaks, and runtime dependencies are complete.
- **Do**: Amend `.ai/plans/feature-opencode-remote-sessions.md` T2 so OpenCode workflow templates register through the harness lowerer and cannot claim the same config entries independently.
- **Do**: Add a schema-version compatibility rule: unsupported target versions fail `check` with upgrade guidance rather than applying stale output.
- **Validate**: `npm pack --dry-run --json`, `bash scripts/check-tarball-shape.sh`, local install from packed tarball into an isolated prefix, then `maude harness check` with no access to the source checkout.

### T8: RUN fixture conformance and hostile migration drills

- **Execution**: ✅ Task 8 completed 2026-09-01 — committed synthetic Claude home/project and normalized OpenCode/Codex golden trees; exhaustive provenance/status checks; byte-identical sync, external-edit, concurrency, all supported transaction-failpoint SIGKILL recovery, rollback/remove/re-migrate, target-drift, absent-executable, secret, hook-inertness, and unmanaged-file drills; Gate C1 green. Evidence: `.ai/logs/2026-09-01-harness-c1-conformance.md` (redacted, linked in kgai).

- **Do**: Run the complete synthetic Claude home/project through both targets in isolated HOME/XDG/CODEX_HOME directories. Compare golden tree, inventory completeness, source provenance, target statuses, and second-run hashes.
- **Do**: Add interaction fixtures combining project-local overrides, enabled project plugins, duplicate MCP names, user target plugins, existing AGENTS/CLAUDE files, narrowed permissions, hook mixtures, malformed sources, and sentinel secrets.
- **Do**: Drill external edits, concurrent sync, killed process at each transaction boundary, rollback, remove, re-migrate, target-version drift, and absent target executables.
- **Gate C1**: zero missing inventory records, zero permission widening, zero literal secret copies, zero unmanaged-file changes, byte-identical second sync, successful rollback, and exact manifest-owned removal.
- **Validate**: targeted Node suites plus root `pnpm test`, `pnpm lint`, and `pnpm format` check posture without formatting unrelated files.

### T9: DOGFOOD real workspaces without cutting over the active machine

- **Execution**: ✅ Task 9 completed 2026-09-01 — isolated migration, byte-identical second strict check, and stock OpenCode/Codex config boot passed for Maude, studyfi-design, and AI-StudyMate. All 878 target records are explained: 446 native, 432 degraded, 0 unsupported, 0 unacknowledged security failures. Exact target gaps are persisted through fail-closed project overrides; Codex hooks require exact source-hash trust. Evidence: `.ai/logs/2026-09-01-harness-c2-dogfood.md`.

- **Do**: Run `migrate --preview` and `check --strict` against three representative repositories: Maude itself; `studyfi-design` with StudyFi plugins and shared `.design`; and `AI-StudyMate` with a large project-local environment.
- **Do**: Generate into temporary target homes only. Compare discovered commands, agents, skills, MCP, hooks, permissions, instructions, `.ai`, `.design`, and kgai behavior against current Claude and the active Dotfiles adapter.
- **Do**: Review every degraded/unsupported record. Fix false degradations; document genuine target gaps. No unexplained delta may pass.
- **Do**: Run stock OpenCode and Codex in each temporary home and ask each to report loaded instruction, command/skill, agent, MCP, permission, and kgai sources. Do not execute arbitrary discovered hooks during this proof.
- **Gate C2**: all three workspaces boot in both targets, all expected native capabilities are discoverable, every non-native item is explained, and security invariants from C1 remain true.
- **Validate**: Store a dated, secret-redacted conformance report under `.ai/logs/` and link it to the plan node in kgai.

### T10: CUT OVER the active Dotfiles installation with rollback

- **Blocked by**: C0, C1, and C2.
- **Do**: Release a Maude version containing the projector before changing the active machine. Install that release through the normal distribution channel, not from the working tree.
- **Do**: Preview adoption of existing `~/.config/opencode` and `~/.codex` state. Preserve unrelated user-owned entries and record backups. Replace only the Dotfiles-owned parity plugin registration and generated projection entries.
- **Do**: Update `~/Dotfiles/setup.sh` to invoke the released `maude harness sync/check` bootstrap. Reduce `~/Dotfiles/opencode/install.sh` to a temporary compatibility wrapper; it must not retain an independent projector.
- **Do**: Fully restart both targets, repeat C2 on the active homes, then rehearse rollback to the pre-adoption state and forward migration again.
- **Gate C3**: active config no longer references `~/Dotfiles/opencode/claude-parity.ts` or `studyfi-design`; rollback and reapply both pass; no user-owned setting changes.
- **Validate**: `readlink`/config inspection, target-native diagnostics, `maude harness status --json`, and two consecutive clean `maude harness check --strict` runs separated by a restart.

### T11: SOAK one released version and run the retirement gate

- **Blocked by**: C3.
- **Do**: Dogfood for at least seven calendar days and across one released Maude version on daily work in Claude, OpenCode, and Codex. Include a Claude settings change, project plugin enable/disable, MCP change, command/skill change, hook change, and target-owned config edit.
- **Do**: Confirm `sync` projects each source change, reports the target-owned edit as a conflict without clobbering it, and preserves rollback.
- **Do**: Search the workspace and home config for references to both old adapters. Classify each hit as documentation, backup, active config, or code; active references block retirement.
- **Gate R**: C0-C3 remain green; one released-version soak completes; zero unexplained capability regressions, permission widenings, literal secret copies, target clobbers, or rollback failures; two consecutive projections are clean; no active symlink/config/caller points to either old adapter.
- **Validate**: Dated retirement report with target versions, repositories exercised, changes projected, conflicts tested, and exact references remaining.

### T12: REMOVE the redundant studyfi-design adapter and close migration ownership

- **Blocked by**: Gate R. Do not combine this deletion with the projector implementation commit.
- **Do**: In `studyfi-design`, delete `plugins/opencode-claude-parity/` and remove README lines 18-24. Search the repository and wider `~/git` workspace for remaining callers.
- **Do**: In Dotfiles, delete `claude-parity.ts` and remove the temporary wrapper only if Gate R proves the released Maude projector fully owns that behavior. Preserve unrelated OpenCode/Codex settings and bootstrap choices.
- **Do**: Record the cross-repo ownership move: Maude owns harness projection; `studyfi-design` owns only StudyFi design assets/plugins; Dotfiles invokes Maude but does not implement projection.
- **Do**: Update Maude docs and capability matrix with supported versions, migration instructions, recovery, and target drift maintenance responsibility.
- **Validate**: no active or repository reference to `studyfi-design/plugins/opencode-claude-parity` or `Dotfiles/opencode/claude-parity.ts`; clean `maude harness check --strict`; `opencode debug config`; Codex instruction/config smoke; `git diff --check` in every touched repository.

### T13: CLOSE Maude quality, packaging, and release gates

- **Do**: Add a pending What's New entry only after the released feature is usable. Regenerate roadmap after plan/status changes.
- **Do**: Run security auditor and ethical hacker over discovery, path handling, secret redaction, permission mapping, target config merge, backup, rollback, remove, and hook execution boundaries.
- **Do**: Run a clean-clone packed-package smoke with isolated homes and no source checkout. Verify package files, optional target executable behavior, and Node 20 compatibility.
- **Do**: Archive this plan only after Gate R cleanup or explicitly leave T12 open; do not report implementation complete while old projection ownership remains ambiguous.
- **Validate**: full Validation section below.

---

## Validation

Run these commands to confirm zero regressions:

1. **Targeted CLI**: `node --test cli/commands/harness.test.mjs cli/lib/harness/*.test.mjs cli/lib/harness/targets/*.test.mjs`
2. **Format**: `pnpm format` followed by inspection that unrelated generated bundles were not changed
3. **Lint**: `pnpm lint`
4. **Types**: `cd apps/studio && bunx tsc --noEmit && cd ../.. && bash scripts/check-tsc-coverage.sh`
5. **Tests**: `pnpm test && cd apps/studio && bun test test/sync-*.test.ts --timeout 20000`
6. **Build**: `pnpm --filter @maude/site build`
7. **Package**: `bash scripts/check-tarball-shape.sh` plus install from `npm pack` into an isolated prefix
8. **Version parity**: `bash scripts/check-version-parity.sh`
9. **OpenCode conformance**: isolated HOME, `opencode debug config`, loaded asset inventory, strict capability report, restart, and byte-identical second sync
10. **Codex conformance**: isolated CODEX_HOME/project, parsed TOML, reported instruction chain, loaded agent/skill/MCP inventory, restart, and byte-identical second sync
11. **Security**: defender and attacker reviews report zero blockers; literal sentinel secrets occur zero times in all generated, logged, backup, and diff output
12. **Real workspaces**: Maude, `studyfi-design`, and `AI-StudyMate` pass both targets under temporary homes before active cutover
13. **Rollback/remove**: adopted user config restores byte-for-byte; generated-only state is removed exactly; modified managed state is refused
14. **Retirement**: Gate R report proves no active references before any old adapter is deleted

---

## Risk Assessment

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Target schema changes while output still parses | Silent semantic drift or weakened controls | Versioned capability registry, executable conformance, supported-version gate, review date in matrix |
| Permission translation broadens access | Arbitrary reads/writes/commands | Monotonic safety checks, fail-closed unknowns, strict-mode blocker, adversarial fixtures |
| Hook trigger is only approximately equivalent | Unexpected code execution or missing state update | Full lifecycle compatibility tuple; unsupported hooks remain disabled and reported |
| Secret interpolation materializes credentials | Credential leak to config, logs, git, or backups | Preserve references only, literal-secret refusal, redaction, sentinel scans |
| JSON/TOML rewrite clobbers user config | Data loss and broken target setup | AST-aware managed merge, ownership manifest, adopt preview, external-edit refusal, rollback |
| Concurrent/global/project sync mixes generations | Partial or inconsistent environment | Scope locks, stable source snapshot, all-target transaction, manifest-last commit |
| Package works only from source checkout | Released CLI cannot discover templates/plugin assets | Packed-tarball install test and explicit npm files contract |
| Environment projector and remote-sessions installer overlap | Competing `.opencode` owners | Projector owns config registration; remote plan consumes its seam before implementation |
| Old adapters deleted too early | Active OpenCode breaks with no rollback | Released cutover, seven-day soak, Gate R, separate cleanup commit |
| `.ai` or `.design` accidentally copied | Conflicting state ownership and large stale snapshots | Reference/register in place only; prohibit state-tree duplication in lowerers |

---

## Acceptance Criteria

- [x] Every global and project source category is discovered and represented in the IR with provenance and deterministic identity.
- [x] Every IR item receives exactly one OpenCode and one Codex status: `native`, `degraded`, or `unsupported`.
- [x] No report or documentation claims blanket parity.
- [x] Generated permissions are equal or narrower than Claude; unsupported scoped semantics fail closed.
- [x] Hooks run only when lifecycle semantics are proven compatible; all others are disabled and explained.
- [x] Environment and keychain references survive without resolving or copying values.
- [x] Sentinel secrets occur zero times in generated config, manifests, reports, logs, backups, diffs, and test snapshots.
- [x] User-owned target config survives byte-for-byte outside explicitly managed entries.
- [x] Externally modified managed entries produce a conflict and no target write.
- [x] Two consecutive syncs from unchanged sources produce byte-identical output and no manifest churn.
- [x] A failed validation or killed process leaves either the prior complete generation or the new complete generation, never a mix.
- [x] `remove` restores adopted state or deletes only still-unmodified manifest-owned state.
- [x] Packed npm installation works without access to the Maude source checkout.
- [x] OpenCode and Codex conformance pass on Maude, `studyfi-design`, and `AI-StudyMate` in isolated homes.
- [ ] The active machine cutover uses a released Maude version and has a tested rollback.
- [x] The OpenCode remote-sessions plan no longer owns overlapping target config entries.
- [ ] Gate R passes before deleting either old adapter implementation.
- [ ] `studyfi-design/plugins/opencode-claude-parity/` and its README reference are removed in a separate `studyfi-design` change after Gate R.
- [ ] Dotfiles retains no independent projection logic after Gate R; unrelated target configuration remains intact.
- [ ] Security reviews report zero blockers.
- [ ] Full Maude quality, package, and version gates pass.
- [ ] The architecture, plan, conformance evidence, and cross-repo ownership move are recorded in kgai.

## Open Questions Resolved by T0

- Which current Claude Code files and settings participate in effective precedence for every source category?
- Which OpenCode and Codex versions become the initial supported floor and ceiling?
- Can Codex's current TOML config be safely managed with an existing maintained editor, or does the output need a different target-native ownership seam?
- Which Claude commands are native commands, skills, or only documented manual workflows in each target?
- Which hook events are genuinely equivalent after comparing trigger, input, output, blocking, timeout, and failure semantics?
- Which Maude plugin assets must be added to the npm surface versus resolved from the installed Claude marketplace cache?

These are implementation-spike questions, not permission to weaken the safety contract. A negative answer changes a mapping to `degraded` or `unsupported`; it does not justify emulation or overwrite.
