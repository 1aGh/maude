## Incremental refresh — `--only`

A DDR written straight to disk (not through `/flow:record-ddr`) leaves the graph stale. Refresh just that one:

```bash
maude kg import --only "DDR-191"          # or several: --only "DDR-006,DDR-191"
```

Bypasses the migration marker, skips the log sweep, doesn't re-stamp the marker. **Re-ingesting an existing DDR is the supported way to refresh a changed file** — deterministic identity converges the element and props merge; it appends one more decision event, which is the honest record of "this was re-recorded."
