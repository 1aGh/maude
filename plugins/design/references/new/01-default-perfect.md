## Default = `--perfect`

`/design:new` is a **high-leverage moment** — the initial scaffold sets the canvas trajectory for all future `/design:edit "<feedback>"` iterations. Cheap to under-do, expensive to refactor after the fact. That's why the critic panel is **always on, always full, always targeting portfolio-grade**:

- **max 8 iterations** auto-fix loop
- **aspiration target 4.5 / 5**
- **panel:** `signature-moment-critic` + `design-critic` + `frontend-critic` + `a11y-critic` (if the canvas has interactive elements) — minimal set; see step 10 for routing detail
- **token cost:** ~150–300k per `/design:new` invocation. This is the deal — it applies always, not by accidental default.

Opt-out flags (for deliberate exceptions):

| Flag | What it does | When to use |
|---|---|---|
| (none) | Full `--perfect` loop. **Default.** | Standard — you want a solid starting point. |
| `--quick` | 1 critic (`signature-moment-critic`) + max 2 fix iter, no full panel | Throwaway exploration ("can we even render a chart canvas?"), proof-of-concept |
| `--no-critic` | Skip auto-critic loop entirely (just generate + reality-check) | Test / debug runs where you only verify the file gets created |
| `--perfect-iter N` | Override max iterations (default 8) | Large canvases (10+ artboards) that need more iterations; or small ones where 4 is enough |
| `--skip-ds-keeper` | Skip the `design-system-keeper` precheck (step 9.5) | Known-experimental canvases where reinvention is the intent; debug runs |

**The mode is not opt-in.** The mode is **opt-out**. If the user doesn't want to pay the cost, they must explicitly say `--quick` or `--no-critic`. Silence is consent to the full loop.

**Input `$ARGUMENTS`:** `<Name> "<brief>" [--component] [--mobile] [--quick | --no-critic] [--perfect-iter N] [--ds=<name>]`

- `<Name>` — Title-Case with spaces (`Match Recap`, `Scout Radar`) for a full-screen canvas project.
  - PascalCase (`MatchRecap`) when it's a component with `--component`.
- `<brief>` — what the canvas should do / look like. Describe **everything the canvas will contain** here (how many artboards, which screens, what flow), not a single screen.
- `--component` — creates `<designRoot>/<newComponentDir>/<PascalName>.jsx` instead of top-level HTML. Components mount inside canvas artboards.
- `--mobile` — hints a mobile aesthetic in the prompt (mobile chrome, single column). Default = desktop. If the name contains "Mobile" / "iOS" / "Android", auto-detect.
- `--quick` | `--no-critic` | `--perfect-iter N` — see the table above.
- `--ds=<name>` — pick which design system this canvas uses (multi-DS projects). Must match a name in `config.json.designSystems[]`. Default = `config.defaultDesignSystem`, falling back to `project` for single-DS layouts. **Unknown DS fails with hint to `/design:setup-ds <name>` — no fallback prompt** (clean separation: `new` does canvases, `setup-ds` does DS creation).
- `--opt-out=palette|aesthetic|full` — opt out z project DS rules. **Default = `palette`** (tokens link + rootClass envelope kept; local namespaced palette overrides colors only; type/radii/aesthetic still enforced). `aesthetic` = palette + gradients/off-ladder radii/alt type pairings/decorative SVGs allowed. `full` = DS treated as advisory. **A11y enforced at every scope.** Plain-language opt-out signals in the brief ("opt-out design system", "modern color scheme", "different feel", "fully off-system") trigger an inferred scope + one-shot AskUserQuestion before the loop kicks off — see SKILL.md "Opt-out scope" + "Iter-1 checkpoint when scope > palette".

**Backwards compat:** `--perfect` and `--perfect --all` are still accepted (no-op for `--perfect` on its own, `--all` expands the panel to **every** critic in `agents/`). A user who writes `--perfect` explicitly gets what they expect.

**Examples:**
```
/design:new "Match Recap" "Post-game recap canvas — 3 artboards: hero stat card, key moments timeline, share/embed view"
/design:new "Onboarding Desktop" "5-step onboarding flow — welcome, invite preview, identity, permissions, tour. Each as separate DCArtboard."
/design:new "Scout Radar Mobile" "Radar/sonar circular sweep finder — single full-screen canvas with 2 artboards: scanning + result list" --mobile
/design:new MatchRecap "..." --component                   # component in components/
/design:new "iOS Bikeshare Signup" "5-screen iOS signup flow, modern blue+orange palette" --mobile --opt-out=aesthetic
/design:new "Marketing Hero" "Landing hero with feature grid" --ds=marketing
/design:new "Onboarding brief" --blank                          # empty annotation-only brief board, zero model cost
/design:new                                                     # ingest: active brief-board's notes → artboards in the SAME canvas
```
