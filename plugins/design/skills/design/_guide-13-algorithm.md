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
  # 1. Run critic panel (routing logic above)
  panel = pick_panel(canvas, feedback, selected)   # routing forces signature-moment-critic for /design:new
  spawn panel in parallel                           # optionally Monitor critique/ for progressive per-critic status (Phase C / DDR-061)
  parse JSON verdicts → aggregate
  write iter NNN-PANEL.md                            # written LAST, after all critics return — the loop reads THIS, not the partial per-critic files

  correctness = sum_blockers_across(panel except signature-moment-critic)
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
  snapshot canvas
  apply edit (Edit tool, scoped to top blocker if line N is set; canvas-wide for aspiration fixes)
  validate (tokens link, rootClass)
  if validation fails:
    restore from snapshot
    refresh_docs()
    exit validation-failed

  prev = { correctness, aspiration }

# refresh_docs() is the function spec'd in "Continuous docs maintenance" below.
# It is wired in at every loop exit point — success, stable-but-bland, max-reached,
# divergent, validation-failed. Even --no-critic (loop skipped entirely) calls
# refresh_docs() once after the single edit.
```

**No exit path skips `refresh_docs()`** — that's what makes the design root self-documenting. The only way it gets stale is if the user invokes `Edit` directly on a canvas file outside `/design:edit`, in which case `/design:setup-docs --full` is the recovery.
