## Sidecar cache freshness gate (Phase C / DDR-061)

The date/file-count heuristics above are fuzzy. The sidecar cache adds a **deterministic** freshness signal: key a `codebase-intelligence` cache entry on the repo's content SHA so a consumer can confirm "the map reflects the exact current tree" in one cheap check, and skip rescanning entirely when nothing changed.

Access the cache through the **`maude` CLI** (`maude cache get/put`) — a declared plugin dependency, always on PATH. Don't reach `cli/lib/cache.mjs` by relative path: the marketplace copies each plugin alone, so the repo's `cli/` isn't beside it (DDR-061). The cache root resolves automatically to `$CLAUDE_PROJECT_DIR/.ai/cache`.

**Content key** — committed HEAD plus working-tree dirtiness, so an uncommitted edit invalidates too:

```sh
FILES_SHA=$( { git rev-parse HEAD 2>/dev/null; git status --porcelain 2>/dev/null; } | git hash-object --stdin | cut -c1-12 )
```

**Check before rescanning** (used by `/flow:plan` and `/flow:utils-verify`). `maude cache get` prints the value on a hit (exit 0) and is silent on miss (exit 1):

```sh
MAP_HIT=$(maude cache get codebase-intelligence "$FILES_SHA")
```

If `$MAP_HIT` is non-empty, its `mapPath` (`.ai/context/codebase-map.md`) already reflects this exact tree — **read it, skip the rescan**. If empty, (re)generate the map per the schema above, then record the new key:

```sh
printf '{"mapPath":".ai/context/codebase-map.md","generatedAt":"%s"}' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  | maude cache put codebase-intelligence "$FILES_SHA"
```

This layer is **committed** (SHA-keyed, shareable across collaborators — see `.gitignore`), so a teammate on the same commit gets the freshness hit without rescanning. Correctness is automatic: the content SHA changes whenever any tracked file changes, so a stale map can never produce a hit.
