## Codebase blockers (file as tickets to unblock automation)

These would let scenario runs become much simpler — replace coordinate fallbacks and DOM-class hooks with proper selectors:

1. **Mobile tab-bar `testID`** (web + native) — e.g. `tab-home`, `tab-subjects`, `tab-chat`, `tab-community`. Removes the `button.flex-1[1]` and `(200, 813)` / `(384, 1180)` hacks.
2. **List-item `testID`** — e.g. `subject-{id}`, `chapter-{id}`. Removes regex grep over snapshot text (which breaks on i18n + counter prefixes).
3. **Action button `testID`** — e.g. `flashcard-mark-hard`, `-practice`, `-known`. Removes emoji-prefix selectors.
