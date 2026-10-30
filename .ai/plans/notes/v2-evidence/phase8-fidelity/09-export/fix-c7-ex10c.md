# 09 Export — round 7c (p8-c7-ex10c): done / open

Checklist: `critic-bar2.md` MUST rows ex-print-warn, ex-history, ex-offline. Verification: fail-first tests (revert-checked against the feat tip), tsc + biome, release rebuild, re-shoot with `_c7c-harness-g3` (`t09w`, `vid`, `t09p`).

## Done

| id | what | tests |
|---|---|---|
| ex-print-warn | **The in-sheet warnings were already product** (`print.jsx` + `POST /_api/export-preflight`: the safe-margin measure and the font check); the shot never showed them because the fixture had neither. Harness fixture `LetakA6` now has a QR code (svg) 2 mm inside the cut and a headline face whose licence forbids embedding (a tiny sfnt with OS/2 fsType 2), so the REAL preflight answers both lines — nothing faked. Product: the ringed element carries the board's amber tag "2 mm to the cut" (`.ex-flag-tag`), and the element reads "The QR code" (acronyms upper-cased) | `v2-export-print.test.tsx` (tag, "QR") |
| ex-history | a finished row has a hover **More** that opens the row menu (Show in Finder or Download · Export again · Export again with other settings… · Copy file names · Remove from list); ↑ ↓ / Esc / outside click; fixed-position so the panel's scroll never clips it. "Other settings" reopens the sheet on the job's own spec; "Remove from list" is this Mac's list only (localStorage, the file and the server history stay — there is no route to delete a history row) | `p8-c7-ex10c-exports-menu.test.tsx` (model + render) |
| ex-offline | harness: the project is linked (`/_sync-status`) and the browser goes offline, and the whole window is shot, so the top bar says "Offline — kept on this Mac" (the product word existed: `save-status.js`); the shot used to be the sheet alone on a local project | — (harness) |

## Open

- ex-history: the done row's meta still reads "<format> · <where> · <ago>"; the top-bar Exports icon in the shot is the ring-less icon (no running job).
- ex-print-warn: the fixture's flyer is not the board's artwork; "Add the back" is ticked by default in the product (the board has it off).
- Round 7b's list otherwise unchanged (Folders › One per canvas, ex-progress "about 1 min left", ex-states close-ups).
