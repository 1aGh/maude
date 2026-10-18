## Critic panel routing — orchestrator decides

When `/design:critic` is invoked without `--agent`, OR when auto-critic fires after `/design:edit` / `/design:new`, the main agent picks a panel based on canvas content + feedback intent. The panel is the last stage of one pipeline: **deterministic checks → render → keeper → at most 3 critics**. LLM critics see only what `maude design check` and the keeper can't judge, and a bigger panel costs more than it finds (K-agent-architecture §2.6). Always include `design-critic` and `a11y-critic` (universally critical); the third seat goes to the one specialist the routing ranks first (§ The cap).

### Routing inputs

```bash
# Source intent — last feedback the user gave
FEEDBACK=$(cat .design/_last-feedback.txt 2>/dev/null || echo "")

# Canvas signals — grep the active canvas for surface area
CANVAS=<active>
HAS_ANIM=$(grep -cE "@keyframes|transition[: -]|animation:|prefers-reduced-motion" "$CANVAS")
HAS_FORMS=$(grep -cE "<input|<textarea|<select|<form|<label" "$CANVAS")
HAS_NAV=$(grep -cE "<nav|role=\"navigation\"|breadcrumb|sub-rail|sub-nav" "$CANVAS")
HAS_LOGO=$(grep -cE "logos?/|logo[- _\"']|wordmark|brand-mark|Logo\b" "$CANVAS")
HAS_CUSTOM_SVG=$(grep -cE "<svg [^>]*viewBox|\.svg[\"']|DrawProof|dangerouslySetInnerHTML" "$CANVAS")  # custom vector mark
# DS-side brand signal (DDR-141) — an INVENTED inline-<svg> logo carries none of the word
# cues above, which is exactly the canvas that must route brand-critic. DS_ROOT from config.
DS_HAS_BRAND=$(ls "$DS_ROOT"/preview/logo.* "$DS_ROOT"/preview/iconography.* 2>/dev/null | wc -l)
HAS_TYPE_HEAVY=$(grep -cE "<p>|t-body|t-meta|t-title|article|prose" "$CANVAS")  # >5 = type-heavy
HAS_HEAVY_JSX=$(grep -cE "useState|useEffect|useMemo|useCallback|map\\(|\\.filter\\(|key=" "$CANVAS")
HAS_USER_STRINGS=$(grep -cE ">[A-Z][a-zA-Z ]{3,}<|placeholder=|aria-label=|title=" "$CANVAS")  # any user-facing copy
```

### Routing rules

| Critic | Always | Or include when… |
|---|---|---|
| `design-critic` | ✓ | (always — holistic baseline) |
| `a11y-critic` | ✓ | (always — a11y is universal) |
| `signature-moment-critic` |   | **Always for `/design:new`** initial generation. On `/design`: feedback mentions `polish|nicer|elegant|iconic|signature|portfolio|memorable|creative` OR canvas is in `<newCanvasDir>` and `iteration_count < 5`. This is the aspiration axis — measures *presence of greatness*, not absence of badness. |
| `typography-critic` |   | `HAS_TYPE_HEAVY > 5` OR feedback mentions `font|type|leading|measure|tracking|hierarchy` |
| `motion-critic` |   | `HAS_ANIM > 0` OR feedback mentions `animation|transition|motion|prefers-reduced` |
| `brand-critic` |   | `HAS_LOGO > 0` OR (`DS_HAS_BRAND > 0` AND (`HAS_CUSTOM_SVG > 0` OR `/design:new` initial generation)) OR feedback mentions `brand|logo|voice|tone|asset|illustration|photography` — the DS-side clause (DDR-141) catches the invented inline-`<svg>` mark that carries no logo word-cues |
| `copy-critic` |   | `HAS_USER_STRINGS > 0` OR feedback mentions `copy|microcopy|text|label|empty state|error message` |
| `frontend-critic` |   | `HAS_HEAVY_JSX > 10` OR feedback mentions `code|jsx|component|hook|prop|key warning|render` |
| `info-architecture-critic` |   | `HAS_NAV > 0` OR feedback mentions `nav|navigation|hierarchy|menu|breadcrumb|search|filter|sitemap` |
| `graphic-design-critic` |   | feedback mentions `composition|layout|visual|hierarchy|balance|density|rhythm|alignment|spacing` |
| `draw-critic` |   | `HAS_CUSTOM_SVG > 0` OR feedback mentions `logo\|icon\|illustration\|diagram\|svg\|vector\|mark\|draw` — judges **standalone vector art** on the favicon / single-color-flatten / keyline-grid / WCAG axes the other critics don't (see `agents/_draw-design-rules.md`). |

