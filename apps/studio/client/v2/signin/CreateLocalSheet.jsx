// client/v2/signin/CreateLocalSheet.jsx — "Create a local project" (02 Onboarding ob-local-name, S6.8): a
// name, and you're in. The project is kept in the Maude folder on this Mac, said in words; the folder
// itself is under Advanced › Location, never in the way. It is the one sheet behind both "Just a local
// project" on the sign-in card and File ▸ New Project… ⇧⌘N on Home (V2-3.9), so the V2-3.9 hooks
// (`home-create-*`) keep their names.
//
// "Choose another folder…" needs a native folder picker that only Rust can open (and `create-local` taking
// the chosen base). Until that command exists the button is not drawn (p8-dead-reasons: a button that never
// works is a dead control); `onChooseFolder` draws it.

import { useState } from 'react';

import { HIcon } from '../../home/home-icons.jsx';
import { useModalFocus } from '../shell/modal-focus.js';

/** The folder name `create-local` will use for a name (home/create-local.ts `projectFolderName`, shown only). */
export function folderNameFor(name) {
  const cleaned = String(name ?? '')
    .normalize('NFC')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it strips
    .replace(/[/\\:\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '')
    .slice(0, 80)
    .trim();
  return cleaned || 'Untitled project';
}

/**
 * @param {{ value: {name: string, busy: boolean}, onChange: (v: {name: string, busy: boolean}) => void,
 *           onSubmit: () => void, onCancel: () => void, onChooseFolder?: (() => void) | null }} props
 */
export function CreateLocalSheet({ value, onChange, onSubmit, onCancel, onChooseFolder = null }) {
  const [adv, setAdv] = useState(false);
  const trap = useModalFocus({ onClose: onCancel });
  return (
    <div
      ref={trap}
      tabIndex={-1}
      className="home-link-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Create a local project"
    >
      <div className="home-link-scrim" aria-hidden="true" onClick={onCancel} />
      <form
        className="island home-link-dialog si-sheet"
        data-testid="home-create-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <h2>Create a local project</h2>
        <label className="si-field">
          <span className="si-field-label">Name</span>
          <input
            className="home-create-name"
            data-testid="home-create-name"
            placeholder="Untitled project"
            // biome-ignore lint/a11y/noAutofocus: the sheet opens for this one field
            autoFocus
            maxLength={80}
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
          />
          <span className="si-field-hint">
            Kept on this Mac, in your Maude folder. Move it to the cloud any time.
          </span>
        </label>
        <div className="si-adv" data-open={adv ? 'true' : undefined}>
          <button
            type="button"
            className="si-adv-btn"
            data-testid="home-create-advanced"
            aria-expanded={adv}
            aria-controls="home-create-adv-body"
            onClick={() => setAdv((a) => !a)}
          >
            <span className={`si-adv-ch${adv ? ' si-adv-ch--open' : ''}`} aria-hidden="true">
              <HIcon name="submenu" size={12} />
            </span>
            Advanced
            <span className="si-adv-count">Location</span>
          </button>
          {adv ? (
            <div className="si-adv-body" id="home-create-adv-body">
              <span className="si-loc">
                <span>Location</span>
                <span className="si-mono" data-testid="home-create-location">
                  ~/Maude/{folderNameFor(value.name)}
                </span>
              </span>
              {onChooseFolder ? (
                <span className="si-loc-acts">
                  <button
                    type="button"
                    className="btn btn--sm"
                    data-testid="home-create-choose-folder"
                    onClick={onChooseFolder}
                  >
                    Choose another folder…
                  </button>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="home-link-foot">
          <button type="button" className="btn" data-testid="home-create-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            data-testid="home-create-submit"
            disabled={value.busy}
          >
            {value.busy ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </form>
    </div>
  );
}
