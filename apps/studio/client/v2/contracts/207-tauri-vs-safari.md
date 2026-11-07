# 2.0.7: canvas frame times, Tauri (WKWebView) vs Safari, measured

Michal (2026-11-07): canvases in the desktop app feel slower than in Safari. This note measures that in the real app:
the debug e2e `.app` built from each commit, base `d74d94df1` vs fix `615a2c7c3` (`fix/207-overview-level`, the overview
level plus stills sliced during a pan). Branch `fix/207-tauri-perf-lane`.

## Decision

1. **The shell adds no measurable frame cost.** The same viewport and canvas, with the same server bits (Safari is
   served by the `.app`'s own bundled `maude-server` and `Resources/apps/studio`), and the same in-frame recorder
   give Tauri and Safari frame times within each other's run-to-run spread, on both arms. On the fix the two are
   equal: sweep p95 is 46 ms vs 52 ms, and the fit cycle is 50 vs 55. On base, Tauri reads 5–20 % higher on the
   heaviest zoom frames (fit cycle p95 408 vs 346 ms). A plain Tauri control launched five times reads 450–630 ms
   for that same p95, so the difference is inside the drift.
2. **No WKWebView or shell variable moves the numbers.** Each of these was changed alone and kept the run inside the
   control spread: `drawsBackground` left on (`opaque`), tab webviews not inspectable, the strip webview hidden, the
   default website data store, the panels hidden with ⌘\, and optimized release Rust (release profile with debug
   assertions, so the embedded WebDriver stays).
3. **Split 0 vs split 1 doesn't change Safari either.** The fix sweep p95 is 52 vs 48 and the fit cycle is 55 vs 55;
   base is 364 vs 338 and 346 vs 335. Tauri's forced split 0 is therefore a fair proxy for the shipped split-on app.
4. **What the gap people feel must be, if it is real:** the build (base vs fix is a 7× p95 difference, much larger than
   any engine difference), the window size (cost follows the number of artboards on screen), or the native input
   path, which these lanes don't exercise (see Open questions). It isn't the WKWebView configuration, the strip or
   home webviews, the data store, the panel material, or debug Rust.

## Setup

- **Display:** one external `49M2C8900L` running at **2560×1440 @ 144 Hz, 1×** (no built-in display online). The
  panel is natively 5120×1440, but it isn't running in that mode now. rAF paces at about 72 Hz (p50 14 ms) in both
  engines.
- **Viewport:** the studio page at **2560×1340 CSS px** in both engines. Tauri: the shell is 2560×1378 (strip 38),
  placed at (0, 31) through System Events. Safari: the window is 2560×1392 at (0, 31), with its chrome measured, not
  guessed. Both are dpr 1, and the canvas frame fills the page (the panels float over it).
- **Project:** an APFS clone of `~/maude-test/studyfi-207` per arm, without `_state`, `_sync.json` or `_server.json`
  (no `linkedHub` in its config). Every process ran with a throwaway HOME, XDG, `MAUDE_INDEX_DIR` and TMPDIR, a stub
  `claude`, the fake keychain, and `NO_OPEN=1 MAUDE_NO_AUTOBUILD=1`. `~/.config/maude/prefs.json` was byte-identical
  and had the same mtime before and after.
- **Lanes** (in-frame recorder `sweep.js`, synthetic `WheelEvent`s on `.dc-canvas`, camera seeded to 10 %):
  `sweep` is the serpentine pan over the whole world. `fitcycle` zooms out 36 ctrl-wheel steps to fit (3.6 %) and
  back in. `fitsweep` is the fit cycle, then a sweep 300 ms after it. Three rounds per launch, base and fix
  interleaved. The row load is the 1-minute load average; `suggestd` was pegged at one core throughout. Rows above
  load 8 were dropped.
- **Flicker** is the number of artboards whose state sequence revisits a state (live→placeholder→live). The empty and
  black-frame counts are DOM state only: frames with any on-screen placeholder. A compositor-level black frame is not
  observable from the DOM.

## Matrix (cycle 2, load 2.7–4.7, medians of 3 runs, mascot; ms)

| engine | split | arm | lane | on-screen max | mounted max | p50 | p95 | p99 | long≥50 | worst 1 s (frames / max) | settle max | flicker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Tauri | 0 | base | sweep | 61 | 40 | 15 | 377 | 549 | 20 | 4 / 426 | 354 | 3 |
| Safari | 0 | base | sweep | 61 | 40 | 15 | 364 | 428 | 23 | 5 / 382 | 357 | 3 |
| Safari | 1 | base | sweep | 62 | 40 | 14 | 338 | 486 | 18 | 3 / 392 | 363 | 2 |
| Tauri | 0 | fix | sweep | 62 | 40 | 14 | 46 | 117 | 7 | 28 / 144 | 159 | 6 |
| Safari | 0 | fix | sweep | 62 | 40 | 14 | 52 | 111 | 8 | 36 / 150 | 175 | 6 |
| Safari | 1 | fix | sweep | 62 | 40 | 14 | 48 | 114 | 7 | 36 / 125 | 181 | 6 |
| Tauri | 0 | base | fitcycle | 88 | 45 | 21 | 408 | 512 | 17 | 3 / 512 | 20 | 0 |
| Safari | 0 | base | fitcycle | 88 | 45 | 19 | 346 | 427 | 16 | 4 / 414 | 30 | 0 |
| Safari | 1 | base | fitcycle | 88 | 45 | 19 | 335 | 438 | 15 | 3 / 438 | 28 | 0 |
| Tauri | 0 | fix | fitcycle | 88 | 43 | 14 | 50 | 86 | 4 | 48 / 86 | 30 | 0 |
| Safari | 0 | fix | fitcycle | 88 | 43 | 15 | 55 | 135 | 5 | 46 / 135 | 29 | 0 |
| Safari | 1 | fix | fitcycle | 88 | 43 | 14 | 55 | 111 | 5 | 45 / 111 | 26 | 0 |
| Tauri | 0 | base | fitsweep | 88 | 45 | 16 | 350 | 535 | 33 | 2 / 624 | 370 | 7 |
| Safari | 0 | base | fitsweep | 88 | 45 | 15 | 319 | 510 | 33 | 2 / 644 | 383 | 8 |
| Safari | 1 | base | fitsweep | 88 | 45 | 16 | 334 | 617 | 34 | 2 / 656 | 384 | 9 |
| Tauri | 0 | fix | fitsweep | 88 | 43 | 14 | 45 | 88 | 9 | 42 / 131 | 166 | 10 |
| Safari | 0 | fix | fitsweep | 88 | 43 | 14 | 51 | 103 | 13 | 44 / 112 | 162 | 10 |
| Safari | 1 | fix | fitsweep | 88 | 43 | 14 | 48 | 95 | 11 | 43 / 108 | 174 | 10 |

Placeholder share of the on-screen artboard frames is about 35–41 % on both engines and both arms: at 10 % about 36
mascot artboards never mount. The fix's higher flicker count is its designed still→live hand-over
(`ph:skeleton>cover>still`), and it is the same in both engines.

The other canvases were run once each at a 10 % sweep, cycle 2:

| canvas | Tauri base | Safari base | Tauri fix | Safari fix |
|---|---|---|---|---|
| DS `system/studyfi-v3/design-system.tsx` (37 on screen, 5 mounted): p95 / p99 | 61 / 96 | 74 / 109 | 45 / 55 | 40 / 56 |
| `math-learning-spaces` (52 on screen, 30 mounted): p95 / p99 | 28 / 68 | 37 / 58 | 22 / 57 | 25 / 69 |

Cycle 1 (load 3.4–6.5) agrees on the fix, with sweep p95 49 for Tauri vs 59 for Safari. Its base Safari rows were
loaded. In its Tauri rows the window still sat at x = 640, 640 px off screen, so they are not used.

## Variables, one at a time (Tauri only, mascot, 3 runs each; p95 ms)

| variant | base fitcycle | base sweep | fix fitcycle | fix sweep | fix fitsweep |
|---|---|---|---|---|---|
| control (5 launches, base / 2, fix) | 360–630 | 371–494 | 55–56 | 64–65 | 47–86 |
| `opaque` (drawsBackground on) | 451 | 384 | 56 | 49 | 50 |
| `no-inspect` | 578 | 385 | | | |
| `no-strip` (strip webview hidden) | 506 | 441 | 51 | 46 | 57 |
| `default-store` | 482 | 385 | | | |
| panels hidden (⌘\, 9 → 5 visible panels) | 643 | 609 | | | |
| release Rust (`CARGO_PROFILE_RELEASE_DEBUG_ASSERTIONS=true`) | 547 | 299 | 55 | 56 | 47 |
| normal window level (`MAUDE_E2E_ON_TOP=0`) | invalid: the window manager tiled the window to 1265 px | | | | |

Base frames swing ±30 % between control launches, so only an effect larger than that could show on base. The fix lanes
are tight, and none of the variants moves them.

## Rejected readings

- **"WKWebView is slower than Safari."** Not measured. The same WebKit gives the same frame times when the server
  bits and viewport are the same.
- **"The transparent tab (`drawsBackground = NO`, rc.2) costs compositing."** `opaque` doesn't move base or fix.
- **"The strip, Home and hidden child webviews cost frames."** `no-strip` doesn't move base or fix. Home and the hidden
  tabs are hidden NSViews, so nothing composites them.
- **"Debug Rust slows the UI process's layer commits."** Release Rust gives the same numbers.
- **"Origin split 0 distorts the Tauri lane."** Safari split 0 and split 1 match.

## Interface for the lanes (scratch, reproducible)

The scratchpad is `/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/tp/`:

- `twd.mjs` drives the Tauri lanes: it launches the e2e app isolated, sizes and places the window, seeds the camera,
  runs `sweep.js` inside the frame and polls. `trun.sh <arm> <tag> <runs> <rounds>` wraps it.
- `swd.mjs` and `srun.sh` do the same for Safari: one safaridriver session, the window sized to the viewport, the
  arm's bundled sidecar at `MAUDE_CANVAS_ORIGIN_SPLIT` 0 or 1 (`sserve.sh`).
- `batch.sh` runs the interleaved matrix, `variants.sh` the one-variable runs, and `summ.py <tag> [-t] [-v]` builds
  the tables. The raw rows are in `out/tauri.jsonl` and `out/safari.jsonl`.
- The `.app` copies are `app-{base,fix,knob,knob-base,relassert,relassert-base}.app`. They are unregistered from
  LaunchServices, and the scratch cargo target is deleted.
- The Rust knobs are `MAUDE_PERF_KNOBS=opaque,no-inspect,no-strip,default-store`. They are compiled in debug builds
  only (`tabs.rs` `perf_knob`; release returns false).

## Open questions (with a recommended default)

1. **The native input path is not measured.** `CGEventPostToPid` scroll events (`scroll.swift`, pixel units,
   trackpad phases, the window number set) reach neither engine: 0 trusted `wheel` events. The HID tap needs the real
   cursor over the test window, so it would move Michal's pointer. *Default:* add a debug-only e2e command that sends
   a synthesized `NSEvent` scroll into the shell window, and compare against safaridriver's `wheel` actions. Do this
   only if Michal still feels a gap on the fix build at the same window size.
2. **5120×1440.** The display is in its 2560×1440 mode now. At 5120 wide, about twice the artboards are on screen, and
   cost follows the mounted and on-screen count in both engines. *Default:* compare the engines at equal window size
   only. An app window wider than the Safari window will feel slower in either engine.
3. **The real app is split-on, release, and has ACP, sync and other tabs.** Split and release are ruled out above. A
   busy second tab rests or is hidden. *Default:* no change. The shipped desktop needs the fix build, not a shell
   change.
