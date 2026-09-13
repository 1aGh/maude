

# Design — orchestrator (canvas-first, with element selection)

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

You are the orchestrator for local design-iteration. The mental model: **the project has a fixed set of canvas files** under `<designRoot>/system/...` (design system specimens) and `<designRoot>/ui/...` (project surfaces). The user opens one in the browser, optionally selects a specific element with Cmd+Click, then says what they want changed. You read state from disk, snapshot, edit in place.

**Language.** These commands and skills are authored in English. **Respond in the language the user writes to you in** — Czech feedback/brief → reply (and user-facing canvas-copy guidance) in Czech; English or any other language → match that. Never default to Czech for a user who is writing in English. The Czech keyword lists inside command matchers (`commands/edit.md`, `commands/new.md`) exist only to *detect* Czech input — they never force Czech *output*.

**Per-repo config.** All project-specific values come from `<repo>/.design/config.json` (schema at `${CLAUDE_PLUGIN_ROOT}/dev-server/config.schema.json`). Key fields you need:

| Field | What you use it for |
|---|---|
| `designRoot` | Repo-relative root for all canvas/system files. Default `.design`. |
| `rootClass` | Body CSS class (e.g. `dugmate`, `app`). All canvases must keep `<body class="<rootClass>" …>` or whatever the project uses. |
| `themeDefault` | Default `data-theme` value (`dark` or `light`) — a single theme name, never `"both"`. |
| `designSystems[].themes` | Authoritative list of themes that DS's tokens CSS ships (e.g. `["dark","light"]`). This — not `themeDefault` — is what to check for "does this DS require both themes". |
| `tokensCssRel` | Path to design system CSS (relative to `designRoot`). Every canvas links it. |
| `teamAccentDefault` | Optional default `data-team` value (or `null` if the project doesn't use team accents). |
| `handoffTargets[]` | Where `/design:handoff` can migrate canvases. |
| `newCanvasDir` / `newComponentDir` | Where `/design:new` scaffolds new files. |

If `.design/config.json` is missing, the dev server returns sensible defaults; the orchestrator falls back to those — see `/_config` endpoint on the dev server.
