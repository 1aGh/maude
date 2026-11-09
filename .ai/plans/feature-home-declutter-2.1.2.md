# 2.1.2: Home declutter

**Status:** active · **Owner:** Michal (feedback via keeper, 2026-11-09) · **Lead:** Maude v2 session
**Push, tag and release:** only with Michal's OK.

## Michal's feedback (verbatim intent)

"Je tu na jedné stránce trochu moc informací." He wants:

- the page run through design-critic;
- the whole thing smoothed out;
- unnecessary information removed.

"Accounts on this Mac" is secondary and does not belong in the main place.

## Observed on his Home (keeper, read-only)

1. **Account cards:** 10 of them sit above Recent canvases and Projects.
   - 6 are old dev/test hubs (127.0.0.1:1234, [::1]:1234, localhost, localhost:8420, localhost:18500, localhost:1234), each showing "Server unreachable · No projects".
   - Hide or collapse unreachable servers that have no projects, and offer Remove. Never delete anything from his config ourselves.
2. **alligators.cloud.maude.sh** shows as "Your server · Sign-in stopped working". It is a Maude Cloud project and belongs under the Maude Cloud account (m.dovrtel@gmail.com).
3. **Overlap:** the blue "Waiting for the browser…" button overlaps the card text.
4. **Possible duplicate:** design.studyfi.com appears as an "isn't where it was" row with "Find the folder…", and separately StudyFi shows "Connected" through design.s… Check for a duplicate or orphaned record (the `design.studyfi.com--local` managed copy).
5. **Project rows are overloaded:** "Your f…" chip, truncated path, state, avatar, "in a tab" and more chips. Reduce a row to:
   - name;
   - where it lives (one word or icon);
   - connection state, only when it is not OK.

## Direction

- **Main surface:** Recent canvases + Projects.
- **Accounts:** a small collapsed summary ("3 accounts · 1 needs sign-in") or a move to Settings.
- **Top of the page:** only a problem that needs action.

## Tasks

- [x] **H1** Data audit (code only, fixture-based):
  - why a `*.cloud.maude.sh` cell appears as "your server";
  - the duplicate or orphaned design.studyfi.com rows;
  - the button overlap;
  - which accounts count as "stale" (unreachable + no projects).
- [x] **H2** Design:
  - run design-critic on the current Home (2.1.1);
  - produce a revised Home artboard set in canvas 17 or a new canvas: main surface, collapsed accounts summary, action-needed banner, slim project rows, stale-server handling (collapsed + Remove).
  - Show it to Michal (AskUserQuestion) before building.
- [ ] **H3** Build per the approved design + fixes from H1.
- [ ] **H4** Tests:
  - fail-first unit tests;
  - Home e2e on the mini or with the no-dialog env, never popping dialogs;
  - screenshots.
- [ ] **H5** Gates, What's New, release on Michal's OK.

## Acceptance Criteria

- [x] Michal approved the Home design before building.
- [ ] Home's main surface is Recent canvases + Projects; accounts are a compact summary that opens on demand; only an action-needed problem is raised at the top.
- [ ] Unreachable servers with no projects are collapsed and offer Remove; nothing is removed without the person's click.
- [ ] A Maude Cloud cell is never shown as "your server"; it belongs to its Maude Cloud account.
- [ ] No duplicate or orphaned project row for one project; no overlapping controls.
- [ ] A project row shows name, place (one word or icon) and state only when not OK.
- [ ] Gates + tests green; no test touched the real config or keychain; no system dialog.

## Rules

Same as `.ai/scenarios/accounts-2.1.1/builder-brief.md`. Never read or write Michal's real `~/.config/maude`. Reproduce with fixtures that mirror the keeper's description.

## Progress log

- 2026-11-09: Opened from Michal's feedback.
- 2026-11-09: H1 audit done (code only).
  - Cloud cells show as server cards because `homeAccountCards` skips `isCloudHubUrl`, which project rows already use. Fix: count them under the Maude Cloud card.
  - Stale servers: unreachable with n=0. Removal reuses `hubSignOut` + confirm ("Forget this server").
  - Orphans: gone rows bypass `collapseDuplicates`. A gone copy folds into its live twin; a lone orphan gets a quiet row plus a new person-only "Remove from list" Home command.
  - Overlap: the `.home-sw` state word doesn't truncate (home.css ~1988), and the busy label is too long.
  - The project row inventory went to the designer.
  - Marked H1 done.
- 2026-11-09: H2 design merged: canvas 17, artboards 15–19, two design-critic passes with no blockers.
  Michal approved: "Ano, stavěj". His answers to the open questions:
  - the chip shows text + dot ("1 needs sign-in");
  - add "Forget all" for old servers;
  - a project row DOES show a quiet last-opened time on the right.
