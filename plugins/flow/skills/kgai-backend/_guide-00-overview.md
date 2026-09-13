

# kgai backend resolver

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

Teaches every flow/design command **one** thing: is the kgai knowledge-graph active here, and if so, how do I read/write/sync it? This skill is the **single source of truth** — a command NEVER re-implements capability detection, scope tagging, or the untrusted-data guard. It reads the config, probes the capability, and hands back a resolved `{active, mode, store, scope}` plus the canonical recipes.

kgai is [an event-sourced decision knowledge graph](https://github.com/kgaidev/kgai): an append-only content-addressed log projected into Kuzu, with a `kg` CLI (`init/ingest/context/history/search/as-of/conflicts/sync`). When active, it replaces the file-based `.ai/decisions/` + `.ai/state/STATE.md` history layer. When inactive, everything falls back to today's `.ai/` file behavior — **no regression, nothing to configure downstream.**
