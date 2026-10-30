// The crawl resets its server between states and reloads the page for every replay. What the page logs while that
// happens (an aborted tree fetch, a reset connection, a half-sent response, a module the restarting server could
// not serve) belongs to the rig. A cross-origin probe the CORS policy blocks, and a server answer, do not.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tagErrorKind } from '../v2-verify/dead-controls/crawl.mjs';
import { isRigError } from '../v2-verify/dead-controls/report.mjs';

const rig = (kind, text) => isRigError({ kind: tagErrorKind(kind, text) });

test('errors a server restart or a page reload causes are the rig’s', () => {
  assert.ok(
    rig(
      'console.error',
      'failed to load tree AbortError: signal is aborted without reason\n    at x'
    )
  );
  assert.ok(
    rig('console.error', 'failed to load tree AbortError: The user aborted a request.\n    at x')
  );
  assert.ok(
    rig(
      'console.error',
      'Failed to load resource: net::ERR_EMPTY_RESPONSE\n    at http://localhost:1/_api/sync/availability:0'
    )
  );
  assert.ok(
    rig(
      'console.error',
      'Failed to load resource: net::ERR_CONNECTION_RESET\n    at http://localhost:1/_health:0'
    )
  );
  assert.ok(
    rig(
      'console.error',
      'Failed to load resource: net::ERR_CONTENT_LENGTH_MISMATCH\n    at http://localhost:1/x.js:0'
    )
  );
  assert.ok(
    rig(
      'console.error',
      '[canvas-shell] TypeError: Failed to fetch dynamically imported module: http://localhost:2/.design/ui/Landing.tsx'
    )
  );
  assert.ok(
    rig('console.error', 'failed to load comments TypeError: Failed to fetch\n    at o (x)')
  );
});

test('a CORS-blocked probe and a server refusal stay real', () => {
  assert.ok(
    !rig(
      'console.error',
      "Access to fetch at 'http://localhost:51681/_health' from origin 'http://localhost:48519' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource."
    )
  );
  assert.ok(
    !rig(
      'console.error',
      'Failed to load resource: net::ERR_FAILED\n    at http://localhost:51681/_health:0'
    )
  );
  assert.ok(!rig('http 400', 'POST /_api/edit-op\n  answer: {"ok":false,"code":"invalid"}'));
});
