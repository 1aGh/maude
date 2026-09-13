## Monorepo Handling

### Detection

A project is a monorepo if any of these exist:

- `pnpm-workspace.yaml` (pnpm workspaces)
- `packages` field in root `package.json` (npm/yarn workspaces)
- `turbo.json` (Turborepo)
- `nx.json` (Nx)
- `lerna.json` (Lerna)

### Enumeration

For pnpm workspaces, parse `pnpm-workspace.yaml` to get package globs, then resolve to actual directories:

```bash
# List all packages
find packages/ apps/ -maxdepth 1 -mindepth 1 -type d | sort
```

For each package, read its `package.json` to get:

- Package name
- Version
- Whether it's published (`private: true` means not published)

### Workspace Protocol

Note the use of `workspace:*` for internal dependencies — this affects how builds and installs work.
