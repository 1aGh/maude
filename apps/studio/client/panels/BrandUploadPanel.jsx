// BrandUploadPanel — T12 (DDR-173), now a SHIM (S8.18). The v1 "Bring my existing brand" panel
// became the v2 Import a brand sheet (client/v2/import/brand-sheet.jsx): drop a logo and/or type a
// website, Reading, then the colours with their roles, the fonts and a preview. The entry points
// (app.jsx's `<BrandUploadPanel open onClose />`, Menu › File › Import a brand…, the onboarding
// "Bring my brand" door) and every v1 testid (brand-up-*) are kept — the sheet re-emits them.
// Nothing deleted: v1's "Copy command" lives in the result's Advanced (and in Settings › Advanced).

import BrandSheet from '../v2/import/brand-sheet.jsx';

export default function BrandUploadPanel({ open, onClose }) {
  return <BrandSheet open={open} onClose={onClose} />;
}
