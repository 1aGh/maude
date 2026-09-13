## 1. Read the config first (the resolver)

**Store resolution is primarily the ENGINE's job since kgai v1.5.1.** A repo with a committed `.kgairc` (project layer of the engine's three-layer config: session `<store>/kg.config.json` → project `.kgairc` → global `~/.kgai/config.json`) resolves its store through `kg config` — typically to a shared parent-folder store like `../.kgai-shared`. For `.kgairc`-enrolled repos, **`kg config` → `store_root` is the source of truth**; don't second-guess it from Maude config.

Read `knowledgeGraph.*` from `.ai/workflows.config.json` (all knobs; never hardcode). Design-only repos read the same block from the same file.

```
mode    = config.knowledgeGraph.mode    ?? "auto"     # auto (default) | on | off
store   = config.knowledgeGraph.store   ?? ""         # fallback/override for maude verbs — see below
scope   = config.knowledgeGraph.scope   ?? {}         # { repo, dept } — stamped on every write
capture = config.knowledgeGraph.capture ?? { decisions:true, state:true, auto:true }
```

- `knowledgeGraph.store` **remains as a fallback/override for the `maude kg` verbs** — repos without a `.kgairc` (legacy per-repo `.kgai/store`, or an explicit remote-only setup) still resolve through it. When both exist, the engine's `.kgairc` resolution wins for anything the engine itself does; the Maude config value is only consulted when `kg config` yields no store.
- **Scope fallback:** when `knowledgeGraph.scope` is absent (a `.kgairc`-enrolled repo that never got a config block), derive `repo` from `git remote get-url origin` (repo name, sans `.git`) and default `dept` to `dev` — the same rule the shared `.kgairc` capture prompt states.
- `engineVersion` is now a **floor, not a pin**: minimum **v1.5.1** (the `.kgairc` / `kg trust` / `kg config` surface). The engine installs and self-updates via the official installer; check with `kg version`.

**An absent `knowledgeGraph` block is treated as `mode:auto`** — exactly like `orchestration`. A user adds the block only to dial down (`off`) or force (`on`).
