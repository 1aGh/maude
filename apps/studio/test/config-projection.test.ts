// The `/_config` projection — Cloud Phase 27.
//
// WHAT WENT WRONG, TWICE IN ONE CHANGE.
//
// The server's `/_config` handler adds fields to the config it returns. The
// client does NOT spread that response — it builds a new object naming each
// field it wants (a deliberate choice: `/_config` and `/_index-data` race, and
// a full replace would clobber `canvasDesignSystems`). So a field the server
// starts returning arrives nowhere until somebody names it on the client too,
// and NOTHING says so. Phase 27 added two and named neither:
//
//   `cloud`        → the cloud studio rendered without its "which project am I
//                    in / how do I leave" chrome, silently.
//   `canvasToken`  → every canvas iframe loaded the cookieless canvas origin
//                    with no capability, so every canvas would have 401'd.
//
// Both shipped to production. The first was found by looking at the page; the
// second had not been found at all.
//
// This test reads BOTH sides out of source and demands they agree. It is a
// grep-gate, the same trade `scripts/check-containment.sh` makes, and it is
// sound for the same reason: the shapes it matches are the ones both files have
// had since they were written, and the "did the regex find anything" assertions
// below are what stop it passing vacuously.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fileContaining } from './_client-source.ts';

const STUDIO = join(import.meta.dir, '..');
const HTTP_TS = readFileSync(join(STUDIO, 'http.ts'), 'utf8');
// The client file that holds the `/_config` fetch — app.jsx before the V2-0.2
// split, wherever that handler moves after it (see `_client-source.ts`). Read
// inside each test, so a missing or duplicated handler fails a test, not the import.
const clientConfigFile = () => fileContaining("fetch('/_config')").src;

/**
 * Fields the `/_config` handler adds ON TOP of the `...ctx.cfg` spread.
 *
 * The spread itself is not enumerable from source and does not need to be: it
 * is the project's own config file, which the client already carries wholesale.
 * The risk is in the COMPUTED fields — the ones the server decides per request.
 */
function serverComputedConfigFields(): string[] {
  const start = HTTP_TS.indexOf("'/_config':");
  expect(start).toBeGreaterThan(0);
  // The handler is short; take to the end of its `Response.json({...})`.
  const body = HTTP_TS.slice(start, start + 2000);
  const end = body.indexOf('\n    // ');
  const src = end > 0 ? body.slice(0, end) : body;

  const fields = new Set<string>();
  // `canvasOrigin: ctx.canvasOrigin,` / `readOnly: projectReadOnly(req),`
  for (const m of src.matchAll(/^\s{8}([a-zA-Z][a-zA-Z0-9]*):\s/gm)) fields.add(m[1]);
  // Conditionally-spread fields: `? { canvasToken: … }` / `? { cloud: { … } }`
  for (const m of src.matchAll(/\?\s*\{\s*([a-zA-Z][a-zA-Z0-9]*):/g)) fields.add(m[1]);
  return [...fields].sort();
}

/** Fields the client's `/_config` handler copies into `cfg`. */
function clientProjectedFields(): string[] {
  const APP_JSX = clientConfigFile();
  const start = APP_JSX.indexOf("fetch('/_config')");
  expect(start).toBeGreaterThan(0);
  const end = APP_JSX.indexOf('.catch(() => {});', start);
  expect(end).toBeGreaterThan(start);
  const src = APP_JSX.slice(start, end);
  const fields = new Set<string>();
  for (const m of src.matchAll(/^\s{10}([a-zA-Z][a-zA-Z0-9]*):\s/gm)) fields.add(m[1]);
  return [...fields].sort();
}

describe('/_config projection', () => {
  test('the scrape finds both sides — a regex that matches nothing approves everything', () => {
    const server = serverComputedConfigFields();
    const client = clientProjectedFields();
    expect(server.length).toBeGreaterThanOrEqual(3);
    expect(client.length).toBeGreaterThanOrEqual(5);
    expect(server).toContain('readOnly');
    expect(client).toContain('readOnly');
  });

  test('every field the server COMPUTES is named by the client', () => {
    const client = new Set(clientProjectedFields());
    const missing = serverComputedConfigFields().filter((f) => !client.has(f));
    expect(missing).toEqual([]);
  });

  test('the two fields this gate was written for are both present', () => {
    // Named explicitly as well as covered by the rule above, because these are
    // the ones that actually shipped broken and a future refactor of the regex
    // should not be able to quietly stop covering them.
    const client = new Set(clientProjectedFields());
    expect(client.has('canvasToken')).toBe(true);
    expect(client.has('cloud')).toBe(true);
  });

  test('the client still MERGES rather than replaces', () => {
    // The reason the projection is explicit in the first place: `/_config` and
    // `/_index-data` race, and a full replace clobbers `canvasDesignSystems`
    // (DDR-093). Anyone "simplifying" this into a spread of `data` must not
    // also drop the functional merge.
    const APP_JSX = clientConfigFile();
    const start = APP_JSX.indexOf("fetch('/_config')");
    const src = APP_JSX.slice(start, APP_JSX.indexOf('.catch(() => {});', start));
    expect(src).toContain('setCfg((prev) => ({');
    expect(src).toContain('...prev,');
  });
});
