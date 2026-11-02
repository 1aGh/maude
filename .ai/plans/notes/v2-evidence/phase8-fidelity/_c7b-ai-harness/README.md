# Round 7b (p8-c7-ai2) re-shoot harness: 03 AI Chat

Layered on `../_c7-ai-harness/` (and its layers, see that README); copy these files over `<repo>/.scr/impl/` and repoint the worktree path (`.scr/repoint.mjs`).

Run order: `THEMES=dark,light` for `s03a s03e s03d s03c s03n s03g s03h s03i s03k` (`chain7b.sh` has the first eight; `s03k` last), then `MAP=pairs-map-c7.json node pairs.mjs` (this dir's `pairs-map-c7b.json` is that map with the ai-chat-list crop moved), then `node c7b-index.mjs <tip>`.

Changes against round 7:
- `s03h.mjs` (new): seeds `_chat/` (19 chats on Combine-kampan / Uniformy-2027 / video-hype, titles + canvas + artboards in the meta sidecar, file mtimes spread over weeks) and the long "Combine recap" chat (first ask yesterday 18:20); shoots `ai-chat-list` and `ai-long` (the seeded chat opened, scrolled to the top).
- `s03i.mjs` (new): `ai-needs-hidden` with the question on Uniformy-2027 and the person on Combine-kampan, panel hidden.
- `s03k.mjs` (new): `ai-question` = an element of the A4 poster picked, cmd-slash, the ask, nothing left picked. The step moved out of `s03g` (its earlier hang runs queued the ask).
- `s03a.mjs`: ai-two-artboards opens the run list from the header count.
- `s03g.mjs`: the question section is gone.
