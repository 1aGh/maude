// client/v2/canvases/folder-ask.js — #195 (2.0.4): what the tree's folder and file rows ask, and the words a
// refusal says.
//
// The report: "I can't add or rename folder" (desktop). The folder row's menu asked with `window.prompt`, and
// Tauri's WKWebView does not implement it — it returns null at once, so "New folder here" and "Rename folder"
// did nothing at all (and "Delete folder"'s `window.confirm` answered "no" the same way). Every one of them now
// asks in the shell's own centered dialog (`NameDialog`, the one "New canvas" uses), and a refusal is said
// under the field in plain words instead of failing silently.
//
// Pure: the dialog's words per ask, the client-side name check (the same rule as the server's — rename-model),
// and the line a failed request shows.

import { checkRename } from './rename-model.js';

/** CONTRACT §4: a dialog's title asks with the verb its primary button uses; the other button is Cancel. */
export const FOLDER_ASK_WORDS = Object.freeze({
  /** a Can view / Can comment session, or a request the server refused for its role (403) */
  role: 'Folders need Can edit. Ask a project owner for edit access.',
  filesRole: 'Changing files needs Can edit. Ask a project owner for edit access.',
  failed: {
    'new-folder': 'Could not make the folder. Nothing was changed. Try again.',
    'rename-folder': 'Could not rename the folder. Nothing was changed. Try again.',
    'trash-folder': 'Could not move the folder to the trash. Nothing was changed. Try again.',
    'rename-canvas': 'Could not rename. Nothing was changed. Try again.',
    'rename-file': 'Could not rename. Nothing was changed. Try again.',
    'trash-file': 'Could not move it to the trash. Nothing was changed. Try again.',
  },
  noGroup: 'There is no canvas folder to put a new folder in yet. Make a canvas first.',
});

const folderName = (p) =>
  String(p || '')
    .replace(/\/+$/, '')
    .split('/')
    .pop() || '';

/**
 * The words of one ask. `ask` = { kind, path, name? }:
 *   new-folder     path = the parent folder           → Create folder in “<parent>”
 *   rename-folder  path = the folder                  → Rename folder “<name>”
 *   rename-canvas  path = the canvas, name = its name → Rename canvas
 *   rename-file    path = the file, name = file name  → Rename “<file>” (the extension stays)
 *   trash-folder   path = the folder                  → Move “<name>” to the trash?
 *   trash-file     path = the file, name = file name  → Move “<file>” to the trash?
 */
export function folderAskWords(ask) {
  const name = ask?.name ?? folderName(ask?.path);
  switch (ask?.kind) {
    case 'new-folder':
      return {
        title: `Create folder in “${folderName(ask.path)}”`,
        label: 'Folder name',
        initial: 'Untitled folder',
        confirm: 'Create',
        busy: 'Creating…',
      };
    case 'rename-folder':
      return {
        title: `Rename folder “${name}”`,
        label: 'Folder name',
        initial: name,
        confirm: 'Rename',
        busy: 'Renaming…',
      };
    case 'rename-canvas':
      return {
        title: `Rename canvas “${name}”`,
        label: 'Canvas name',
        initial: name,
        confirm: 'Rename',
        busy: 'Renaming…',
      };
    case 'rename-file': {
      const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
      return {
        title: `Rename “${name}”`,
        label: ext ? `Name (stays ${ext})` : 'Name',
        initial: ext ? name.slice(0, -ext.length) : name,
        confirm: 'Rename',
        busy: 'Renaming…',
      };
    }
    case 'trash-folder':
      return {
        title: `Move “${name}” to the trash?`,
        body: 'Every canvas inside moves to the trash, where you can bring it back. Empty folders inside are removed.',
        confirm: 'Move to trash',
        busy: 'Moving…',
      };
    case 'trash-file':
      return {
        title: `Move “${name}” to the trash?`,
        body: 'You can bring it back from the Trash.',
        confirm: 'Move to trash',
        busy: 'Moving…',
      };
    default:
      return null;
  }
}

/** True for the asks that take a name (a NameDialog), false for the yes/no ones. */
export const asksForName = (ask) =>
  ask?.kind === 'new-folder' ||
  ask?.kind === 'rename-folder' ||
  ask?.kind === 'rename-canvas' ||
  ask?.kind === 'rename-file';

/**
 * The typed name before anything is sent: the same rule the server holds (letters, numbers, spaces, - and _;
 * not starting with _; 60 characters), so a refused name is said at once, with the suggestion.
 * @returns {{ kind: 'keep' } | { kind: 'error', error: string } | { kind: 'send', name: string }}
 */
export function checkAskName(ask, draft) {
  const words = folderAskWords(ask);
  const current = ask?.kind === 'new-folder' ? '' : (words?.initial ?? '');
  const v = checkRename({ draft, current });
  if (v.kind === 'rename') return { kind: 'send', name: v.name };
  return v.kind === 'error' ? { kind: 'error', error: v.error } : { kind: 'keep' };
}

/**
 * The line a failed folder/file request shows under the field (or in the yes/no dialog).
 * `res` = { ok: false, status?, error?, network? } from the shell's request functions (use-tabs.jsx).
 * The server's own words come back as they are (they are plain since #195 — canvas-create.ts FOLDER_WORDS,
 * NAME_RULE); a role refusal, a lost connection or a bare status gets one plain sentence instead.
 */
export function askFailure(kind, res) {
  const fallback = FOLDER_ASK_WORDS.failed[kind] ?? FOLDER_ASK_WORDS.failed['new-folder'];
  if (res?.status === 403)
    return kind.endsWith('-file') || kind === 'rename-canvas'
      ? FOLDER_ASK_WORDS.filesRole
      : FOLDER_ASK_WORDS.role;
  if (res?.network) return fallback;
  const error = typeof res?.error === 'string' ? res.error.trim() : '';
  // a bare status ("error 500"), or a lower-case developer string from an older server, is not for people
  if (!error || /^error \d+$/.test(error) || /^[a-z"]/.test(error)) return fallback;
  return error;
}
