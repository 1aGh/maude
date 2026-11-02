Harness used for G1 (01 / 02 / 05). Paths are hard-coded to the worktree agent-af49de751057c2ee5 (REPO in lib.mjs, spec.mjs, boot-spec.mjs, pair.mjs, chain.mjs, home2.mjs): copy, then adapt.

  boot-spec.mjs + spec.mjs   SPEC: boot a studio over a scratch copy of .design on :4777, then `node spec.mjs "<canvas base>" <outdir> light|dark`
                             (⇧0 for 100 %, wheel-pan to the artboard, element screenshot; light = the host's dark-token <style> removed)
  run.mjs <sNN.mjs> light,dark   IMPL scenarios on a project server (SHOTS_OUT=<dir>); fx.mjs / fx3.mjs = fixtures
  home2.mjs                  Home scenes: `server.ts --home` + Tauri stub + route interception of Home's own APIs
  fake-acp/                  slowed fake ACP agent (derived from apps/desktop/e2e/fixtures/fake-acp) + the e2e claude stub ("signed in")
  pair.mjs + pairs-config.mjs   SPEC | IMPL pairs (ImageMagick); index-data.mjs + gen-index.mjs   the INDEX.md files
  chain.mjs                  runs every scenario for the themes sequentially
