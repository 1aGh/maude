### 6. Draft — artboard by artboard (preferred + fallback)

The canvas exists and is empty (step 3). **Draft it into that canvas with Edit, never by writing the file over** — the hooks refuse a `Write` over an existing canvas (`whole-file-rewrite:`), and a single big write would arrive as one blank wait. The person watches the draft arrive piece by piece, one run, one version, one undo (skill `design` § "A first draft from Home").

**Three stages, in this order:**

1. **Every artboard empty first, with its kind and size.** One `<DCArtboard>` per entry of the envelope's Artboard plan, each with its `kind` and real dimensions from [Artboards of a kind](../../skills/design/_guide-28-artboards.md), written in **one Edit** (the first artboard goes into `<DCSection id="main">` and brings the canvas-lib import with it — the guide has the exact shape). The person sees the whole shape of the canvas in the first second. Then give each artboard its place with `maude design place` when they would overlap or the default grid is wrong, and check it with `maude design layout-check`.
2. **Fill big before small.** Background and colour, then the large shapes and pictures, back to front, one artboard at a time. Never start with details. This is where generation runs: for each artboard, hand the envelope to the generator and splice what it returns into that artboard with Edit.
3. **Words last.** Headlines, body copy and labels go in after the shapes, so the text lands where the layout already is. Keep every `data-cd-id` (new elements get new readable ids) and write nothing the DS tokens already cover as a literal.

Generate with, in order:

1. **Preferred:** `Skill(skill: "frontend-design:frontend-design", args: <envelope>)` — creative-design specialist. **Always attempt this first** — even when you predict "same model executes, won't help". Predicting the outcome before observing is the violation; trying and falling back transparently is the contract. See SKILL.md "Why call the Skill even when the executing model is the same". The envelope's Output contract tells it to return the artboard subtree only.
2. **Fallback:** If the Skill is unavailable / errors out (typically "Skill type not found" or "Agent type 'frontend-design:frontend-design' not found"), draft the same subtrees yourself with Read + Edit, the envelope as the brief. **Mark the report as "orchestrator-direct fallback (quality may be 1 generation lower)"**.
3. **Never silently fall back.** The final print MUST contain a `Generation: <path>` line stating which path generated. After generation, update the `Generation path:` line in `$RUN/envelope-<slug>.md` with the actual path taken.

**When a write is denied** the hook names the reason (`artboard-busy:`, `soft-locked:`, `out-of-scope:`, `lease-lost:`, `read-only:`): read the table in `/design:edit` step 4.5 and do not retry the same write. On a canvas you just made nothing should be busy, but a second AI chat may be drafting the same canvas — then draft the artboards it has not claimed and say so.

If the draft breaks the canvas (it no longer parses or draws), the hooks put the file back at that edit and tell you why; fix the cause and write again.

See SKILL.md "Cross-skill calls → Generation invocation".