If the routing produces just `design-critic + a11y-critic` (minimum panel), that's fine — those two cover most baseline-quality cases. The conditional ones fire when the canvas / feedback genuinely calls for them.

### The cap — at most 3 critics

The routed panel is `design-critic` + `a11y-critic` + **at most one** specialist. When the table above matches several, the third seat goes to the first match in this order:

1. **A specialist the person asked for** — its feedback cue matched (`font…` → `typography-critic`, `polish…` → `signature-moment-critic`, …). When several cues match, take the first in the order of rule 3.
2. **`/design:new` initial generation → `signature-moment-critic`.** Brand reuse is still checked: the keeper's Pass A.8 covers it, as a blocker under `dsFidelity: strict`.
3. **The canvas signal**, in this order: `draw-critic` (a custom mark) → `brand-critic` → `motion-critic` → `info-architecture-critic` → `typography-critic` → `copy-critic` → `frontend-critic` → `graphic-design-critic`. The deterministic checks already catch much of what the later ones would.

The specialists that matched but did not get the seat are listed in the panel's TL;DR, so the person can run one with `/design:critic --agent <name>`. Only `--all` and `--agent` go past the cap, and only because the person asked for exactly that.

**Why `signature-moment-critic` is its own axis:** the other critics are *correctness* gates. Without an aspiration gate, the auto-fix loop converges on "all checks green" — which is exactly competent stock. `signature-moment-critic` measures composition, brand prominence, mock fidelity, restraint, negative space, and a specificity gate (no Lorem / placeholder content). It's the difference between a canvas that *passes* and one a designer would *screenshot*.

The **selected element** narrows the same routing — if `_active.json.selected` is set, run grep on the selected element's outerHTML instead of the whole canvas. (Targeted critique = targeted panel.)

### Spawning the panel — one hand-off per critic

Every critic is spawned with a **`maude.agent-handoff/1` hand-off** (contract V2-1.18 §5.2; the full recipe and a sample are `/design:critic` step 6). Write `$RUN/handoff/<critic>-<n>.in.json`, in the run folder the design plugin's hook named for this conversation, with `<n>` the round. Then spawn the picked critics **in parallel**, with one message containing N `Agent` tool calls, each prompt starting with that JSON. A critic's `owns` is only its result (`output`) and its report next to it, never the canvas. The hook refuses any other write `out-of-scope`, and the critic runs `maude design check <output>` before it stops. You read each `HandoffOut`, map it to the verdict (`handoffToCriticVerdict`, `/design:critic` step 7), aggregate, and write `panel-<n>.md`. **The main agent applies every fix**; a critic never does.

**Every hand-off MUST carry the opt-out scope** as `context.styleContract.optOutScope`. It comes from the `--opt-out=<scope>` flag, else from the `opt_out_scope` field of the canvas's `.meta.json`, else `palette`. Critics that honor the scope (design-stack) downgrade their DS-rule findings; critics that ignore it (a11y / frontend / copy) put `"opt_out_applied": "n/a"` in `result.verdict` for auditability. The auto-fix loop's SOLID stop condition reads each critic's post-downgrade `blockers` count — so honoring scope at critic level naturally flows into the loop's exit logic without separate filter code.

