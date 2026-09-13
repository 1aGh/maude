### 4.6 Custom-art routing → `draw-agent` (conditional)

**Fires when the feedback asks to draw/add a genuine custom vector mark** — a logo, custom icon, illustration, or diagram — rather than tweak an existing element. Drawing SVG by hand (the orchestrator typing `<path d="…">` coordinates) is precisely the drift-prone path the geometry engine replaces, so route these to `draw-agent` in **inline** mode instead.

```bash
# Intent: a draw/create request naming a mark type (EN + CZ cues).
WANTS_DRAW=$(grep -iqE "(draw|create|add|nakresli|přidej|vytvoř)[^.]*(logo|wordmark|brand mark|icon|illustration|diagram|svg|vector|mark|ikon)" <<< "$FEEDBACK" && echo 1 || echo 0)
```

**Skip** (fall through to the normal hand-edit in step 5) when:
- The request is a tweak to an **existing** element ("make the icon bigger", "change the logo color") — that's a scoped edit, not new art.
- The mark is a trivial **icon-set glyph** the DS already provides (just reference the set; don't engine-build a one-`<path>` chrome icon).
- **The mark is the brand logo/wordmark AND the DS ships a canonical specimen** (the step-1.5 brand pre-load resolved `$BR_LOGO`) — **substitute the canonical mark** (lift its markup from the specimen; adapt only size/placement via tokens/classes), don't draw a new one. Redrawing a mark the DS already ships is the invention-laundering path DDR-141 closes; `draw-agent` is for art the DS does NOT ship.
- The feedback doesn't name a mark type at all.

**When `WANTS_DRAW=1` and it's genuine new art**, spawn `draw-agent` inline against the active canvas (it owns the plan→generate→rank→verify loop), then jump to step 7 (confirmation screenshot) — skip the manual step 5 edit:
```
Agent(
  description: "draw mark into <active canvas>",
  subagent_type: "design:draw-agent",
  prompt: <<EOF
brief:         "<feedback, verbatim>"
type:          "logo | icon | illustration | diagram"   # infer from the feedback
grid:          <1 logo/icon · 0 illustration · 8 diagram>
output_mode:   "inline"
into_canvas:   "<abs path to active canvas>"
selected:      <selected element JSON if the edit is scoped (place the mark there), else null>
slug:          "<canvas-slug>-<mark>"
config:        <contents of .design/config.json>
designRoot:    "<abs designRoot>"
opt_out_scope: "<scope or empty>"
max_rounds:    3
candidates_n:  2
EOF
)
```
The step-8 critic panel then includes `draw-critic` automatically (the `HAS_CUSTOM_SVG` routing signal fires once the mark lands). **Failure handling:** agent fails / can't converge → fall back to the normal step-5 hand-edit and note it.
