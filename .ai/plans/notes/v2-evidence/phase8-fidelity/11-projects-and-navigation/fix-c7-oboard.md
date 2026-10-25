# 11 Projects and Navigation — stage C round 7 (p8-c7-g1112b)

Checklist: critic-bar2.md MUST rows. Everything below is committed, tested, and re-shot (dark + light).

## Done

| id | change |
|---|---|
| pn-tab-b20, pn-relaunch-strip | already met by C4's strip fix (10 tabs at ~110 px, "10 more", resting ring); re-shot to show it |
| pn-home, pn-home-search | the slim ask bar docks once the COMPOSER CARD is under the header (it watched the whole question block incl. starters and the What's New line, so it never docked); `.home-top::before` fades what scrolls under the header (`HomeAsk.jsx`, `home.css`) |
| pn-ds, pn-ds-search | the one system is a two-line card ("Design system" / "<system name>" / "N canvases", `subLines` in `pinned-rows.js`); harness: ONE system, system open (tinted). **Not done: "used by N projects"** — the only count of projects is the cloud library check (`library-host.jsx`, linked systems only); no per-project use data exists for a local system. ⌘K DS rows follow 13's `search-ds.js` (board 13 owns; 11's Colour / Components section rows need a converted system) |
| pn-trash, pn-relaunch | the toast wears its own glyph (trash from `trashCanvas`, tabs from the restore pill — new `tab` glyph in `shell/icons.jsx`) in the quiet colour (`notifications.tsx`); × only on hover (C6) |
| pn-deeplink | the toast names the artboard by its label (`artboardLabel` from `/_api/index`, fallback the id) and the link's artboard is SELECTED (`ui-open.js` `selectArtboard`) |
| pn-jump | the opened canvas row says its count ("21"); harness: artboard selected, list scrolled to the row — all 21 rows, current row marked |
| pn-k-close | canvases and artboards are ONE list under "Canvases and artboards" (ranked by the index score, a tie: canvas first); the row keeps its own `group`, only the heading is shared |
| pn-compare | the two frames get the chrome's theme (they started dark in a light window), re-sent when a frame says `loaded`; borderless stage |
| pn-move | harness: a canvas held over a folder → "Move here" on the folder |

## Open

- pn-compare: the stage is still two iframes (two documents: both versions' CSS cannot share one), not the canvas with A / B artboard labels + a 660 px island; "Restore this version" wraps in a 248 px panel with a long artboard name (fixture).
- pn-ds: "used by N projects" (no data), ⌘K "Colour / Components · section of the Design system" rows (13's rows, needs a converted system in the harness).
- pn-history / pn-compare version titles are machine change lines; the keys sheet is the full 92-key one (06 owns).
