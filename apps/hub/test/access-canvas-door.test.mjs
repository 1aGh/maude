// The canvas-door lift of S9.3's canvas-only fail-closed gate (S9.4/S9.5).
//
// A row flagged `canvasDoor` has a handler that answers a canvas-only session
// itself (V2-1.16 L1–L6); the gate then only asks whether ANY granted canvas
// holds the capability, and the claim — not the stored read_only projection —
// decides. Every other row keeps refusing canvas-only sessions (U1 answer).

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { hubAccessRefusal, NOT_IN_SCOPE_REFUSAL } from '../src/access-gate.mjs';
import { checkHubRouteTable, classifyHubRequest, HUB_ROUTE_ROWS } from '../src/routes-v2/index.mjs';

const canvasOnly = (r) => () => ({
  label: 'c',
  owner: 'c@x.test',
  role: null,
  // peerSessionFields stores a canvas-only session read-only (fail closed).
  readOnly: true,
  scope: '*',
  access: { v: 1, role: null, grants: [{ c: 'ui/a.tsx', r }] },
});
const req = { headers: { authorization: 'Bearer t' } };

describe('canvasDoor rows', () => {
  test('a canvas-only session passes the gate on a canvasDoor row, by its claim', () => {
    for (const capability of ['read', 'export', 'edit']) {
      assert.equal(
        hubAccessRefusal({
          request: req,
          capability,
          scope: 'canvas',
          canvasDoor: true,
          verify: canvasOnly('member'),
        }),
        null,
        capability
      );
    }
  });

  test('…but only for capabilities some grant holds', () => {
    const refusal = hubAccessRefusal({
      request: req,
      capability: 'edit',
      scope: 'canvas',
      canvasDoor: true,
      verify: canvasOnly('viewer'),
    });
    assert.equal(refusal?.status, 403);
  });

  test('without the flag, every canvas-only session is still refused (U1)', () => {
    assert.deepEqual(
      hubAccessRefusal({
        request: req,
        capability: 'read',
        scope: 'filtered',
        verify: canvasOnly('member'),
      }),
      { status: 403, body: NOT_IN_SCOPE_REFUSAL }
    );
  });

  test('the S9.5 rows carry the flag; mode, parity and the document item route do not', () => {
    const flagged = (path) => classifyHubRequest('GET', path).row.canvasDoor === true;
    for (const path of [
      '/api/documents',
      '/api/projects/current/v1/bootstrap',
      '/api/projects/current/v1/revisions',
      '/api/projects/current/v1/history',
      '/api/projects/current/v1/lane',
      '/api/projects/current/v1/blobs/abc',
      '/api/projects/current/v1/proposals',
      '/api/projects/current/v1/transactions/tx_1',
      '/api/history',
      '/api/history/file',
    ]) {
      assert.equal(flagged(path), true, path);
    }
    for (const path of [
      '/api/projects/current/v1/mode',
      '/api/projects/current/v1/parity',
      '/api/documents/ws%2Fx%2Fmain%2Fa',
    ]) {
      assert.equal(flagged(path), false, path);
    }
  });

  test('a non-boolean canvasDoor is a boot failure', () => {
    assert.throws(() =>
      checkHubRouteTable([
        { path: '/x', cap: { safe: 'read', unsafe: 'edit' }, scope: 'canvas', canvasDoor: 1 },
      ])
    );
    assert.doesNotThrow(() => checkHubRouteTable(HUB_ROUTE_ROWS));
  });
});
