D5 final re-shoot harness, G3 (canvases 07 08 09), on the merged tip. Repo-relative: it sits at
<repo>/.ai/plans/notes/v2-evidence/phase8-fidelity/_d5-harness-g3/ and finds the repo root, scripts/lib/stub-claude.mjs, apps/studio
(playwright) and the .design fixtures from its own location, so it runs from the Mac mini slot root (scripts/remote-lane.sh) as well.

Layering = the newest committed harness per canvas, copied over each other in this order:
  _c7b-harness-g3 (08 t08, 09 t09/ho/adv, fx*, lib, run)  <  _c7c-harness-g3 (09 fx3 with LetakA6, vid = ex-offline on a faked linked
  project, t09p = ex-history with the row menu open, t09w = ex-print-warn)  <  _c7o-harness-g3 (07 t07 / t07c).
Changes made for D5 only: lib.mjs derives REPO/HARNESS from import.meta.url; fx*.mjs read Matchday.tsx / LetakA6.tsx from this folder and
cache under <repo>/.scr/c8v/fx-cache; run.mjs takes an absolute ROWS path; t08 debug screenshots go to .scr/c8v/out; shoot.mjs wraps one
scenario run in a watchdog (kills the process group after 240 s of silence or 1500 s total - the runs sometimes hang in browser.close after
the last shot); chain.sh <07|08|09> runs the whole canvas, both themes. pairs.mjs builds the full-size spec|impl pairs locally.

Run (one Chromium chain at a time; Google Chrome channel; TMPDIR is pointed inside .scr/c8v/tmp):
  cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release        # client bundle first
  bash .ai/plans/notes/v2-evidence/phase8-fidelity/_d5-harness-g3/chain.sh 09     # frames -> .scr/c8v/impl/09/<id>-<theme>.jpg, logs, rows
Scenario order per canvas (a later one overwrites the ids it re-shoots):
  07: t07 (all ids, Full timeline with a held trim), t07c (ve-captions + ve-music on a project that has its footage + song)
  08: t08
  09: t09 (all ids), ho (ex-handoff, ex-handoff-edges), vid (ex-video, ex-offline), adv (ex-advanced), t09w (ex-print-warn), t09p (ex-progress, ex-states, ex-history)
Spec side: reused unchanged from the D4/D2 evidence worktrees (the 07 08 09 boards did not change after the D4 spec shots; git log on .design/ui/v2/).
