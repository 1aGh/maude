// client/v2/export/file-rows.jsx — P8-C4: the two rows every sheet ends with (09 Export: `File name`, `Save to`;
// a batch: `Folders`, `Save to`).
//
// The name is what the file will be called — the SERVER's own naming (`renderStem`) run on this export's names, so the
// field shows exactly what lands on disk. One file: the field is editable (what you type becomes the pattern); several:
// it shows the first name and "and N more", and the pattern stays under Advanced › File names. Save to is the spec's
// `options.saveTo`: Downloads, the project's own folder, or ask each time.
//
// fix-bulk B5 — the Mac app saves into ANY folder: "Choose a folder…" opens the shell's folder picker
// (`pick_export_folder`, which checks the folder and keeps it per project in the app's own state, never in the
// project), and the folder picked is the `remembered` choice, named by its own name. The next sheet opens on it.
// The path never travels to the server: the shell writes the file (export_save.rs), so no page origin can name a
// folder. A browser tab can only download — it offers Downloads alone.

import { useEffect, useState } from 'react';
import { Select } from './advanced/fields.jsx';
import { nativeSave } from './native-save.js';
import { Row } from './parts.jsx';

export const SAVE_TO_OPTIONS = [
  ['downloads', 'Downloads'],
  ['ask', 'Ask each time'],
];
export const SAVE_TO_DEFAULT = 'downloads';
/** The Select's "Choose a folder…" value: an action, never a `saveTo`. */
export const SAVE_TO_CHOOSE = 'choose';
export const CHOOSE_FOLDER = 'Choose a folder…';
export const LAST_FOLDER = 'Last folder';

const folderName = (p) =>
  String(p ?? '')
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1) ?? null;

/** Save to's choices: a browser tab downloads; the Mac app adds the project's folder, Choose a folder… and Ask. */
export function saveToOptions({ native = false, folder = null, value = null } = {}) {
  if (!native) return [['downloads', 'Downloads']];
  const out = [['downloads', 'Downloads']];
  if (folder || value === 'remembered')
    out.push(['remembered', (folder && folderName(folder)) || LAST_FOLDER]);
  out.push([SAVE_TO_CHOOSE, CHOOSE_FOLDER], ['ask', 'Ask each time']);
  return out;
}

/** What the sheet sends: the person's pick, else the project's folder when it has one, else Downloads. */
export function effectiveSaveTo(picked, { native = false, folder = null } = {}) {
  if (!native) return SAVE_TO_DEFAULT;
  if (picked) return picked;
  return folder ? 'remembered' : SAVE_TO_DEFAULT;
}

/**
 * The project's save folder and the picker, for the sheet. `doors` is `nativeSave()` (a test hands its own).
 * @returns {{ native: boolean, folder: string|null, choose: () => Promise<boolean> }}
 */
export function useSaveFolder(doors) {
  const [d] = useState(() => doors ?? nativeSave());
  const [folder, setFolder] = useState(null);
  useEffect(() => {
    if (!d.available) return undefined;
    let alive = true;
    d.folder().then((f) => {
      if (alive) setFolder(f);
    });
    return () => {
      alive = false;
    };
  }, [d]);
  const choose = async () => {
    const r = await d.pickFolder();
    if (r.ok) setFolder(r.path);
    return r.ok === true;
  };
  return { native: d.available, folder, choose };
}

/** 09 ex-batch-pick — the "File names" row of several picked artboards: the pattern, by its two plain readings. */
export const FILE_NAMES_OPTIONS = [
  ['canvas-artboard', 'Canvas — artboard'],
  ['artboard', 'Artboard only'],
];
export const FILE_NAMES_TEMPLATE = { 'canvas-artboard': undefined, artboard: '{artboard}' };
/** Which of the two a pattern is (anything else typed under Advanced reads as the default one). */
export const fileNamesPick = (template) =>
  template === '{artboard}' ? 'artboard' : 'canvas-artboard';

/** 09 ex-batch — the Folders row of a canvas / folder / project export: where each canvas's files go inside the result. */
export const FOLDERS_OPTIONS = [
  ['one', 'One folder'],
  ['per-canvas', 'One per canvas'],
];

/** `name.png` → `name`: the extension is the format's, the person only types the stem. */
export const stemOf = (file) => String(file ?? '').replace(/\.[A-Za-z0-9]{2,5}$/, '');
const extOf = (file) => /(\.[A-Za-z0-9]{2,5})$/.exec(String(file ?? ''))?.[1] ?? '';

/**
 * @param file      the first file's name, extension included (`nameSamples(...)[0]`)
 * @param more      how many files beyond the first this export makes
 * @param onName    (pattern) => void — only for a single file
 * @param folders   a batch's `Folders` row, drawn instead of `File name` (a select + the path it makes)
 * @param place     `useSaveFolder()` — the Mac app's folder and picker (absent: Downloads / Ask, as before)
 */
export function FileRows({
  file,
  more = 0,
  onName,
  saveTo,
  onSaveTo,
  folders = null,
  place = null,
}) {
  const single = more === 0 && typeof onName === 'function';
  const value = place ? effectiveSaveTo(saveTo, place) : (saveTo ?? SAVE_TO_DEFAULT);
  const options = place ? saveToOptions({ ...place, value }) : SAVE_TO_OPTIONS;
  const pick = async (v) => {
    if (v !== SAVE_TO_CHOOSE) return onSaveTo(v);
    // the folder picked becomes this project's folder; a cancelled picker leaves Save to as it was
    if (await place?.choose?.()) onSaveTo('remembered');
  };
  return (
    <>
      {folders ?? (
        <Row k="File name" testid="export-row-file-name">
          {single ? (
            <span className="ex-field-wrap">
              <input
                type="text"
                className="input ex-field"
                aria-label="File name"
                data-testid="export-file-name"
                spellCheck={false}
                value={stemOf(file)}
                onChange={(e) => onName(e.target.value)}
              />
              <span className="ex-field-ext" aria-hidden="true">
                {extOf(file)}
              </span>
            </span>
          ) : (
            <span className="input ex-field" data-testid="export-file-name">
              <span className="ex-field-t">{file}</span>
              {more > 0 ? <span className="ex-more">and {more} more</span> : null}
            </span>
          )}
        </Row>
      )}
      <Row k="Save to" testid="export-row-save-to">
        <Select
          label="Save to"
          testid="export-save-to"
          value={value}
          options={options}
          onChange={pick}
        />
      </Row>
    </>
  );
}
