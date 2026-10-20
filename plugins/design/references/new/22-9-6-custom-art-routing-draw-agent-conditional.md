### 9.6. Custom-art routing → `draw-agent` (conditional)

**Fires when the drafted canvas contains a genuine custom vector mark** — a brand logo / wordmark lockup, a hero illustration, a custom icon family, or a node-link diagram that `frontend-design` hand-wrote as raw `<svg>` path data. LLM-free-handed `<path d>` is exactly the drift-prone output the geometry engine exists to replace, so route those marks to `draw-agent` to rebuild them deterministically + verify them on the favicon / flatten / WCAG ladder.

**Detection (gate — only genuine custom marks):**
```bash
# A hand-written mark, not a token-driven UI shape or a stock icon-set glyph.
HAS_CUSTOM_MARK=$(grep -cE "<svg [^>]*viewBox[^>]*>[^<]*<(path|polygon|polyline)" "$TARGET_PATH")
# Brief intent — did the user actually ask for a logo / illustration / diagram?
WANTS_MARK=$(grep -iqE "logo|wordmark|brand mark|illustration|hero (art|graphic)|diagram|custom icon" <<< "$BRIEF" && echo 1 || echo 0)
```

**Skip** when neither fires, OR when the only SVG is a trivial inline icon already covered by the DS icon set (a single `<path>` 24-grid glyph used as button chrome) — re-drawing those via the engine is overhead, not value. Per the plan's gotcha: route for *genuine* marks only.

**Canonical-mark substitution FIRST (DDR-141).** When the detected mark is a brand logo / wordmark AND step 5a resolved a `$LOGO_SPECIMEN`, do NOT reroute to `draw-agent` — the DS already ships the canonical mark, and rebuilding the invention "better" just launders it into a verified artifact. Instead, replace the hand-written `<svg>` with the specimen's mark markup (lift verbatim from `$LOGO_SPECIMEN`; adapt only size/placement via existing tokens/classes) with one Edit, and stamp the substitution in the final print (`Brand mark: substituted canonical <LOGO_SPECIMEN basename>`). `draw-agent` is for genuinely NEW art the DS doesn't ship — illustrations, diagrams, and missing icon glyphs (drawn to the iconography family rules from the envelope's Brand-assets subsection).

**When it fires** (non-logo marks, or no logo specimen exists), `draw-agent` is a bounded writer of **one new file** per mark. It never edits the canvas: it writes the `<svg>` block to a snippet in the run folder, and **you splice it in** (one more Edit of the same run).

1. **Write the hand-off** to `$RUN/handoff/draw-agent-<n>.in.json` (`<n>` is one more than the highest `draw-agent-<n>.in.json` already there, or `0`). The shape is the **Sample hand-off** in [`agents/draw-agent.md`](../../agents/draw-agent.md):
   - `owns` = the snippet `$RUN/draw/<slug>.jsx` plus the result file `$RUN/handoff/draw-agent-<n>.out.json`. Never the canvas.
   - `output` = the result file; `checks` = `maude design check <output>`.
   - `context.brief` = the part of the brief that describes this mark, verbatim.
   - Create the folder first: `mkdir -p "$RUN/draw"`.
2. **Spawn** with the hand-off JSON at the top of the prompt, then the fields below. The hooks refuse any write outside `owns` (`out-of-scope`) and hold the agent to its result.

   ```
   Agent(
     description: "draw <type> mark for <Name>",
     subagent_type: "design:draw-agent",
     prompt: <<EOF
   <the hand-off JSON>
   Hand-off: <path of the .in.json>

   brief:         "<the part of the brief describing this mark, verbatim>"
   type:          "logo | illustration | diagram | icon"
   grid:          <1 for logo/icon, 0 for illustration, 8 for diagram>
   output_mode:   "inline"
   into_canvas:   "<abs path to TARGET_PATH>"
   selected:      <the hand-written <svg> block to replace, or null>
   slug:          "<Name>-<mark>"
   config:        <contents of .design/config.json>
   designRoot:    "<abs designRoot>"
   opt_out_scope: "<scope or empty>"
   max_rounds:    3
   candidates_n:  2
   EOF
   )
   ```
3. **Read the result.** Run `maude design check "$RUN/handoff/draw-agent-<n>.out.json"`. A missing or invalid result means the agent did not finish: leave the hand-written mark and say so. A valid one has `next: "splice"` and names the snippet in `changed`.
4. **Splice.** Replace the hand-written `<svg>` in `$TARGET_PATH` with the snippet using the Edit tool, at the place its first-line comment names. Keep every `data-cd-id`, give the new `<svg>` root a new readable id, and leave a locked element alone. A busy artboard is the hooks' deny: do not retry, and say the mark is ready to place when the artboard is free.

Its verdict joins the iter-1 panel summary alongside ds-keeper. `draw-critic` (step 10 panel) then independently judges the result via the `HAS_CUSTOM_SVG` routing signal.

**Failure handling:** agent fails / can't converge → leave the hand-written mark, surface a warning in the final print (`custom-art routing failed — <mark> left as hand-written SVG; re-run /design:draw manually`), continue to the panel.
