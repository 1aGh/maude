// Plan T34 / writer registry H09 — a project in accepted-revisions mode never
// has its checkout rewritten by Git from the studio: the checkout is the
// shared history's projection, and a rewrite would come back as someone's edit.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ACCEPTED_GIT_REFUSAL,
  CHECKOUT_REWRITING_GIT_ROUTES,
  refuseCheckoutRewrite,
} from '../git/accepted-guard.ts';

describe('checkout-rewriting Git routes in an accepted project', () => {
  test('refused with a 409 that says where the intent lives, only in accepted mode', async () => {
    const refused = refuseCheckoutRewrite(() => true);
    expect(refused?.status).toBe(409);
    const body = (await refused?.json()) as typeof ACCEPTED_GIT_REFUSAL;
    expect(body.code).toBe('accepted-project');
    expect(body.error).toContain('History');
    expect(refuseCheckoutRewrite(() => false)).toBeNull();
    expect(refuseCheckoutRewrite(undefined)).toBeNull();
  });

  test('every rewriting route asks the guard before it reads a body or touches Git', () => {
    const http = readFileSync(join(import.meta.dir, '..', 'http.ts'), 'utf8');
    for (const route of CHECKOUT_REWRITING_GIT_ROUTES) {
      const start = http.indexOf(`'${route}': async (req: Request) => {`);
      expect(start).toBeGreaterThan(-1);
      const handler = http.slice(start, http.indexOf('\n    },', start));
      const guard = handler.indexOf('refuseCheckoutRewrite(');
      expect(guard).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(handler.indexOf('readJson'));
    }
    // Graph-only operations stay available (H10).
    for (const route of ['/_api/git/commit', '/_api/git/branch', '/_api/git/push']) {
      const start = http.indexOf(`'${route}': async (req: Request) => {`);
      const handler = http.slice(start, http.indexOf('\n    },', start));
      expect(handler).not.toContain('refuseCheckoutRewrite(');
    }
  });
});
