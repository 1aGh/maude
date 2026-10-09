// Tests for the dgn message inventory (plan V2-1.2 → drift gate of V2-2.10).
//
//   node --test scripts/v2-dgn/dgn-inventory.test.mjs
//
// A fixture tree plants one example of every send / handle / gate pattern the real sources use; each must be
// found with the right direction, payload keys and gates. To watch it go red, point the suite at a broken copy:
//   DGN_INVENTORY_UNDER_TEST=/path/to/broken.mjs node --test scripts/v2-dgn/dgn-inventory.test.mjs

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const MOD = resolve(process.env.DGN_INVENTORY_UNDER_TEST || join(HERE, 'dgn-inventory.mjs'));
const { inventory } = await import(pathToFileURL(MOD).href);

const FIXTURE = {
  // Shell listener: an origin pre-gate, one active-canvas-gated branch, one ungated branch; a shell sender.
  'apps/studio/client/hooks/bridge.jsx': `
    export function useBridge({ cfg, iframesRef, activePath }) {
      function onMessage(e) {
        const expectedOrigin = cfg?.canvasOrigin || window.location.origin;
        if (e.origin !== expectedOrigin) return;
        const m = e.data;
        if (!m || !m.dgn) return;
        if (m.dgn === 'fx-active') {
          const activeWin = iframesRef.current.get(activePath)?.contentWindow;
          if (e.source === activeWin) use(m.alpha, m.beta);
        } else if (m.dgn === 'fx-any') {
          use(m.gamma);
        } else if (m.dgn === 'fx-orphan') {
          use(m.delta);
        }
      }
      window.addEventListener('message', onMessage);
      iframesRef.current.get(activePath).contentWindow.postMessage({ dgn: 'fx-down', y: 1, ...rest }, '*');
      post({ dgn: dir });
    }
  `,
  // Canvas side: senders up; a parent-gated handler reading through an \`as\` alias; a switch; a dgn alias.
  'apps/studio/fx-canvas.tsx': `
    window.parent.postMessage({ dgn: 'fx-active', alpha: 1, beta: 2 }, '*');
    window.parent.postMessage({ dgn: 'fx-any', gamma: 3 }, '*');
    const onMessage = (e: MessageEvent) => {
      const m = e.data as { dgn?: string } | null;
      if (!m || !m.dgn) return;
      if (m.dgn === 'fx-down') {
        if (e.source !== window.parent) return;
        const mm = m as { y?: number };
        use(mm.y);
      }
      switch (m.dgn) {
        case 'fx-case': use((m as { z?: number }).z); break;
      }
      const t = m.dgn;
      if (t === 'fx-alias') use(m.w);
    };
  `,
  // A script embedded in a template string (inspect.ts style), wrapped in <script> tags.
  'apps/studio/fx-inspect.ts': `
    const SCRIPT = \`
<script>
(function() {
  window.parent.postMessage({ dgn: 'fx-embedded', file: 'x' }, '*');
  window.addEventListener('message', function(e) {
    var m = e.data;
    if (m.dgn === 'fx-case') { m.z; }
  });
})();
</script>
\`;
  `,
  // Request/response helper (export-dialog.tsx style).
  'apps/studio/fx-dialog.tsx': `
    const r = await bridgeRequest('fx-req', 'fx-res', { scope: 1 });
  `,
  // Inline <script> of the canvas shell template.
  'plugins/design/templates/_shell.html': `<!doctype html><html><body>
<script>
  window.parent.postMessage({ dgn: 'fx-html', file: 'a' }, '*');
</script></body></html>`,
  // Hub-injected expiry page assembled in a template string.
  'apps/hub/src/fx-proxy.mjs':
    "export const page = (t) => `parent.postMessage({dgn:'fx-hub'},${t});`;\n",
};

let root;
let inv;
const row = (t) => inv.rows.find((r) => r.type === t);

before(() => {
  root = mkdtempSync(join(tmpdir(), 'dgn-inventory-'));
  for (const [rel, text] of Object.entries(FIXTURE)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  inv = inventory(root);
});
after(() => rmSync(root, { recursive: true, force: true }));

describe('dgn inventory — fixture patterns', () => {
  test('canvas→shell with an active-canvas gate: direction, payload, gates', () => {
    const r = row('fx-active');
    assert.ok(r, 'fx-active found');
    assert.deepEqual(r.dir, ['c2s']);
    assert.deepEqual(r.keys, ['alpha', 'beta']);
    assert.deepEqual([...new Set(r.handles.flatMap((h) => h.gates))].sort(), ['origin', 'source']);
  });

  test('an origin-only branch reports no source gate', () => {
    const r = row('fx-any');
    assert.deepEqual(r.dir, ['c2s']);
    assert.deepEqual(
      r.handles.flatMap((h) => h.gates),
      ['origin']
    );
  });

  test('shell→canvas: spread keys are not payload keys; reads go through an `as` alias; parent gate', () => {
    const r = row('fx-down');
    assert.deepEqual(r.dir, ['s2c']);
    assert.deepEqual(r.keys, ['y']);
    assert.deepEqual(r.handles[0].reads, ['y'], 'read through `const mm = m as {…}`');
    assert.deepEqual(r.handles[0].gates, ['parent']);
  });

  test('switch cases, dgn aliases and scripts embedded in template strings are handle/send sites', () => {
    const c = row('fx-case');
    assert.equal(c.handles.length, 2, 'switch case in the .tsx + the embedded script branch');
    assert.deepEqual(c.keys, ['z']);
    assert.deepEqual(row('fx-alias').keys, ['w']);
    const emb = row('fx-embedded');
    assert.ok(emb && emb.sends.length === 1, 'embedded <script> send found');
    assert.equal(emb.sends[0].line, 5, 'line numbers stay file-relative');
  });

  test('bridgeRequest sends the request and handles the response', () => {
    assert.deepEqual(row('fx-req').sends[0].keys, ['id', 'scope']);
    assert.equal(row('fx-res').handles[0].how, 'bridgeRequest');
  });

  test('inline template <script> and the hub page count as canvas-side senders', () => {
    assert.equal(row('fx-html').sends[0].side, 'canvas');
    assert.equal(row('fx-hub').sends[0].side, 'canvas');
  });

  test('orphans and dynamic types are flagged, not dropped', () => {
    assert.equal(row('fx-orphan').orphan, 'no-sender');
    assert.equal(row('fx-embedded').orphan, 'no-handler');
    assert.ok(inv.rows.some((r) => r.dynamic && r.type === '<dynamic:dir>'));
  });
});

describe('dgn inventory — this repository (smoke)', () => {
  test('finds the known bridge and classifies its anchors', () => {
    const real = inventory(REPO);
    const types = real.rows.filter((r) => !r.dynamic);
    assert.ok(types.length >= 100, `expected ≥ 100 message types, got ${types.length}`);
    const vc = real.rows.find((r) => r.type === 'view-chrome');
    assert.deepEqual(vc.dir, ['s2c']);
    assert.ok(vc.handles.some((h) => h.file === 'apps/studio/canvas-shell.tsx'));
    const tc = real.rows.find((r) => r.type === 'tool-cursor');
    assert.deepEqual(tc.dir, ['c2s']);
    assert.ok(tc.sends.every((s) => s.file === 'apps/studio/use-tool-mode.tsx'));
  });
});
