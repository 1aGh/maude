### 0. Pre-flight: bootstrap detection

Before scaffolding a canvas, check whether the project has a usable design system. Canonical recipe is `maude design bootstrap-check` (the on-PATH `maude` binary dispatches to the bundled helper — DDR-062) — exits 0 (ready) / 10 (needs `/design:init`) / 11 (needs `/design:setup-ds`). Use `--shell-export` to populate `HAS_DS`/`CONFIG_PRESENT`/`KNOWN_DS`/`DEFAULT_DS`/`REPO_ROOT`/`BOOTSTRAP_EXIT`:

```bash
eval "$(maude design bootstrap-check --shell-export)"
```

| State | Action |
|---|---|
| `HAS_DS=true` | Skip to step 1. **If `--ds=<name>` was passed**, validate it against `config.json.designSystems[].name`. Unknown DS → fail with:<br/>`Error: design system "<name>" not found in config.json.designSystems[].`<br/>`Available: <list>`<br/>`To create: /design:setup-ds <name> "<brief>"`<br/>**No fallback prompt** — clean separation between canvas creation (`new`) and DS creation (`setup-ds`). Resolve the DS's tokens + component HTML and pass as context to `frontend-design`. Write the chosen `designSystem` name into the new canvas's `.meta.json`. |
| `HAS_DS=false`, `CONFIG_PRESENT=false` | Print `→ Running /design:init to initialize project…` and invoke `/design:init --skip-prompts`. Then invoke `Skill design-system` with `mode_hint=bootstrap`, `target_ds=project`, `brief=$BRIEF`. After bootstrap returns, continue to step 1 and create the canvas with the freshly-scaffolded tokens. |
| `HAS_DS=false`, `CONFIG_PRESENT=true` | Invoke `Skill design-system` with `mode_hint=bootstrap`, `target_ds=project`, `brief=$BRIEF` directly. After bootstrap returns, continue to step 1. |

The skill treats `$BRIEF` as the answer to discovery Question 1 (product one-liner) and runs the full 8-question discovery, scaffolds the DS, runs the completeness-critic, and returns. The canvas creation then proceeds with the project's actual tokens (not a default placeholder set).
