## Integration with the workflow

| Trigger | Action |
|---|---|
| `/flow:utils-verify` fails during `/flow:execute` | Apply Phase 1 before the iteration counter increments. Symptom fixes burn iterations. |
| `/flow:validate` blocker (scenario, a11y, design) | Phase 1 evidence gathering before fix attempt. Cross-platform divergence often points to a config / build / env delta. |
| Ticket triage | `/flow:bug-rca` produces an RCA document = Phase 1 + 2 output. `/flow:bug-fix` continues with Phase 4 (failing test → minimal fix). Provider per `integrations.tracker.provider`. |
| 3+ failed fix attempts | Stop, write a DDR proposing an architectural change. Don't attempt fix #4. |
