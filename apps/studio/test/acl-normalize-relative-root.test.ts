// The gate fixture's `normalize` masks the sandbox root so two boots compare byte for byte. Bun
// prints a bundled module's path RELATIVE to the server's cwd when the file sits a few levels up
// (`// ../tmp/slot2/mdcc-test-X/.design/…`) and absolute when it is far away — so a machine whose
// temp dir is near the checkout (the mini lane) leaked a per-boot random name into acl-u7-parity,
// which a Mac (temp dir far above the checkout) never showed. The relative spelling is masked too.

import { describe, expect, test } from 'bun:test';
import { relative } from 'node:path';

import { type GateCell, normalize } from './_acl-gate.ts';

const STUDIO = `${import.meta.dir}/..`;

const cell = (root: string) =>
  ({
    root,
    base: 'http://127.0.0.1:41001',
    canvasBase: 'http://127.0.0.1:41002',
  }) as unknown as GateCell;

describe('acl gate normalize masks the root in its cwd-relative spelling', () => {
  test('two roots that differ only in the random dir name normalise to the same bytes', () => {
    const near = (name: string) => `${STUDIO}/../../../tmp-near/${name}`;
    const a = near('mdcc-test-AAAAAA');
    const b = near('mdcc-test-BBBBBB');
    const bytes = (root: string) =>
      `// ${relative(STUDIO, root)}/.design/ui/c.tsx\nimport "x";\n// abs ${root}/.design`;
    expect(normalize(bytes(a), cell(a))).toBe(normalize(bytes(b), cell(b)));
    expect(normalize(bytes(a), cell(a))).not.toContain('AAAAAA');
  });
});
