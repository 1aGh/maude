# Phase 8 C0 — the shell's tokens are maude-v2 (before | after)

Branch p8-c0-tokens from feat/maude-v2 238b39701. Release client (`build.ts --release`) of each tree, Playwright Chromium
1600×1000 with a `window.__TAURI__` stub, throwaway HOME/XDG, `stubClaudeEnv`, fixture `apps/desktop/e2e/fixtures/project`
(Home: project-less server + a seeded index; strip: `strip.html` from disk with a stubbed `tabs_state`). Each pair is
`<state>-<theme>.jpg`, BEFORE left, AFTER right.

Computed on the shell root (`.maude[data-theme]`; Home `.maude-v2`) and on the first `[role=dialog]`:

| | before (v1 ladder) | after (maude-v2) | DS |
|---|---|---|---|
| `--accent` dark / light | `oklch(68% .18 268)` / `oklch(52% .195 268)` | `oklch(54% .165 238)` / `oklch(53% .175 238)` | azure 238 |
| `--radius-sm/md/lg/xl` | 5 / 7 / 10 / 14 px | 6 / 10 / 14 / 20 px | 6 / 10 / 14 / 20 |
| `--space-1..4` | 2 / 4 / 8 / 12 px | 4 / 8 / 12 / 16 px | 4 / 8 / 12 / 16 |
| font-family | `Inter, system-ui …` | `system-ui, -apple-system …` | system-ui first |
| dark `--bg-1` / `--bg-2` | 0.198 / 0.232 L | 0.245 / 0.275 L | 0.245 / 0.275 |
| Share sheet (dark) | bg 0.232, radius 14 | bg 0.275 (`--bg-2`), radius 20 | sheet = bg-2, radius-xl |
| Export · Settings sheet (dark) | bg 0.198, radius 10 | bg 0.245 (`--bg-1`), radius 14 | sheet = bg-2 (component still says `--bg-1`) |
| tab strip accent | `#4a7dff` / `#2f6bff` | `--accent` / `--focus-ring` from maude-v2 | — |

Home already rendered under `.maude-v2` before C0; its pair is unchanged by design.
