# Switch the project to maude-v2: review

Five canvases in the project. One is already on maude-v2 (`ui/v2/00 Index.tsx`) and isn't touched. The other four, all in `ui/panels/`, move from **maude** to **maude-v2**. `maude design ds switch --all --to maude-v2 --dry-run` marks all four as switchable, with nothing pinning them and nothing refused. Both systems are at schema level 10.

Nothing has changed yet. Each canvas below has a proposal file in this folder. Apply them, or run `maude design ds switch --all --to maude-v2` (one step in Version history, so ⌘Z undoes it).

## The same changes on every canvas

- `.meta.json`: `designSystem` goes from `maude` to `maude-v2`.
- The two imports `system/maude/colors_and_type.css` and `system/maude/preview/_components.css` point to `system/maude-v2/…` instead.
- **The wrapper `className="maude"` becomes `className="ds"`.** This change is required: maude-v2 sets its tokens on `.maude-v2` / `.ds`, so a `.maude` wrapper would render every artboard with no tokens. `.ds` is the neutral wrapper ds-check asks for (S6).
- Every token name the canvases use exists in maude-v2, including the old aliases (`--canvas-*`, `--accent-muted`, `--accent-tint`).

## Per canvas

| Canvas | Artboards | Edits | Proposal |
|---|---|---|---|
| ui/panels/GitPanel.tsx | 5 | 2 imports · 1 wrapper · 1 logo comment | `ui-panels-gitpanel.json` |
| ui/panels/DiffView.tsx | 3 | 2 imports · 1 wrapper | `ui-panels-diffview.json` |
| ui/panels/GitHubIdentity.tsx | 5 | 2 imports · 1 wrapper · 1 logo comment | `ui-panels-githubidentity.json` |
| ui/panels/RepoBranchSwitcher.tsx | 6 | 2 imports · 6 wrappers (one per artboard) | `ui-panels-repobranchswitcher.json` |

## What will look different

- **Accent:** indigo (hue 268) becomes azure (hue 238). `accent-soft` and `selection` become translucent tints instead of solid colours. Buttons, selected rows, chips, focus rings and the RepoBranchSwitcher fold-back CTA all change colour.
- All artboards stay on `data-theme="dark"`, so the light-first order in maude-v2 changes nothing here.

## Needs a decision

1. **The inline Maude mark** in GitPanel, GitHubIdentity and DiffView is copied from maude's logo. If maude-v2's logo specimen is a different mark, redraw it from `system/maude-v2/preview/logo`.
2. **All four canvases are handed off** (`status: handed-off`). After the switch, the built code and the canvases use different systems. Decide whether to hand them off again.
3. **The old `maude` system** will have no canvases left. Keeping it or deleting it is your call; this switch doesn't change it.

## Left as it is

- GitPanel line 170: the mock file row `system/maude/preview/components-cards.tsx`. It is sample data, not an import.
- Comments in the four `.css` files that mention `system/maude/…`. They have no effect.
- The literal sizes, weights and spacing ds-check reports (S3/S4). They don't block the switch.
