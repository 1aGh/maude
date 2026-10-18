// dialogs/export-dialog.jsx — S8.2: a SHIM. The v1 Export & handoff dialog (moved here by V2-0.2) is gone;
// the one Export sheet lives in client/v2/export/ (export-sheet.jsx). This file keeps the two names the
// shell imports (`ExportDialog`, `downloadCapturedBlob`) pointing at it, so app.jsx and the bridge keep
// working until their imports are repointed. Deleted with the rest of the v1 tree at V2-8.0.

export { ExportSheet as ExportDialog } from '../v2/export/export-sheet.jsx';
export { downloadCapturedBlob } from '../v2/export/run-export.js';
