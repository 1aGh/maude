# canvas-text-editing

**Native-desktop** E2E scenario — the verification backbone for `feature-unified-text-editing`: every editable text surface on the Maude canvas (artboard element, shape text, sticky, standalone text, section title) behaves like one predictable WYSIWYG editor in the **real WKWebView**. DOM-driven via `@wdio/tauri-service` (no computer-use).

**Persona:** designer editing text on the canvas.
**Plan:** `.ai/plans/feature-unified-text-editing.md`.
**Harness:** `apps/desktop/e2e/` (WebdriverIO + embedded WebDriver provider). Skill: `desktop-e2e`.
**Hypothesis:** click-to-place caret, custom blinking caret, plain-HTML annotation editors, Text-tool click-through, Enter/Shift+Enter unification, and build-time editability gating all hold in WKWebView — the engine where the original bugs lived (Chromium is untrusted for caret/hit-test behavior; measured).

## Driving model (load-bearing)

- Native WebDriver pointer/keys do **NOT** penetrate the canvas iframe (measured 2026-07-09). Every interaction is a **synthetic event dispatched inside the same-origin frame** (`MAUDE_CANVAS_ORIGIN_SPLIT=0`), reached via `iframe.contentDocument` from the top frame — robust against post-build hot-reload.
- Synthetic events run **no UA default action**: typing is emulated via `execCommand('insertText')`; caret placement is asserted against the app's OWN `placeCaretAt` path (which is exactly what real users exercise too).
- Native caret **blink is temporal** — no automated tool can assert it. The custom `[data-maude-caret]` element + its `maude-caret-blink` animationName is the harness-assertable proxy; the actual blink/feel is a **user visual gate** (plan Task 7.2).
- Camera state persists per-user across runs (`_canvas-state/<slug>.view.json`, DDR-115) — the suite deletes it in `before()` and re-fits, else hit-test targets land off-viewport where `caretRangeFromPoint` resolves null.
- Commit tests write through to disk (annotations PUT + `/_api/edit-text`) — the suite snapshots the fixture files in `before()` and restores them byte-exact in `after()`.
- Between runs, kill stale fixture sidecars (`pkill -f "maude-server --root .*e2e/fixtures"`) — a leaked server serves stale staged sources.

## Platform matrix

| Platform | Required | Rationale |
| --- | --- | --- |
| **native-desktop** (`Maude.app`, Tauri/WKWebView) | ✓ | The feature is WebKit-correctness work — caret blink, foreignObject hit-testing, and rAF throttling behave differently (and were broken) specifically in WKWebView. |
| web-desktop (Chromium via `agent-browser`) | N/A | Cannot reproduce the WKWebView caret/hit-test behavior (measured). desktop-e2e IS the cross-platform substitute for this feature. |
| web-mobile / ios / android | N/A | No mobile form factor for the desktop app. |

## Fixture

`apps/desktop/e2e/fixtures/project/.design/` — enriched for this scenario:

- `ui/Smoke.tsx` — testids `smoke-h1` / `smoke-p` / `smoke-mixed`; the mixed `<p>Total: {1 + 1} items</p>` renders leaf-looking in the DOM but is mixed in source (the editability-gate probe).
- `ui-smoke.annotations.json` (annotations v2, DDR-242) — seeded sticky `s_e2esticky1`, standalone text `s_e2etext1`, section `s_e2esection1` (annotations sidecar lives at the designRoot ROOT under the canvas slug, NOT sibling to the canvas).

## Steps (automated — `apps/desktop/e2e/scenarios/canvas-text-editing.e2e.ts`)

| # | Step | Expected |
| --- | --- | --- |
| 1 | Boot + open fixture canvas; reset camera (fit + rect-stable). | Every seeded surface reachable (h1, mixed p, sticky, text, section). |
| 2 | Artboard: synthetic dblclick on h1. | `contenteditable="plaintext-only"` + `dc-text-editing`; caret **collapsed at the click point** (not select-all); explicit caret-color; Escape reverts. |
| 3 | Artboard: custom caret. | `[data-maude-caret]` present, `animationName` includes `maude-caret-blink`, positioned inside the h1 rect, native caret transparent; disposed on Escape. |
| 4 | Sticky + standalone text editors, at fit AND zoomed ×2. | Editor is a `<textarea>` (annotations v2) in `.dc-world` (`closest('foreignObject') === null`), positioned over the element (±12px), its read text block replaced (no ghost/double-paint). |
| 5 | Sticky caret-at-click. | Dblclick on the 5th character (aimed with a Range) → collapsed caret at that offset (±3), read from the textarea's `selectionStart`; the textarea shows the platform caret (the custom caret is artboard-only since annotations v2). |
| 6 | Text tool click-through. | With T armed, click on the sticky opens ITS editor (stroke count unchanged); click on empty space opens a NEW pending editor (no stroke until commit; Escape leaves nothing). |
| 7 | Keyboard unification. | Sticky/text: Enter commits (stroke re-renders new text), Shift+Enter keeps the editor open (+ emulated newline grows a line); section title (singleLine): Shift+Enter ALSO commits, label has no newline; artboard: Shift+Enter keeps editing, Enter commits. |
| 8 | Persistence gate. | Mixed `<p>` dblclick → NO contenteditable + hint toast ("dynamic — edit via chat"); h1 edit persists **to disk** and through the HMR reload (⌘R-equivalent); sibling `<p>` byte-identical on disk and on canvas. |

**Acceptance:** all 8 steps pass, 0 blockers. Run output lands in `.ai/device/scenario-runs/canvas-text-editing/<YYYY-MM-DD-HHMM>/` (gitignored). This committed `spec.md` is the spec; run outputs are NOT committed here.

## User visual gate (not automatable — plan Task 7.2)

After a green run, confirm in `pnpm dev:desktop`: the caret **blinks** on all five surfaces; click-to-place feels right; T-click edits in place; Enter/Shift+Enter; type → persist across ⌘R.

## How to run

```sh
pnpm test:e2e:desktop:build   # one-time / on canvas-runtime or Rust source change
cd apps/desktop/e2e && pnpm exec wdio run ./wdio.conf.ts --spec ./scenarios/canvas-text-editing.e2e.ts
# or: /desktop-e2e canvas-text-editing
```

> Canvas-runtime source (`apps/studio/*.tsx`) is read from the staged `.app` resources at runtime — a `cp` into `Maude.app/Contents/Resources/apps/studio/` refreshes it without a rebuild. Pipeline/server code (`canvas-pipeline.ts`, `http.ts`, …) is compiled INTO the sidecar — those changes need `bun run build.ts --release --target=<host>` + swapping `Contents/MacOS/maude-server` (or the full `test:e2e:desktop:build`).
