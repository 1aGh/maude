# ds convert on this repo's own design systems (p8-ds, 2026-10-25)

Decision: `v2-michal-convert-in-repo-ds-end-of-phase8` (convert at the end of phase 8, `--dry-run` first, then refresh the DS ledger rows).

## What ran

1. Scratch project = a COPY of this worktree's `.design` (exports, runtime state and `linkedHub` stripped), throwaway HOME/XDG, `claude` stubbed, `NO_OPEN=1 MAUDE_NO_AUTOBUILD=1`. This repo's own `.design` was never booted.
2. `maude design ds-check` before: `maude` and `maude-v2` conformant (0).
3. `maude design ds convert --dry-run --json` (`ds-convert/dry-run.json.txt`): clean, `refused: null` for both.
   - `maude`: 37 canvases, 39 specimens -> 7 sections (brand 2, colour 9, type 2, space 5, motion 1, components 18, patterns 0) + 2 own artboards (Desktop index, Desktop showcase); default system.
   - `maude-v2`: 16 canvases (folder `ui/v2`), 38 specimens -> brand 3, colour 9, type 1, space 5, motion 1, components 17 + the same 2 own artboards.
4. `maude design ds convert --json` on the copy (`ds-convert/convert-run.json.txt`), exit 0.
5. The generated files were copied into the worktree's `.design/system/<ds>/` (same bytes: revision ids are content hashes, and the base files were identical). Versioned, not ignored by any DDR-115 list.

## What the convert changed in the repo (reviewable: 2 modified lines + 12 new files)

Per system: `design-system.tsx` (~2 kB) + `design-system.meta.json`, `revisions/head.json` (one `convert` log entry, `head == base == R0`), `revisions/<R0>.{tokens.css,components.css,json}` and `tokens.json` (`"source": "css"` -> `"canvas"`, the single changed line). Nothing a 1.x peer reads changed.

- R0 `tokens.css` is byte-identical to `colors_and_type.css` and R0 `components.css` to `preview/_components.css` for both systems (`cmp`), so every canvas that follows the system renders what it rendered before.
- `maude`: R0 = 6a17cc71…; `maude-v2`: R0 = a983d92f….

## Checks after

- `maude design ds-check` (in the worktree): `maude: conformant (0)`, `maude-v2: conformant (0)`; exit 0 (`ds-convert/ds-check-after.txt`).
- `ds status`: both `converted: true`, `headState: ok`, level 0. `ds revisions list maude-v2`: one revision, referenced by head.
- `ds check-system` (`ds-convert/check-system-*.txt`): Complete (7 sections, both modes, reduced motion) ok, Schema ok; the contrast warnings (51/64 pairs on maude-v2, e.g. Accent-on-soft 1.2:1, Fg 3 on Bg 4) are the system's own design values, unchanged by the convert.
- Render: both converted boards open through the capture origin with all seven sections plus the two own artboards, no 403 / blank page (`ds-board-maude.jpg`, `ds-board-maude-v2.jpg`; server log clean). The scratch copy of phase 8 once hit `403 not-in-scope` on the two desktop specimens (INDEX note, canvas 13); it does not reproduce on the tree's tip. `ui-00-index-after.jpg`: a canvas that follows the system still renders.
- Round trip: `ds convert maude-v2 --restore` put the folder back (tokens.json bytes equal the original, the board in `_trash/ds-convert/`), a second `ds convert maude-v2` produced the same revision id.

## Ledger

Rows that depend on a converted in-repo system and what this run could honestly do:

| row | before | now | why |
| --- | --- | --- | --- |
| `00/rule/the-design-system-lives-on-a-board` | built | verified | both in-repo systems are now on a board (`design-system.tsx` + head.json), conformant, rendering (boards above). |
| `13/*` artboard rows | mixed | unchanged | their fidelity shots (phase 8, canvas 13) were taken on a scratch project converted from these same two system folders, so converting the repo changes nothing they proved. |
| `13/ds-make-*` | built | unchanged | need AI to draw the directions; not reachable by a convert. |
| `13/ds-many-library`, `13/ds-many-linked` | built | unchanged | need a loopback hub with a team library. |
| `13/ds-edit-reach`, `13/ds-multi-panel` | built | unchanged | the open gap is the critic verdict (reach embed shows island chrome; light multi-panel shot lost the two-systems state), not the missing convert; needs a re-shoot + critic, not this task. |
| `S10` package | built | unchanged | closed at its wave gate by the lead. |

## Not done

- No desktop e2e or app run against the converted `.design` (the e2e fixtures are their own projects).
- No pixel diff of all canvases before/after: the R0 CSS is byte-identical, so the proof is by construction plus one canvas shot.
