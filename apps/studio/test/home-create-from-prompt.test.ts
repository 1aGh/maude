// home-create-from-prompt — S6.4 (Q4, Q6): "a new project" on Home is created NAMED FROM THE SENTENCE.
// `POST /_home/projects/create-local {fromPrompt}` runs the same non-AI C4 rule as the first canvas
// (`nameFromPrompt(...).project`) on the server; an explicit `name` still wins and still means what it did.

import { beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHomeFetch } from '../home/routes.ts';
import { freshIndexDir, homeDeps, homeReq } from './_home-fixtures.ts';

beforeAll(() => {
  freshIndexDir();
});

async function create(body: unknown) {
  const deps = homeDeps();
  const fetchHome = createHomeFetch(deps);
  const res = await fetchHome(
    homeReq('/_home/projects/create-local', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    })
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown>, deps };
}

describe('create-local from a sentence', () => {
  test('the project is named from the sentence', async () => {
    const { status, json, deps } = await create({
      fromPrompt: 'A calm landing page for Studio site, light and airy',
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.name).toBe('Studio site');
    expect(existsSync(join(deps.projectsDir as string, json.name as string, '.design'))).toBe(true);
  });

  test('a sentence with nothing to name it by falls back to "Untitled project"', async () => {
    const { json } = await create({ fromPrompt: '   ' });
    expect(json.name).toBe('Untitled project');
  });

  test('an explicit name still wins over a sentence', async () => {
    const { json } = await create({ name: 'Plakaty', fromPrompt: 'A poster for the derby' });
    expect(json.name).toBe('Plakaty');
  });

  test('a sentence that is not text names nothing, it does not crash', async () => {
    const { status, json } = await create({ fromPrompt: { x: 1 } });
    expect(status).toBe(200);
    expect(json.name).toBe('Untitled project');
  });
});
