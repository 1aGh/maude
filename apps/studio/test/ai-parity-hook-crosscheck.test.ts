// V2-8.16 AI parity (live journey S1, terminal lane, 2026-10-28) — a path the registry TEACHES the
// agent must be a path the design plugin's hook ALLOWS.
//
// Turn 5 "Move ui/Greeting.tsx to the trash." failed: `canvas.trash` taught `agent.path: "file"` —
// "Move the .tsx and its sidecars to <designRoot>/_trash/…" — and the PreToolUse hook refuses exactly
// that (`use-verb` / `use-trash`: Bash never moves or deletes a versioned design file). With no
// allowed way left the agent grepped Maude's source and gave up.
//
// The cross-check: every `file` action whose `how` moves, renames, copies or deletes a whole
// versioned design file is turned into the shell command it implies, and that command is run
// through the hook's own rule (`classifyBash`). Any refusal is a taught-but-blocked path → red.
// The hand-made new canvas (`new-canvas`, the Write half of the hook) is judged the same way.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { classifyBash } from '../../../cli/lib/bash-guard.mjs';
import { handMadeCanvasReason } from '../../../cli/lib/design-hook.mjs';

const ROOT = join(import.meta.dir, '..', '..', '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'apps/studio/actions.manifest.json'), 'utf8'));

type Row = { id: string; agent?: { path: string; how?: string; verb?: string } };
const rows = manifest.actions as Row[];

const project = mkdtempSync(join(tmpdir(), 'maude-hook-xcheck-'));
const designRoot = join(project, '.design');
mkdirSync(join(designRoot, 'ui'), { recursive: true });
mkdirSync(join(designRoot, 'assets'), { recursive: true });
writeFileSync(join(designRoot, 'config.json'), '{"canvasGroups":[{"label":"UI","path":"ui"}]}\n');
writeFileSync(join(designRoot, 'ui', 'a.tsx'), 'export default function A() { return null; }\n');
writeFileSync(join(designRoot, 'assets', 'a.png'), 'png');
afterAll(() => rmSync(project, { recursive: true, force: true }));

/** The whole-file shell form a `how` implies, or null when it edits inside a file. */
function impliedCommand(how: string): string | null {
  const first = how.split(/;| — |\. Over HTTP/)[0] as string;
  // inside a file: an element / artboard / JSX edit is the Edit tool's, never a file op
  // (`<designRoot>` / `<slug>` are placeholders, not tags)
  if (/JSX|element|DCArtboard|<(?:div|svg|img|path|p|h\d|Sequence|Video|Audio)\b/.test(first)) return null;
  const asset = /\bassets\/</.test(first);
  if (!asset && !/\.tsx\b/.test(first)) return null;
  const src = asset ? '.design/assets/a.png' : '.design/ui/a.tsx';
  const dst = asset ? '.design/assets/b.png' : '.design/ui/b.tsx';
  const verb = /^\s*(Move|Rename|Copy|Duplicate|Delete|Remove)\b/.exec(first)?.[1];
  if (verb === 'Move' || verb === 'Rename') return `mv ${src} ${dst}`;
  if (verb === 'Copy' || verb === 'Duplicate') return `cp ${src} ${dst}`;
  if (verb === 'Delete' || verb === 'Remove') return `rm ${src}`;
  return null;
}

const refusal = (cmd: string) =>
  classifyBash(cmd, { cwd: project, designRoot, root: project })?.code ?? null;

/** Does `how` teach writing a brand-new canvas `.tsx` by hand (the hook's `new-canvas` deny)? */
const handMade = (how: string) =>
  /^\s*Write a new\b[^;]*\.tsx\b|^\s*Write a new video-comp \.tsx\b/.test(how) &&
  handMadeCanvasReason(designRoot, 'ui/brand-new.tsx') !== null;

describe('a taught agent path is one the design hook allows', () => {
  test('the detector is not vacuous: the old canvas.trash text is refused by the hook', () => {
    const old =
      'Move the .tsx and its sidecars to <designRoot>/_trash/<stamp>__<slug>/ and write _trash-manifest.json {canvas, slug, trashed[]} beside them; Trash restores from it';
    const cmd = impliedCommand(old);
    expect(cmd).toBe('mv .design/ui/a.tsx .design/ui/b.tsx');
    expect(refusal(cmd as string)).toBe('use-verb');
    expect(refusal('rm .design/ui/a.tsx')).toBe('use-trash');
    expect(refusal('cp .design/ui/a.tsx .design/ui/b.tsx')).toBe('not-a-writer');
    expect(refusal('mv .design/assets/a.png .design/assets/b.png')).toBe('use-verb');
    // an element edit is not a file op
    expect(impliedCommand('Move the element’s JSX after its last sibling')).toBeNull();
    expect(impliedCommand('Delete the element’s JSX (a removed DCArtboard is parked)')).toBeNull();
  });

  test('no `file` action teaches a whole-file move / rename / copy / delete the hook refuses', () => {
    const blocked: string[] = [];
    for (const r of rows) {
      if (r.agent?.path !== 'file' || !r.agent.how) continue;
      const cmd = impliedCommand(r.agent.how);
      const code = cmd ? refusal(cmd) : null;
      if (code) blocked.push(`${r.id}: ${code} (${cmd})`);
    }
    expect(blocked).toEqual([]);
  });

  // The Write half: `new-canvas` refuses a canvas written by hand ("Make it with the app's own create").
  // Lead (V2-8.16, option a): every new-canvas action is taught as POST /_api/canvas, then Edit.
  test('no `file` action teaches writing a brand-new canvas .tsx by hand', () => {
    const got = rows
      .filter((r) => r.agent?.path === 'file' && r.agent.how && handMade(r.agent.how))
      .map((r) => r.id);
    expect(got).toEqual([]);
    // … and the detector still sees the old wording
    expect(handMade('Write a new .tsx under the design root with a DCArtboard per screen')).toBe(true);
  });

  test('the new-canvas actions name the app’s create route', () => {
    for (const id of ['canvas.new', 'canvas.new-brief', 'canvas.new-video', 'home.ask']) {
      const how = rows.find((r) => r.id === id)?.agent?.how ?? '';
      expect({ id, route: how.includes('/_api/canvas --method POST') }).toEqual({ id, route: true });
    }
  });

  test('canvas.trash is taught as the trash verb', () => {
    const r = rows.find((x) => x.id === 'canvas.trash');
    expect(r?.agent).toEqual({ path: 'cli', verb: 'maude design trash move <canvas>' });
  });
});
