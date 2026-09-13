## Read the config first

Read `orchestration.*` from `.ai/workflows.config.json` (all knobs; never hardcode thresholds):

- `mode` — **opt-out, default `auto`.** `auto` (relay-if-capable else reduce) · `reduce` (panel + consolidator, never a live team) · `off` (today's raw single-pass / sum-of-verdicts, run nothing here). **An absent `orchestration` block (or absent `mode`) is treated as `auto` — the debate is ON by default; a user adds the block ONLY to dial it down (`reduce`) or off (`off`).**
- `bookends.{diverge,adversarial,research}.enabled` — per-shape opt-out (default `true`; set `false` to silence one shape).
- `maxSeats` (2–4 cap) · `escalationCeiling` (escalation-rate warning threshold) · `designTeam.{enabled (opt-out, default true),minConflicts}`.

**Resolution:** absent block / `mode:auto` → debate ON (live `relay` when native team messaging is available and enabled, else the `reduce` panel). `mode:off` → run the command's pre-debate behavior unchanged. So a downstream repo that just installs the plugin gets the debate by default — `reduce` if it never enabled the experimental flag (cheap, no live teams), `relay` when enabled native messaging is actually available. Nothing to configure to turn it **on**; one line (`"orchestration": { "mode": "off" }`) to turn it **off**.
