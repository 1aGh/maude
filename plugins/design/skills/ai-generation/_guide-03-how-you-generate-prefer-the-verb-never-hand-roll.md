## How you generate — prefer the verb, never hand-roll

Always go through the verb (never a raw `curl` to a provider, never a raw bin path — DDR-062):

```bash
# text → image, land it on the active canvas
REF=$(maude design generate --prompt "a misty pine forest at dawn, soft light" --aspect 16:9 --root "$REPO")
# → /assets/<sha8>.png ; then splice <img src="assets/<sha8>.png"> into the canvas

# edit an existing image (maskless Nano Banana edit → a NEW asset)
REF=$(maude design generate --prompt "make the sky deep purple" --source assets/7f3a9c21.png --root "$REPO")
```

`/design:generate` is the explicit entry point; `/design:edit` (step 4.7 `WANTS_GENERATE`) and `/design:new` route here when the brief/feedback asks for AI imagery. The finished asset **lands on the canvas automatically** — generation is never a dead-end modal (the in-app dialog auto-inserts; the command path splices the `<img>` via a source edit).
