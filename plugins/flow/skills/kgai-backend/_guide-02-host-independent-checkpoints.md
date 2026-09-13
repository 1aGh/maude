## Host-independent checkpoints

Run memory bookends explicitly in both hosts. Before structural work, resolve
mode/store/trust and read relevant prior decisions. At completion or pause,
capture actual decisions made in this run once, respecting the capture settings;
then follow the configured sync policy. Pure research or unacted recommendations
are not decisions. Do not wait for a Stop hook: kgai's Claude transcript scanner
does not establish that Codex edits were captured.

`maude kg resolve --json` may report an empty Maude config store while the engine
resolves a trusted `.kgairc` shared store. Check `kg config` before treating an
empty field as absence; follow the capability rules below. Do not override a
trusted engine store or switch to another repository's graph. If the wrapper
cannot reach that store, report the mismatch and use the engine's `kg context` /
`kg ingest` with its existing resolved configuration and the same scope contract.
For local-only stores, no remote pull/push is required or authorized by a close.
