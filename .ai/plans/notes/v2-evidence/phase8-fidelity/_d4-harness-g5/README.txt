D4 (p8-d4-g5) deltas. Copy _d-harness-g5, _d2-harness-g5, _d3-harness-g5, _c6-bugs4-harness, _d6-harness-g5 over each other in that order into .scr/, then this folder; set REPO in lib.mjs; symlink node_modules (root + apps/studio) into the main checkout; ln -s ../fx5-canvases .scr/fx5/canvases; release-build the client.
Order: bun .scr/mk-dsconv.mjs; bash .scr/chain-d4.sh (13 + 14, light, dark, dsboard crops); bash .scr/chain-x.sh (newly reached states); SHOTS_OUT=.scr/impl bun .scr/run.mjs .scr/s14t.mjs light,dark; bun .scr/mkpairs.mjs 13-design-system 14-editing; TIP=<sha> bun .scr/mkfinal-d4.mjs.
Newly reached in D4 (D3 called them unreachable):
  s13s.mjs  ds-edge-suggest: the off-system question is NOT AI-driven - git init the project, a canvas on the converted system with .meta.json designSystem and one hand-picked colour, canvas uncommitted.
  s13u.mjs  ds-multi-schema: an UNCONVERTED second system (maude) with core colours removed; a converted system is refused by Bring it up.
  s14ai.mjs ed-edge-ai: fake agent (h/fake-acp/g14-agent.mjs) edits through the design hook; env MAUDE_ACP_ADAPTER_ENTRY / MAUDE_CLAUDE_BIN stub.
  s14t.mjs  ed-edge-tereza: a second browser; its /_api/git-user answered "Tereza" through ctx.route('**/_api/git-user*') (the canvas-origin request carries ?fc=).
Still unreachable: ds-many-library, ds-many-linked (need a hub).
