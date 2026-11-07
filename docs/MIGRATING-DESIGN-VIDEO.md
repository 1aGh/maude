# Migrating to the `design-video` plugin

Video moved out of the `design` plugin into its own opt-in plugin, `design-video` (#156 §4, [DDR-249](../.ai/archive/decisions/DDR-249-design-video-plugin-split.md)). A terminal Claude Code or Codex session loads every command, skill and agent description a plugin lists, so a session that never touches video no longer pays for the reel, footage and Lottie surface. Public page: [maude.sh/docs/design-video](https://maude.sh/docs/design-video).

## Desktop app

Nothing to do. The app's AI chat injects `design` and `design-video` together (`apps/studio/acp/plugin-bootstrap.ts`, staged by `apps/desktop/scripts/stage-resources.mjs`).

## Terminal

```
/plugin marketplace update maude
/plugin install design-video@maude
/reload-plugins
```

Keep `design@maude` installed: `design-video` needs it (its agents run under the design plugin's hooks). Codex: `codex plugin add design-video@maude`.

## Renames

| Old | New |
| --- | --- |
| `/design:reel` | `/design-video:reel` |
| `/design:video-analyze` | `/design-video:video-analyze` |
| `/design:to-lottie` | `/design-video:to-lottie` |
| `Skill design:video-comp` | `Skill design-video:video-comp` |
| `Skill design:footage-director` | `Skill design-video:footage-director` |
| `Skill design:footage-keyframes` | `Skill design-video:footage-keyframes` |
| video part of `design:ai-generation` | `Skill design-video:video-generation` |
| `subagent_type: design:footage-analyst` | `subagent_type: design-video:footage-analyst` |
| `subagent_type: design:footage-director` | `subagent_type: design-video:footage-director` |

Unchanged: `/design:generate` (images and sound; `--modality video` loads `design-video:video-generation`), `/design:export`, `/design:to-rn`, and every `maude design` verb. The old names do not resolve any more; there is no alias, because Claude Code namespaces a command by the plugin that ships it.
