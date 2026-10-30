# Switch the project to maude-v2: review

Five canvases in the project. One is already on maude-v2: `ui/v2/00 Index.tsx`, which needs no change. The other four are in `ui/panels`. Each is on `maude`, and `maude design ds switch --all --to maude-v2 --dry-run` marks every one as switchable. None has pins, and the dry run refused nothing.

Nothing has been applied. Each canvas has a proposal file next to this one.

| Canvas | Proposal | What changes |
|---|---|---|
| `ui/panels/GitPanel.tsx` | `ui-panels-gitpanel.json` | meta `designSystem` → maude-v2 · `@ds` header · removes the two `system/maude/…` CSS imports · `Board` wrapper `.maude` → `.ds` |
| `ui/panels/DiffView.tsx` | `ui-panels-diffview.json` | same four changes |
| `ui/panels/GitHubIdentity.tsx` | `ui-panels-githubidentity.json` | same four changes |
| `ui/panels/RepoBranchSwitcher.tsx` | `ui-panels-repobranchswitcher.json` | meta · header · imports · six artboard wrappers `.maude` → `.ds` · `--presence-agent` → `--x-presence-agent` on one avatar |

## Why these edits
- **Imports (S5):** each canvas hard-imports maude's CSS. Once that import is gone, the shell injects whichever system the `.meta.json` names.
- **Wrapper (S6):** maude-v2 scopes its tokens to `.maude-v2[data-theme]` and `.ds[data-theme]`. `.ds` is the form that doesn't depend on a particular system.
- **Sibling CSS:** the `.css` files use `--canvas-*`, `--accent-tint` and `--accent-muted`. maude-v2 defines all of them as aliases, so they keep working. Renaming them to `--x-canvas-*`, `--selection` and `--accent-soft` is optional, and each proposal's notes list the exact lines.

## Needs a decision
1. **Theme.** All four canvases were drawn dark (`data-theme="dark"`), and the proposals keep them dark. maude-v2 is light-first. Say if you want them flipped to light.
2. **Brand mark (S7).** Each canvas draws maude's spark-on-bubble mark inline. maude-v2 has its own mark (`system/maude-v2/assets/logos/mark.svg`). The proposals leave the old mark in place.
3. **Colour shift.** In maude-v2 the accent is azure, not indigo. Agent presence and the AI become the vermilion spark. The M/A/D badges, the "N unsaved" pill and the checked rows will change colour. Look at the canvases after applying.
4. **Default for new canvases.** `config.json` still has `defaultDesignSystem: "maude"`. Run `maude design ds default maude-v2` if new canvases should start on v2 too.

## Left as they are
- A locked element in `GitPanel.tsx`: the Changes tab (`data-cd-locked`). No edit touches it.
- S3/S4 literal font-weight and px warnings. They are the same under both systems.
- The mock file path `system/maude/preview/components-cards.tsx` in GitPanel's sample data. It's sample copy, not a reference.
