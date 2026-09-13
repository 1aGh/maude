## The two artifacts (schema: `apps/studio/footage/schema.ts`)

- `assets/<sha8>.footage.json` — a `FootageAnalysis` (per clip). **Seconds-based.**
- `<designRoot>/<slug>.edl.json` — an `Edl` (per cut). Beats are **output-frame-based**;
  `startSec` is the only seconds value (source in-point).

Both are **VERSIONED** (DDR-115 — they commit + sync like `.meta.json`). Written
only via the loopback `PUT /_api/footage` route (validated); read with a plain GET.
