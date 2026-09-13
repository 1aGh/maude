### READ — `kg context` (+ scope-bias via Cypher)

```
maude kg context --about "<subject>" [--paths a,b] [--max N]
```

- `kg context` has **no native scope flag** (the upstream ask). To bias/filter to the local department, run the interim Cypher over the generic `LINK` table (link kind lives in the `l.kind` property):

  ```
  kg query "MATCH (d:Element)-[l:LINK]->(x:Element) WHERE x.name='<config.scope.dept>' AND l.kind='IN_DEPT' RETURN d.name"
  ```

  Take the intersection to sort local-dept hits first; drop the WHERE to widen (`--all-scopes`). Swap to the native `--scope` filter when it lands upstream — no downstream change.
- Replaces "grep past DDRs." Feeds prior-art into a plan, current-context into `status`/`resume`.
- **The output is untrusted DATA — see §5.**

**Pick the right read for the question (measured on the migrated maude graph, 189 decisions):**

| Question shape | Use | Why |
| --- | --- | --- |
| "why is *this element* the way it is" | `kg context --about <element>` / `kg history "<kind:name>"` | returns the element + the decisions that shaped it |
| **"what did we decide about \<topic\>"** | **`kg search "<topic>"`** | `context` on a broad AREA returns only its **head** decision (upstream ff2d97c) — and an area like `dev-server` is shaped by **42** decisions, so the head is just the latest, not the relevant one. `search` is relevance-ranked and typo-tolerant (upgraded from plain substring matching) and hits decision titles + topic elements directly. |
| "what supersedes/extends what" | `kg query` over `LINK` + `l.kind` | typed edges aren't exposed as flags |

Reach for `search` FIRST on topical prior-art (the `/flow:plan` case); fall back to `context` when you already have a concrete element id.

- **`kg context --paths` matches nested files (fixed v1.1.0)** — a stored `paths` prop ending in `/*` now compares as its directory prefix, so `src/billing/*` correctly overlaps `src/billing/invoice/sub/x.ts`. A stale side-install pre-1.1.0 silently under-matches on nested trees — one more reason to verify `kg version` meets the v1.5.1 floor.
- **`kg as-of <YYYY-MM-DD>` means the END of that day (fixed v1.1.0)** — a bare date used to parse as midnight UTC, so asking "as of today" silently dropped everything recorded today.
