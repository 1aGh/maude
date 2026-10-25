# P8 stage C · round 7 · c7-edit — fix report (done vs open)

Branch `p8-c7-edit` (from feat/maude-v2 6f503db82). Scope: 14 critic-bar2 MUST items (1)–(5). This hand-back
covers item (1) — V2-clipboard-objects — in full; (2)–(5) and the stage-D re-shoot are open (see Continue).

## Done — V2-clipboard-objects (ed-ab-menu, ed-obj-order)

| change | files | test (red → green, reverted once) |
| --- | --- | --- |
| Four edit-ops on the existing `/_api/edit-op` route: `object.copy` + `artboard.copy` are READS (new additive `EditOp.read`: the dispatcher stamps in memory and writes nothing — no history row, no undo record); `object.cut` and `canvas.paste` are ordinary writes (one revert / one kernel action). The copied text stays in server memory (≤16 clips, 16 MB); a copy answers only a handle `{id, kind, count, from}`, so no JSX travels from any client and the 64 KiB body bound stays. A paste re-checks each item (exactly one JSX element), drops every `data-cd-id`/`data-cd-locked`, gives DOM roots fresh readable ids (`created`), and renames a pasted artboard (copyId / copyName) with an optional `at` row placement | `edit-ops/clipboard.ts` (new), `edit-ops/types.ts`, `edit-ops/dispatch.ts` | `p8-c7-clipboard-ops.test.ts` (15) |
| The clipboard lives in the SHELL (`client/clipboard-relay.ts`): the edit-op relay records a copy/cut handle and, on every paste, overwrites `params.clip` with its own handle; nothing held → refused in the shell. A clip from ANOTHER canvas is not run on the canvas's word (the iframe is untrusted, C4 frame scope): the canvas gets `queued`, the shell asks "Paste the object copied in Home?" · Paste in its own toast and runs the edit-op itself on click (legacy `record-edit` for ⌘Z) | `client/clipboard-relay.ts` (new), `client/hooks/use-canvas-bridge.jsx` | `p8-c7-clipboard-client.test.ts` |
| Canvas: `runClipAction` — paste / cut push ONE edit-op revert record on the canvas undo stack (none on an op-log home), copy pushes none; ⌘C/⌘X (registry chords, Edit mode, object or artboard selection); ⌘V is WebKit's own paste event, taken only when the system clipboard still holds the marker a copy left (pictures / Figma frames / other text stay paste-bar's and the media intake's); Edit › Cut / Copy / Paste and ⌘K run the same function | `editing/clipboard.ts`, `editing/clipboard-actions.ts` (new), `editing/index.tsx`, `editing/object-keys.ts` | `p8-c7-clipboard-client.test.ts` |
| Object menu: Cut ⌘X · Copy ⌘C · Paste ⌘V lead the Duplicate group (14 ed-obj-order) | `editing/object-menu.tsx`, `editing/object-actions.ts`, `canvas-shell.tsx` | same |
| Artboard menu = exactly 14 ed-ab-menu: Ask AI · Duplicate / Duplicate at another width ▸ / Rename · Copy / Paste · Export… · Move to trash. Add comment (C), Start a vote… (⌘K `annotations.start-vote`) and Advanced ▸ (zoom keys / View menu, ⌘K `artboard.reset-position` + `layout.convert-to-absolute`, the align bar, the inspector) left the menu; `artboardMenuAdvanced` keeps the list | `editing/artboard-menu.tsx`, `editing/artboard-actions.ts` | `v2-artboard-menu`, `s2-22-menus`, `p8-c3-modes` updated |

Registry (shared, own commit 83a8e8632): `object.copy` ⌘C, `object.cut` ⌘X, `artboard.copy` ⌘C (selection-scoped, Edit), `canvas.paste` (no chord), agent paths, regen (manifest, keymap.gen, help, studio-actions).

Verified: tsc 0, biome clean on touched files, 461 + 137 + 26 tests green in the lane, `gen-actions --check`, `gen-plugin-surfaces --check`, release build + `check-client-boots-source` OK + `opening-card-clears` PASS, dist reverted.

