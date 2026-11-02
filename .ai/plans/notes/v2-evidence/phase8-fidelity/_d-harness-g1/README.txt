Stage D harness for G1 (01 / 02 / 05): the stage-A harness (_harness-g1) repointed to worktree agent-a1266e1495ea7588d (REPO constants), with the stage-D adaptations:
  run.mjs         the What's new notice is dismissed by .maude-notice-close (its first button is now "See all")
  s05a.mjs        closeHist(): Esc no longer closes Version history, close it by vh-close
  pairs-config    impl crops re-fitted (es-panels-canvas history, es-panels-make AI, es-canvas-three, ob-adv-sheets, ob-settings)
  pair.mjs        dark es-landing: first frame found by the blue Ask AI button
  cmp.mjs         pixel-diff of two spec dirs (used to check the 02 board re-render)
Use: copy h/* to <repo>/.scr/h and boot-spec/spec to .scr, repoint REPO, release-build the client, `node chain.mjs light,dark`, `node pairall.mjs light,dark`, `node stage-d-index.mjs <tip>`.
