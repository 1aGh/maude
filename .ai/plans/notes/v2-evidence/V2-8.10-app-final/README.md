# V2-8.10 packaged app at the final product tree (2026-11-02, head 71ec8ec75)

Rebuilt after Michal's rounds r3–r5 at **71ec8ec75** on 2026-11-02 16:44, and every check below was re-run on that
build. The older builds (fa52b24c6, fab4e6c4a) are described further down.

Built in the freeze with `MAUDE_NO_AUTO_UPDATE=1 pnpm build:desktop`, through the test lane (`dist/` snapshotted and
clean afterwards). Output: `apps/desktop/src-tauri/target/release/bundle/macos/Maude.app`, version 2.0.0-rc.1, 392 MiB
(plus the `.dmg`). The build "fails" only at the updater-archive signing step, because there is no
`TAURI_SIGNING_PRIVATE_KEY` locally; both bundles are written before that step.

| check | result at 71ec8ec75 |
| --- | --- |
| `check-bundle-completeness.mjs <app> --smoke` | exit 0, "Bundle is self-contained — all checks passed." (`bundle-completeness-smoke.tail.txt`) |
| `check-client-boots.mjs <app>` | exit 0, "#root children: 1, 494 chars … menu, ⌘K palette, tree all answer" (`client-boots.tail.txt`) |
| no WebDriver in the release binary | `nm`: 0 wdio symbols; compiled capabilities `default`, `home-splash`, `strip` only; the one `strings` hit is the plugin's permission name inside the ACL manifest string, never granted |
| live render: `opening-card-clears.mjs` on the release-built client | Chromium PASS: the "Opening…" card clears (`opening-card.tail.txt`) |
| what this app carries since the fa52b24c6 build | r4 (18 findings + img 44: real OS drag and drop, setup-ds canvas-first, the Figma picker, one Light / Dark pill, the device code, the zoom fix …), r5 (8 findings: video drag and play, Libraries, per-class theme, Copy relative path), the r4+r5 security fixes (Copy link only from a confirmed hub), and the fixes the final checks found |

**Still Michal's:** the smoke test on a clean macOS user (no node, bun, brew or claude), the third leg of the V2-8.10
row. The app is built with `MAUDE_NO_AUTO_UPDATE=1`, so it won't offer to replace itself while he tries it.

```json
{"blockers": 0, "pass": true, "head": "71ec8ec75", "pending": ["clean-user smoke (Michal)"]}
```

---

# V2-8.10 packaged app at the r3 freeze (2026-11-01, head fa52b24c6)

Rebuilt for round r3 (Michal's 7 findings on READY TO TRY 11) at fa52b24c6 on 2026-11-01 20:46; every check below re-run on that build. The fab4e6c4a build it replaces is described below with the same checks.


Built in the freeze with `MAUDE_NO_AUTO_UPDATE=1 pnpm build:desktop`, through the test lane (`dist/` snapshotted and
clean afterwards). Output: `apps/desktop/src-tauri/target/release/bundle/macos/Maude.app`, version 2.0.0-rc.1, 391 MiB,
built 2026-11-01 20:46 (r3; was 14:43 at fab4e6c4a) (plus `Maude_2.0.0-rc.1_aarch64.dmg`). The build "fails" only at the updater-archive signing step
— there is no `TAURI_SIGNING_PRIVATE_KEY` locally — after both bundles are written.

| check | result |
| --- | --- |
| `check-bundle-completeness.mjs <app> --smoke` (every verb in a stripped PATH) | exit 0, "Bundle is self-contained — all checks passed." (`bundle-completeness-smoke.tail.txt`) |
| `check-client-boots.mjs <app>` (bundled server + agent-browser, Tauri global) | exit 0, "#root children: 1 … menu, ⌘K palette, tree all answer" (`client-boots.tail.txt`) |
| no WebDriver in the release binary | `nm`: 0 wdio symbols; compiled capabilities `default`, `home-splash`, `strip` only (`gen/schemas/capabilities.json`); the one `wdio-webdriver` string is the plugin's permission NAME in the ACL manifest (a compile-time dep), never granted |
| live render: `opening-card-clears.mjs` on the release-built client | Chromium PASS: the "Opening…" card clears (`opening-card.tail.txt`) |
| what this app carries since the 20b4215eb build | the rc.1 findings + UX-audit round (P1–P6), the r2 security fixes, the export / selection / tab-intent / Pen / size-picker / identity fixes, the slash-menu ink |

**Still Michal's:** the smoke test on a clean macOS user (no node/bun/brew/claude), the third leg of the V2-8.10 row. The
app is built with `MAUDE_NO_AUTO_UPDATE=1`, so it won't offer to replace itself while he tries it.

```json
{"blockers": 0, "pass": true, "head": "fab4e6c4a", "pending": ["clean-user smoke (Michal)"]}
```
