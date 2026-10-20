// S6.15 — the client half of Help › Help and guides › "Add the guide canvases to this project":
// one function behind the Help dialog's button and the ⌘K row, and the words it answers with.
import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ACTIONS_BY_ID } from '../actions/index.ts';
import { HelpModal } from '../client/dialogs/help-modal.jsx';
import {
  ADD_GUIDES_ROUTE,
  addGuides,
  GUIDES_WORDS,
  guidesLine,
} from '../client/v2/help/add-guides.js';
import { actionSearchRows } from '../client/v2/search/search-model.js';
import { menuCtx } from '../client/v2/shell/project-menu-model.js';

const answer =
  (status: number, body: unknown = {}) =>
  async () =>
    new Response(JSON.stringify(body), { status });

describe('addGuides', () => {
  test('POSTs the one route and says the guides were added', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const f = async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response(
        JSON.stringify({ ok: true, added: ['How to use Maude', 'How to make video'], skipped: [] })
      );
    };
    const r = await addGuides(f as typeof fetch);
    expect(calls).toEqual([[ADD_GUIDES_ROUTE, { method: 'POST' }]]);
    expect(r).toMatchObject({ ok: true, words: GUIDES_WORDS.added });
  });

  test('asking again says they are already here', async () => {
    const r = await addGuides(
      answer(200, {
        ok: true,
        added: [],
        skipped: ['How to use Maude', 'How to make video'],
      }) as never
    );
    expect(r).toMatchObject({ ok: true, words: GUIDES_WORDS.alreadyThere });
  });

  test('a guide the person already has is named, the other is added', () => {
    expect(guidesLine({ added: ['How to make video'], skipped: ['How to use Maude'] })).toBe(
      'Added How to make video. How to use Maude was already here.'
    );
  });

  test('a role below edit gets the role words, a failure gets the failure words', async () => {
    expect(await addGuides(answer(403) as never)).toMatchObject({
      ok: false,
      words: GUIDES_WORDS.readOnly,
    });
    expect(await addGuides(answer(500) as never)).toMatchObject({
      ok: false,
      words: GUIDES_WORDS.failed,
    });
    const offline = async () => {
      throw new TypeError('network');
    };
    expect(await addGuides(offline as never)).toMatchObject({
      ok: false,
      words: GUIDES_WORDS.failed,
    });
  });
});

describe('the Help dialog', () => {
  const html = (canAddGuides?: boolean) =>
    renderToStaticMarkup(
      createElement(HelpModal, {
        open: true,
        onClose: () => {},
        onStartTour: () => {},
        canAddGuides,
      })
    );

  test('offers “Add the guide canvases to this project” to a person who can edit', () => {
    const out = html(true);
    expect(out).toContain('data-testid="help-add-guides"');
    expect(out).toContain(GUIDES_WORDS.label);
  });

  test('says nothing about it below Can edit', () => {
    expect(html(false)).not.toContain('help-add-guides');
    expect(html(undefined)).not.toContain('help-add-guides');
  });
});

describe('the ⌘K row', () => {
  const rowsFor = (ctx: unknown) =>
    actionSearchRows(ctx, { isRunnable: () => true }) as Array<{ actionId: string; name: string }>;

  test('“Add the guide canvases to this project” is offered where a person can edit', () => {
    const hit = rowsFor(menuCtx({ native: true, canvasOpen: false })).filter(
      (r) => r.actionId === 'help.add-guides'
    );
    expect(hit).toHaveLength(1);
    expect(hit[0]?.name).toBe(GUIDES_WORDS.label);
    expect(rowsFor(menuCtx({ native: false })).some((r) => r.actionId === 'help.add-guides')).toBe(
      true
    );
  });

  test('a read-only session is not offered it (the server refuses it too)', () => {
    expect(
      rowsFor(menuCtx({ native: true, readOnly: true })).some(
        (r) => r.actionId === 'help.add-guides'
      )
    ).toBe(false);
  });

  test('the registry action is worded as the contract says and gated at Can edit', () => {
    const def = ACTIONS_BY_ID.get('help.add-guides');
    expect(def?.label).toBe(GUIDES_WORDS.label);
    expect(def?.visible?.minRole).toBe('edit');
  });
});
