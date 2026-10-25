## Full-body ingest — the graph must stand on its own

Log verdicts (`rca` · `system-review` · `code-review` · `security-review` · `execution-report`) ride the same import unless `--no-logs`.

**Both DDRs and logs are ingested with their FULL body.** An earlier cut stored only a lead paragraph (~3 % of a DDR) — which quietly made the graph an index that could not stand on its own, so every real "why" still required opening the file. The goal is a genuine switch: the graph answers "what did we reject, and why" with no file open. Cost: the committed log is ~5 MB for this corpus (2 MB of DDR prose + 1.1 MB of logs + envelope).

`.ai/logs/**` additionally matters because it is **gitignored** (the repo files it under "AI workflow runtime"), so those files exist only on the machine that produced them while committed docs reference them — the graph is their ONLY inheritable copy. Each log entry also gets `EVIDENCE_FOR` edges to every DDR it cites.

Dates: `**Date:**` when present (34 of 123), else the file's mtime — they're untracked, so git has no creation date either.
