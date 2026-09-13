### 9.5. Record the edit decision (kgai — when active)

Load **`flow:kgai-backend`** and check `maude kg resolve --json`.

- **`active: false`** (default) → skip silently (net-new, additive capture — no classic file path).
- **`active: true`** → ingest the edit as an `edit:` node that mutates the canvas, carrying the user's feedback **verbatim** as an inert prop (never executed — DDR-130). Author + scope tags automatic:

  ```bash
  echo '{"decision":{"title":"Edit: <slug>","rationale":"<verbatim user feedback>","date":"<YYYY-MM-DD>","mutations":[{"op":"upsert_element","kind":"edit","name":"<slug>-<iter>"},{"op":"upsert_element","kind":"canvas","name":"<slug>"},{"op":"add_link","from":"edit:<slug>-<iter>","to":"canvas:<slug>","link":"MUTATES"}]}}' | maude kg ingest --root "$CLAUDE_PROJECT_DIR"
  ```

  The canvas's `.tsx`/`.meta.json` byte edits are additionally auto-captured by kgai's Stop hook; this explicit ingest names the *edit decision* and its verbatim feedback.
