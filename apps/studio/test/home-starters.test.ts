// home-starters — S6.4 (Q5): the three starters under Home's question are a fixed catalogue picked by the
// target project (dominant artboard kind, empty or not) and named after it. No AI, no network: the same
// input always gives the same three lines. The words are the canvases' own (05 es-home-*, 01/02 Home).

import { describe, expect, test } from 'bun:test';

import { BRAND_STARTER, DS_STARTER, pickStarters } from '../client/home/home-starters.js';

const lines = (s: Array<{ title: string; detail: string }>) =>
  s.map((x) => `${x.title} | ${x.detail}`);

describe('pickStarters', () => {
  test('a new project while signed in: the 05 cloud set', () => {
    expect(lines(pickStarters({ target: { kind: 'new' }, signedIn: true }))).toEqual([
      'A pricing page | with a yearly toggle',
      'Three logo ideas | for a new brand',
      'A matchday poster | A4, ready to print',
    ]);
  });

  test('a project on this Mac, not signed in: the 05 local set', () => {
    expect(lines(pickStarters({ target: { kind: 'new' }, signedIn: false }))).toEqual([
      'A portfolio page | six projects, calm',
      'Three logo ideas | for a new brand',
      'A moodboard | photos and swatches',
    ]);
  });

  test('a web project is named after itself', () => {
    const s = pickStarters({
      target: {
        kind: 'local',
        name: 'Alligators brand',
        canvases: 4,
        byKind: { web: 3, print: 1 },
      },
      signedIn: true,
    });
    expect(lines(s)).toEqual([
      'A design system | for Alligators brand',
      'A pricing page | with a yearly toggle',
      'An onboarding flow | four screens, mobile',
    ]);
  });

  test('a print-led project gets print starters', () => {
    const s = pickStarters({
      target: { kind: 'local', name: 'Club', canvases: 9, byKind: { print: 6, web: 2 } },
      signedIn: false,
    });
    expect(s[0].title).toBe('A design system');
    expect(s[1].title).toBe('A matchday poster');
    expect(s.some((x: { detail: string }) => x.detail === 'for Club')).toBe(true);
  });

  test('a project with no canvases yet offers to bring a brand in', () => {
    const s = pickStarters({
      target: { kind: 'local', name: 'Studio site', canvases: 0, byKind: {} },
      signedIn: true,
    });
    expect(s).toHaveLength(3);
    expect(s[2]).toEqual(BRAND_STARTER);
    expect(BRAND_STARTER.title).toBe('Bring my existing brand');
    expect(BRAND_STARTER.intent).toBe('import-brand');
  });

  test('S10.16c: "A design system" leads a project that has canvases and opens the make sheet, it does not fill the prompt', () => {
    for (const byKind of [{ web: 3 }, { print: 2 }, { video: 1 }, { digital: 4 }]) {
      const s = pickStarters({
        target: { kind: 'local', name: 'Studio site', canvases: 5, byKind },
        signedIn: true,
      });
      expect(s).toHaveLength(3);
      expect(s[0].id).toBe('ds');
    }
    expect(DS_STARTER.title).toBe('A design system');
    expect(DS_STARTER.intent).toBe('make-ds');
    expect((DS_STARTER as { prompt?: string }).prompt).toBeUndefined();
    // named after the project, like "Three logo ideas"
    const named = pickStarters({
      target: { kind: 'local', name: 'Club', canvases: 5, byKind: { web: 1 } },
      signedIn: true,
    })[0];
    expect(named.detail).toBe('for Club');
    // a new project and an empty one have nothing for a system to learn from: their sets stay
    const ids = (target: object) =>
      pickStarters({ target, signedIn: true } as never).map((x: { id: string }) => x.id);
    expect(ids({ kind: 'new' })).not.toContain('ds');
    expect(ids({ kind: 'local', name: 'X', canvases: 0, byKind: {} })).not.toContain('ds');
  });

  test('always three, each with a sentence that fills the prompt and does not send', () => {
    for (const target of [
      { kind: 'new' },
      { kind: 'local', name: 'X', canvases: 1, byKind: { video: 1 } },
      { kind: 'cloud', name: 'Y', canvases: null, byKind: {} },
    ]) {
      const s = pickStarters({ target, signedIn: true });
      expect(s).toHaveLength(3);
      for (const x of s) {
        expect(x.id).toBeTruthy();
        if (x.intent) continue;
        expect(x.prompt.length).toBeGreaterThan(8);
        expect(x.prompt.toLowerCase()).toContain(x.title.toLowerCase().replace(/^an? /, ''));
      }
    }
  });

  test('deterministic', () => {
    const t = { kind: 'local', name: 'Z', canvases: 2, byKind: { web: 2 } };
    expect(pickStarters({ target: t, signedIn: false })).toEqual(
      pickStarters({ target: t, signedIn: false })
    );
  });
});
