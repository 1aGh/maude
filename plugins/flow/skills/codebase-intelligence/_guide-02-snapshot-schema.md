## Snapshot Schema

The output file `.ai/context/codebase-map.md` must contain these sections:

### Identity

| Field   | Description                                               |
| ------- | --------------------------------------------------------- |
| Project | Human-readable project name (from CLAUDE.md or repo name) |
| Repo    | `org/repo` identifier                                     |
| Type    | `monorepo` or `single-repo`                               |

### Stack

| Field           | Description                                          |
| --------------- | ---------------------------------------------------- |
| Language        | Primary language(s) detected                         |
| Framework       | Major frameworks (Next.js, Express, Angular, etc.)   |
| Build tool      | Turborepo, Vite, Webpack, tsc, etc.                  |
| Package manager | pnpm, yarn, or npm (from lock file)                  |
| Runtime         | Node version, Deno, Bun, etc. (from .nvmrc, engines) |

### Architecture

- Annotated directory tree (top 3 levels)
- For monorepos: table of packages/apps with paths and purposes

### Key Files

Table of important files and their roles (entry points, configs, CI, docs, types).

### Conventions

- File naming pattern (kebab-case, camelCase, PascalCase)
- Import style (absolute `@/` vs relative `../`)
- Test pattern (colocated, `__tests__/`, `*.test.ts`)
- Commit style (conventional, freeform, squash)
- Linting (eslint, biome, prettier config)

### Test Surface

- Test runner and its config file
- Whether coverage is configured
- Approximate test file count

### CI/CD

Table of CI workflows, their triggers, and purposes.

### Constraints

Hard rules extracted from `CLAUDE.md`:

- Prohibited packages
- Required conventions
- Branching rules
- Legal restrictions

### Design artifacts

Present only when the project uses the design plugin (`<designRoot>` exists — resolve from `paths.designRoot`, default `.design`). Captures the canvas workspace so design surfaces aren't invisible to a code-only snapshot:

- **Design systems** — one line per DS (`name`, path, `(default)` marker) from `<designRoot>/config.json`.
- **Canvases** — total count, then one line per canvas: filename, its `designSystem` (or the default), declared `status` (`draft` / `in-review` / `ready-for-handoff` / `handed-off`), and `last_modified`. Canvases marked `ready-for-handoff` are the ones a `/flow:done` will offer to hand off.

Omit the whole section when `<designRoot>` is absent — the snapshot must stay clean for code-only projects.
