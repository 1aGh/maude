// home-target-chip — S6.4: which project the sentence on Home lands in. The chip's choices (projects on
// this Mac + cloud, "a new project"), its default (the most recently opened), the offline filter and the
// words ("a new project" / "a project on this Mac"). Pure, over the same model Home draws.

import { describe, expect, test } from 'bun:test';

import {
  buildHomeModel,
  defaultTarget,
  newProjectWord,
  targetChoices,
} from '../client/home/home-model.js';

const P1 = 'l0000000000000001';
const P2 = 'l0000000000000002';

const shell = (recent: string[] = [P1, P2]) => ({
  projects: [
    { pid: P1, root: '/m/Alligators', name: 'Alligators brand', profile: 'default', place: 'tab' },
    { pid: P2, root: '/m/Studio', name: 'Studio site', profile: 'default', place: 'closed' },
    { pid: 'lgone', root: '/m/Gone', name: 'Gone', profile: 'default', place: 'closed' },
  ],
  profiles: [{ id: 'default', label: 'Personal' }],
  recent,
});
const index = {
  v: 1,
  projects: [
    {
      pid: P1,
      state: 'ok',
      project: { name: 'Alligators brand' },
      counts: { canvases: 3 },
      canvases: [],
    },
    {
      pid: P2,
      state: 'ok',
      project: { name: 'Studio site' },
      counts: { canvases: 2 },
      canvases: [],
    },
    { pid: 'lgone', state: 'gone', project: { name: 'Gone' }, canvases: [] },
  ],
};
const cloud = {
  ok: true,
  profile: 'default',
  signedIn: true,
  account: { email: 'me@x.cz' },
  shared: [],
  projects: [
    {
      id: 'nabor',
      name: 'Nábor 2027',
      role: 'member',
      ownerName: 'Tereza',
      url: 'https://nabor.cloud.maude.sh',
    },
    { id: 'pohar', name: 'Pražský pohár', role: 'viewer', url: 'https://pohar.cloud.maude.sh' },
    { id: 'mapa', name: 'Mapa', role: 'observer', url: 'https://mapa.cloud.maude.sh' },
  ],
};
const build = (clouds: unknown[] = [cloud], s = shell()) =>
  buildHomeModel({ shell: s, index, clouds });

describe('targetChoices', () => {
  test('lists projects on this Mac, cloud projects not here yet, then "a new project"', () => {
    const model = build();
    const items = targetChoices({ model, signedIn: true, online: true });
    expect(items.map((i: { key: string }) => i.key)).toEqual([
      `local:${P1}`,
      `local:${P2}`,
      'cloud:default:nabor',
      'new',
    ]);
    expect(items.at(-1).name).toBe('a new project');
  });

  test('a project that is not where it was cannot take a canvas', () => {
    const items = targetChoices({ model: build(), signedIn: true, online: true });
    expect(items.some((i: { key: string }) => i.key === 'local:lgone')).toBe(false);
  });

  test('a cloud project the person can only comment on or view is not a target', () => {
    const keys = targetChoices({ model: build(), signedIn: true, online: true }).map(
      (i: { key: string }) => i.key
    );
    expect(keys).not.toContain('cloud:default:pohar');
    expect(keys).not.toContain('cloud:default:mapa');
  });

  test('offline: this Mac stays, cloud rows grey out as "not on this Mac yet"', () => {
    const items = targetChoices({ model: build(), signedIn: true, online: false });
    const c = items.find((i: { key: string }) => i.key === 'cloud:default:nabor');
    expect(c.disabled).toBe(true);
    expect(c.hint).toBe('not on this Mac yet');
    expect(items.find((i: { key: string }) => i.key === `local:${P1}`).disabled).toBe(false);
  });

  test('online, the cloud row is a choice with the same hint', () => {
    const c = targetChoices({ model: build(), signedIn: true, online: true }).find(
      (i: { key: string }) => i.key === 'cloud:default:nabor'
    );
    expect(c.disabled).toBe(false);
    expect(c.hint).toBe('not on this Mac yet');
  });
});

describe('the new-project words', () => {
  test('signed in and online: "a new project"', () => {
    expect(newProjectWord({ signedIn: true, online: true })).toBe('a new project');
  });
  test('not signed in: "a project on this Mac"', () => {
    expect(newProjectWord({ signedIn: false, online: true })).toBe('a project on this Mac');
  });
  test('signed in but offline: the project stays on this Mac, so it says so', () => {
    expect(newProjectWord({ signedIn: true, online: false })).toBe('a project on this Mac');
  });
});

describe('defaultTarget', () => {
  test('is the most recently opened project', () => {
    const model = build([], shell([P2, P1]));
    const items = targetChoices({ model, signedIn: true, online: true });
    expect(defaultTarget(items, { shell: shell([P2, P1]), model })).toBe(`local:${P2}`);
  });

  test('skips a recent project that cannot take a canvas, and falls to the first on this Mac', () => {
    const s = shell(['lgone', 'lnot-in-list']);
    const model = build([cloud], s);
    const items = targetChoices({ model, signedIn: true, online: true });
    expect(defaultTarget(items, { shell: s, model })).toBe(`local:${P1}`);
  });

  test('with no project at all it is "a new project"', () => {
    const model = buildHomeModel({
      shell: { projects: [], profiles: [], recent: [] },
      index: null,
      clouds: [],
    });
    const items = targetChoices({ model, signedIn: false, online: true });
    expect(defaultTarget(items, { shell: null, model })).toBe('new');
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('a project on this Mac');
  });
});
