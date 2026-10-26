// client/v2/onboarding/FolderGithubSheet.jsx — "Open a folder or a GitHub project" (02 ob-adv-sheets, S6.9).
// Two segments. "A folder on this Mac" opens the system folder picker (Rust `open_project_folder`, the caller's
// `onOpenFolder`) and the folder becomes a project tab. "From GitHub" is S6.10's: its repo list comes from REST in
// Rust and the token never reaches this page, so the segment RESTS until the caller passes `github`
// ({ content, canOpen, onOpen }) — drawn, not hidden, so the choice exists.

import { useState } from 'react';

import { AdvModal, AdvSheet } from './AdvSheet.jsx';
import { FOLDER_WORDS as W } from './onboarding-model.js';

/**
 * @param {{ tab?: 'folder'|'github', busy?: boolean, error?: string|null,
 *           onOpenFolder: () => void, onCancel: () => void,
 *           github?: { content: any, canOpen: boolean, onOpen: () => void } | null }} props
 */
export function FolderGithubSheet({
  tab = 'folder',
  busy = false,
  error = null,
  onOpenFolder,
  onCancel,
  github = null,
}) {
  const [on, setOn] = useState(tab === 'github' && github ? 'github' : 'folder');
  const isGithub = on === 'github' && !!github;
  return (
    <AdvModal onCancel={onCancel}>
      <AdvSheet
        id="folder"
        title={W.title}
        verb={W.verb}
        busy={busy}
        canSubmit={isGithub ? github.canOpen : true}
        onSubmit={isGithub ? github.onOpen : onOpenFolder}
        onCancel={onCancel}
      >
        {/* biome-ignore lint/a11y/useSemanticElements: a two-way segmented control, not a form fieldset */}
        <span className="ob-seg" role="group" aria-label="Where it is">
          <button
            type="button"
            className="ob-seg-b"
            aria-pressed={!isGithub}
            data-testid="onb-folder-tab-folder"
            onClick={() => setOn('folder')}
          >
            {W.tabFolder}
          </button>
          <button
            type="button"
            className="ob-seg-b"
            aria-pressed={isGithub}
            aria-disabled={github ? undefined : 'true'}
            data-testid="onb-folder-tab-github"
            onClick={() => github && setOn('github')}
          >
            {W.tabGithub}
          </button>
        </span>
        {isGithub ? (
          github.content
        ) : (
          <p className="ob-fine" data-testid="onb-folder-line">
            {W.folderLine}
          </p>
        )}
        {error ? (
          <p className="ai-conn-err" role="alert" data-testid="onb-folder-error">
            {error}
          </p>
        ) : null}
      </AdvSheet>
    </AdvModal>
  );
}
