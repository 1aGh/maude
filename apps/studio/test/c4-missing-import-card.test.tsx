// 2.0.7 (fix/207-ds-draw) — a canvas with an import that resolves to no file (deleted, renamed, not on this Mac
// yet) is blocked by the frame's closure walk (gate-b-c4l): its frame answers 403 `not-in-scope` before any
// build could name the file, so the stage said only "It didn't finish loading". Found on a Design system
// canvas whose specimen imports `./_layout.css`: one missing stylesheet made the whole board undrawable with
// no word why. The walk now records the missing path, `/_index-data` reports it (`canvasMissingImports`)
// and the stage names it.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { canvasMissingImportsReport, type ProjectReader } from '../access/closure.ts';
import { canvasMissingOf } from '../client/canvas-url.js';

const project = (files: Record<string, string>): ProjectReader => ({
  list: () => Object.keys(files),
  text: (r) => files[r] ?? null,
  head: () => 'h1',
});

const DS = 'system/web';
const BOARD = `${DS}/design-system.tsx`;
const SPECIMEN = `${DS}/preview/logo.tsx`;
const DS_FILES: Record<string, string> = {
  'config.json': JSON.stringify({ designSystems: [{ name: 'web', path: DS }] }),
  [BOARD]:
    'import { DesignCanvas, DCArtboard } from "@maude/canvas-lib";\n' +
    'import { DSSection, Specimen } from "@maude/ds/board";\n' +
    'export default () => <DesignCanvas><DCArtboard id="ds-logo" label="Logo" width={1440} height={900}>' +
    `<Specimen src="preview/logo.tsx" /></DCArtboard></DesignCanvas>;\n`,
  [SPECIMEN]: "import './_layout.css';\nexport default function Logo() { return <p>logo</p>; }\n",
  [`${DS}/colors_and_type.css`]: ':root{}\n',
};

describe('the closure walk names an import that resolves to no file', () => {
  test('a Design system canvas whose specimen imports a missing stylesheet: that file', () => {
    const r = canvasMissingImportsReport(project(DS_FILES), [BOARD]);
    expect(r.get(BOARD)).toEqual([`${DS}/preview/_layout.css`]);
    // with the file there, nothing is missing
    const whole = { ...DS_FILES, [`${DS}/preview/_layout.css`]: '.x{}\n' };
    expect(canvasMissingImportsReport(project(whole), [BOARD]).has(BOARD)).toBe(false);
  });

  test('an ordinary canvas: its own missing import, never one outside the design root', () => {
    const files = {
      'ui/a.tsx':
        'import { DesignCanvas } from "@maude/canvas-lib";\nimport "./gone.css";\nimport "../../../etc/x.css";\n' +
        'export default () => <DesignCanvas />;\n',
      'ui/b.tsx':
        'import { DesignCanvas } from "@maude/canvas-lib";\nexport default () => <DesignCanvas />;\n',
    };
    const r = canvasMissingImportsReport(project(files), ['ui/a.tsx', 'ui/b.tsx']);
    expect(r.get('ui/a.tsx')).toEqual(['ui/gone.css']);
    expect(r.has('ui/b.tsx')).toBe(false);
  });
});

const D = '.design';
const PATH = `${D}/${BOARD}`;
const cfg = {
  designRel: D,
  newComponentDir: 'ui/components',
  canvasMissingImports: { [PATH]: [`${DS}/preview/_layout.css`] },
};

let realFetch: typeof fetch;
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ canvas: { path: BOARD, state: 'present' } }),
    }) as Response) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

describe('the stage', () => {
  test('canvasMissingOf reads the index', () => {
    expect(canvasMissingOf(cfg, PATH)).toEqual([`${DS}/preview/_layout.css`]);
    expect(canvasMissingOf(cfg, `${D}/ui/other.tsx`)).toBeNull();
  });

  test('the failed frame names the missing file instead of "It didn’t finish loading"', async () => {
    const { Viewport } = await import('../client/shell/viewport.jsx');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <Viewport
          tabs={[{ path: PATH }]}
          activePath={PATH}
          registerIframe={() => {}}
          cfg={cfg}
          canvasReloadNonce={0}
          renderSignal={{}}
          canvasError={{ path: PATH, kind: 'compile', reason: 'cap' }}
        />
      );
    });
    const card = host.querySelector('[data-testid="canvas-imports-card"]');
    expect(card?.textContent).toContain(
      'This canvas imports system/web/preview/_layout.css, which is not in the project.'
    );
    expect(card?.textContent).toContain(
      'Put the file back, or remove the import, to draw the canvas.'
    );
    expect(card?.textContent).not.toContain('another canvas');
  });
});
