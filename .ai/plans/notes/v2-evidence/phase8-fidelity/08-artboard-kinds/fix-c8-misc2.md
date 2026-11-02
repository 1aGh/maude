# 08 Artboard Kinds — round 8 (p8-c8-misc2)

## Done

- **ak-web-widths** — the Height note on the tallest of several widths of one page: "2185 now — the longest of the three." `webLongestOf` (dom-selection.ts) reads, at selection time, the web pages of the same section at distinct widths and stamps `data-dc-web-longest`; `artboardFacts.longestOf` → `webHeightNote(h, n)`. Alone / fixed / same-width boards keep "N now — grows as you add."
- **ak-mixed-fit** — the Layers list names only the artboards of the pressed kind (the canvas still dims the rest), the tree of an artboard outside the kind waits; "N other artboards are dimmed. Show all" is the FOOT of the panel (`LayersKindFoot`, `.ly2` fills the body, `.kf-foot` margin-top auto).
- **ak-safe-zones / ak-mixed-filter** — harness (the Safe zones control is a select-shaped button + checked menu, not a native `<select>`; the kind filter is one shared store, so pressing Print twice toggled it off). Both re-shot with the state on screen.
- The Safe zones menu was 252 px wide inside a ~246 px card and cut off on the left: now 224 px.

## Open

- ak-advanced: Grid tracks · Edit tracks… / Layout · Convert to absolute… stay drawn disabled (decided, no op).
- The Safe zones menu is cut off at the card's foot when the card has little under the row (its footnote and the lower platforms hide); a side state.
