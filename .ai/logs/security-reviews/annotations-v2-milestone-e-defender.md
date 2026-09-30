# Security defender audit — annotations v2, Milestones C–E

- Scope: `731c64ca..HEAD`, 60 source files.
- Prior reports: `annotations-v2-{defender,attacker}.md`. None of their closed findings regressed.
- Verdict at audit time: **NEEDS FIXES** — 1 blocker, 3 warnings, 5 notes.
- Fix status (2026-09-30): the fix pass is recorded at the end of this report.

## Blocker

**B1 — `type: "constructor"` crashes every viewer's canvas, and it stays crashed (medium).**
- **Where:** `annotations/ui/element-node.tsx`, where `VIEWS` is a plain object and the view is looked up as `VIEWS[props.el.type] ?? PlaceholderView`.
- **What happens:** `TYPE_RE` accepts `constructor`, and unknown types are kept. The lookup then resolves to the inherited `Object`, and React throws. There is no error boundary, so the canvas iframe root unmounts.
- **Who can plant it:** anyone who can write the board — a canvas-origin op POST, a sync peer, the hub, or a committed JSON file.
- **Fix:** look the view up with `Object.hasOwn`, or store views in a null-prototype map. Add an error boundary per element, plus a regression test.

## Warnings

- **W1 — `board-io.ts` atomic write follows symlinks, and a FIFO passes the size gate (low).** Fix: `lstat` the paths and require them to stay inside the design root.
- **W2 — `annotate` falls back to a direct file write when a live server refuses the batch with a status other than 409/413 (low).** Fix: fall back only on a network error or a 404/405 from an old server.
- **W3 — clipboard paste has no size cap before `JSON.parse` (low).**

## Notes

- **N1 — runtime registration.** It is test-only today, and the server validates with its own registry.
- **N2 — `registerElementView('__proto__')` could replace the prototype.** The B1 fix closes this.
- **N3 — awareness `annotationGesture` sanitization is sound.**
- **N4 — undo records carry no canvas identity.** A cross-canvas replay needs canvas-origin code (deferred F1).
- **N5 — `diff@8.0.4` is pinned and has no install script.**

## Regression checks (all hold)

`DANGEROUS_KEYS`, size-before-read, `Object.hasOwn`-gated AI field writes, the loopback-only `annotate` POST, validated replica snapshots, the pending-rebase cap, Figma import through `validateElements`, and the untrusted marker on AI reads.

## Fix pass (2026-09-30)

- **B1:** fixed. `VIEWS` is a `Map`; `validateElement` rejects `Object.prototype` names as types; each element node renders inside an error boundary that falls back to the placeholder; regression test added.
- **W1:** fixed. `board-io` uses `lstat`, refuses non-regular files and symlinks, and checks that `_state/` stays inside the design root.
- **W2:** fixed. `annotate` writes the file directly only when no server answers.
- **W3:** fixed. The clipboard payload is capped at `MAX_BOARD_BYTES` before parsing.
