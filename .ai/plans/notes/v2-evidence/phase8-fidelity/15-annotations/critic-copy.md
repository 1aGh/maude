# copy-critic — 15 Annotations (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/15 Annotations.tsx` · lens: every visible string vs the board and CONTRACT §3 words + §4 voice (CONTRACT wins over a stale board; the owning board wins in board conflicts — the Comments empty state is 05's, the Figma import sheet 12's, the AI connect sheet 03's)_

**Method.** Spec copy read from the board source (lines 318–1786, including the `Gallery` helper). Impl copy read from the full-size impl frames (`.scr/impl/15-annotations/*.png`, all light frames OCR'd and the key ones viewed at full size), then owners grepped. **Dark:** an OCR diff of every dark frame against its light twin showed only OCR noise, and `an-stk-gallery-dark` was viewed. Every row is **L·D**; nothing differs in dark only.

**Fixture (not findings):** stickies were seeded through `maude design annotate`, so they are AI-authored (plain paper, spark, no "Tereza · 2 h ago" author line). There are no collaborators, no vote history and no Czech content. Specimen panels (rule lists, timing notes, the comment-vs-annotation table) are documentation, not product strings.

**CONTRACT-wins calls (not findings):** the board's gallery lists Project status first; the impl follows CONTRACT §6 [C13] (FigJam Doodle · Life Style · Opposing Thoughts · Project status). The board's ⌘K "Show resolved stickies" is CONTRACT §6 [C29] "Hide resolved stickies" in the impl (actions/defs/annotation.ts:109).

## Per artboard (all rows L·D)

| id | difference | spec (board) | impl | owner file:line | sev |
| --- | --- | --- | --- | --- | --- |
| an-enter | "Previewing Homepage · esc to edit", colour row "+5" | | match | client/v2/preview/preview-bar.jsx:77 | ok |
| an-enter | toolbar has no key letters (the board's rule specimen shows H N C M A R T E S); tooltips not checked | key caps under the tools | icons only | toolbars/ (annotate toolbar) | warning |
| an-place | quiet stickies on and between artboards; author lines are fixture | | | | **verified** |
| an-sticky | "Medium", "Turn into a comment", lock, trash; "Resolve" added (CONTRACT §6 [C29]) | | match | actions/defs/annotation.ts:74 | **verified** |
| an-today | specimen sheet; text-size menu ("Small 12 · Medium 16 · Large 24 · Extra large 36 · Huge 64"), Group bar and cards not drawn in the frame | | | | warning |
| an-arrow-bind | the bound end doesn't name its target (proposed) | chip "Button · See the work" | — | annotations/ (arrow binding) | blocker |
| an-follow | specimen; "X 295 · Y 200" pill matches the pattern; route tag "Let go — the shortest clean path…" is documentation | | | | — |
| an-rebind | unreachable (needs an AI rewrite) | "Pointed at the old "See the work" — replaced by AI · Point to…"; "Button · See our work · rewritten by AI" | — | annotations/ui/arrow-cards.tsx:13,282 | blocker |
| an-arrow-kinds | "Straight · Curved · Elbow" matches; heads menu (None · Line · Triangle · Triangle (outline) · Circle · Diamond) not opened | | | | — |
| an-marker | "Marker · Highlighter · Eraser", five inks "+4" match | | | | ok |
| an-marker | ownership tag missing (proposed) | "On Post 1:1 · moves with it" | — | annotations/ | warning |
| an-section | a " 2" suffix on a person's section name (numbering is only for Untitled canvas, §3) | "Zpětná vazba Tereza" | "Tereza's feedback 2" | annotations/ (wrap-section naming) | warning |
| an-section | section toolbar and folded sections not seen (not selected; Fold is proposed) | "Fold · ✦ Ask AI about it"; "Nápady na story · 6 stickies · 2 people" | — | annotations/ | warning |
| an-templates | S doesn't open the templates popover | "Templates · or drag on the canvas for a blank one", Kanban "To do · Doing · Done" … "Blank section · Draw it, name it", prompt field | — (S arms Section only) | client/v2/annotations/templates-panel.jsx:178 (not opened by S) | blocker |
| an-plan | column titles faint; the first one collides with the "Tablet" label; cards empty (template seeds `cards('')`, no AI fill) | "Nápady 4 · Rozpracované 3 · Hotovo 2" with card words | "… 2 · Doing 1 · Done 1", empty cards | annotations/templates.ts:46-56 | warning |
| an-plan | channel legend, stamp counts, arrows to the artboards missing | "Instagram · Tisk · Web · Video" | — | annotations/ | warning |
| an-stk-gallery | "Stickers E", "Search stickers…", "Stamps vote · one each · they count", "<pack> N · by <author>", "+N", credits line — all match; Recent hidden because nothing was placed yet | | | client/v2/annotations/stickers-gallery.jsx:219 | **verified** |
| an-stk-search | chips "All · 6 / done · 4 / almost-done · 2 / finished · 2 / complete · 2" and "No "done" in FigJam Doodle, Life Style or Opposing Thoughts · no stamp either" match (keyword captions are manifest data) | | | | ok |
| an-stk-search | the no-match state wasn't exercised | "No stickers match "hotovo" · Sticker words are English — try done · finished · approved" | — | client/v2/annotations/stickers-gallery.jsx | warning |
| an-stk-drop | "Replace… · Flip · Duplicate", "160 × 160" match | | | | ok |
| an-stk-drop | a broken sticker picture has no name or alt fallback (also in an-stamps, an-ai-stickers) | the sticker art | broken-image glyph, no words | annotations/ (sticker element) | warning |
| an-stamps | stamp row and count popover missing (proposed) | "Stamps" row; "5 stamps on Směr B" · "You · Yes" … | "+" add-vote mark only | annotations/ui/vote-dots.tsx | blocker |
| an-stamps | vote bar count has no denominator | "4 of 5 done" | "0 done" | client/v2/annotations/vote-store.js:83 | warning |
| an-stamps | "Vote · 1 artboard · 3 left of your 3 · 1:59 · End vote" | "Vote · 3 directions · 0 left of your 3 · 1:42 · End vote" | pattern matches | vote-store.js:72-86 | ok |
| an-vote | sheet: "Start a vote" → "Start vote" (same verb, §4), "Title · Optional", "Votes each", "Time 2 min", secrecy line "Anyone who can open this project's files can see the votes." (CONTRACT §7 [A18]), Cancel | | match | client/v2/annotations/vote-sheet.jsx; routes/votes.ts:52 | ok |
| an-vote | the ended-vote section isn't reached in this frame | "Hlasování · Helmy · 1 Oct" · "Last week's vote · 5 people · 3 votes each · 2 min" | — | client/v2/annotations/ | warning |
| an-vs | Comments panel "Open · Mine · Resolved · All" (CONTRACT §6) and the 05 empty state match | | | client/v2/empty/empty-copy.js:108 | ok |
| an-vs | leftover undo toast written as a command, not a status (§4); history rows elsewhere are past tense ("Placed a component") | — | "Undo: move 1 artboard" (also an-ai-apply, an-visibility) | client/use-undo-stack.tsx:294 | warning |
| an-convert | converted thread + context menu not driven | "From Jonas's sticky · turned into a comment by You · Undo"; menu "Turn into a comment · Resolve · Lock ⇧⌘L · … · Ask AI about this sticky ⌘/ · Move to trash ⌫" | toolbar button only | actions/defs/annotation.ts:74; bridge/dgn-protocol.ts:139 | warning |
| an-ai-read | unreachable (AI signed out) | scope "3 stickies"; "All three ask for a bigger hero picture…"; "Make these changes · Not now" | Edit inspector "div · Frame" | client/v2/ai/ | blocker |
| an-ai-apply | unreachable (AI) | "Done — the hero picture fills the right half of Desktop. The 3 stickies that asked for it are resolved…"; chips; "Made by AI" | resolved sticky only | client/v2/ai/ | blocker |
| an-ai-stickers | AI status stickers render broken, with no spark/AI mark; the reply is absent | Done! / Flagged + "Done — the hero fills the right half… "Warmer sun?" is flagged — that one is your call." | broken tile | annotations/ (sticker) + client/v2/ai/ | blocker |
| an-ai-write | no AI marker on the notes; no chat summary (written by verb) | spark edge + "Done — 4 notes on Pricing, each pointing at what it means. The design didn't change." | plain notes | client/v2/ai/ | warning |
| an-layers | "Annotations 6", "Everyone · You · ✦ AI", "Arrow to See the work" match | | | client/v2/annotations/annotation-list-model.js:80,201 | ok |
| an-layers | stickies listed flat although the canvas has a section; filter foot not exercised | "Zpětná vazba Tereza 4" group; "Hidden by the filter: Jonas 9 · You 4 · AI 5" | flat list | client/v2/annotations/annotation-list-model.js | warning |
| an-visibility | ⇧P result not seen (stickies still on screen; re-drive). The toast copy exists ("Annotations hidden. Press ⇧P to bring them back.") | toast + Show | — | annotations/ui/visibility.ts:55 | warning |
| an-dangling | dangling card not shown (button deleted from source, not moved to the trash) | "Pointed at "Book a call" — moved to the trash by Jonas · Point to…" | ring at the old end only | annotations/ui/arrow-cards.tsx:13,282 | blocker |
| an-crowd | LOD counts and hover card not reached (37 %, LOD starts < 25 %) | "Nápady · 84 stickies · + 8 people · Click to zoom to it" | — | annotations/ (LOD) | warning |
| an-crowd | Edit Layers rows are tag names, each tagged "Hero" (14 R1) | layer names | "div · Hero", "span · Hero", "b · Hero", "bu… · Hero" | client/v2/inspector/model.js:58-64 / layers tree | warning |
| an-video | time pin + timeline marks missing (proposed) | "0:12" chip; "2 notes · 1 comment"; "0:12 / 0:30" | — | annotations/ui/time-pins.tsx | blocker |
| an-video | size written without spaces | "1080 × 1920" | "Clip · 320×180" | video artboard label (07/08) | warning |
| an-print | "Not printed" matches | | | annotations/ui/time-pins.tsx:6 | ok |
| an-print | export sheet not in the paired frame (`an-print-export` shows the canvas) | "Include annotations · Stickies, arrows and stickers stay out unless you include them. · Print files never carry them — pick PDF for a review copy." | — | exporters/scope.ts `annotationsExportPolicy` + 09 sheet | warning |
| an-viewer | unreachable (needs a Can comment session) | "N · Stickies need Can edit. · Ask to edit" | — | client/v2/shell/role-denial.js:19 | blocker |
| an-figjam | import sheet matches ("Figma link", "Figma isn't connected yet. Connect once to read this file. · Connect…", "A board from FigJam works too — it comes in as annotations.", Cancel / Import) | | | client/v2/import/figma-model.js:40 | ok |
| an-figjam | arrival state unreachable (needs a Figma connection) | toast "46 items from FigJam arrived as annotations · Undo"; section chip "From FigJam" | — | figma import → annotations | blocker |

## Root causes that hit several artboards

1. **R1 — proposed annotation states aren't built or can't be reached.** These are the bound-arrow chip, the dangling / rebind card, the video time pin, the stamp row and count, the templates popover, Fold and section counts. Their copy is missing even where the component exists (arrow-cards.tsx, templates-panel.jsx).
2. **R2 — AI states are gated on sign-in.** an-ai-read / apply / stickers and the AI chips on an-ai-write need a signed-in run before the copy can be checked.
3. **R3 — the sticker picture breaks and has no text fallback.** There is no name or alt words, so a broken asset leaves an unlabeled glyph (an-stk-drop, an-stamps, an-ai-stickers).
4. **R4 — status words.** The undo toast reads as a command ("Undo: move 1 artboard", use-undo-stack.tsx:294). The vote count "0 done" has no "of N" (vote-store.js:83).
5. **R5 — tag names in Layers in Edit** (shared with 14 R1).

```json
{"canvas":"15 Annotations","critic":"copy-critic","blockers":11,"warnings":20,"verified_ids":["an-place×light","an-place×dark","an-sticky×light","an-sticky×dark","an-stk-gallery×light","an-stk-gallery×dark"]}
```
