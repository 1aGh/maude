// client/v2/ai/picked-shots.js — P8 r11 (03 `ai-long-pinned`, `ai-six`): "Six shots picked — they're in Assets ›
// Combine recap" shows the shots under the words. The only record of WHICH files a reply picked is its own tool calls:
// the raster files it wrote, copied or moved into the design root (a `Write`'s path, a `cp` / `mv` command's
// destination). A `Read` is looking, not picking. Nothing here reads the reply's words, so nothing is guessed —
// a pick the AI only lists in prose, or puts outside the design root (which this panel cannot serve), draws no strip.

import { sentImageSrc } from './sent-attachments.js';

/** The board's strip is six wide. */
export const SHOTS_MAX = 6;

const RASTER = /\.(?:png|jpe?g|gif|webp)$/i;
const LOOKING = /^(?:read|view|open|glob|grep|ls)\b/i;
const PATH_FIELDS = ['file_path', 'filePath', 'path', 'file', 'destination', 'dest', 'target'];
// a quoted run or a bare word of a shell command
const WORD = /"([^"]+)"|'([^']+)'|(\S+)/g;

function pathsOf(part) {
  const args = part.args && typeof part.args === 'object' ? part.args : {};
  const out = [];
  for (const f of PATH_FIELDS) if (typeof args[f] === 'string') out.push(args[f]);
  if (typeof args.command === 'string') {
    for (const m of args.command.matchAll(WORD)) out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}

/**
 * The shots a reply put in the project: `[{ name, src }]` — each a raster file under the design root, once, in the
 * order its tool calls named it, at most `SHOTS_MAX`. Fewer than two = none (one picture is an edit, not a pick).
 * @param {Array<{type?:string,toolName?:string,args?:object}>} parts the assistant message's content
 * @param {string} designRel the design root, as the panel knows it
 */
export function pickedShots(parts, designRel = '.design') {
  const seen = new Set();
  const out = [];
  for (const part of Array.isArray(parts) ? parts : []) {
    if (part?.type !== 'tool-call' || LOOKING.test(String(part.toolName ?? '').trim())) continue;
    for (const p of pathsOf(part)) {
      if (!RASTER.test(p) || seen.has(p)) continue;
      const src = sentImageSrc(p, designRel);
      if (!src) continue;
      seen.add(p);
      out.push({ name: p.split('/').pop(), src });
    }
  }
  return out.length >= 2 ? out.slice(0, SHOTS_MAX) : [];
}