**Carry the DS fidelity too (DDR-141)** as `context.fidelity`. It comes from `config.dsFidelity` (`strict` → `strict`, `advisory` → `loose`), and scope `full` makes it `loose` (see "dsFidelity — severity of reuse findings"). `design-system-keeper` gets it as `ds_fidelity` in its own envelope (Passes A / A.6 / A.8 severity); `brand-critic` reads it for the canonical-mark identity check; all other critics ignore it. Same flow-through: severity is decided at critic level, the loop just counts post-severity blockers.

### Streaming critic verdicts (Phase C / DDR-061)

Each critic writes its result `$RUN/handoff/<critic>-<n>.out.json` **the moment it finishes** — they don't buffer until the whole panel completes. Use that to drop perceived latency: **start a Monitor on the run's `handoff/` folder as the panel spawns**, and print a one-line status as each result lands rather than one silent block at the end:

```sh
# Monitor emits one line per critic result of this round (<n>) that validates.
until [ "$(ls "$RUN"/handoff/*-critic-"$N".out.json 2>/dev/null | wc -l)" -ge "$PANEL_SIZE" ]; do
  for f in "$RUN"/handoff/*-critic-"$N".out.json; do
    [ -f "$f" ] && maude design check "$f" >/dev/null 2>&1 && echo "✓ $(basename "$f" -"$N".out.json): landed"
  done
  sleep 1
done
```

Print `✓ a11y-critic: 0 blockers, 2 warnings` as each result becomes readable. **The consolidated `panel-<n>.md` is still written LAST**, after every critic has returned — it stays the single source the auto-fix loop reads (the loop never consumes the partial per-critic results for its stop condition; it reads the panel). Streaming is a *display* optimization layered on top; it must not change the consolidated contract.

**Fallback:** if `run_in_background` / Monitor is unavailable (restrictive sandbox), spawn the panel synchronously as before and write PANEL.md when all return — no behavior loss, just no progressive print.

### Panel consolidation report

`$RUN/critique/panel-<n>.md` schema:

```markdown
# Critic panel — iter {N}

_{ISO ts} · canvas: `{path}` · critics: design-critic, a11y-critic, ... · total blockers: X · total warnings: Y_

## TL;DR

**Blockers: X** · Warnings: Y · Verdict: pass | fix-and-retry | divergent

{1–2 sentence synthesis across critics.} Not run (cap of 3): {matched specialists left out, or "—"}.

## Blockers (sorted by category)

### check (1)
1. [check L88] {id-duplicate · …}. Fix: {…}.

### a11y (3)
1. [a11y-critic L245] {summary}. Fix: {…}.
…

### ds-tokens (2)
1. [design-critic L312] {summary}. Fix: {…}.
…

## Warnings

…

## Per-critic reports

| Critic | Blockers | Warnings | Result · report |
|---|---|---|---|
| check | 1 | 0 | critique/check-<n>.json |
| design-system-keeper | 0 | 2 | critique/keeper-<n>.json |
| design-critic | 2 | 4 | handoff/design-critic-<n>.out.json · critique/design-critic-<n>.md |
| a11y-critic | 1 | 0 | handoff/a11y-critic-<n>.out.json · critique/a11y-critic-<n>.md |
…

## Verdict

```json
{
  "panel": ["design-critic", "a11y-critic", ...],
  "not_run": ["typography-critic"],
  "iter": N,
  "total_blockers": X,
  "total_warnings": Y,
  "by_critic": { "check": { "blockers": 1, "warnings": 0 }, "design-critic": { "blockers": 2, "warnings": 4 }, ... },
  "top_blockers_across_panel": [
    { "agent": "a11y-critic", "category": "contrast", "line": 245, "summary": "...", "fix": "..." },
    ...
  ],
  "passed": (X == 0)
}
```
```
