// Internal shim behind smoke.sh — 2.0.5 (#205): why a canvas does not render, in the shell card's own words.
//
// Reads the studio's `/_index-data` answer on stdin (smoke.sh fetches it from the main origin of the server
// it is already smoking) and prints, per canvas that imports another canvas (`canvasImportsCanvases`) or whose
// built module was refused for a file another canvas owns (`canvasRefusedInputs`):
//
//   REFUSED  ui/Home.tsx — This canvas uses ui/Shared.tsx, which belongs to another canvas. Move the shared …
//
// Lines go to stdout, one per canvas; nothing (exit 0) when there is nothing to say or the answer is unreadable.
import { canvasImportsLines } from '../client/v2/code/canvas-imports-words.js';

export function reasonLines(index, componentDir) {
  if (!index || typeof index !== 'object') return [];
  const designRel = typeof index.designRoot === 'string' ? index.designRoot : '.design';
  const imports = index.canvasImportsCanvases ?? {};
  const refused = index.canvasRefusedInputs ?? {};
  const keys = [...new Set([...Object.keys(imports), ...Object.keys(refused)])].sort();
  return keys.map((k) => {
    const rel = k.startsWith(`${designRel}/`) ? k.slice(designRel.length + 1) : k;
    const words = canvasImportsLines(imports[k] ?? [], componentDir, refused[k] ?? []);
    return `REFUSED  ${rel} — ${words.join(' ')}`;
  });
}

if (import.meta.main) {
  let index = null;
  try {
    index = JSON.parse(await Bun.stdin.text());
  } catch {
    process.exit(0);
  }
  const lines = reasonLines(index, process.argv[2]);
  if (lines.length) process.stdout.write(`${lines.join('\n')}\n`);
}
