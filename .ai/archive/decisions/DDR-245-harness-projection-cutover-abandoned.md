# DDR-245 — Harness environment projection: the cutover is abandoned

- **Status:** Accepted
- **Date:** 2026-10-05
- **Scope:** `repo:maude`, `dept:dev`
- **Closes:** `feature-harness-environment-projection.md` T10–T13 (not pursued)

## Context

`maude harness` (T0–T9) shipped in v1.2.0: one Claude discovery pass, a provenance-aware IR, fail-closed OpenCode and
Codex lowerers, manifests, managed merge and rollback. The plan stayed open for the cutover of the owner's machine
(T10), a seven-day soak (T11), removing the old bridges (T12) and the closing gates (T13). On 2026-10-05
`maude harness status --global` still reported no adopted targets.

## Decision

1. **The cutover, soak and retirement gate are not pursued.** The owner ran OpenCode and Codex as an experiment and
   concluded that a second harness adds nothing; Claude Code is the only harness in use. A soak "on daily work" in
   targets nobody works in would prove nothing.
2. **The dead copy is removed.** `studyfi-design/plugins/opencode-claude-parity/` and its README section are deleted
   (studyfi-design `522ba70`). It had no caller and sat in a work repo.
3. **The shipped `maude harness` code stays as is.** It is released, tested and isolated; removing it is a separate
   choice, not part of closing this plan. No further maintenance is promised against new OpenCode/Codex schemas.
4. **The Dotfiles bridge is the owner's to drop.** `~/Dotfiles/opencode/claude-parity.ts` is still symlinked into
   `~/.config/opencode` but is inert while OpenCode is unused; Maude does not manage it.

## Consequences

- The plan is archived. `feature-opencode-remote-sessions` loses its reason to share an ownership seam with it.
- Reviving multi-harness support starts from `maude harness` with a new plan, re-validating target schemas first.
