D3 harness for G1 (01 / 02 / 05): round-5 (p8-c5-panels) 01/02/05 scenarios + bugs3 s01ai.mjs, repointed to worktree agent-a81ec5fb665864bd9 (REPO constants).
  s01ai.mjs      fake agent steps every 9 s; finish moment found by an in-frame MutationObserver (re-armed on reload); waits for the run's end before Cmd-Z; shoots the undo toast while it is up
  lib.mjs        plain Playwright Chromium (no channel)
  final-index.mjs <tip>  appends the "FINAL (D3, <tip>)" section + the "final (D3):" line
Spec side: 01 / 05 reused (spec-raw from round 5); 02 re-rendered (spec.mjs against a scratch copy of .design served by boot-spec.mjs on :4777).
Use: copy to <repo>/.scr/h (boot-spec/spec to .scr), symlink node_modules, release-build the client, node chain.mjs light,dark; node pairall.mjs light,dark; node final-index.mjs <tip>.
