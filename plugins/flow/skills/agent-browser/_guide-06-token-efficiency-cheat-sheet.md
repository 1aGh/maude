## Token efficiency cheat-sheet

| Action            | Cheap                              | Expensive                      |
| ----------------- | ---------------------------------- | ------------------------------ |
| Snapshot          | `snapshot -i -c`                   | `snapshot` (full tree, ~5×)    |
| Screenshot review | `screenshot path.png` then ignore  | `Read path.png` (image tokens) |
| Click             | `click @e3` (returns 9 bytes)      | re-snapshot before each click  |
| Read element text | `get text @e5`                     | re-snapshot for one value      |
| Find element      | `find role button --name "Submit"` | full snapshot to locate        |
| Wait              | `wait @e3` / `wait --text "..."`   | `wait 5000`                    |

**Rule of thumb**: for a 10-step interaction, target <2k tokens of tool output. Compare to Playwright MCP which costs ~3-5k for the same flow.

---
