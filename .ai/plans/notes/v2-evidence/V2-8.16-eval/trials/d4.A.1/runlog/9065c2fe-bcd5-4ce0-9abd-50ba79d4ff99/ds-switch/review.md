# Switch to maude-v2 — review

Four canvases use `maude`. `ui/v2/00 Index.tsx` already uses maude-v2 and isn't touched. Nothing below has been applied yet; each canvas switches when you apply its proposal.

| Canvas | Proposal | Changes |
|---|---|---|
| `ui/panels/GitPanel.tsx` | `ui-panels-gitpanel.json` | 2 imports, 1 theme wrapper, meta → maude-v2 |
| `ui/panels/DiffView.tsx` | `ui-panels-diffview.json` | 2 imports, 1 theme wrapper, meta → maude-v2 |
| `ui/panels/GitHubIdentity.tsx` | `ui-panels-githubidentity.json` | 2 imports, 1 theme wrapper, meta → maude-v2 |
| `ui/panels/RepoBranchSwitcher.tsx` | `ui-panels-repobranchswitcher.json` | 2 imports, 6 theme wrappers (one per artboard), meta → maude-v2 |

## What carries over cleanly

All 59 tokens these canvases use exist in maude-v2 under the same names, so colours, spacing, type, radii and motion switch without renaming. `--dv-split` in DiffView is the canvas's own variable.

## What needs a decision

1. **Missing components.** maude-v2's shared styles have no `.callout` (and its `--info/--warn/--error/--success` forms), `.panel`, `.tree-row`, `.tab`/`.tabbar`, `.btn--icon` or `.btn--danger`, and nothing else in the project defines them. These elements will render unstyled after the switch:
   - GitPanel: the panel, the file tree, the tabs, the Get-latest and Publish-rejected callouts, icon buttons
   - DiffView: the compare panels, the summary callout, icon buttons
   - GitHubIdentity: all of artboard E (four callouts), the Sign out danger button, the sidebar tree
   - RepoBranchSwitcher: the sidebar panel and the file tree

   You can restyle them with maude-v2 parts (`.island`, `.row-item`, `.icon-btn`, `.chip`, the `--status-*-soft` / `--status-*-text` tokens) or add the missing classes to maude-v2. Either one is a follow-up edit after the switch.
2. **Theme.** The proposals move each canvas from dark to light, maude-v2's default. If you'd rather keep them dark, change `data-theme="light"` to `"dark"` in the wrapper edits. maude-v2 supports both.
3. **Mono type.** maude-v2 keeps mono for Advanced sections only. These canvases use `--font-mono` for file paths, badges and the GitHub device code. It still renders, but it goes against the system.
4. **Draft amber (RepoBranchSwitcher).** In maude-v2, azure is for actions and selection and vermilion is reserved for the AI. Check that the amber draft state still reads right.
5. **DiffView is handed off.** Switching changes what was handed off.

Comments that still name `system/maude` (canvas headers, each canvas's `.css`) aren't covered by the proposals. They don't affect how anything renders.
