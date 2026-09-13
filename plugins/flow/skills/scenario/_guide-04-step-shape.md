## Step shape

Each platform script follows this contract:

```bash
#!/usr/bin/env bash
. /tmp/scenario-run.env                    # exports RUN_DIR
DIR="$(pwd)/$RUN_DIR/<platform>"
echo "================== <platform> =================="

# 0. bootstrap (close stale session, set device emulation, boot sim, etc.)
# 1..N. each step:
#   - take screenshot $DIR/step-N-<short-name>.png
#   - perform action (click/press/find/eval)
#   - wait for expected element / text
#   - on failure: write $DIR/result.txt with "fail: <reason>" and exit 1

# Final:
echo "pass" > $DIR/result.txt
```

**Naming**: `step-{N}-{short-descriptor}.png`. N is logical step number, NOT timestamp. `step-6-card-1-front.png` and `step-7-card-1-back.png` for sub-steps within step 6.

---
