## Authoring a new scenario

**For a one-shot pilot** (most cases): inline the bash directly in a Bash tool call. Don't create files just to delete them later.

**For a stable, repeatable scenario**, work one step at a time with the user rather than generating the whole thing unattended — announce the step you're about to take, act, screenshot, then co-design the assertion for that step with the user before moving on. Stop after each step for confirmation; don't run ahead and present a finished multi-step scenario as a fait accompli.

1. `mkdir -p .ai/scenarios/<name>/runners`
2. Write `README.md` with the user-flow description, fixtures (subject/chapter/account), expected end state.
3. Adapt existing runners if any — replace selectors per scenario.
4. First run: pilot interactively, one step at a time (announce → act → screenshot → confirm the assertion with the user → next step). Use `agent-device --save-script` to record native flows automatically:

   ```bash
   agent-device open <bundle-id> --platform ios --udid $UDID --session pilot \
     --save-script .ai/scenarios/<name>/runners/ios-phone.ad
   # … drive scenario interactively …
   agent-device --session pilot close
   # replay later:           agent-device replay .ai/scenarios/<name>/runners/ios-phone.ad
   # self-heal stale sels:   agent-device replay -u <file>
   ```

5. Once stable, commit `runners/` + `README.md`. Subsequent runs are reproducible.

agent-browser has no equivalent record/replay — author web variants as bash directly.

---
