// S5.17 — 03 AI Chat fidelity, the client half.
//   G2  the scope chip's artboards come from the real `.meta.json` shapes (`sections[].artboards`, else the
//       top-level `artboards`) with their LABELS, so the chip says "Pricing" and the menu offers
//       "Choose artboards…".
//   G4  the empty chat shows the hint only (the suggestion strip sits above the field): no v1 "Create new
//       design system" CTA, no /design:* verb buttons, no slash suggestions.
//   G1  a `bad-scope` refusal is a coded problem the panel can say plainly.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { renderToStaticMarkup } from 'react-dom/server';

beforeAll(() => {
  if (!globalThis.document) GlobalRegistrator.register();
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

describe('G2 — artboardsFromMeta', () => {
  test('sections[].artboards with labels', async () => {
    const { artboardsFromMeta } = await import('../client/v2/ai/use-ai-scope.js');
    const meta = {
      sections: [
        {
          id: 's',
          artboards: [
            { id: 'landing', label: 'Landing' },
            { id: 'pricing', label: 'Pricing' },
          ],
        },
        { id: 't', artboards: [{ id: 'settings', label: '  ' }] },
      ],
    };
    expect(artboardsFromMeta(meta)).toEqual([
      { id: 'landing', label: 'Landing' },
      { id: 'pricing', label: 'Pricing' },
      { id: 'settings', label: 'settings' },
    ]);
  });

  test('the top-level artboards when no section names any; junk and duplicates are skipped', async () => {
    const { artboardsFromMeta } = await import('../client/v2/ai/use-ai-scope.js');
    expect(
      artboardsFromMeta({
        sections: [{ id: 's', title: 'x' }],
        artboards: [{ id: 'a', label: 'A · one' }, { id: 'a' }, null, { label: 'no id' }],
      })
    ).toEqual([{ id: 'a', label: 'A · one' }]);
    expect(artboardsFromMeta({})).toEqual([]);
    expect(artboardsFromMeta(null)).toEqual([]);
  });

  test('with the labels the menu offers "Choose artboards…"', async () => {
    const { artboardsFromMeta } = await import('../client/v2/ai/use-ai-scope.js');
    const { scopeMenu } = await import('../client/v2/ai/scope.js');
    const boards = artboardsFromMeta({
      sections: [
        {
          artboards: [
            { id: 'landing', label: 'Landing' },
            { id: 'pricing', label: 'Pricing' },
          ],
        },
      ],
    });
    const items = scopeMenu({
      scope: { kind: 'whole' },
      artboards: boards,
      activeArtboardId: 'pricing',
    });
    expect(items.map((i) => i.label)).toContain('Choose artboards…');
    expect(JSON.stringify(items)).toContain('Pricing');
  });
});

describe('G4 — the empty chat is the hint only', () => {
  test('no v1 CTA, no /design:* verbs, no slash suggestions', async () => {
    const { ChatEmpty } = await import('../client/v2/ai/Suggest.jsx');
    const html = renderToStaticMarkup(<ChatEmpty />);
    expect(html).toContain('Ask for a change, a few variants, or an answer.');
    expect(html).toContain('data-testid="ai-hint"');
    expect(html).not.toContain('Create new design system');
    expect(html).not.toContain('/design:');
    expect(html).not.toContain('chat-sug');
    expect(html).not.toContain('chat-empty-cta');
  });
});

describe('G1 — a bad-scope refusal says what happened', () => {
  test('problemModel codes it, with the server’s words and no verb', async () => {
    const { problemModel } = await import('../client/v2/ai/needs-you.js');
    const m = problemModel({ code: 'bad-scope', message: 'That selection is not on a canvas.' });
    expect(m).toEqual({
      code: 'bad-scope',
      title: 'That selection is not on a canvas.',
      detail: null,
      verb: null,
    });
  });
});
