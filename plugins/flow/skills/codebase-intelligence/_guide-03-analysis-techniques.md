## Analysis Techniques

### Directory Scanning

```bash
find . -maxdepth 3 -type d \
  -not -path '*/node_modules/*' \
  -not -path '*/.git/*' \
  -not -path '*/dist/*' \
  -not -path '*/build/*' \
  -not -path '*/.next/*' \
  -not -path '*/coverage/*' \
  | sort
```

Annotate directories with their purpose based on naming convention:

- `src/`, `lib/` → source code
- `test/`, `tests/`, `__tests__/` → test files
- `docs/` → documentation
- `scripts/` → build/dev scripts
- `config/` → configuration

### Package.json Parsing

Extract from `package.json`:

- `dependencies` / `devDependencies` → framework detection
- `scripts` → available commands
- `engines` → runtime requirements
- `workspaces` → monorepo packages

### Config File Detection

Check for the presence of:

| Category   | Files to Check                                               |
| ---------- | ------------------------------------------------------------ |
| TypeScript | `tsconfig.json`, `tsconfig.*.json`                           |
| Linting    | `eslint.config.*`, `.eslintrc.*`, `biome.json`               |
| Testing    | `vitest.config.*`, `jest.config.*`, `.mocharc.*`             |
| Bundler    | `vite.config.*`, `next.config.*`, `webpack.config.*`         |
| CI         | `.github/workflows/*.yml`, `.gitlab-ci.yml`                  |
| Formatting | `prettier.config.*`, `.prettierrc*`                          |
| Monorepo   | `turbo.json`, `nx.json`, `lerna.json`, `pnpm-workspace.yaml` |

### Test Runner Detection

Priority order:

1. `vitest.config.*` exists → vitest
2. `jest.config.*` exists → jest
3. Check `devDependencies` in `package.json`
4. Check `scripts.test` in `package.json` for runner name

### CI Workflow Detection

Read `.github/workflows/*.yml` files, extract:

- `name` field
- `on` triggers (push, PR, schedule, dispatch)
- Key `steps` to determine purpose

### Design Artifact Scanning

Only when `<designRoot>` (default `.design`, from `paths.designRoot`) exists — **read-only**:

```bash
DESIGN_ROOT=$(jq -r '.paths.designRoot // ".design"' .ai/workflows.config.json 2>/dev/null || echo ".design")
if [ -d "$DESIGN_ROOT" ]; then
  # Design systems (name + default marker)
  jq -r '.defaultDesignSystem as $d | .designSystems[]? | "\(.name)\(if .name==$d then " (default)" else "" end)"' "$DESIGN_ROOT/config.json" 2>/dev/null
  # Canvases: one line per sidecar (format-agnostic — sidecars, not .tsx/.html)
  find "$DESIGN_ROOT" -name '*.meta.json' -not -path '*/_history/*' 2>/dev/null | while IFS= read -r m; do
    jq -r '"\(input_filename | sub(".*/";"") | sub(".meta.json";".tsx")) (DS: \(.designSystem // "default"), status: \(.status // "draft"), last edit: \(.last_modified // "?" | sub("T.*";"")))"' "$m" 2>/dev/null
  done
fi
```

Counts and the default-DS fall-back keep the section honest on sidecars that predate the `status`/`designSystem`/`tags` fields (older canvases simply show `draft` / `default`).
