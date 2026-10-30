# Phase 0 — product defects the desktop e2e default lane exposed (V2-0.1 triage, 2026-10-09)

The default lane was 5/12 on unchanged `main` (44073eed). Test-side causes were fixed in
`b82ea11f` (shared app process across spec files, stale selectors, tsx `__name`, window width).
It now ends **10 passed / 2 failed**; the two reds are real product defects, left red on purpose
(no masking). They are NOT move-only work, so they are carried into **V2-2.8 (Known bugs)** on
`feat/maude-v2`, each with a fail-first regression test. Evidence: the e2e logs of that run.

| # | Scenario | Defect | Cause | Patch |
| --- | --- | --- | --- | --- |
| P1 | `export-formats` (SVG) | SVG export fails in the packaged app: `Cannot find module 'dom-to-svg'` | `exporters/_browser-bundles.ts` uses `require.resolve(pkg)` at runtime; inside the `bun --compile` sidecar a package that is not embedded never resolves from disk (DDR-045 class). Last green 2026-08-23; suspect the Bun 1.3.3 → 1.4.2 bump (e2bc5ce6), unconfirmed. `dom-to-svg` is also not staged into the `.app` | disk walk-up from `DEV_SERVER_ROOT` to the package entry; add `dom-to-svg` to `RENDER_RUNTIME_PKGS` in `apps/desktop/scripts/stage-resources.mjs` |
| P2 | `export-formats` (PNG/PDF/HTML after another canvas) | after switching canvases the Export dialog targets the PREVIOUS canvas's artboard | the 2 s select-echo suppression (5e3c079d8) also drops the server's `selected: null` restore after a switch; the dialog's artboard wiring (9ab278fe1) never checks the selection's file | suppress only an echo for the same file; the dialog uses `selected.artboardId` / `selection` only when `selected.file === activePath`. **After the V2-0.2 split** the first hunk lives in `client/hooks/use-canvas-bridge.jsx`, the second in `App()`'s render |
| P3 | `acp-write-scope` tests 2–3 | an AI write OUTSIDE the project completes with no permission prompt | sessions read the user's own `~/.claude/settings.json` (`settingSources: ['user']`); its `permissions.allow` (`Edit`, `Write`, `Bash(*)`) pre-approves Write, so `requestPermission` — where the write-scope gate lives (DDR-184) — is never called | flag-layer `permissions.ask` for Write/Edit/MultiEdit/NotebookEdit in `acp/bridge.ts`. **Decided by Michal 2026-10-09: NOT applied** — the AI chat keeps Claude Code's default behaviour (the user's own allow rules apply). V2-2.8 fixes the scenario instead: it asserts the prompt only when no user rule pre-approves Write, and otherwise asserts the write landed as the user's settings allow |

The pre-existing `~/.maude-e2e-write-scope-probe.txt` (2026-10-06) suggests P3 already happened on an earlier run.

## Proposed patches (against 44073eed — re-target P2 after the split)

```diff
--- a/apps/studio/exporters/_browser-bundles.ts
+++ b/apps/studio/exporters/_browser-bundles.ts
@@ -6,5 +6,5 @@
 // shims can `addScriptTag({ path })` without re-bundling per request.
 
-import { existsSync } from 'node:fs';
+import { existsSync, readFileSync } from 'node:fs';
 import { tmpdir } from 'node:os';
 import path from 'node:path';
@@ -235,4 +235,23 @@
  * running dev server pays the build cost once.
  */
+/**
+ * The package's entry FILE on disk, found by walking up from DEV_SERVER_ROOT.
+ * NOT `require.resolve`: inside the `bun --compile` sidecar a runtime resolve
+ * of a package that is not embedded never reaches disk (DDR-045 class) — SVG
+ * export failed "Cannot find module 'dom-to-svg'" in the desktop app. Bun.build
+ * then bundles from this path, the way video-encode-lib.ts reaches mediabunny.
+ */
+function packageEntry(name: string): string {
+  for (let dir = DEV_SERVER_ROOT; ; dir = path.dirname(dir)) {
+    const pkgDir = path.join(dir, 'node_modules', name);
+    const pj = path.join(pkgDir, 'package.json');
+    if (existsSync(pj)) {
+      const pkg = JSON.parse(readFileSync(pj, 'utf8')) as { module?: string; main?: string };
+      return path.join(pkgDir, pkg.module ?? pkg.main ?? 'index.js');
+    }
+    if (path.dirname(dir) === dir) throw new Error(`Cannot find package '${name}' from ${DEV_SERVER_ROOT}`);
+  }
+}
+
 export function getBrowserBundle(packageName: string, globalName: string): Promise<string> {
   const key = `${packageName}::${globalName}`;
@@ -240,5 +259,5 @@
   if (existing) return existing.ready;
 
-  const entry = require.resolve(packageName);
+  const entry = packageEntry(packageName);
   const cachePath = path.join(
     tmpdir(),
--- a/apps/desktop/scripts/stage-resources.mjs
+++ b/apps/desktop/scripts/stage-resources.mjs
@@ -342,5 +342,15 @@
 // the Chromium binary is resolved at runtime from the ms-playwright cache or an
 // executablePath (see bin/_pw-launch.mjs). RCA: issue-desktop-export-failures.
-const RENDER_RUNTIME_PKGS = ['playwright', 'mediabunny', 'gifenc', '@remotion/web-renderer'];
+//   • `dom-to-svg` — exporters/_browser-bundles.ts Bun.build's it at export time for
+//     the SVG lane (a dynamic package name, so neither embedded in the compiled
+//     binary nor seen by the helper-deps import scrape); absent → SVG export fails
+//     "Cannot find module 'dom-to-svg'".
+const RENDER_RUNTIME_PKGS = [
+  'playwright',
+  'mediabunny',
+  'gifenc',
+  '@remotion/web-renderer',
+  'dom-to-svg',
+];
 let renderPkgCount = 0;
 for (const pkg of RENDER_RUNTIME_PKGS) {
--- a/apps/studio/client/app.jsx
+++ b/apps/studio/client/app.jsx
@@ -12262,9 +12262,14 @@
             // genuine cross-canvas restore never follows a local select that
             // closely (it follows a canvas switch).
-            if (Date.now() - lastLocalSelectAtRef.current < 2000) return;
             const incoming = m.selected;
             const one = Array.isArray(incoming) ? incoming[0] : incoming;
             const prevSel = selectedRef.current;
             const prevOne = Array.isArray(prevSel) ? prevSel[0] : prevSel;
+            // Only an echo of OUR OWN select is suppressed — same canvas file.
+            // A restore for another canvas (or none, after a switch) is never an
+            // echo; dropping it left the previous canvas's selection in the
+            // shell, and Export then targeted that canvas's artboard.
+            const echo = one != null && prevOne != null && one.file === prevOne.file;
+            if (echo && Date.now() - lastLocalSelectAtRef.current < 2000) return;
             setSelected((prev) => mergeSelClientFields(incoming, prev));
             if (
@@ -17260,6 +17265,12 @@
           // viewport-active artboard canvas-lib reports on pan. Without this,
           // scope=artboard fell back to `:first-of-type` (always the first).
-          activeArtboardId={selected?.artboardId ?? canvasActiveArtboard ?? null}
-          selection={selected?.selector ? { selector: selected.selector, file: selected.file } : null}
+          activeArtboardId={
+            (selected?.file === activePath ? selected?.artboardId : null) ?? canvasActiveArtboard ?? null
+          }
+          selection={
+            selected?.selector && selected.file === activePath
+              ? { selector: selected.selector, file: selected.file }
+              : null
+          }
           exportLane={cfg.exportLane || 'local'}
           onBrowserCapture={captureFromCanvas}
--- a/apps/studio/acp/bridge.ts
+++ b/apps/studio/acp/bridge.ts
@@ -551,4 +551,16 @@
     options.settings = { enabledPlugins: { 'design@maude': false, kgai: false } };
   }
+  // feature-acp-write-path-scope — the user's OWN ~/.claude allow rules
+  // (`settingSources: ['user']`) can pre-approve Write/Edit, and a
+  // pre-approved call never reaches `requestPermission`, where the
+  // write-scope gate lives: an out-of-project write then lands silently.
+  // An `ask` rule in the flag layer (above user) routes every write tool
+  // through the gate; in-project writes are still auto-approved there.
+  // (bypassPermissions / dontAsk still short-circuit — an explicit choice.)
+  const flag = (options.settings ?? {}) as Record<string, unknown>;
+  options.settings = {
+    ...flag,
+    permissions: { ask: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'] },
+  };
   meta.claudeCode = { options };
   return {
```
