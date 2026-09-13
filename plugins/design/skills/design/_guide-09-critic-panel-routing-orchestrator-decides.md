## Critic panel routing — orchestrator decides

When `/design:critic` is invoked without `--agent`, OR when auto-critic fires after `/design` / `/design:new`, the orchestrator picks a panel based on canvas content + feedback intent. Always include `design-critic` and `a11y-critic` (universally critical). Then conditionally add specialists.

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

**Why `signature-moment-critic` is its own axis:** the other critics are *correctness* gates. Without an aspiration gate, the auto-fix loop converges on "all checks green" — which is exactly competent stock. `signature-moment-critic` measures composition, brand prominence, mock fidelity, restraint, negative space, and a specificity gate (no Lorem / placeholder content). It's the difference between a canvas that *passes* and one a designer would *screenshot*.

The **selected element** narrows the same routing — if `_active.json.selected` is set, run grep on the selected element's outerHTML instead of the whole canvas. (Targeted critique = targeted panel.)

### Spawning the panel

The orchestrator spawns the picked critics **in parallel** with one message containing N `Agent` tool calls. Each critic writes its own report; the orchestrator parses each JSON verdict, aggregates, and writes `<NNN>-PANEL.md`.

**Every Agent invocation MUST pass `opt_out_scope`** in the prompt — read from the canvas's `<active>.meta.json` `opt_out_scope` field, or override from `--opt-out=<scope>` flag, or default `palette`. Critics that honor the scope (design-stack) will downgrade their DS-rule findings; critics that ignore it (a11y / frontend / copy) emit `"opt_out_applied": "n/a"` for auditability. The auto-fix loop's SOLID stop condition reads each critic's post-downgrade `blockers` count — so honoring scope at critic level naturally flows into the loop's exit logic without separate filter code.

**Pass `ds_fidelity` too (DDR-141)** — resolved from `config.dsFidelity` with scope-`full` overriding to `advisory` (see "dsFidelity — severity of reuse findings"). Consumed by `design-system-keeper` (Passes A / A.6 / A.8 severity) and `brand-critic` (canonical-mark identity check); all other critics ignore it. Same flow-through: severity is decided at critic level, the loop just counts post-severity blockers.

### Streaming critic verdicts (Phase C / DDR-061)

Each critic writes its own `critique/<NNN>-<agent>.md` (verdict JSON at the bottom) **the moment it finishes** — they don't buffer until the whole panel completes. Use that to drop perceived latency: **start a Monitor on the critique directory as the panel spawns**, and print a one-line status as each report lands rather than one silent block at the end:

```sh
# Monitor emits one line per critic report that appears since the panel started.
# Seed COUNT from the iteration's NNN prefix so prior iterations' files don't match.
until [ "$(ls "$CRITIQUE_DIR"/${NNN}-*-critic.md 2>/dev/null | wc -l)" -ge "$PANEL_SIZE" ]; do
  for f in "$CRITIQUE_DIR"/${NNN}-*-critic.md; do
    [ -f "$f" ] && grep -l '"passed"' "$f" >/dev/null 2>&1 && echo "✓ $(basename "$f" .md | sed 's/^[0-9]*-//'): landed"
  done
  sleep 1
done
```

Print `✓ a11y-critic: 0 blockers, 2 warnings` as each verdict JSON becomes readable. **The consolidated `<NNN>-PANEL.md` is still written LAST**, after every critic has returned — it stays the single source the auto-fix loop reads (the loop never consumes the partial per-critic files for its stop condition; it reads PANEL.md). Streaming is a *display* optimization layered on top; it must not change the consolidated contract.

**Fallback:** if `run_in_background` / Monitor is unavailable (restrictive sandbox), spawn the panel synchronously as before and write PANEL.md when all return — no behavior loss, just no progressive print.

### Panel consolidation report

`<NNN>-PANEL.md` schema:

```markdown
# Critic panel — iter {N}

_{ISO ts} · canvas: `{path}` · critics: design-critic, a11y-critic, ... · total blockers: X · total warnings: Y_

## TL;DR

**Blockers: X** · Warnings: Y · Verdict: pass | fix-and-retry | divergent

{1–2 sentence synthesis across critics.}

## Blockers (sorted by category)

### a11y (3)
1. [a11y-critic L245] {summary}. Fix: {…}.
…

### ds-tokens (2)
1. [design-critic L312] {summary}. Fix: {…}.
…

## Warnings

…

## Per-critic reports

| Critic | Blockers | Warnings | Report |
|---|---|---|---|
| design-critic | 2 | 4 | NNN-design-critic.md |
| a11y-critic | 1 | 0 | NNN-a11y-critic.md |
…

## Verdict

```json
{
  "panel": ["design-critic", "a11y-critic", ...],
  "iter": N,
  "total_blockers": X,
  "total_warnings": Y,
  "by_critic": { "design-critic": { "blockers": 2, "warnings": 4 }, ... },
  "top_blockers_across_panel": [
    { "agent": "a11y-critic", "category": "contrast", "line": 245, "summary": "...", "fix": "..." },
    ...
  ],
  "passed": (X == 0)
}
```
```
