// client/v2/inspector/element-code.js — S11.8: read one element's JSX through the shell.
//
// The canvas file comes from `/_api/canvas-source` on the MAIN origin (the route needs `export`, so Can
// view is refused with 403 — the row is not even drawn for that role, this is the second lock). The shell
// then slices it by `data-cd-id` (jsx-slice.js). The canvas origin is never asked for source.

import { elementJsx } from './jsx-slice.js';

/** The line Can view gets, and the one the server sends (routes/canvas-source.ts `codeRefusalResponse`). */
export const NO_CODE_FOR_VIEW = "Can view doesn't include the code. Ask the owner to change this.";

/**
 * @param {{ canvasFile: string, id: string, index?: number, fetchImpl?: typeof fetch }} q
 * @returns {Promise<{ ok: true, code: string } | { ok: false, message: string }>}
 */
export async function readElementCode({ canvasFile, id, index = 0, fetchImpl }) {
  const doFetch = fetchImpl ?? globalThis.fetch;
  if (!canvasFile || !id)
    return { ok: false, message: 'Select one element first. Nothing was copied.' };
  let res;
  try {
    res = await doFetch(`/_api/canvas-source?canvas=${encodeURIComponent(canvasFile)}`);
  } catch {
    return { ok: false, message: "The code didn't load. Nothing changed. Try Copy code again." };
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 403 && body?.error === 'read-only')
    return { ok: false, message: body.message || NO_CODE_FOR_VIEW };
  if (!res.ok || typeof body?.source !== 'string')
    return { ok: false, message: "The code didn't load. Nothing changed. Try Copy code again." };
  const code = elementJsx(body.source, id, index);
  if (code === null)
    return {
      ok: false,
      message:
        "This element isn't in the file as written. Reload the canvas, then Copy code again.",
    };
  return { ok: true, code };
}
