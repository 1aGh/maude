# V2-8.10 packaged app at the final freeze (2026-10-31, head 20b4215eb)

Built in the freeze with `MAUDE_NO_AUTO_UPDATE=1 pnpm build:desktop`, through the test lane (`dist/` was snapshotted,
and was clean afterwards). Output: `apps/desktop/src-tauri/target/release/bundle/macos/Maude.app`, version 2.0.0-rc.1,
391 MiB, built 18:41. The build "fails" only at the updater-archive signing step. That is expected: there is no
`TAURI_SIGNING_PRIVATE_KEY` locally, and the `.app` and the dmg are both produced before that step.

| check | result |
| --- | --- |
| `check-bundle-completeness.mjs <app> --smoke` (every verb in a stripped PATH) | exit 0, "Bundle is self-contained — all checks passed." (`bundle-completeness-smoke.tail.txt`) |
| `check-client-boots.mjs <app>` (the bundled server plus agent-browser, with a Tauri global) | exit 0, "#root children: 1 … menu, ⌘K palette, tree all answer" (`client-boots.tail.txt`) |
| no WebDriver in the release binary | 0 `wdio` symbols in `maude-desktop` (the plugin is registered under `cfg(debug_assertions)` only) |
| live render: `opening-card-clears.mjs` on the release-built client | Chromium PASS: the "Opening…" card clears. The `--webkit` harness needs a Playwright WebKit browser that isn't installed (not downloaded). WebKit canvas opening is covered by V2-8.3 in the real app instead. |
| what the app carries since the 7f16 build | the shell no longer quits when a fresh tab's URL is read (`webview_url::url_of`); asset tiles; the closure rule; the a11y fixes |

**Still Michal's:** the smoke test on a clean macOS user (no node/bun/brew/claude), the third leg of the V2-8.10
row. The app is built with `MAUDE_NO_AUTO_UPDATE=1`, so it won't offer to replace itself while he tries it.

```json
{"blockers": 0, "pass": true, "head": "20b4215eb", "pending": ["clean-user smoke (Michal)"]}
```
