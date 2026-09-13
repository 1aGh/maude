### 6. Validate

```bash
grep -q "$(basename "$TOKENS_REL")" "$ACTIVE" || RESTORE=1
# Accept BOTH plain HTML (class="…") and JSX (className="…") form — React canvases
# render the rootClass via JSX so it never appears as a literal HTML attribute.
grep -qE "(^| )(class|className)=\"$ROOT_CLASS([\" ])" "$ACTIVE" || RESTORE=1
# grep for hardcoded #hex in style attributes — should be 0 hits in newly added lines
```

If `RESTORE=1`, copy back the snapshot and report drift to user. Don't leave broken HTML.

```bash
# Phase 8 Task 4 — refresh AI banner heartbeat (keeps the banner alive through
# the validate + screenshot + critic steps that follow).
curl -s -m 2 -X POST -H 'content-type: application/json' \
  -d "{\"file\":\"$ACTIVE\"}" \
  "http://127.0.0.1:$PORT/_api/ai/heartbeat" >/dev/null 2>&1 || true
```
