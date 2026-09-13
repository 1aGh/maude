## Edge reconstruction — typed markers FIRST, then dedupe bare mentions

`DDR-\d+` is BOTH typed cross-refs and thousands of loose body mentions. Resolve the strong ones first, or the graph drowns (DDR-054 alone is name-dropped 100+×). Order:

1. **Typed markers** (`**Supersedes:**` → `SUPERSEDES`, `**Related:**`/`**Relates:**` → `REFERENCES`, `**Extends:**`/`**Amends:**` → `EXTENDS`), keeping the strongest kind per target (`SUPERSEDES > OVERRIDES > EXTENDS > REFERENCES`).
2. **Bare `DDR-\d+` body mentions** → weak `references`, **skipped if the target already has a typed edge**.

All cross-ref links are `add_link` between two `decision:`-kind elements → they land in kgai's **generic `LINK` table** with the kind in `l.kind` (NOT the dedicated `SUPERSEDES` rel table, which is for Decision-level log supersession). Query them as `MATCH (a:Element)-[l:LINK]->(b:Element) WHERE l.kind='SUPERSEDES'`.
