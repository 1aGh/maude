# Round 11 re-shoot harness, canvas 03 AI Chat (`p8-r11-03`)

= `_d7-harness-g1/g2` trimmed to 03 (only the scenes below), with the round-11 deltas:

- `s03r.mjs` (new; replaces `s03e`'s ai-done part): one chat on Post 1:1, shot once the finish moment has SETTLED into the
  "Made by AI" label (`h.settled`, run.mjs) — both themes the same state; a missing label is logged, never shot silently.
- `s03c.mjs` (ai-long-pinned): the "Pick the six sharpest" reply's agent copies six photos into
  `.design/assets/combine-recap/` in ONE Bash call (`shots: 6` in `fake-agent.mjs`), so the reply's own tool call names
  the pictures the strip draws.
- `s03h.mjs` (ai-long): logs whether the "What AI did" fold is there (the dark D7 run had none) and how many run records
  moved into the seeded chat; the long chat's first run gets a retry when its steps did not record.
- `s03k.mjs` (ai-question) is the ONLY scene that shoots ai-question (the D7 `03x` chain ran `s03e` + `s03h`, whose
  ai-question has no element picked, so no spark ring).

```
scripts/remote-lane.sh --slot auto --max 3600 --fetch .scr/d7/03-ai-chat -- bash .ai/plans/notes/v2-evidence/phase8-fidelity/_r11-harness-g1/chain.sh [dark,light] ["s03r s03c s03h s03k"]
ONLY=ai-done,ai-question,ai-long,ai-long-pinned bash .ai/plans/notes/v2-evidence/phase8-fidelity/_r11-harness-g1/mkpairs.sh   # local
```

Safety as in the D7 harness: throwaway HOME/XDG + stubClaudeEnv in every boot, NO_OPEN=1, MAUDE_NO_AUTOBUILD=1, the project is a copy.
