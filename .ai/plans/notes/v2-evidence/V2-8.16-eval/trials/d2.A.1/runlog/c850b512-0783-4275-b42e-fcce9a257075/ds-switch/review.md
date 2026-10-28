# Switch to maude-v2 — review

One canvas, as asked. Nothing has been applied yet: the canvas and its `.meta.json` are unchanged until you apply this review.

| Canvas | From → to | Edits | Proposal |
|---|---|---|---|
| `ui/panels/GitPanel.tsx` | maude → maude-v2 | 15 | [`ui-panels-gitpanel.json`](./ui-panels-gitpanel.json) |

## What changes

- **Meta:** `designSystem` becomes `maude-v2`. The `@ds` header tag and comments follow.
- **Styles:** the two CSS imports point at `system/maude-v2/` (tokens + `_components.css`).
- **Wrapper:** `Board` uses `className="maude-v2 ds"`. maude-v2's tokens hang off `.maude-v2[data-theme]` and its components off `.ds`.
- **Components, renamed to maude-v2's classes:**
  - `.check` → `.checkbox`
  - `.btn--icon` → `.icon-btn`
  - `.panel` → `.island` (canvas peek)
  - `.tree-row` → `.row-item` (7 file-tree rows; the selected row also gets `aria-current="true"`, which is how `.row-item` shows selection)
- **Tokens:** no changes needed. Every variable the canvas and `GitPanel.css` use exists in maude-v2.

All 5 artboards are affected: changes, save-version, publish, empty, conflict.

## Needs a decision

1. **Locked Changes tab.** The "Changes" tab is locked, so it keeps `.tab`. maude-v2 has no tab-bar rule (its tabs are the `.seg` segmented control), so after the switch Changes/History show as plain buttons. Unlock it (⇧⌘L) if you want them moved to `.seg`.
2. **Callout tone.** maude-v2's callout has no info/warn variants and no left bar. Because of this, the Get-latest nudge (C) and "Publish didn't go through" (E) lose their colour cue. Keep them neutral, or draw the tone in `GitPanel.css`.
3. **Theme.** The canvas stays dark, per its brief. maude-v2 is light-first, so you may want `data-theme="light"`.
4. **Mark.** maude-v2's logo is the azure tile with the light star from `assets/logos/mark.svg`. The canvas still draws maude's grey bubble. I left it unchanged.

## Left alone

- `GitPanel.css`. Its rules still work under maude-v2. Its header comment still names `system/maude`. Optional alias renames that ds-check suggests (`--accent-muted` → `--accent-soft`, `--accent-tint` → `--selection`, `--canvas-*` → `--x-canvas-*`) don't block the switch.
- Every other canvas, including the sibling panels in `ui/panels/`.
