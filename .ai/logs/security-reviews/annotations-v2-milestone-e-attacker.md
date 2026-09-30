# Adversarial review — annotations v2, Milestones C–E

- Scope: `731c64ca..HEAD`. Findings come from reading the code only.
- Verdict at review time: **NEEDS FIXES** — 1 high, 3 medium, 3 low, 3 exploit chains.
- Fix status: see the "Fix pass" section at the end.

## Findings

**A1 — HIGH: one element of type `"constructor"` blanks every peer's canvas, persistently.** Same root cause as defender B1 (`VIEWS` is a plain object; no error boundary). It can be planted through ops, Yjs, a committed file, or a malicious canvas via F1. Nothing renders, so the element can't be deleted from the UI.

**A2 — MEDIUM: `annotate` falls back to writing a stale whole file, which erases collaborators' edits.**
- Any failure other than 409/413 triggers the fallback: a timeout, a network error, a 400 or a 5xx.
- The disk→room bridge then replaces the live room with that file.
- Deterministic trigger: a body over the 4 MB cap.
- Attacker trigger: flooding the op chain with batches of worst-case text merges, until the agent's 3 s timeout fires.

**A3 — MEDIUM: a hostile web page can plant board content under a colleague's name through the clipboard (pastejacking).**
- `author` survives the paste.
- A link card's `domain`/`title` render verbatim, apart from its `url`.

**A4 — MEDIUM: `read-annotations --rects` merges canvas-controlled strings unstripped and uncapped.**
- The affected fields are `selector`, `text`, `tag` and `cdId`.
- The untrusted marker names only some fields.
- `--full` copies arbitrary keys of unknown types into `style`.

**A5 — LOW: undo records in sessionStorage are shared by every canvas on the origin.** Canvas A can plant an `annotation-ops` record that B replays through its own iframe.

**A6 — LOW: a legacy `maudeStrokes` paste runs a quadratic migration on an unbounded payload.**

**A7 — LOW: the placeholder for an unknown type takes unbounded geometry and catches clicks, yet can't be selected or deleted.**

Info: peer gesture ghosts are clamped to ±1e6 world units, not to the screen.

## Exploit chains

1. **Project-wide canvas blackout** (A1 + F1). **HIGH.**
2. **The merge guarantee collapses under load** (A2 + F1). **MEDIUM.**
3. **Web page → fake author → agent** (A3 + A4 + F2/F3). **MEDIUM.**

## AI surface

- **Trifecta: FAIL.** This is structural and predates this change.
- **Excessive agency:** `annotate delete` and `--board` run without confirmation.
- **Provenance laundering:** an AI `update` keeps a human `author`.

## Ruled out

- Registry hijack from canvas code.
- href / colour / text sinks.
- Pending-batch resurrection: the worst case is a 10 s ghost.
- Merge budget bypass.
- Gesture ids.

## Fix pass (2026-09-30)

- **A1:** fixed (see defender B1).
- **A2:** fixed. With a live server, any failure is a hard failure; the file is written directly only when no server answers.
- **A3:** fixed. A paste re-stamps `author` as the local user and derives a link card's `domain` from its `url`.
- **A4:** fixed. Manifest strings are stripped and capped. The marker covers every string in the output. `--full` no longer copies the keys of unknown types.
- **A5:** fixed. Each undo record carries its canvas file, and the layer ignores a record for another canvas.
- **A6:** fixed. The clipboard text is capped, and a legacy payload is trimmed to the element cap before migrating.
- **A7:** fixed. Placeholder geometry is clamped, and the placeholder doesn't take pointer events.
- **Not fixed (structural, pre-existing):**
  - the trifecta;
  - confirmation for destructive `annotate` verbs;
  - making the disk→room reseed diff-based.

  Each is tracked as a follow-up.
