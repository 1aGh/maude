### 10. Tell user

Write the result in the Maude voice (skill `contract-voice`): the result, not yourself; no "I", no "we", no exclamation marks. Result first, then what is safe, then one verb if one is needed. Short: one or two sentences, then the detail block below only when the person asked for detail or the critic loop ran.

Say, in this order:

1. **What changed and where**, by artboard: "Done. The roster rows on Home are tighter (padding 8/12)."
2. **What was left alone and why**, if a write was denied or an element is locked: "Footer was left as it is: Tereza is editing it." / "Post 1:1 is busy; its change comes back to this chat when it is free."
3. **That the earlier version is in Version history**, and that one undo takes the whole change back. The canvas redraws on its own: do not tell the person to reload.
4. **The critic result**, if the loop ran: the verdict in plain words, and the lowest axes when it ended `stable-but-bland`.

Detail block (for `--perfect`, or when the loop ran):

```
Edited: <canvas name> · artboards: <names>

Critic panel ({list}):
  correctness: {X} blockers · {Y} warnings
  {if signature-moment-critic in panel:}
  aspiration: {n}/5 (signature {n}, brand {n}, fidelity {n}, restraint {n}, neg-space {n}) · specificity: {pass|fail}
  verdict: {solid | stable-but-bland | max-reached | divergent | validation-failed}
{if iter > 1 or --perfect, list iterations: "iter 1 → iter 2 → iter 3 (final)"}
{if the best round was kept: "Kept round K (best result)"}
{if stable-but-bland: "Lowest axes: <list>. Targeted feedback would lift these."}
```

A failure says what happened, what is safe (the canvas is unchanged or the earlier version is kept), and the one thing to do. Never name your own tools, verbs or run ids in the text the person reads.
