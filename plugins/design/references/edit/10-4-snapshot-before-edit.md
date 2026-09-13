### 4. Snapshot before edit

```bash
# SLUG already computed in step 3 (uses normalised form — no designRoot prefix, no leading dot)
HIST="$DESIGN_ROOT/_history/$SLUG"
mkdir -p "$HIST"
N=$(printf "%03d" $(($(ls "$HIST" 2>/dev/null | wc -l) + 1)))
TS=$(date -u +%Y%m%dT%H%M%S)
cp "$ACTIVE" "$HIST/$N-$TS.bak"
```
