# Switch ui/panels to maude-v2 — review

4 canvases, all on `maude` today: maude → maude-v2. Nothing is applied yet. Each canvas has a proposal next to this file. Applying one sets `designSystem: "maude-v2"` in its `.meta.json` and makes the listed edits.

| Canvas | Proposal | Edits | Needs a decision |
| --- | --- | --- | --- |
| ui/panels/GitPanel.tsx | ui-panels-gitpanel.json | 13 | locked Changes tab, callout tones, words |
| ui/panels/GitHubIdentity.tsx | ui-panels-githubidentity.json | 11 | Sign out button, callout tones |
| ui/panels/RepoBranchSwitcher.tsx | ui-panels-repobranchswitcher.json | 15 | draft colour (AI coral), two solid azure buttons |
| ui/panels/DiffView.tsx | ui-panels-diffview.json | 10 | frosted sheet, callout tone, words |

## What changes on every canvas

- Imports go from `system/maude/…` to `system/maude-v2/…` (tokens + shared components).
- The artboard wrapper `className="maude"` becomes `className="maude-v2 ds"`. maude-v2 scopes its tokens to `.maude-v2` / `.ds`, and its callout rules need `.ds`.
- Header `@ds maude` becomes `@ds maude-v2`.
- Tokens: every `var(--…)` the canvases and their sibling CSS use exists in maude-v2. No token renames needed.
- Class renames where maude-v2 has a different component:
  - `.panel` → `.island`
  - `.tree-row` → `.row-item` (the selected row also gets `aria-current="true"`, which is how `.row-item` marks it)
  - `.btn--icon` → `.icon-btn`
  - `.btn--danger` → `.btn--ghost` (the fallback components.json documents)

## How it will look different

From the tokens alone: the accent goes indigo → azure, corners get rounder (md 7 → 10 px, lg 10 → 14 px), and the fonts go Inter / JetBrains Mono → system UI / SF Mono. `.island` is frosted glass where `.panel` was solid.

## Needs a decision

1. **Locked element, GitPanel.** The "Changes" tab is locked by a person, so the tab bar is not converted. maude-v2 has no `.tab` (its tabs are `.seg`). Unlock it (⇧⌘L) to convert both tabs; until then they're styled only by GitPanel.css.
2. **Callout tones, all four canvases.** maude-v2's `.callout` has no info/warn/error/success variants, so those callouts render as quiet neutral boxes. This matters most on GitHubIdentity's "states" artboard, which exists to show four tones. Accept quiet, or add local tones in each canvas's CSS.
3. **Sign out, GitHubIdentity.** With the fallback, "Stay signed in" and "Sign out" are two identical ghost buttons. Suggest making Sign out `btn--primary` (the contract says the primary repeats the title's verb).
4. **Draft colour, RepoBranchSwitcher.** "On a draft" uses `--presence-agent`. In maude-v2 that's coral and reserved for AI, so it would read as an AI marker. Suggest `--status-warn`.
5. **Theme.** All artboards stay `data-theme="dark"`. maude-v2 is light-first. Say if they should go light.
6. **Words.** The maude-v2 contract says "Share" (not Publish), "Version history" (not History), and names collaborators Tereza and Jonas (not Anna). The panel briefs call their vocabulary load-bearing, so no copy is changed.
7. **Brand mark.** The canvases draw the v1 mark inline; maude-v2's mark lives in `system/maude-v2/preview/logo`. Not redrawn.

## Not touched

- Sibling CSS files (GitPanel.css, GitHubIdentity.css, RepoBranchSwitcher.css, DiffView.css): they only use tokens maude-v2 has. Their header comments still say "maude".
- `.registry.json` files: they record the handed-off build and are left as is.
