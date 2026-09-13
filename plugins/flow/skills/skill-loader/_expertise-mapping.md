# skill-loader — expertise mapping

> Loaded on demand (from `SKILL.md` Step 2) when diffing candidate technologies against what's already on hand. The known library → skill mappings and worked examples live here so the core flow stays small.

## Diff candidates against loaded skills + agents

For each candidate, scan the active host's installed skill catalog (substring + alias check). Examples:

| Candidate | Already loaded? Look for                                  |
| --------- | --------------------------------------------------------- |
| `pixi.js` | `pixijs-skills:*`                                         |
| `yjs`     | _(nothing built-in — must fetch)_                          |
| `react`   | `frontend-design:frontend-design` (UI patterns)            |
| `drizzle` | _(nothing built-in — must fetch)_                          |
| `expo`    | `flow:agent-device` (native automation, not framework docs) |

Skip anything already covered. Anything that is **not** covered is a gap → resolve it per [`_resolution-strategy.md`](./_resolution-strategy.md).

## Examples

### Example A — user asks for yjs work

```
User: "Add a yjs-backed shared document to the canvas inspector."
```

1. Scan loaded skills — no `yjs` match.
2. `search_skills("yjs CRDT")` → pick top-ranked result.
3. `get_skill(<id>)` → yjs API knowledge now loaded.
4. Record in `.ai/state/STATE.md` and proceed with implementation.

### Example B — onboarding to a repo with drizzle + hono

```
/flow:init
```

1. Read `package.json` → detect `drizzle-orm`, `hono`, `zod`.
2. `zod` is small and well-known to base model — skip.
3. `drizzle-orm` → fetch.
4. `hono` → fetch.
5. Write loaded-skills reference memory.

### Example C — built-in already covers it

```
User: "Refactor the particle system to use ParticleContainer."
```

1. Scan loaded skills — `pixijs-skills:pixijs-scene-particle-container` is already present.
2. STOP. Do not call `terminal-skills`. Use the built-in skill directly.
