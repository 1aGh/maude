// S4.19 G1 (canvas 15 `an-follow`): one ⌘Z after a drag put the file back, but the live artboard stayed at the
// drop spot when the undo came within 2 s of the drag. The shell's echo guard dropped EVERY meta event inside
// that window, our own PATCH's echo and the undo's write alike. The guard now reads the file and calls it an
// echo only when it still says what canvas-lib wrote.
//
// Runs the shell's own `metaIsOwnEcho` (lifted from the template between its markers).

import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SHELL = readFileSync(
  join(import.meta.dir, '..', '..', '..', 'plugins', 'design', 'templates', '_shell.html'),
  'utf8'
);

function lift() {
  const begin = SHELL.indexOf('// meta-echo:begin');
  const end = SHELL.indexOf('// meta-echo:end');
  expect(begin).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(begin);
  return new Function(`${SHELL.slice(begin, end)}\nreturn metaIsOwnEcho;`)() as (
    sinceSelfMs: number,
    fresh: unknown,
    mirror: unknown
  ) => boolean;
}
const meta = (...ab: Array<[string, number, number]>) => ({
  layout: { artboards: ab.map(([id, x, y]) => ({ id, x, y })) },
});

test('the file that says what we just wrote is our echo', () => {
  const echo = lift();
  expect(echo(80, meta(['home', 172, 229]), meta(['home', 172, 229]))).toBe(true);
});

test('an undo inside the 2 s window (the file lost the layout we mirrored) applies', () => {
  const echo = lift();
  expect(echo(1600, {}, meta(['home', 172, 229]))).toBe(false);
  expect(echo(1600, meta(['home', 0, 0]), meta(['home', 172, 229]))).toBe(false);
});

test('a peer moving a different board inside the window applies', () => {
  const echo = lift();
  expect(echo(300, meta(['home', 172, 229], ['pricing', 9, 9]), meta(['home', 172, 229]))).toBe(
    false
  );
});

test('outside the window nothing is an echo, as before', () => {
  const echo = lift();
  expect(echo(2000, meta(['home', 172, 229]), meta(['home', 172, 229]))).toBe(false);
  expect(echo(60_000, meta(['home', 172, 229]), meta(['home', 172, 229]))).toBe(false);
});

test('the meta branch asks the helper rather than gating on the window alone', () => {
  expect(SHELL).toContain('metaIsOwnEcho(sinceSelf, j, window.__canvas_meta__)');
  expect(SHELL).not.toContain('if (Date.now() - lastSelf < 2000) return;');
});