## Open
1. **Stage D not re-shot** for ed-ab-menu / ed-obj-order (the harness must open the object menu on "Book a call" and the artboard menu; both now carry the drawn rows).
2. Item (2) object inspector rows (Uses <system>, token chips Space 24 / Round, Type + Interaction, folded Advanced Tokens/CSS/Constraints): in the D4 ed-inspector shot the inspector is cut at Opacity by a short impl viewport and the harness selected "See the work", not "Book a call" — first a harness fix (viewport height, target), then judge which rows are really missing.
3. Item (3) component picker groups Brand / Components / Patterns, no description leak.
4. Item (4) multi-artboard card "Mixed" (not "—"); Tidy bar still on the name labels in light.
5. Item (5) harness: shoot shape / text-edit / text-style / lay-free / img / comp-instance on the board's object, open Layers, close the Undo popover / AI panel in edge shots.
6. Clipboard follow-ups: no live e2e paste through the iframe yet (the dispatcher + relay are pinned by unit tests); a pasted artboard with no `at` (⌘K / Edit › Paste with nothing selected) takes a default-grid slot; a JSX item that reads a component's props pastes but renders an error card (undoable); the characterization snapshot of the v1 artboard menu needs `check-v1-characterization --update` on the merged tip.

# Continuation — p8-c7-edit2 (round 7, second builder)

Branch `p8-c7-edit2` (from feat/maude-v2 e5833ffc4). Commits: 22cfd8527 (Uses row), f392310b4 (picker label), 6dd6766c0 (marquee boards), 3001cb524 (clipboard), + the stage-D/docs commit.

## Done
| item | change | test (red → green) |
| --- | --- | --- |
| (2) ed-inspector / ed-obj-enter | the object inspector's "Uses <system>" row is the first thing under the name (14 draws it there); an artboard / several artboards keep the door at the foot (13 ed-where) — `inspector/frame.jsx` `usesOnTop`, `.insp-uses-top` | `v2-inspector-render` (object: right under `.insp-hd`; artboard: hairline wrap) |
| (2) harness | ed-inspector shot = "Book a call" on an 1800 px page (the whole card, Advanced folded); the fixture's Book a call has a link + hover so Interaction reads "Open cal.com/studio" / "Lift to Floating"; Layers open on the object boards; layers carry sentence-case names | — |
| (3) ed-comp-pick | a system's description after a component's name ("Tabs (this system switches views with …)") no longer rides into the row (`ds/component-list.ts oneLine`) | `edit-components-route` |
| (4) ed-ab-tidy | a marquee-caught artboard is selected with the SAME snapshot a click makes (attrs, world size, geometry): the multi-artboard card reads "Mixed" / a shared size instead of "—"; `mergeSelClientFields` merges a SET member by member (echo lacks the client-only fields) and keeps an artboard's geometry. The Tidy bar already clears the name labels (`clearLabels`); both themes now shoot the same 3-board state | `p8-c7-marquee-hit`, `p8-c7-merge-selection` |
| (5) harness | all 14 ids re-shot both themes with Layers / Assets / framing; edge-paste + edge-keys before the AI/Undo steps | — |
| (6) clipboard | a paste with nothing selected lands beside the LAST artboard (its row, one gap right of that row; `pasteSpot`); an object that reads names declared around it (component props, a local const, a module helper) is refused at paste in words ("That object reads title from where it was copied; it can’t be pasted here. Copy the whole component instead.") — never an error card (`edit-ops/scope-names.ts`: `needsOf` at copy, `scopeAt` at the paste spot) | `p8-c7-paste-spot`, `p8-c7-clipboard-scope` |

## Open
1. Patterns group in the picker stays hidden (no placeable pattern source; the DS board's showcases are not insertable) — Brand / Components are drawn.
2. ed-obj-order: the board's four panels (nudge chips, "Logo is locked" tip, Layers hide/lock rows, Frame selection before/after) are side states, only the menu (now with Cut / Copy / Paste) + Layers are in the shot.
3. ed-inspector Advanced is 06's (Element / POS / SIZE rows, "Tokens it uses" as `--token` rows) — not 14's Tokens chips / CSS block / Constraints diagram.
4. ed-edge-keys: focus does not land on the "Services" row in the fixture (the walk stops on the page frame, discs 1.1–1.4 are drawn); ed-edge-paste shows no paste bar ("Pasted from Figma as an image…") — the synthetic ClipboardEvent is not taken in this state.
5. Fixture content (cards 111 px high, "Ink" is "Black", no Alligators "Plakát" style, Datum is a Text) differs from the board's story.
