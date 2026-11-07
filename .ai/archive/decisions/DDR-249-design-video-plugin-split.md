# DDR-249 — Video splits out of `design` into the opt-in `design-video` plugin

- **Status:** Accepted — 2026-11-07 (Michal's decision on issue #156 §4: build it)
- **Extends:** DDR-148 (video comps), DDR-164 (BYOK media generation), DDR-168 (the app's bundled plugins always win), DDR-191 (bare `name:`, Claude Code namespaces)
- **Related:** DDR-183 (footage-analyst egress-free), DDR-126 (one version line), decision `maude/v2-T4.3-codex-skills-outside-skills`
- **Ticket:** issue #156 §4; plan `.ai/plans/feature-issues-burndown-2026-11.md` T4.4

## Context

A Claude Code or Codex session lists every command, skill and agent description of every enabled plugin, in every turn. The design plugin carried the whole video surface — `/design:reel`, `/design:video-analyze`, `/design:to-lottie`, the skills `video-comp` (25 guides), `footage-director`, `footage-keyframes`, the agents `footage-analyst` and `footage-director`, and the video half of `ai-generation` — so a terminal user who never cuts video paid for it in every session. The desktop app, on the other hand, ships the video features (timeline, reel, footage analysis, Lottie handoff) and must keep them.

## Decision

1. **A new plugin `plugins/design-video`** takes the three commands, the three skills, both footage agents (moved with `git mv`) and a new skill `video-generation`. Both manifests (`.claude-plugin`, `.codex-plugin` with `codex-skills/`), its own `HARNESS.md`, `CATEGORIES.md` and a `v2-words.ratchet.json` closed at 0. Listed in both marketplaces (`.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`) right after `design`.
2. **Video generation splits by section, not by verb.** `maude design generate` is one verb with a `--modality` flag and one key rule, so `/design:generate` and `design:ai-generation` stay in design (images, sound, the never-handed-a-key rule, prompt conventions). Only the video-specific text — the Veo row, image-to-video, composing generated clips/music/captions into a reel, the Veo licence line — moves to `design-video:video-generation`, which loads `design:ai-generation` first. `media-generation-director` stays in design (it reads canvases too).
3. **Opt-in in a terminal, always on in the app.** `stage-resources.mjs` stages `plugins/design-video` into the `.app`; `computeSessionPlugins` injects it right after design, and only when design is injected (`DESIGN_VIDEO_PLUGIN_DIR`, `paths.ts`). `suppressionFor` derives `design-video@maude` from the injection set, so a native copy is switched off with no other edit. The chat panel's baked slash list carries both plugins (`gen-plugin-surfaces.mjs` `SLASH_PLUGINS`).
4. **design-video needs design and ships no hooks of its own.** Hooks are session-wide and `bareAgent` strips any namespace, so the design plugin's hooks keep holding `footage-analyst` (untrusted reader: no Bash, no write outside the design root) and `footage-director` (bounded writer, hand-off required, `check` only) under their new `design-video:` names; `cli/lib/handoff.mjs` `BOUNDED_WRITERS` names `design-video:footage-director`. A second copy of the hooks would double every PostToolUse record when both plugins are installed.
5. **Dependencies stay in `plugins/design/dependencies.json`.** whisper.cpp, ffmpeg, mlx-vlm and ollama are used by `maude design` helpers in `apps/studio/bin`, which the studio itself runs (captions, smart frames) whether or not the plugin is installed. `maude doctor` keeps reporting them for design users.
6. **One version line.** Both design-video manifests move with every release (`bump-version.sh`, `check-version-parity.sh`, its test); `version-parity.yml` runs the script on every PR, so it needed no edit.
7. **No aliases.** Claude Code namespaces a command by the plugin that ships it, so `/design:reel` cannot point at the new plugin. Every live reference moved to `design-video:` (registry, schemas, prompts, studio handoff text, site docs); history (CHANGELOG, What's New entries, plans, contracts, research, dogfood canvases) keeps the old names. Migration notes: `docs/MIGRATING-DESIGN-VIDEO.md`, site `/docs/design-video`, and a pending What's New entry.

## Alternatives rejected

- **Keep video in design, trim descriptions only** (#156 §2/§3 already capped them): still pays the 30-odd video guides' skill listing and three command descriptions per session.
- **Split `/design:generate` into an image and a video command:** one verb, one key rule, one permission card; two commands would restate the rule twice and invite drift.
- **A `design-video` hooks.json:** duplicate hook runs when both are installed (post-edit touch records, run-folder bookkeeping); the session-wide design hooks already cover the agents.
- **Move the video dependencies to design-video:** the helpers that need them belong to the studio, not the plugin; `maude doctor` would stop reporting them to design-only users whose in-app captions still need whisper.

## Pins

`cli/lib/plugin-design-video-split.test.mjs` (files only in design-video, manifests at the release version, marketplace entry, version scripts, desktop staging + injection, no live `design:<moved>` reference); `apps/studio/test/acp-plugin-bootstrap.test.ts` (injection order, never without design); `cli/lib/plugin-v2-words.test.mjs` (both ratchets closed); `cli/lib/plugin-name-namespace.test.mjs` and `plugin-agent-description-cap.test.mjs` (both agent dirs); `plugin-surfaces.test.mjs` (mirrors + slash list for both).
