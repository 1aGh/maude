// client/v2/ai/Consent.jsx — S5.10: a folder from disk asks once (03 AI Chat `Consent`). AI may read it,
// never write to it. The title verb is the button verb (CONTRACT §4): "Let AI read “…”?" · Let AI read.
// A folder outside this project names its full path, so the person sees exactly what they allow.
// Not now keeps the chip and sends without it.

import { FolderGlyph } from './AChip.jsx';
import { chipMeta } from './attach.js';

export function consentWords(c) {
  const files = chipMeta({ kind: 'folder', count: c.count, countCapped: c.countCapped });
  return {
    title: `Let AI read “${c.name}” (${files})?`,
    detail: 'Asked once for this folder. AI only reads it — nothing on disk changes.',
    where: c.outsideProject ? c.root : '',
  };
}

export function Consent({ consent, onAllow, onNotNow }) {
  // No autofocus: the card arrives while the person may still be typing, and Enter must never be
  // the thing that lets AI read a folder.
  if (!consent) return null;
  const w = consentWords(consent);
  return (
    // biome-ignore lint/a11y/useSemanticElements: an inline consent card with two buttons, not a form fieldset
    <div
      className="ai-consent"
      role="group"
      aria-label="Folder access"
      data-testid="ai-attach-consent"
    >
      <p className="ai-consent-t">
        <span className="ai-consent-ic">
          <FolderGlyph />
        </span>
        <span>{w.title}</span>
      </p>
      <p className="ai-consent-d">{w.detail}</p>
      {w.where ? (
        <p className="ai-consent-d ai-consent-where" data-testid="ai-attach-consent-path">
          Outside this project: <span className="ai-consent-path">{w.where}</span>
        </p>
      ) : null}
      <span className="ai-card-a">
        <button
          type="button"
          className="btn btn--sm"
          onClick={onNotNow}
          data-testid="ai-attach-consent-notnow"
        >
          Not now
        </button>
        <button
          type="button"
          className="btn btn--sm btn--primary"
          onClick={onAllow}
          data-testid="ai-attach-consent-allow"
        >
          Let AI read
        </button>
      </span>
    </div>
  );
}
