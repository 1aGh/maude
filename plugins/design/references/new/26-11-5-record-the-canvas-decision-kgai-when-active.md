### 11.5. Record the canvas decision (kgai — when active)

Load **`flow:kgai-backend`** and check `maude kg resolve --json`.

- **`active: false`** (default) → skip silently. Design records nothing to `.ai/decisions/` today; this is a **net-new**, purely additive capture — there is no classic file path to preserve.
- **`active: true`** → ingest the canvas as a `canvas:` node so its design rationale becomes queryable (schema-free model; the `flow:kgai-backend` glossary owns the vocabulary). Author + scope tags are automatic:

  ```bash
  echo '{"decision":{"title":"Canvas: <Name>","rationale":"<one-line brief>","date":"<YYYY-MM-DD>","mutations":[{"op":"upsert_element","kind":"canvas","name":"<slug>","props":{"path":"<DESIGN_ROOT>/<rel>.tsx","platform":"<platform>","status":"draft"}},{"op":"upsert_element","kind":"ds","name":"<TARGET_DS>"},{"op":"add_link","from":"canvas:<slug>","to":"ds:<TARGET_DS>","link":"RENDERS"}]}}' | maude kg ingest --root "$CLAUDE_PROJECT_DIR"
  ```

  If the DS ships brand specimens (step 5a `$LOGO_SPECIMEN`), also add a `USES_BRAND` link to the `brand:<TARGET_DS>` element. kgai's Stop hook additionally auto-captures the model-written `.tsx`/`.meta.json` edits — this explicit ingest names the canvas *decision* with its DS edge.
