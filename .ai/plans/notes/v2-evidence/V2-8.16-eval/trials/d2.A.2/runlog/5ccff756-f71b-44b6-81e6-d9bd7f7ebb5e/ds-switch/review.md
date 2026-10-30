# Switch to maude-v2: review

One canvas, maude → maude-v2. Nothing has been applied yet. The canvas and its `.meta.json` are unchanged until you apply this proposal.

## ui/panels/GitPanel.tsx (`ui-panels-gitpanel.json`)

**Changes (17 edits + meta `designSystem: maude-v2`)**
- The header `@ds` and the two CSS imports now point at `system/maude-v2/`.
- Board wrapper: `.maude` dark → `.maude-v2 ds`, light (maude-v2's default).
- Shared classes mapped to maude-v2:
  - `.panel` → `.island`
  - `.btn--icon` → `.icon-btn`
  - `.check` → `.checkbox`
  - `.tree-row` → `.row-item` (7 rows; the selected row also gets `aria-current`)
- Callouts: the info nudge becomes a plain callout. The "Publish didn't go through" warning gets maude-v2's heads-up tone (`--bg-3` background).

**Needs a decision**
1. **The locked Changes tab.** maude-v2 has no tab bar class, so Changes/History will show as plain buttons. The Changes tab is locked, so both tabs are left alone. To move them to `.seg`, unlock it (⇧⌘L) and ask again.
2. **Theme.** Light is proposed. To keep it dark, use `data-theme="dark"` in the Board edit and drop the header edit.
3. **Brand mark.** The canvas draws maude's spark-on-bubble. maude-v2 has its own `assets/logos/mark.svg` and `wordmark.svg`.

**Follow-ups in GitPanel.css (not in this proposal; every token there exists in maude-v2)**
- **Contrast in light:** the M/A/D badges use `--bg-0` text on status fills. Switch to `--status-*-fg`. The M badge fails contrast otherwise.
- maude-v2 uses mono only in Advanced and code. About ten `gp-` classes use `--font-mono`.
- The brand spark uses `--accent` (azure). maude-v2 uses `--spark` for it.
- Moving the docked chrome to floating islands would be a redesign, not part of a switch.
