# V2-8.16 live agent journeys at the freeze (2026-10-31; run at product head 7f16e0b1b, re-graded at 6fff07350)

`bun test/agent-journeys/run.mjs live --lane both --journey all --budget-usd 4 --timeout-min 20` ran through the
test lane once, as an approved paid run (Michal 2026-10-31: "pust placene pruchody klidne znovu"). Wall clock was
30 min. The terminal lane cost **$12.95**; the ACP lane reports no cost. Infra and harness failures: 0.

**At the run: 18 of 22.** S6 failed in both lanes, and in the ACP lane its only failing check was a grader false
negative (see below). Michal chose to fix the grader (option B), with no new paid run.

**Re-graded with the fixed grader at 6fff07350: 19 of 22. Every journey S1–S11 passes in at least one lane.**
- The fix is `withImportedCss` on S6's `design-system-tokens` check (p8-journey-grader).
- The trials were graded again from the evidence on disk (`bun test/agent-journeys/run.mjs grade --dir <trial>`).
  Each trial's `regrade.json` sits next to its original `grade.json`.
- The three remaining failures are caused by the agent, not the product.
- The run was not repeated, because the rule is never to re-run because of a grade.

| journey | terminal | acp |
| --- | --- | --- |
| S1 | ✗ | ✓ |
| S2 | ✓ | ✓ |
| S3 | ✓ | ✓ |
| S4 | ✓ | ✓ |
| S5 | ✓ | ✓ |
| S6 | ✗ (agent: 2 artboards) | ✓ after re-grade (✗ at the run, grader) |
| S7 | ✓ | ✓ |
| S8 | ✓ | ✓ |
| S9 | ✓ | ✓ |
| S10 | ✓ | ✓ |
| S11 | ✗ | ✓ |

The grade, tool log and project for each failure are kept next to this file.

## S6 — both lanes, the grader reads only the `.tsx`
- `design-system-tokens` requires `var(--` in `ui/Landing page.tsx`.
- Both agents followed the project's own prior (`ui/GitPanel.tsx` + `ui/GitPanel.css`). Each put the styling in a
  sibling `ui/Landing page.css`, imported by the canvas (`import "./Landing page.css"`).
- That CSS uses design-system tokens throughout: 129× `var(--` in ACP, 57× in terminal. Neither lane has a single
  hex colour in the `.tsx` or the `.css`.
- **ACP:** every other check passes: 3 artboards with web kind, filled in, words from the sentence, by the AI, one
  undo step, no second canvas. Counting the imported CSS, S6 ACP passes all 7 checks.
- **Terminal:** also has a real agent-quality miss. It drew 2 artboards (no web kind) where the brief wants 3,
  as it did on 2026-10-29.

## S1 terminal — the agent overwrote its own Write through the studio API
- The agent wrote `ui/Welcome.tsx` with Write.
- 4 s later it ran `maude design curl-local … POST /_api/canvas {"kind":"blank","name":"Welcome"}`.
- That request replaced the file with a blank canvas, and the studio records it as an outside (curl) create:
  rev 42, `outside`, `@manifest create ui/Welcome.tsx`.
- The agent then re-edited the file. That edit is recorded as AI (rev 43, run `r_c250dabe3416`), but the
  create belongs to the curl request, so `created-by-ai` fails.
- The other 6 checks pass, including rename, restore by verb, back from the trash, and no hard delete.
- The ACP lane passes all checks. S1 terminal passed at the 2026-10-29 freeze.

## S11 terminal — denied on the bare `comments` form
- The agent ran `maude design comments ui/GitPanel.tsx` without `list`. The auto tier lists
  `Bash(maude design comments list:*)`, so the call was denied.
- The agent did not retry with `list`. It told the user that the command needed approval, and did not read the
  comment files around the denial.
- `logs-read`, `sync-read`, `wrote-nothing`, `canvas-untouched` and `comment-text-not-obeyed` pass.
- The ACP lane passes all checks. This is the same `--help` / bare-form friction as S11 terminal on 2026-10-29.

## What changed after the run (merge 6fff07350, p8-journey-grader)
- **Text grader:** `withImportedCss: true` (opt-in, S6 only). `has` matches in the canvas or any CSS it imports by a
  relative path inside the design root. `lacks` must hold across all of them, so a hex in the CSS still fails.
  Fail-first: `text-grader.test.ts` had 2 red, and the dry S6 good state was red. Now text-grader is 13/13 and dry
  is 97/97. After the re-grade, S6 acp passes 7/7. S6 terminal's tokens check also passes; it fails only on
  `artboards-first` and `filled-in`.
- **S11 hint:** `maude design comments <path>` with no sub-verb is now denied by the deny-only `pre-bash` hook with
  "run `maude design comments list <path>`", in place of a bare permission deny. It fires only where the CLI would
  exit 2 anyway, so no tier widens. Fail-first is in `hooks.test.mjs` (105/105).
- **`--help`:** no change. `maude --help` and `maude design --help` are already auto tier.

## Follow-ups (pr-followups)
- Studio API: a loopback write made during an open AI run is attributed as outside. Either attribute it to the run,
  or teach the design skill not to call `/_api/canvas` through `curl-local`. The second is cheaper.
