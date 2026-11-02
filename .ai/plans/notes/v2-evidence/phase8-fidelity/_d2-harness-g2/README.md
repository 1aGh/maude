# Stage D2 (final re-shoot) harness, G2 (03 AI Chat, 04 Modes, 06 Advanced)

Built on `../_d-harness-g2` (stage D) and `../_g2-harness` (stage A; fx3/fx4 fixtures, s03c, s06c unchanged). Paths hard-code the worktree
`/Users/iagh/git/personal/maude/.claude/worktrees/agent-a948527cf7721a4d9` (`.scr/` scratch): change `REPO` in `lib.mjs` and the `W` paths before reuse. `fx.mjs` / `fx2.mjs` /
`fx3.mjs` / `fx4.mjs` come from `../_d-harness-g1` / `../_g2-harness`; `s06e` needs the g5 `ds-converted` fixture (`../_d-harness-g5/mk-dsconv.mjs`).

Changes against stage D:
- `fake-agent.mjs`: behaviour from a one-shot `<scratch>/next-mode` JSON (`{mode: hang|done|tell|permission|question|fail, text?, title?, poster?}`), so the prompts typed into the chat are the board's own words.
- `run.mjs`: `h.mode(obj)` writes it; `h.fresh()` waits for `.dc-ai-ring[data-fresh]` in the canvas frame; `h.step(..., {fresh:true})` shoots inside that 1.8 s window (`{now:true}` shoots with no extra wait: a second frame of the same window).
- `lib.mjs`: `SHOT_CHANNEL=chrome` launches Google Chrome (H.264 decode) for `s04v`.
- `s03a`/`s03b`: board prompts; finish moment shots; `ai-question` = answered question, `ai-choice-q` = the elicitation; `ai-history` pressed inside a finish window.
- `s04a`: left panel opened from its corner icon for Assets; Preview clicks by the bounding box of the Desktop/Tablet element that is on screen; link follow by click event; toolbar slots by position.
- `s04c`: ask is the board's `Make it greener, keep the logo white`. `s04v`: md-present-video (new). `s06b`: left panel opened first. `s06d`: longer waits. `s06e`: ad-ds (new).
- `pairs.mjs` takes `ONLY=<id,id>`; `pairs-map.json`: md-present-video and ad-ds mapped; `stage-d2-index.mjs` writes the FINAL section + `full-size-path.txt` line; `chain.sh "<scenario> [themes]" ...` runs scenarios one after another.
