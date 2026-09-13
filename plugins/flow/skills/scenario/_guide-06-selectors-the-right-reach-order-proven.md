## Selectors — the right reach order (proven)

**Prefer a stable locator over everything else.** When a target has no testID/`data-testid`, that's worth flagging in the run's "Recommended follow-ups" (see Report shape) rather than quietly working around it forever — see "Codebase blockers" below for the recurring asks (tab-bar, list-item, action-button testIDs).

For each tap/click target, try these in order until one works:

1. `find "<text>" click` (agent-device) or `find role button click --name "<text>"` (agent-browser) — semantic locator
2. Fresh snapshot grep + `@ref` — re-snapshot before EACH press (refs renumber)
3. JSON snapshot rect center (`agent-device snapshot -i --json | jq …`) → `press <x> <y>` in points
4. Web only: `agent-browser eval 'document.querySelectorAll("<stable-class>")[i].click()'`
5. **Vision-based check — advisory only.** If a vision backend is available, use it as a last-resort locator or a sanity check on an ambiguous screen — but a vision result NEVER gates a pass/fail on its own. Treat it as a note in the report, not a step outcome. A project can wire a specific vision backend/config via its scenario guide.

Selector OR chains for resilience: `'id="x" || label="Y" || text="Z"'` (single argument).

---
