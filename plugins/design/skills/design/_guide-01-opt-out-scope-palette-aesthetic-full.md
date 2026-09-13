## Opt-out scope — palette / aesthetic / full

When a user invokes `/design:new` or `/design` with `--opt-out=<scope>` (or signals an opt-out in plain language — "opt-out design system", "modern color scheme", "different feel"), the orchestrator picks one of three scopes. The scope flows into the auto-critic loop and gets persisted on the canvas's `.meta.json`.

| Scope | What's relaxed (vs. project DS) | Critics that downgrade matching DS-rule blockers → warnings | Critics that stay strict |
|---|---|---|---|
| `palette` *(default)* | Palette only — local namespace overrides colors. Type / radii / icons / aesthetic still enforced. | (none) | all |
| `aesthetic` | Palette + decorative aesthetic — gradients, off-ladder radii, alternate type pairings, decorative SVG/emoji glyphs allowed inside the namespace. | `design-critic`, `graphic-design-critic`, `typography-critic`, `signature-moment-critic` (does *not* penalize accent/gradient choices as "restraint" violations) | `a11y-critic`, `frontend-critic`, `copy-critic`, `motion-critic` (motion duration tokens still apply), `info-architecture-critic`, `brand-critic` |
| `full` | DS treated as advisory. Type / radii / aesthetic up to canvas. | `design-critic`, `graphic-design-critic`, `typography-critic`, `signature-moment-critic`, `info-architecture-critic`, `brand-critic` (only for *DS-rule* findings, not asset integrity), `motion-critic` (DS motion-token rule downgraded; reduced-motion stays strict) | `a11y-critic`, `frontend-critic`, `copy-critic` |

### Validation envelope — kept at every scope

`<link rel="stylesheet" href="<tokensCssRel>">` and `<body class="<rootClass>" data-theme=…>` survive every opt-out. Step-6 validation greps for them and rolls back the snapshot if missing. The opt-out widens the critic *judgement bar*; it does not strip the file's structural envelope.

### A11y is independent of opt-out

WCAG hard-stops (contrast, semantics, focus, motion-respect, touch targets, form labels) apply at every scope. `a11y-critic` and `frontend-critic` do not honor `opt_out_scope` — their blockers stay blockers. Treating a11y as a separate axis is the only safe way to offer broader visual exploration.

### `dsFidelity` — severity of reuse findings, same axis as scope (DDR-141)

`config.dsFidelity: "advisory" | "strict"` (default `advisory`) decides how hard **specimen reuse** is enforced — whether reinventing something the DS already ships (canonical logo, iconography family, component shape, platform showcase shell) is a warning or a blocker:

- **`advisory`** (default) — reuse findings from `design-system-keeper` (Passes A / A.6 / A.8) and `brand-critic`'s canonical-mark check surface as **warnings**. Today's behavior; zero regression for projects that never set the knob.
- **`strict`** — the "DS at any cost" contract: those findings arrive as **blockers**, tagged `category: ds`, and count toward the auto-fix loop's correctness gate — the loop cannot exit `SOLID` while a shipped specimen stays reinvented.

**One axis, not two competing switches.** `dsFidelity` composes with `opt_out_scope`: the *resolved* scope is applied first, and a scope of **`full` always overrides `strict` to `advisory`** — an explicit per-canvas free-use decision beats project policy. At `aesthetic`, strict still binds whatever that scope doesn't relax (brand mark identity and component reuse bind; gradients/radii/type do not). Inventing remains legitimate at every fidelity when the DS ships **no** specimen for the thing being built — strictness gates *reinvention*, never *creation*.

### Iter-1 checkpoint when scope > palette

When `opt_out_scope ∈ {aesthetic, full}` is in effect, after the post-write reality-check screenshot but **before spawning iter-1 critics**, surface a one-shot `AskUserQuestion`:

```
Iter 1 ready (opt_out_scope = <scope>). Pick:
  (a) Run the auto-fix loop now — fixes a11y; downgrades DS blockers per scope.
  (b) Show me iter 1, I'll send specific feedback (skip auto-loop this round).
  (c) A11y-only check — skip aspiration + DS, just verify accessibility.
```

This fires only when the user opted into a wider scope. The default `palette` scope keeps the existing contract (auto-loop runs unconditionally). The point is: when the user signaled exploration, give them iter-1 cheaply before the loop reshapes it for compliance.

### Inferring scope from plain language

If the user invokes `/design:new` with brief text containing opt-out signals but no explicit `--opt-out=` flag, the orchestrator may **propose** a scope based on phrasing (vibrant/modern/playful/exploratory → `aesthetic`; product-foreign domain → `aesthetic`; "fully off-system" / "different brand" → `full`), but must **surface a one-shot AskUserQuestion before kicking off the auto-fix loop**:

```
I read your "<opt-out phrase>" as opt_out_scope = <inferred>. Pick:
  (a) palette  — DS aesthetic still enforced (default)
  (b) aesthetic — palette + gradients/radii/type free
  (c) full      — DS advisory only
A11y enforced regardless.
```

If the user is in Auto Mode (AskUserQuestion denied), default to `palette` and flag the assumption explicitly in the print step (`opt_out_scope = palette (auto-picked because Auto Mode; user signaled "<phrase>" — explicit --opt-out=aesthetic|full would have widened)`).

### Persisting scope on the canvas

After the user picks (or in Auto Mode default), write the scope to the canvas's `.meta.json`:

```jsonc
{
  "title": "...",
  "opt_out_scope": "palette" | "aesthetic" | "full",
  ...
}
```

Subsequent `/design:edit` iterations on the same canvas read this field and apply the same scope **automatically** — no re-asking on every edit. To change scope mid-flow: `/design:edit "<feedback>" --opt-out=<new-scope>` overrides for that iteration and persists the new value.

### Propagating scope to critic agents

The orchestrator passes `opt_out_scope: <scope>` in every critic's input envelope. The 4 design-stack critics (`design-critic`, `signature-moment-critic`, `graphic-design-critic`, `typography-critic`) read it and adjust verdict severity. Each verdict's top_blockers MUST be tagged with `category` (one of `a11y | ds | frontend | aspiration | brand | copy | motion | ia | type`). The auto-fix loop filters `category: ds`-tagged blockers per scope before counting them toward the SOLID stop condition. See per-critic specs for downgrade rules.
