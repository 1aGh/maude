// client/v2/export/file-rows.jsx — P8-C4: the two rows every sheet ends with (09 Export: `File name`, `Save to`;
// a batch: `Folders`, `Save to`).
//
// The name is what the file will be called — the SERVER's own naming (`renderStem`) run on this export's names, so the
// field shows exactly what lands on disk. One file: the field is editable (what you type becomes the pattern); several:
// it shows the first name and "and N more", and the pattern stays under Advanced › File names. Save to is the spec's
// `options.saveTo`: Downloads, or ask each time.

import { Select } from './advanced/fields.jsx';
import { Row } from './parts.jsx';

export const SAVE_TO_OPTIONS = [
  ['downloads', 'Downloads'],
  ['ask', 'Ask each time'],
];
export const SAVE_TO_DEFAULT = 'downloads';

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
 */
export function FileRows({ file, more = 0, onName, saveTo, onSaveTo, folders = null }) {
  const single = more === 0 && typeof onName === 'function';
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
          value={saveTo ?? SAVE_TO_DEFAULT}
          options={SAVE_TO_OPTIONS}
          onChange={onSaveTo}
        />
      </Row>
    </>
  );
}
