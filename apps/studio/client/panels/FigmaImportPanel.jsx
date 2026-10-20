// FigmaImportPanel — DDR-216, now a SHIM (S8.17). The v1 "paste a URL, pick a mode" dialog became the v2
// Import from Figma sheet (client/v2/import/figma-sheet.jsx): paste a link, Connect… in place the first time,
// pick frames and where they go — each frame arrives as Figma's exact picture — or a FigJam board as
// annotations. The entry points (app.jsx's `<FigmaImportPanel onClose onImported />`, Menu › File › Import from
// Figma…, the onboarding door, Home's `import-figma` intent) and the v1 testids the sheet still has a place for
// are kept — the sheet re-emits them. Nothing deleted: v1's three modes map to `import.figma` (the link picks
// frames or board; styles are the sheet's "Colours and text styles" option) and Preview to the frame list.

import FigmaSheet from '../v2/import/figma-sheet.jsx';

export default function FigmaImportPanel({ onClose, onImported, activePath = null }) {
  return <FigmaSheet open onClose={onClose} onImported={onImported} activePath={activePath} />;
}
