# Vendored: tauri-plugin-wdio-webdriver 1.2.0

- **Upstream:** crates.io `tauri-plugin-wdio-webdriver` **1.2.0** (MIT, `LICENSE` kept as shipped),
  repo `webdriverio/desktop-mobile`, path `packages/tauri-plugin-webdriver`, commit
  `6629cfbdf2e8972962ff3ca0f8422634880d82ed` (from `.cargo_vcs_info.json`). Copied from the
  published `.crate` minus its `Cargo.lock`.
- **Wired by:** `[patch.crates-io]` in `apps/desktop/src-tauri/Cargo.toml` (the dependency stays
  `=1.2.0`, so the lock cannot drift off the version the patch was written against).
- **Registered:** only under `#[cfg(debug_assertions)]` in `src/lib.rs`, as before. A release
  build compiles the crate but never calls `init()`, so the shipped `.app` starts no WebDriver
  server.

## Why

V2-3.7 (decision `maude/v2-3.7-wdio-webview-fork`, contract
`apps/studio/client/v2/contracts/V2-3.7-own-tab-bar.md` §7.1) puts one shell window with several
child webviews (`strip`, `home`, `p-*`). Stock 1.2.0 looks handles up through
`app.webview_windows()`, which drops every webview of a multi-webview window, so session create
fails with `no such window`.

## The patch (`webviews.patch`, against the upstream 1.2.0 tree)

- `webview_windows()` → `webviews()` for handle lookup, listing and switch
  (`server/mod.rs`, `server/handlers/window.rs`). Handles are still labels; a single-webview
  window's webview carries the window's label, so today's handles do not change.
- The executor holds `Webview<R>` instead of `WebviewWindow<R>` (`platform/*.rs`); window-level
  ops (rect, maximize, minimize, fullscreen) go through `.window()`.
- `DELETE /window` calls `webview.close()` instead of `WebviewWindow::destroy()`.
- `Cargo.toml`: `tauri` gets the `unstable` feature (`Manager::webviews`).

The spike (`v2-3.7-own-tab-bar` ec34becf, `spike/wdio-webdriver-webviews.diff`) changed only the
macOS executor's type; this copy makes the same type swap in the linux / windows / ios / android
executors, which `create_executor` in `platform/mod.rs` already hands a `Webview`. Without it
the crate does not compile on Linux (the `.deb` build compiles it). Only macOS is compiled here;
the Linux build is proved by `build-desktop.yml`.

Regenerate the patch after an edit:
`diff -ru -x .cargo-ok -x Cargo.lock -x VENDORED.md -x webviews.patch <upstream 1.2.0 dir> .`

## Dropping the fork

When upstream ships webview handles (track it on `webdriverio/desktop-mobile`):

1. Bump `tauri-plugin-wdio-webdriver` in `Cargo.toml` to that release; remove the
   `[patch.crates-io]` entry and this directory.
2. `cargo update -p tauri-plugin-wdio-webdriver`; check that its Windows build constraint (the
   `cfg(not(target_os = "windows"))` target section) still holds.
3. Run the desktop e2e lanes; the handles must still be `home`, `strip`, `p-*`.
