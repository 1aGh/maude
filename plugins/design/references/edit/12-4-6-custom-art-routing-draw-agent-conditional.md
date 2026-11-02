### 4.6 Custom-art routing → `draw-agent` (conditional)

**Fires when the feedback asks to draw/add a genuine custom vector mark** — a logo, custom icon, illustration, or diagram — rather than tweak an existing element. Drawing SVG by hand (typing `<path d="…">` coordinates) is precisely the drift-prone path the geometry engine replaces, so route these to `draw-agent` in **inline** mode instead.

```bash
# Intent: a draw/create request naming a mark type (EN + CZ cues).
WANTS_DRAW=$(grep -iqE "(draw|create|add|nakresli|přidej|vytvoř)[^.]*(logo|wordmark|brand mark|icon|illustration|diagram|svg|vector|mark|ikon)" <<< "$FEEDBACK" && echo 1 || echo 0)
```

**Skip** (fall through to the normal hand-edit in step 5) when:
- The request is a tweak to an **existing** element ("make the icon bigger", "change the logo color"): that's a scoped edit, not new art.
- The mark is a trivial **icon-set glyph** the DS already provides (just reference the set; don't engine-build a one-`<path>` chrome icon).
- **The mark is the brand logo/wordmark AND the DS ships a canonical specimen** (the step-1.5 brand pre-load resolved `$BR_LOGO`): **substitute the canonical mark** (lift its markup from the specimen; adapt only size/placement via tokens/classes), don't draw a new one. Redrawing a mark the DS already ships is the invention-laundering path DDR-141 closes; `draw-agent` is for art the DS does NOT ship.
- The feedback doesn't name a mark type at all.

**When `WANTS_DRAW=1` and it's genuine new art**, `draw-agent` is a bounded writer of **one new file**. It never edits the canvas: it writes the `<svg>` block to a snippet in the run folder, and **you splice it in** (step 5's Edit, one more step of the same run).

1. **Write the hand-off** to `$RUN/handoff/draw-agent-<n>.in.json` (`<n>` is one more than the highest `draw-agent-<n>.in.json` already there, or `0`). The shape is the **Sample hand-off** in [`agents/draw-agent.md`](../../agents/draw-agent.md):
   - `owns` = the snippet `$RUN/draw/<slug>.jsx` plus the result file `$RUN/handoff/draw-agent-<n>.out.json`. Never the canvas.
   - `output` = the result file; `checks` = `maude design check <output>`.
   - `context.brief` = the feedback, verbatim.
   - Create the folder first: `mkdir -p "$RUN/draw"`.
2. **Spawn** with the hand-off JSON at the top of the prompt, then the fields below. The hooks refuse any write outside `owns` (`out-of-scope`) and hold the agent to its result.

   ```
   Agent(
     description: "draw mark for <active canvas>",
     subagent_type: "design:draw-agent",
     prompt: <<EOF
   <the hand-off JSON>
   Hand-off: <path of the .in.json>

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
3. **Read the result.** Run `maude design check "$RUN/handoff/draw-agent-<n>.out.json"`. A missing or invalid result means the agent did not finish: fall back to the normal step-5 hand-edit and say so. A valid one has `next: "splice"` and names the snippet in `changed`.
4. **Splice.** Insert the snippet into the active canvas with the Edit tool, at the place its first-line comment names (the selected element, or the slot the brief names). Keep every `data-cd-id`, give the new `<svg>` root a new readable id, and leave a locked element alone. A busy artboard is the hooks' deny (step 4.5): do not retry, and say the mark is ready to place when the artboard is free.
5. Jump to step 7 (confirmation screenshot), skipping the manual step-5 edit.

The step-8 critic panel then includes `draw-critic` automatically (the `HAS_CUSTOM_SVG` routing signal fires once the mark lands). **Failure handling:** the agent fails or cannot converge: fall back to the normal step-5 hand-edit and say so.
