# Lead checkpoint 2026-10-30 ~01:30 (continues checkpoint-2026-10-29-batch.md)

Integration branch `lead-merge-2` (worktree .claude/worktrees/lead-merge-2) now holds, on top of feat 34f79beef:
lint fixes, fix-c2 + fix-c3 (restore rig 4/4), held-conflict-status, hub-drafts, selfhost-convert (+ collector
`disabled=`), ia-edges, import-link (+ security-pair fixes), a1-save-hold, v1-drop-desktop (+ 18 gesture tests),
write-claim scope split (yjs out of the helper closure), import-link role-refusal row. tsc/gens/biome/boot green.
Verification batch on the mini: bonpoc70l → scratchpad/mini-merge2c.txt. Green → ff feat to lead-merge-2 + push.

Running builders:
- p8-suite-green (Opus): full studio suite 0 fail on macOS (pre-existing cascade, ~490 timeouts on feat too) +
  the 12 CI Linux fails + the test that clobbers dist in CI. Hint sent: window.__TAURI__ leaks across files.
- p8-sweep-final (Sonnet): last dead control (Preview label selects — kg v2-p8-leftovers-preview-label-selects),
  plant-dead self-test, crawler exit 0. Then merge p8-sweep-leftovers + p8-sweep-final.

Open with Michal (via keeper): link import in cloud cells (A refuse = default built; B allow).
Owed in chain4: solo desktop e2e `format-update.e2e.ts`. Security pair over the whole batch after the freeze.
Michal: screen window needs no announcement; caffeinate -dimsu around 8.3; stop + tell keeper if the screen locks.
