# Chat: "Implement N comments", empty-state CTAs, per-chat Rename/Archive/Delete/Copy transcript, ModeBanner, rate-limit banner, ErrorCard, Permission/Elicitation prompts, OS notifications — home `G0-D/D9` (V2-8.13)

Gate 0 §D "every v1 feature keeps a home" — `.ai/plans/feature-maude-v2-redesign.md` G0-D table, row D9.

## Nothing-deleted map (`apps/studio/client/v2/nothing-deleted.json`)
- row `D9` · action `ai.chat` · testid `chat-overflow-menu`
- where: AI chat (⇧⌘A) › the title ⌄ opens the chat list; a row's ⋯ menu: Open, Rename…, Copy transcript, Archive, Move to trash (Delete is Move to trash — Trash keeps it until cleared out); the suggest-only banner's Allow changes sits at the top of the AI chat; the empty state’s buttons and “Implement N comments” sit in the feed (S5.12)
- v1 entry points mapped to this row: 22
- reachability.json (headless boot per shell, probe pass 2026-10-25T23:27:36.802Z): reachable — per shell desktop: ok: ai-chat (ai-chat-header) · browser: n/a · cloud-owner: n/a · cloud-member: n/a · cloud-viewer: n/a · viewer: n/a · embed: n/a
- `node scripts/check-v2-nothing-deleted.mjs` on this tip: 100 % (all 144 rows, 1569 entry points, 453 kept actions/hooks)

## Tests that pin it (green on the tip)

