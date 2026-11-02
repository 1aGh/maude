# Switch ui/panels to maude-v2 — review

4 canvases, all on `maude` now, all switchable (`maude design ds switch ui/panels --to maude-v2 --dry-run`: every one ticked, no pins, no refusal; both systems are at schema level 10).
Nothing is applied yet. Each canvas has a proposal next to this file.

| Canvas | Proposal | Edits | Needs a decision |
| --- | --- | --- | --- |
| ui/panels/GitPanel.tsx | `ui-panels-gitpanel.json` | 5 | Tabs (one is locked) · callout tones · panel / tree-row |
| ui/panels/DiffView.tsx | `ui-panels-diffview.json` | 4 (+3 Close buttons by hand) | callout tone · panel |
| ui/panels/GitHubIdentity.tsx | `ui-panels-githubidentity.json` | 5 | Sign out danger button · four callout tones · panel / tree-row |
| ui/panels/RepoBranchSwitcher.tsx | `ui-panels-repobranchswitcher.json` | 10 | panel / tree-row |

Every `.meta.json` gets `"designSystem": "maude-v2"`.

## What changes on every canvas

- The two imports move from `system/maude/` to `system/maude-v2/`.
- The artboard wrapper goes from `className="maude"` to `className="maude-v2 ds"`. maude-v2 only sets its tokens under `.maude-v2[data-theme]`, so the old `.maude` scope would match nothing. Its core components (callout, card, dialog, checkbox) only apply under `.ds`.
- The `@ds` header (and RepoBranchSwitcher's section title) names maude-v2.
- Tokens: every token the four canvases and their CSS use exists in maude-v2 under the same name. No token renames.
- Line heights change from fixed px to ratios (base 20px → 1.45), so text runs slightly tighter.
- Theme: maude-v2 starts light at `:root`, but every artboard sets `data-theme="dark"`, so all four canvases stay dark.

## Needs a decision

1. **Callout tones.** maude-v2's Callout has no info / success / warn / error variants. GitPanel (info, warn), DiffView (info) and GitHubIdentity (all four on the states artboard) would lose their tint, and GitHubIdentity's four edge states would look the same. Options: add tones to each canvas's own CSS, or add variants to maude-v2.
2. **Sign out button (GitHubIdentity).** maude-v2 has no danger button. The proposal uses the system's own fallback (ghost), which drops the red. Options: accept it, keep a local red style, or add a danger variant to the system.
3. **GitPanel tabs.** The Changes tab is **locked** (`data-cd-locked`) and uses `.tab`, which maude-v2 doesn't have (its tabs are the `.seg` segmented control). It is left exactly as it is, and so is the History tab beside it so the pair stays matched. To move them to `.seg`, unlock Changes first (⇧⌘L).
4. **Panel and list rows.** `.panel` (6 uses) and `.tree-row` (17 uses) have no maude-v2 rule. The nearest matches are `.island` and `.row-item`. The canvases' own `gp-` / `gi-` / `dv-` / `rb-` classes keep them visible, so they aren't renamed: adopting the v2 look is a choice.

## By hand

- DiffView's three Close buttons use `btn btn--icon dv-close`. The text is identical three times, so it can't be a single-match edit. Change each to `icon-btn dv-close`.

## Left alone

- Comments that still mention `system/maude` (each sibling `.css` header, the TSX docblocks).
- `*.registry.json`: all four canvases are handed off, so their handoff bundles describe the maude build until the handoff is redone.
