// client/v2/onboarding/FigmaSheet.jsx — "Import from Figma" (02 ob-adv-sheets, S6.9). Import opens the target
// project (or a new one) with the `import-figma` intent (Q8); that window's own Import-from-Figma dialog takes the
// link and the access token — the token lives with the project's server, which Home does not have, so this sheet
// holds no credential field and the page never sees one. The fine print is the canvas's, naming the project the
// frames will land in.

import { AdvModal, AdvSheet } from './AdvSheet.jsx';
import { FIGMA_WORDS as W, figmaProjectName } from './onboarding-model.js';

/** @param {{ target?: {name?: string}|null, busy?: boolean, error?: string|null, onImport: () => void, onCancel: () => void }} props */
export function FigmaSheet({ target = null, busy = false, error = null, onImport, onCancel }) {
  return (
    <AdvModal onCancel={onCancel}>
      <AdvSheet
        id="figma"
        title={W.title}
        verb={W.verb}
        busy={busy}
        onSubmit={onImport}
        onCancel={onCancel}
      >
        <p className="ob-fine" data-testid="onb-figma-line">
          {W.fine(figmaProjectName(target))}
        </p>
        {error ? (
          <p className="ai-conn-err" role="alert" data-testid="onb-figma-error">
            {error}
          </p>
        ) : null}
      </AdvSheet>
    </AdvModal>
  );
}
