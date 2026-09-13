## 6. Failure & fallback (summary)

| Condition | Behavior |
| --- | --- |
| `kg` missing / `mode:off` / store unreachable | classic `.ai/` path, unchanged (the `else` branch) |
| `kg config` reports `pending_approval` (unapproved committed `.kgairc`) | classic `.ai/` path for this run; tell the user to review with `kg trust --show` — **never run `kg trust` yourself** (§2) |
| `kg sync` fails at close | warn, keep local log, retry next session — never block |
| Two heads on one element (conflict) | surface `kg conflicts` in `/flow:status`; do not auto-merge |
| `mode:on` but `kg` absent | surface the error (user forced it) — do NOT silently fall back |
