// 2.0.5 (#205) — the refusal's REASON, end to end on a booted workspace cell.
//
// The import walk (access/closure.ts) judges a canvas by the files its relative imports name. The build
// (Bun) can reach a file the walk did not name: a directory import whose `package.json` `main` points
// elsewhere. Here `ui/a.tsx` imports `./pkg` — the walk resolves it to the decoy `ui/pkg/index.tsx` (a
// helper; the walk passes: no canvas is blocked) — while Bun follows `pkg/package.json` `main` to canvas B,
// which A's frame cannot see. The built module's inputs name B, so the inputs gate (http.ts
// `canvasInputsGate`) refuses it. Three things must hold:
//   1. the reason is recorded and shown on the MAIN origin's /_index-data for a reader who may see B;
//   2. the CANVAS origin still answers the bare not-in-scope body (canvas code reads that body);
//   3. a reader who cannot see B does not get its name — not even that A was refused for a file.
// Revert the recording in `canvasInputsGate` (http.ts) and (1) goes red.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  A_ONLY,
  type AclCell,
  asUser,
  B_REL,
  frameCap,
  get,
  hasCanary,
  OWNER,
  withFc,
} from './_acl-cell.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const A = 'ui/a.tsx';
const NOT_IN_SCOPE = { error: 'not-in-scope', reason: 'not-in-scope' };
const OWNER_O = asUser(OWNER, 'owner@example.com');
const A_ONLY_O = asUser(A_ONLY, 'guest@example.com');

const FILES: Record<string, string> = {
  // canvas B: a canvas by its meta; carries the canary
  [B_REL]: '// CANARY-B-SOURCE\nexport default function B() { return <p>B</p>; }\n',
  'ui/canary-b-zx.meta.json': '{}\n',
  // canvas A imports a directory: the walk sees the decoy, Bun follows `main` to B
  [A]: "import P from './pkg';\nexport default function A() { return <div><P /></div>; }\n",
  'ui/a.meta.json': '{}\n',
  'ui/pkg/index.tsx': 'export default function P() { return <i>decoy</i>; }\n',
  'ui/pkg/package.json': '{"main":"../canary-b-zx.tsx"}\n',
};

let cell: AclCell;

beforeAll(async () => {
  const { root, designRoot } = makeSandbox();
  for (const [rel, text] of Object.entries(FILES)) {
    mkdirSync(join(designRoot, rel, '..'), { recursive: true });
    writeFileSync(join(designRoot, rel), text);
  }
  const port = nextPort();
  const proc = await bootServer(root, port, {
    MAUDE_WORKSPACE_MODE: '1',
    MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
    HUB_DASHBOARD_URL: 'https://cloud.maude.sh',
    MAUDE_PROJECT_NAME: 'Canary',
  });
  const info = (await Bun.file(join(designRoot, '_server.json')).json()) as { canvasPort: number };
  cell = {
    proc,
    root,
    designRoot,
    base: `http://localhost:${port}`,
    port,
    canvasBase: `http://localhost:${info.canvasPort}`,
  };
}, 60000);

afterAll(async () => {
  if (cell) await killProc(cell.proc);
});

type Index = { canvasImportsCanvases?: unknown; canvasRefusedInputs?: Record<string, string[]> };
const indexOf = async (who: Record<string, string>): Promise<{ text: string; data: Index }> => {
  const r = await get(`${cell.base}/_index-data`, who);
  return { text: r.text, data: JSON.parse(r.text) as Index };
};

describe('a built module the inputs gate refuses (the walk passed)', () => {
  test('nothing is recorded before A is opened', async () => {
    expect((await indexOf(OWNER_O)).data.canvasRefusedInputs).toBeUndefined();
  });

  test('the canvas origin answers the bare not-in-scope body', async () => {
    const fc = (await frameCap(cell, OWNER_O, A)) as string;
    const r = await get(cell.canvasBase + withFc(`/.design/${A}`, fc), OWNER_O);
    expect(r.status).toBe(403);
    expect(JSON.parse(r.text)).toEqual(NOT_IN_SCOPE);
    expect(hasCanary(r.text)).toBe(false);
    expect(r.text).not.toContain('ui/');
  });

  test('the walk itself passed: no imported-canvas entry for A', async () => {
    expect((await indexOf(OWNER_O)).data.canvasImportsCanvases).toBeUndefined();
  });

  test('a reader who may see B is told which file A was refused for (main origin)', async () => {
    const { data } = await indexOf(OWNER_O);
    expect(data.canvasRefusedInputs).toEqual({ [`.design/${A}`]: [B_REL] });
  });

  test('a reader who cannot see B gets no name, and no entry that would say A has one', async () => {
    const fc = (await frameCap(cell, A_ONLY_O, A)) as string;
    // the same refusal for this reader's own frame
    const mod = await get(cell.canvasBase + withFc(`/.design/${A}`, fc), A_ONLY_O);
    expect(mod.status).toBe(403);
    const { text, data } = await indexOf(A_ONLY_O);
    expect(data.canvasRefusedInputs ?? {}).toEqual({}); // filtered to nothing: no entry, no name
    expect(hasCanary(text)).toBe(false);
    expect(text).not.toContain('canary');
  });
});
