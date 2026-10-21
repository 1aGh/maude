# Wave-B gate: a11y re-check (B1 to B9, W1)

Branch `gate-b-a11y` @ the fix commits (`697561224` shared token, `c3a0ed1ab` the rest, plus the follow-up for the empty
tree role and the sheet's first focus), release client rebuilt from that tree (`MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts
--release`), same rig, same fixtures and servers as `a11y.md`, same axe settings, dark and light, reduced motion on. The whole
scan set (every flow in both themes, 189 scans) was re-run after the first fix commit; the empty-project flow and the Home /
onboarding flow once more after the follow-up. Screenshots of the previously failing states: `./a11y-recheck/<area>/`.
`node scripts/check-client-boots-source.mjs`: OK. `cd apps/studio && bunx tsc --noEmit`: clean.

| Item | Verdict | Evidence |
| --- | --- | --- |
| B1 comment row `nested-interactive` | FIXED | Comments panel, 6 rows, dark and light: axe 0 (was `nested-interactive` x6). The row is a plain container; the thread opens from `button.cmp-open`. `a11y-recheck/comments/00-comments-panel-*.jpg` |
| B2 `--accent-text` undefined | FIXED | `--accent-text` now defined in both shell theme blocks (dark 5.86:1 on `--accent-muted`, 14.7 on the island; light 7.06 / 9.69). Inspector "Uses project": axe 0 dark and light (was 2.33:1). `a11y-recheck/video/03-clip-selected-*.jpg` |
| B3 timeline Advanced buttons | FIXED | `.tla-link` and `.tla-seg-btn` carry `background: transparent; border: 0`: the island scans (empty, clips, selected, expanded, Advanced, captions, comment tool, VideoMusic / Formats / Transcript / Edit) all 0. |
| B4 palette meta marks | FIXED | `.st-pal-meta .st-pal-mark` is `--fg-0`: query "video" (3 rows with marks in the meta) axe 0 dark and light. |
| B5 Export "Other formats" | FIXED | `role=menu` now holds only the groups of format rows; the search input is beside it inside `export-other-menu` (testid unchanged). axe 0 both themes. |
| B6 scrolling regions | FIXED | `diag-logs-lines` and `.chat-feed` are tab stops (`chat-feed` named "Conversation"). Diagnostics Logs and every AI chat scan: axe 0. |
| B7 empty-project tree | FIXED | "New canvas" moved out of `role=tree` (placement unchanged: `order: -1`), and an empty project's list is `role=group` (a tree with no treeitem failed `aria-required-children` once the button was gone). Empty project, layers, assets, palette, AI panel: axe 0 in `aria-required-children`. |
| B8 `.es-keys` | FIXED | `opacity: 1`; blank-canvas empty state, empty Layers / Assets / Trash: axe 0 both themes. |
| B9 Missing frame | FIXED | `role=group` while the frame carries Relink… (still `img` otherwise); the canvas document on VideoTranscript: axe 0. |
| W1 onboarding Advanced sheets | MOSTLY FIXED | dialog is a `<div>` (no `aria-allowed-role`); on open focus lands on a control inside for hub / folder-GitHub / CLI / Figma; 0 of 6 to 14 Tab presses escape (was 9 to 12); Shift+Tab stays; Esc and Cancel close. Remaining: the AI door's `role=dialog` sits in `ConnectSheet`, focus there stays on the modal wrapper (Tab still trapped, first stop is Cancel); and after close focus goes to `body` because the opener (the Advanced menu's item) is unmounted and Home has no shell fallback. |

## What is left (all non-blocking; the gate needs 0 blockers and there are 0)

- W1 remainder above. W2 (`landmark-one-main`, `page-has-heading-one` on the shell document with no canvas frame, and on the canvas
  runtime document in DS follower / DS-switch states): still 2 moderate best-practice rules per such scan; needs a decision
  on the shell's landmarks (a `main` around the canvas region). W3 (Diagnostics opened by a mouse click on a palette row:
  focus stays on the canvas frame), W4 (Comments panel: Esc does not close it, focus falls to `body` after its Close),
  W5 (share role menu: Tab leaves the open menu, Esc lands on the canvas frame): unchanged, listed in `a11y.md`.
- Not reachable in the rig (see `a11y.md` W6): the DS library card, the invite landing / invite sheet, live roles beyond the
  stubbed answers, populated Home rows.

## Red to green
`apps/studio/test/gate-b-a11y.test.tsx`, 12 pins (the first 11 through the lane in one lock: green 12/12; with every fix reverted
to the base: 0/12; fixes re-applied after). The empty-tree role pin and the first-focus assertion were added after and ran
green with the later lane run. Pins: `--accent-text` in both theme blocks holds 4.5:1 on `--accent-muted` / `--bg-1` / `--bg-2`
(computed from the token values); `.tla-link` / `.tla-seg-btn` background; `.st-pal-meta .st-pal-mark`; `.es-keys` opacity; a
rendered Comments panel has no `role=button` holding a focusable descendant; a rendered `OtherFormats` has no input in
`role=menu`; a rendered `AdvModal` > `AdvSheet` has `role=dialog` on a `DIV`, focus inside it and Tab wrapping; source pins for the
Diagnostics list, the chat feed, the Missing-frame role and the empty project's New canvas placement and role.
