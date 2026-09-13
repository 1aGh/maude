## 2. The capability gate — resolve `active`

```
kgPresent    = `command -v kg` succeeds
storeResolvable = `kg config` resolves a store_root (covers .kgairc)
                  OR config store != "" OR a legacy local .kgai/store dir exists

active = mode == "on"  ? true                          # force (errors surface, no silent fallback)
       : mode == "off" ? false                         # classic .ai/ path, byte-for-byte unchanged
       : /* auto */      (kgPresent && storeResolvable) # conservative — first-run repos stay on files
```

**`pending_approval` is its own state, not "inactive" and not yours to fix.** A committed `.kgairc` does nothing until a human on this machine approves it — no store is created, and `kg config` reports `pending_approval`. When the resolver sees that: treat the graph as **inactive for this run** (classic `.ai/` path), tell the user once — "this repo has a committed `.kgairc` awaiting approval; review it with `kg trust --show` and approve with `kg trust`" — and **NEVER run `kg trust` yourself**. Approving a capture prompt injected into future sessions is a human trust decision; the skill may run it only on the user's explicit instruction.

The resolver is available as `maude kg resolve --json` (prints `{active, mode, store, scope}`), so a command can gate in one call instead of re-deriving. **If `active == false`, do NOTHING kgai — run the command's classic `.ai/` path unchanged.** This is the load-bearing no-regression invariant (memory `feedback-no-break-exhaustive-verify`): the `else` branch is today's behavior verbatim.

**Never hard-fail a command on kgai.** `kg` missing / store unreachable / `kg` error ⇒ warn once, fall back to the classic path. Only `mode:on` surfaces errors instead of falling back (the user asked for it explicitly).
