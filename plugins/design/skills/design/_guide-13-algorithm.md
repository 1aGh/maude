### Algorithm

```
# Tunable per mode (see "Default flow vs. --perfect" table)
max_iter            = 4 (default flow) | N (--perfect, default 8)
aspiration_target   = 4.0 (default flow) | 4.5 (--perfect)
divergence_tolerance = 1 (default flow) | 2 (--perfect)

prev = { correctness: ∞, aspiration: 0 }
best_snapshot = none
best_score = -∞               # weighted: -correctness + aspiration
diverge_count = 0
no_gains_count = 0

# Always append iteration 0 to chat.md (initial edit / generate)
append_to_chat_md(iter=0, feedback, selected, snapshot_id, edit_summary, critic_verdict=null)

for iter in 1..max_iter:
  # 1. One round of the pipeline: deterministic checks → render → keeper → ≤ 3 critics
  check   = `maude design check <canvas> --tier stop --json`   # errors count as correctness blockers
  shots   = `maude design screenshot --canvas <canvas> --all-screens --out-dir $RUN/critique/shots-<n>/`
  keeper  = design-system-keeper (when its trigger fires — /design:new 9.5, /design:edit 7.5)
  panel   = pick_panel(canvas, feedback, selected)   # ≤ 3; routing gives signature-moment-critic the third seat on /design:new
  for critic in panel: write $RUN/handoff/<critic>-<n>.in.json   # owns = its result + its report, never the canvas
  spawn panel in parallel                           # optionally Monitor $RUN/handoff/ for progressive per-critic status (Phase C / DDR-061)
  verdicts = [handoffToCriticVerdict(out) for each valid <critic>-<n>.out.json]   # `maude design check <out>` first
  reduce-pass (DDR-130) → write $RUN/critique/panel-<n>.md   # written LAST — the loop reads THIS, not the partial results
  # never post comments here — only an explicit /design:critic does (one batched call)

  correctness = check.errors + sum_blockers_across(panel except signature-moment-critic) + keeper.blockers
  aspiration  = signature-moment-critic.aspiration_score (or 5 if not in panel)
  specificity = signature-moment-critic.specificity      (or "pass" if not in panel)

  # 2. Update best-snapshot tracking — composite score
  current_score = -correctness * 10 + aspiration   # correctness dominates aspiration
  if current_score > best_score:
    best_score = current_score
    best_snapshot = current_snapshot_id

  # 3. Track gain delta
  gained = (correctness < prev.correctness) OR (aspiration > prev.aspiration + 0.1)
  if !gained:
    no_gains_count += 1
  else:
    no_gains_count = 0

  # 4. Append this iteration to chat.md
  append_to_chat_md(iter, feedback, selected, snapshot_id, edit_summary, critic_verdict)

  # 5. Exit conditions (in order)
  if correctness == 0 AND aspiration >= aspiration_target AND specificity == "pass" AND no_gains_count >= 1:
    refresh_docs()
    print "✓ solid — correctness clean, aspiration {aspiration}/5, stable"
    exit success

  if correctness == 0 AND specificity == "pass" AND no_gains_count >= 2:
    # Correctness is clean and we're stuck on aspiration — surface diagnostic, don't loop forever
    refresh_docs()
    print "⚠ stable but {aspiration}/5 (target {aspiration_target}) — surfacing for review"
    print "  Lowest axes: {top 2 axes from signature-moment-critic with score < target}"
    exit stable-but-bland

  if iter == max_iter:
    if best_snapshot != current_snapshot:
      restore best_snapshot
      print "↺ restored to best (iter {best_iter}, correctness {best.c}, aspiration {best.a}/5)"
    refresh_docs()
    print "⚠ max iterations reached"
    exit max-reached

  # 6. Divergence — both axes worsening
  diverged = (correctness > prev.correctness) AND (aspiration < prev.aspiration - 0.3)
  if diverged:
    diverge_count += 1
    if diverge_count >= divergence_tolerance:
      restore best_snapshot
      refresh_docs()
      print "✗ divergence: scores worsened {diverge_count}× — restored to best"
      exit divergent
  else:
    diverge_count = 0

  # 7. Auto-fix — craft prompt from top blockers (correctness + aspiration mixed, sorted)
  fix_prompt = build_fix_prompt(
    top_blockers_across_panel,         # combines correctness blockers AND aspiration top_blockers
    max = 3,
    sort_by = "severity"               # severity: a11y > ds-tokens > specificity > signature > restraint > others
  )
  # snapshots: the design plugin's pre-edit hook saves the bytes before each of your edits (_guide-07)
  apply edit (Edit tool — you, never a critic; scoped to top blocker if line N is set; canvas-wide for aspiration fixes)
  validate: the post-edit hook runs `maude design check --tier fast`; a failed check blocks the edit and restores the file
  if validation fails (the hook blocked the fix twice for the same blocker):
    refresh_docs()
    exit validation-failed

  prev = { correctness, aspiration }

# refresh_docs() is the function spec'd in "Continuous docs maintenance" below.
# It is wired in at every loop exit point — success, stable-but-bland, max-reached,
# divergent, validation-failed. Even --no-critic (loop skipped entirely) calls
# refresh_docs() once after the single edit.
```

**No exit path skips `refresh_docs()`** — that's what makes the design root self-documenting. The only way it gets stale is if the user invokes `Edit` directly on a canvas file outside `/design:edit`, in which case `/design:setup-docs --full` is the recovery.
