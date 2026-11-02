# Switch ui/panels to maude-v2 — review

Four canvases move from **maude** to **maude-v2**. Nothing has been applied yet. Each canvas has its own proposal file next to this one, and you apply them. `maude design ds switch ui/panels --to maude-v2 --dry-run` ticks all four: none of them is pinned, and both systems are at schema level 10.

| Canvas | Proposal | Edits | Meta |
|---|---|---|---|
| `ui/panels/GitPanel.tsx` | `ui-panels-gitpanel.json` | imports · `@ds` header | `designSystem: maude-v2` |
| `ui/panels/DiffView.tsx` | `ui-panels-diffview.json` | imports · `@ds` header | `designSystem: maude-v2` |
| `ui/panels/GitHubIdentity.tsx` | `ui-panels-githubidentity.json` | imports · `@ds` header | `designSystem: maude-v2` |
| `ui/panels/RepoBranchSwitcher.tsx` | `ui-panels-repobranchswitcher.json` | imports · `@ds` header · MK avatar hue | `designSystem: maude-v2` |

## What changes

- **Tokens.** Each canvas imports `system/maude-v2/colors_and_type.css` in place of the maude one. maude-v2 defines every token name that maude does, so none of the `var(--…)` uses needs a rename. The values do change: the accent goes from indigo to azure, and surfaces, status hues and type sizes shift to the v2 ladder.
- **Components.** `system/maude-v2/preview/_components.css` loads last, so `.btn`, `.btn--primary`, `.btn--ghost`, `.input`, `.textarea`, `.seg`, `.switch`, `.chip` and `.kbd` take the v2 anatomy.
- **Header.** `@ds maude` becomes `@ds maude-v2`.
- **RepoBranchSwitcher only.** The "MK" presence avatar moves from `--presence-agent` to `--presence-away`. In v2, `--presence-agent` is the spark, the colour that marks only the AI.

## What needs a decision

1. **The bridge sheet.** maude-v2 has no `.panel`, `.tree-row`, `.tabbar`/`.tab`, `.callout*`, `.btn--icon` or `.btn--danger`, and all four canvases use some of them. The proposal keeps `system/maude/preview/_components.css` imported, ahead of the v2 sheet, so those classes still render and take v2 tokens. Nothing breaks, but the canvases still depend on the old system's folder.
   **The other way:** move to v2 anatomy. That means `.panel` → `.island`, `.tree-row` → `.row-item` and `.btn--icon` → `.icon-btn`. The callouts and the danger button need new v2 patterns, because v2 has none yet. That edits a lot of markup per canvas and is better done as a `/design:edit` pass.
2. **Docked layout.** GitPanel, GitHubIdentity and RepoBranchSwitcher draw the studio shell with a menubar and a full-height sidebar. maude-v2's first hard rule is "Chrome floats; it never frames." A token switch can't fix that, so these canvases will show v2 colours on a v1 layout until someone redesigns them.
3. **Theme.** All four force `data-theme="dark"`. maude-v2 is light-first, and its dark theme is an equal option. The proposal keeps dark. Changing it is a one-word edit on each wrapper.
4. **Brand mark.** GitPanel and GitHubIdentity draw an inline mark on a `--bg-3` tile. maude-v2's logo uses an `--accent` tile with an `--accent-fg` star, so the mark could come from `system/maude-v2/assets/logos/mark.svg` instead.

## Left alone

- The sibling `.css` files (`GitPanel.css`, `DiffView.css`, `GitHubIdentity.css`, `RepoBranchSwitcher.css`) use only `var(--…)` tokens that exist in v2. Only their header comments still say "system/maude".
- The `.registry.json` handoff files and the `status: handed-off` / `handoffCommit` fields in the metas. They record what was handed off.
- GitPanel line 170 names `system/maude/preview/components-cards.tsx`. That is mock file-list content, not an import.
