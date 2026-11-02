# Switch to maude-v2 — review

Only one canvas is in this switch. The other canvases in `ui/panels/` stay on `maude`.

| Canvas | From → to | Proposal |
| --- | --- | --- |
| `ui/panels/GitPanel.tsx` | maude → maude-v2 | [`ui-panels-gitpanel.json`](./ui-panels-gitpanel.json) |

## What changes (17 edits + meta)

- **meta.json:** `designSystem` changes to `maude-v2`. `opt_out_scope: palette` stays.
- **System hookup:** removes the pinned `system/maude/…` CSS imports, because the shell injects maude-v2. The wrapper `.maude` becomes `.ds`, still with `data-theme="dark"`. The header tag and comments are updated to match.
- **Component classes:** each maude class becomes its maude-v2 counterpart:

  | maude | maude-v2 |
  | --- | --- |
  | `.panel` | `.card` |
  | `.tree-row` | `.row-item` (the current row also gets `aria-current`) |
  | `.check` | `.checkbox` |
  | `.btn--icon` | `.icon-btn` |
  | `callout--info` | removed |
  | `callout--warn` | `gp-callout-warn` |

  Every `data-cd-*` attribute stays as it is.

## Left alone

- **Changes tab is locked by a person** (`data-cd-id="changes"`). The tab bar stays on maude's `.tabbar/.tab`, and v2 has no style for it. Unlock it (⇧⌘L) to move it to v2's `.seg`.
- **`GitPanel.css`** is a sibling file, so it isn't edited here. After applying, run `maude design ds-check --fix=mechanical --canvas ui/panels/GitPanel.tsx` to rename the old token names. Then add a `.gp-callout-warn` rule with a `bg-3` fill and a warn icon.

## Needs a decision

1. **Docked layout.** v2's rule is that chrome floats and never frames. This canvas is a full-height docked panel with a menubar. Keep it as an Advanced-only layout, or redesign it as a floating island?
2. **Developer words in the default view.** The menubar shows "maude / main", the rows show file paths, and one path points at the old system's folder.
3. **Colour roles.** The avatars use azure and status-info colours. v2 wants `--presence-*` there. The M/A/D/U badges could become v2 `.chip`.
4. **Theme and logo.** Dark is kept, though v2's default is light. The local logo mark should be replaced with the v2 logo asset.
5. **Callout look.** The v2 callout has no left accent bar, so the Get-latest nudge and the conflict callout will look flatter. Check them in a screenshot after applying.
