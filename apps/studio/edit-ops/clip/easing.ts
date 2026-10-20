// edit-ops/clip/easing.ts — `video.easing.set` (S7.18; 07 ve-advanced "Easing", 06 ad-timeline).
//
// One animation window of a comp — the k-th `interpolate(frame, …)` of a named component — takes a curve:
// `{ easing: Easing.bezier(a, b, c, d) }` as the call's options, the way the Timeline's keyframe markers
// and the Advanced panel both count them (video/keyframes.ts). `bezier: null` takes the curve off. Nothing
// outside that call changes except `Easing` joining the `remotion` import when the comp did not have it.
// Pure: no IO.

import MagicString from 'magic-string';

import { isBezier, writeEasing } from '../../video/keyframes.ts';
import { assertCompSemantics } from '../../canvas-edit.ts';
import { assertParses } from '../../clip-ops.ts';
import { bad, type Node, parseProgram } from './jsx.ts';

export interface EasingPatch {
  component: string;
  index: number;
  /** four numbers, or null for no curve */
  bezier: [number, number, number, number] | null;
}

export function easingPatch(file: string, p: Record<string, unknown>): EasingPatch {
  if (typeof p.component !== 'string' || !/^[A-Za-z_$][\w$]*$/.test(p.component))
    bad(file, 'The animation names no clip.');
  if (!Number.isInteger(p.index) || (p.index as number) < 0 || (p.index as number) > 999)
    bad(file, 'The animation is not one this video has.');
  let bezier: EasingPatch['bezier'] = null;
  if (p.bezier !== null && p.bezier !== undefined) {
    if (!isBezier(p.bezier))
      bad(file, 'A curve is four numbers; the first and third sit between 0 and 1.');
    bezier = [...(p.bezier as number[])] as EasingPatch['bezier'];
  }
  return { component: p.component as string, index: p.index as number, bezier };
}

/** `Easing` in the `remotion` import: added to the named list, or a new import after the last one. */
function ensureEasingImport(source: string, file: string): string {
  const program = parseProgram(file, source);
  const imports = (program.body ?? []).filter((st: Node) => st.type === 'ImportDeclaration');
  const from = imports.find((st: Node) => st.source?.value === 'remotion');
  const s = new MagicString(source);
  if (from) {
    const specs = (from.specifiers ?? []).filter((sp: Node) => sp.type === 'ImportSpecifier');
    if (specs.some((sp: Node) => (sp.local?.name ?? sp.imported?.name) === 'Easing')) return source;
    const last = specs[specs.length - 1];
    if (last) {
      s.appendLeft(last.end, ', Easing');
      return s.toString();
    }
  }
  const after = imports[imports.length - 1];
  const line = "import { Easing } from 'remotion';";
  if (after) s.appendLeft(after.end, `\n${line}`);
  else s.prepend(`${line}\n`);
  return s.toString();
}

export function applyEasing(
  file: string,
  source: string,
  patch: EasingPatch
): { source: string; changed: boolean } {
  const w = writeEasing(source, patch.component, patch.index, patch.bezier);
  if (!w.ok) {
    if (w.reason === 'no-call') bad(file, 'That animation is not in the video any more.');
    if (w.reason === 'not-literal')
      bad(file, 'This animation’s options are not a plain object, so the curve is left as it is.');
    bad(file, 'A curve is four numbers; the first and third sit between 0 and 1.');
  }
  const written = (w as { ok: true; source: string }).source;
  if (written === source) return { source, changed: false };
  const out = patch.bezier ? ensureEasingImport(written, file) : written;
  assertParses(file, out, patch.component);
  assertCompSemantics(file, out);
  return { source: out, changed: true };
}
