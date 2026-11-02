// client/v2/onboarding/FigmaSheet.jsx — "Import from Figma" (02 ob-adv-sheets, S6.9). The Figma link is asked here (a
// link is not a secret) and rides to the project window as the `import-figma` intent's prompt, where the window's
// own sheet opens with it filled in. The access token is NOT asked on Home: it lives with the project's server,
// which Home does not have — the "Advanced · Access token" fold says so, and the page never sees a credential.
// The fine print is the canvas's, naming the project the frames will land in.

import { useState } from 'react';

import { HIcon } from '../../home/home-icons.jsx';
import { figmaLinkKind } from '../import/figma-model.js';
import { AdvModal, AdvSheet } from './AdvSheet.jsx';
import { FIGMA_WORDS as W, figmaProjectName } from './onboarding-model.js';

/** @param {{ target?: {name?: string}|null, busy?: boolean, error?: string|null, onImport: (link: string) => void, onCancel: () => void }} props */
export function FigmaSheet({ target = null, busy = false, error = null, onImport, onCancel }) {
  const [link, setLink] = useState('');
  const [adv, setAdv] = useState(false);
  const kind = figmaLinkKind(link);
  const bad = kind === 'bad';
  return (
    <AdvModal onCancel={onCancel}>
      <AdvSheet
        id="figma"
        title={W.title}
        verb={W.verb}
        busy={busy}
        canSubmit={!bad}
        onSubmit={() => onImport(kind === 'none' ? '' : link.trim())}
        onCancel={onCancel}
      >
        <span className="ob-field">
          <label className="ob-field-label" htmlFor="onb-figma-link">
            {W.linkLabel}
          </label>
          <input
            id="onb-figma-link"
            className="ob-input ob-mono"
            data-testid="onb-figma-link"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder={W.linkPlaceholder}
            // biome-ignore lint/a11y/noAutofocus: the sheet opens for this one field
            autoFocus
            aria-invalid={bad ? 'true' : undefined}
            aria-describedby={bad ? 'onb-figma-link-err' : undefined}
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
        </span>
        {bad ? (
          <p
            className="ob-err"
            id="onb-figma-link-err"
            role="alert"
            data-testid="onb-figma-link-err"
          >
            {W.badLink}
          </p>
        ) : null}
        <p className="ob-fine" data-testid="onb-figma-line">
          {W.fine(figmaProjectName(target))}
        </p>
        <div className="si-fold" data-open={adv ? 'true' : undefined}>
          <button
            type="button"
            className="si-adv-btn"
            data-testid="onb-figma-advanced"
            aria-expanded={adv}
            aria-controls="onb-figma-adv-body"
            onClick={() => setAdv((a) => !a)}
          >
            <span className={`si-adv-ch${adv ? ' si-adv-ch--open' : ''}`} aria-hidden="true">
              <HIcon name="submenu" size={12} />
            </span>
            Advanced
            <span className="si-adv-count">{W.tokenFold}</span>
          </button>
          {adv ? (
            <div className="si-adv-body" id="onb-figma-adv-body">
              <p className="ob-fine" data-testid="onb-figma-token-line">
                {W.tokenLine}
              </p>
            </div>
          ) : null}
        </div>
        {error ? (
          <p className="ai-conn-err" role="alert" data-testid="onb-figma-error">
            {error}
          </p>
        ) : null}
      </AdvSheet>
    </AdvModal>
  );
}
