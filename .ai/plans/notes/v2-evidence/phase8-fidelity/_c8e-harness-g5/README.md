# C8 harness, 14 Editing (p8-c8-edit)

Deltas over `_d5-harness-g5` (run `_d5-harness-g5/setup.sh`, then copy `scr/` of THIS folder over `.scr/`; `scr/fx5-canvases/`
over `.scr/fx5-canvases/` — it adds the `assets/` folder and a new Alligators fixture):

- `scr/fx5.mjs` copies `fx5-canvases/assets/*` into the scratch project's `.design/assets/` (a real, content-addressed photo).
- `scr/fx5-canvases/Alligators.tsx`: the title wears the system's `t-title` class and carries its own size over it (the
  Type card reads "Title · changed" + Reset); no `<br />` (a text with an element child gets no style or language info); the
  Zapiš se post is inline literal JSX (a post built by a shared component refuses edit-in-place, crop and the Pen), its photo
  is `assets/9a1f3c5e.jpg`; the date badge is a Datum FRAME over a real Shape (`data-shape="rectangle"`, "Podklad").
- `scr/s14h.mjs` (Studio fixture): ed-lay-auto (the gap handle held, so the ruler + hint + "Services → Auto layout" tag are up),
  ed-lay-reorder (the card lifted, tag + slot + hint pills), ed-obj-order (menu on the SELECTED button, Layers hide/lock rows),
  ed-comp-pick (the page slid left so the highlighted row's ghost on the centre line is not under the picker),
  ed-comp-instance (a Button placed in a frame, its text overridden).
- `scr/s14i.mjs` (Alligators): ed-text-edit (edit mode, last word selected, Language Čeština line), ed-img (Fit Crop, Zoom
  128 %, crop mode), ed-pen (4 points, finish, double-click into point editing), ed-lay-free, ed-shape, ed-text-style.
- `scr/s14j.mjs`: ed-edge-huge INSIDE the 6000 px page (pinch in, scroll down: sticky name, minimap, "You're looking at …").
- `scr/chain-c8e.sh <theme>`: the order the ids were shot in (s14b keeps only ed-obj-multi; s14e: edge-paste + edge-keys; s14g: ed-inspector).
  `SHOT_CHANNEL=chrome` (default) uses the installed Google Chrome. Run it from the repo root after `bun run build.ts --release`.
