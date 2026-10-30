Final (D2) harness for G1 (01 / 02 / 05): _d-harness-g1 + _c3-ai-harness, repointed to worktree agent-a14cd45eae2ac5f32 (REPO constants).
  s01ai.mjs   waits for [data-fresh] and shoots the finish moment (panel folded, toast), then the settled frame; undo waits 7 s, no palette fallback
  s05a.mjs    empty Comments panel via Cmd-K > Comments (the Share cluster draws the icon only once a canvas has comments)
  s05f.mjs    re-opens the left panel after h.open when canvas-search is missing
  home2.mjs   waits for the Home server port (slow boot on a loaded machine)
  final-index.mjs <tip>   appends the FINAL (stage D2) section + the full-size-path line
Use: copy to <repo>/.scr/h (boot-spec/spec/final-index to .scr), spec-raw from the stage-D worktree, release-build the client,
  node chain.mjs light,dark; node home2.mjs light,dark; node pairall.mjs light,dark; node final-index.mjs <tip>.
