### WRITE — `kg ingest` (decision + scope + cross-ref) — **JSON on stdin**

`kg ingest` reads a decision object from **stdin** (or `--file F`); it is NOT flag-driven. The envelope is `{ "decision": { title, rationale, date, mutations:[…] } }`, where `mutations` carries the element upserts + links:

```bash
echo '{
  "decision": {
    "title": "<Title>",
    "rationale": "<why>",
    "date": "<real ISO date>",
    "mutations": [
      { "op": "upsert_element", "kind": "decision", "name": "<repo>/<slug>" },
      { "op": "upsert_element", "kind": "repo", "name": "<config.scope.repo>" },
      { "op": "upsert_element", "kind": "dept", "name": "<config.scope.dept>" },
      { "op": "add_link", "from": "decision:<repo>/<slug>", "to": "repo:<repo>", "link": "IN_REPO" },
      { "op": "add_link", "from": "decision:<repo>/<slug>", "to": "dept:<dept>", "link": "IN_DEPT" },
      { "op": "add_link", "from": "decision:<repo>/<slug>", "to": "decision:<repo>/<other>", "link": "SUPERSEDES" }
    ]
  }
}' | maude kg ingest
```

- **Namespace every repo-local anchor `<repo>/<slug>`** — for kinds `decision`, `milestone`, `plan`, `doc`, `rca`, `code-review`, `security-review`, `execution-report`, `working-state`. Identity is `hash(kind:name)` **across the whole store**, and a shared org store holds many repos: a bare `plan:dependency-debt-eradication` or `decision:DDR-018` is one node that two repos silently overwrite for each other. Shared kinds (`repo:`, `dept:`, `topic:`, `area:`) are never namespaced — collapsing those across repos is the point.
- **Scope is not optional and not decision-only.** EVERY anchor a write creates — a plan close, a milestone, a working-state snapshot, a recorded verdict — carries `IN_REPO` + `IN_DEPT`, exactly like the decision above. An anchor without them is invisible to every scoped read (`--about` a dept, an admin dashboard filtered by repo) even though `kg search` still finds it, which is the failure mode that reads as "the graph is fine" right up until someone filters it. Measured on the StudyFi store 2026-08-14: 254 of 578 decisions (44%) had no `IN_REPO`, and the un-namespaced anchors were concentrated in exactly the plan/working-state writes this recipe used to leave untagged.

- **Author is automatic** — kgai's `guessActor()` resolves `KGAI_ACTOR` env → **`git config user.name`** → `$USER`, stamped at `kg init` (verified: `kg init` on this repo recorded `actor: 1aGh`). Do NOT wire author; inject `KGAI_ACTOR` only for a richer identity string.
- **Identity is deterministic** — `hash(kind:name)` means `dept:dev`, `footage:<sha8>`, `reel:<slug>` converge to one node across machines/repos with zero coordination. Content-addressed ids (`assetSha8()`/`edlSlug()`) map 1:1.
- **Valid mutation ops (verified live — do NOT invent others):** `upsert_element` (`kind`, `name`, optional inline `props` map — **props MERGE on re-upsert**, so this doubles as a prop-update), `add_link` (`from`, `to`, `link`), and `set_prop` (singular — `element` + `props`/`key`+`value`). There is **no `set_props`** (plural) op — set props inline on `upsert_element` instead.
- **Link storage:** `SUPERSEDES` is its own Kuzu rel table; every other `link` (IN_REPO/IN_DEPT/REFERENCES/EXTENDS/…) lands in the generic `LINK` table with the kind in `l.kind` — hence the scope Cypher above. `context` returns them all under each element's `links[]`.
- Cross-ref extraction (SUPERSEDES / OVERRIDES / REFERENCES / EXTENDS) follows the marker table in `cli/lib/ddr-to-kgai.mjs` (typed edges first, then bare `DDR-\d+` mentions as weak deduped `references`).
- `--dry-run` prints the deterministic ids + `shapes` without writing — use it to preview a batch.
- **`kg ingest` rejects unknown fields (since v1.3.0)** — a payload field that isn't one of the documented ones (most commonly a model inventing `"elements": [...]` by mirroring ingest's OUTPUT shape instead of its input) now fails loud with the valid-fields list, instead of silently recording a mutation-less decision that `kg context`/`kg history` could never find. The recipe above only uses `title`/`rationale`/`date`/`mutations` — verified with `--dry-run` against the live v1.4.0 engine — so it's unaffected; if you hand-build a new envelope, `--dry-run` it first.
- **Analyses/reports are not decisions (kgai's own capture philosophy, v1.3.0)** — upstream's bundled auto-capture skill now explicitly excludes "analyses, research findings, cost or status reports, and recommendations nobody has acted on" from what gets recorded; volatile figures (prices, counts) belong in the report, not the log. We don't use kgai's own auto-capture Stop hook (we call `ingest`/`record-log` explicitly), but the same discipline already applies here: `kg record-log` attaches a verdict FILE as `EVIDENCE_FOR` a decision, it never records the analysis itself as if it were the decision — keep new recipes shaped the same way.
