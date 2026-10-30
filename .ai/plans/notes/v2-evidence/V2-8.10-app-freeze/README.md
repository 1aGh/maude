# V2-8.10 packaged app at the freeze (2026-10-29, product head a686e71c7, built from b1020a18e, .ai-only diff)

`pnpm build:desktop`, run through the test lane (dist/ snapshot, clean after). Output:
`apps/desktop/src-tauri/target/release/bundle/macos/Maude.app`, 1.9.1, 406 MiB, plus the dmg. The build "fails" only at
the updater-archive signing step (no `TAURI_SIGNING_PRIVATE_KEY` locally), which is expected.

| check | result |
| --- | --- |
| `check-bundle-completeness.mjs <app> --smoke` (every verb in a stripped PATH) | exit 0, "Bundle is self-contained — all checks passed." |
| `check-client-boots.mjs <app>` (bundled server + agent-browser with a Tauri global) | exit 0, "#root children: 1 … menu, ⌘K palette, tree all answer" |
| no WebDriver in the release binary | the plugin's code is absent (0 symbols). The one `wdio-webdriver` string is the permission name inside the compiled capability manifest; with no plugin registered under `cfg(debug_assertions)`, nothing serves it. |
| `git status apps/studio/dist` after | clean |

**Still Michal's:** the smoke test on a clean macOS user (no node/bun/brew/claude). It is the third leg of the V2-8.10 row.
