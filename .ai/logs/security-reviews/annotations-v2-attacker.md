# Security attacker review — annotations v2 (DDR-242)

Branch `worktree-annotations-v2`, base `fa3290bf`. Agent: `flow:ethical-hacker`. The agent returned the report inline
(the sandbox refused its file write); this file records it together with how each finding was resolved.

**Original verdict: NEEDS FIXES** (F1 high, F2 medium, F3 low, F4 low; one chain F2 + F3). AI/MCP surface: yes.
Trifecta: FAIL.
**After this change: F4 is fixed. F1–F3 predate v2 and move to a dedicated follow-up.** They are not regressions of
this diff, and a correct fix is a separate design (see F1).

The attacker ruled out parse DoS through `mini-dom` + `sanitizeAnnotationSvg` in the real pipeline. The defender's
isolated measurement found the tokenizer quadratic, and it was made linear anyway (defender #1).

## Findings

### F1 — A canvas iframe can address any sibling canvas's board (high) — deferred to follow-up
`/_api/annotations` and `/_api/annotations/ops` are canvas-origin reachable (`CANVAS_SAFE_API`) and take a free `file`.
A hostile canvas can read or delete another canvas's board. There is no path traversal: the slug is flattened.

The attacker's key point: v2 made a malicious delete-all indistinguishable from a legitimate one. v1's accidental
DDR-223 "emptiness never beats content" guard no longer helps, because an op-driven delete-all *is* content.

**Why it isn't fixed here.**

- **The obvious binding is bypassable.** Tying `file` to the request `Referer` doesn't work: the canvas script can
  `history.replaceState` its own URL to the victim's `/_canvas-shell.html?canvas=…`.
- **A real fix is a separate design.** It needs a capability issued by the main origin for each iframe.
- **The exposure is shared.** `/_api/comments*` and `/_api/canvas-meta` have the same exposure, so it belongs to one
  canvas-origin authority change rather than to this storage change.

**Mitigations that hold today.**

- The board is a versioned file (DDR-115), so git history recovers it.
- The room persists through `_history`.

### F2 — Board text reaches an agent unfenced (medium) — deferred to follow-up
`read-annotations` output carries element text verbatim. The ingest path of `/design:new` (step 6b) already frames the
board as untrusted data. The tool output itself still needs a fence.

### F3 — Forgeable `author` provenance (low) — deferred to follow-up
`author` is client-supplied. It should be stamped server-side from the session where one exists. Chained with F2, it
makes injected text look user-authored.

### F4 — Load and boot paths read before a size check (low) — FIXED
- `api.ts` `readBoard` checks the size before reading.
- `migrate-boot.ts` uses `lstat`, then a size cap, then reads, with realpath-contained writes.
- `v1-bridge-io.ts` already had the gate, and now also refuses an unreadable board.

## Follow-up

The session task "Harden annotation write surface (F1–F3)" covers F1, F2, F3 and the related gap where accepted cold
start materializes over an unreadable local board.
