# D4 final re-shoot harness, G2 (03 AI Chat) on 21c9714cf

No script changes against `../_c6-harness-g2/`. Assemble `.scr/impl/` as that README says (the layers `_d-harness-g1`, `_g2-harness`, `_d2-harness-g2`, `_d3-harness-g2`, then `_c6-harness-g2`), repoint the worktree path (`.scr/repoint.mjs <dir> <worktree>`), `bun install --frozen-lockfile` in apps/studio, release-build the client, then:

```
cd .scr/impl && export SHOTS_OUT=<worktree>/.scr/impl-out
for s in s03a s03e s03d s03c s03n; do node run.mjs $s.mjs dark,light; done   # c6chain.sh minus its s01ai line (01 is group 1)
MAP=pairs-map-c6.json node pairs.mjs   # 03 only (map copied from ../_c6-harness-g2/)
```

Fixtures needed next to impl: `.scr/attach/{trenink-0412.mov,Combine-brief-2026.pdf}`, `.scr/spec/03/` (stage-A spec PNGs + meta.json). If ai-copy / ai-hero / ai-done / ai-history print "NO FRESH WINDOW", re-run that scenario for that theme: the 1.8 s finish window is timing-sensitive.
