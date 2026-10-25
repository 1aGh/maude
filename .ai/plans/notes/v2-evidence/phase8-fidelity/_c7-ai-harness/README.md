# Round 7 (p8-c7-ai) re-shoot harness: 03 AI Chat

Layered on `../_c6-harness-g2/` (copy the layers in that README's order into `<repo>/.scr/impl/`, then these files over them; repoint the worktree path with `.scr/repoint.mjs`).
Spec images: `.scr/spec/03/`. Fixtures next to impl (real files now, the old 1-byte stubs were rejected by the attach route and shown as an error chip):
`.scr/attach/trenink-0412.mov` (`ffmpeg -f lavfi -i color=c=0x86dc9d:s=320x180:d=42:r=10 -c:v libx264 -pix_fmt yuv420p`), `.scr/attach/Combine-foto.png` (`magick -size 640x400 gradient:'#9fd6f2-#86dc9d'`), `.scr/attach/Combine-brief-2026.pdf` (`magick -size 595x842 xc:white -duplicate 11`, 12 pages).

Run order (later wins where two scripts shoot one id): `THEMES=dark,light ./base.sh s03a s03e s03d s03c s03g s03n`, then `MAP=pairs-map-c7.json node pairs.mjs` (03 only), `node c7-index.mjs <tip>`.

Changes against round 6:
- `s03g.mjs` (new): Tereza's three open comments seeded (`_comments/ui-combine-kampan.json`) so the comments strip leads in `ai-open` / `ai-suggest` (Post picked first, then the panel + Canvases, as the board); photo + footage + PDF chips (`ai-attach`) and the drop overlay (`ai-attach-drop`, mapped to the board's `ai-attach`); the second ask on POST 1:1 for `ai-same-artboard` / `ai-copy`; `ai-question` with an element picked; `ai-permission` on a generated Uniformy-2027 canvas (4 jersey + 4 photo artboards, the photos shift-picked).
- `s03e.mjs`: `ai-history` clicks the "Make it greener" row so its Undo this chat / Restore show.
- `s03c.mjs`: `ai-scope` with nothing picked ("Whole canvas", the board's main case).
- `fake-agent.mjs`: an "Agent persona" config option (renders under Advanced › From the agent).
- `pairs-map-c7.json`, `c7-index.mjs`, `base.sh`.
