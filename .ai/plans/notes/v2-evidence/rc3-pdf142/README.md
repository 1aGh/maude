# #142 — real PDF print through the PACKAGED sidecar (rc.2)

Result: PASS (2026-11-03)

## Steps
1. `gh release download v2.0.0-rc.2 --repo 1aGh/maude --pattern Maude_2.0.0-rc.2_universal.dmg`; mounted read-only (`-nobrowse`), copied `Maude.app` to scratch, detached. Bundle version 2.0.0-rc.2.
2. Throwaway project: `.design/config.json` (formatVersion 2) + `.design/ui/e2e-print.tsx` (copy of `PRINT_TSX` in `apps/studio/test/export-e2e-lanes.test.ts`: one A6 `kind="print"` artboard, `print={{paper:"a6", bleedMm:3}}`, 397x559).
3. Booted the packaged `Contents/MacOS/maude-server --port 4871 --root <project>` with `env -i`, throwaway HOME/XDG, a stub `claude` first on PATH, `NO_OPEN=1`, `MAUDE_NO_AUTOBUILD=1`, plus the env the Tauri shell sets (`MAUDE_DEV_SERVER_ROOT`, `MAUDE_PKG_ROOT`, `MAUDE_DEV_SERVER_BIN`, `MAUDE_AGENT_BROWSER` -> bundled paths, see `sidecar.rs`). Without `MAUDE_DEV_SERVER_ROOT` the bare binary reports missing artifacts under `/$bunfs/root`; that is expected, the shell always sets it.
4. Same request as the e2e (`POST /_api/export`, local lane): `{format:"pdf",scope:"artboard",options:{canvasFile:".design/ui/e2e-print.tsx",artboardId:"flyer",pdfPrint:{includeBleed:true,marks:{crop:true,registration:true}}}}` -> HTTP 200, 11998 bytes, `%PDF-1.7`.
5. Parsed with pdf-lib (`check-boxes.mjs`, pdf-lib from the main checkout's apps/studio/node_modules).
6. Control: same export WITHOUT `pdfPrint` -> only a MediaBox (no BleedBox/TrimBox), so the check discriminates.

## Boxes (pt; 1 pt = 0.3528 mm)
| box | found | expected (pdf.ts `applyPrintBoxesAndMarks`) |
|---|---|---|
| BleedBox | [0, 0, 300, 420.96] (105.83 x 148.51 mm) | full page: [0,0,W,H] with includeBleed |
| TrimBox | [8.504, 8.504, 282.992, 403.952] (99.83 x 142.51 mm) | inset by 3 mm = 8.5039 pt each side: W-17.008, H-17.008 -> exact match |
| MediaBox | [-21.26, -21.26, 342.52, 463.48] | bleed box + crop/registration slug 21.26 pt (7.5 mm) each side |
Trim strictly inside media (the e2e's own assertion). Control PDF: MediaBox [0,0,300,420.96], no Bleed/TrimBox.

## Logs
`server-log-excerpt.txt`: `[jobs] pdf: lane=local`, `[_pdf-playwright] page.pdf wrote 1 file(s)`. No oxc-parser / print post-pass / error line. (The log has no explicit oxc line either way; the evidence is that the canvas built and the post-pass produced the boxes.)

## Not covered
- Did not run the GUI app (Tauri shell); the sidecar was launched by hand with the shell's env, not by the shell.
- rc.2..origin/main has no commits touching `apps/studio/exporters`, `export*`, `print*` (checked).
- Only the `keep` text mode; `embed`/`outline` not run.
