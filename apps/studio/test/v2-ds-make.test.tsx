// S10.16b (13 · ds-make-inputs … ds-make-done) — making a design system with AI, the shell's half.
// The sentence alone is enough; the brief that goes to AI carries it verbatim and only NAMES the references; a
// direction is picked or mixed from the inspector; the ready card says what is missing and, once used, offers the
// existing canvases one switch review. The engine behind it is S10.16a's (`ds/make.ts`); a scripted agent drives the
// same verbs, so nothing here waits on a real AI.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AGENT_PATHS } from '../actions/agents.ts';
import { DS_ACTIONS } from '../actions/defs/ds.ts';
import { DS_MAKE_EVENT, requestDsMake } from '../client/v2/ds/default-write.js';
import {
  AUDIENCES,
  canMake,
  cleanSentence,
  hostOf,
  MAKE_WORDS,
  makeBrief,
  missingWords,
  READY_WORDS,
  readiness,
  SENTENCE_MAX,
  sectionsToPost,
  systemLabelFor,
  systemNameFor,
} from '../client/v2/ds/make-model.js';
import { onDsSwitchRequest, resetDsSwitchBus } from '../client/v2/ds/switch-bus.js';
import { resolveKind } from '../client/v2/inspector/kinds/index.js';
import { ASK_AI_MAX, bindPaletteEnv } from '../client/v2/search/search-env.js';
import { createDsMake } from '../ds/make.ts';
import { cleanup, makeProject } from './_ds-engine-fixture.ts';

const SENTENCE = 'A small Brno studio that makes calm software. Friendly, precise, never loud.';

/* ---------------------------------------------------------------- the model */

describe('the three inputs', () => {
  test('the sentence alone is enough; nothing else is needed', () => {
    expect(canMake({ sentence: '' })).toBe(false);
    expect(canMake({ sentence: '   \n ' })).toBe(false);
    expect(canMake({ sentence: SENTENCE })).toBe(true);
    expect(cleanSentence(`  ${SENTENCE}\u0007 `)).toBe(SENTENCE);
    expect(cleanSentence('x'.repeat(SENTENCE_MAX + 50))).toHaveLength(SENTENCE_MAX);
  });

  test('the new system is named after the project, and a taken name gets the next free one', () => {
    expect(systemNameFor('Studio site', [])).toBe('studio-site');
    expect(systemNameFor('Studio site', ['studio-site'])).toBe('studio-site-2');
    expect(systemNameFor('Studio site', ['studio-site', 'studio-site-2'])).toBe('studio-site-3');
    expect(systemNameFor('Ředitelství škol!', [])).toBe('reditelstvi-skol');
    expect(systemNameFor('2026 / x', [])).toBe('x');
    expect(systemNameFor('', [])).toBe('brand');
    expect(systemLabelFor('  Studio site  ')).toBe('Studio site');
    expect(systemLabelFor('')).toBe('My brand');
  });

  test('"Mostly for" offers the four of canvas 13', () => {
    expect(AUDIENCES.map((a) => a.label)).toEqual([
      'Websites',
      'Apps',
      'Print and social',
      'A bit of everything',
    ]);
  });
});

describe('the brief that goes to AI', () => {
  const base = {
    ds: 'studio-site',
    label: 'Studio site',
    sentence: SENTENCE,
    audience: 'websites',
  };

  test('carries the sentence verbatim, between marks, and nothing the person did not write', () => {
    const brief = makeBrief({ ...base, refs: {} });
    expect(brief).toContain(`"""${SENTENCE}"""`);
    expect(brief).toContain('Mostly for: Websites.');
    expect(brief).toContain('Nothing else to learn from.');
    expect(brief).toContain('/design:setup-ds studio-site --app');
    expect(brief).toContain('maude design ds draft studio-site --direction a|b|c');
    // the person runs `done`, not the agent
    expect(brief).toContain('Do not run `ds done`');
    // no option ladder, no vibe references
    expect(brief).not.toMatch(/like (Stripe|Notion|Linear|Apple)|inspired by/i);
  });

  test('the references are only named: a server-shaped logo path, a typed host, Figma, the canvases', () => {
    const brief = makeBrief({
      ...base,
      refs: {
        logoRef: 'assets/logos/ab12cd34.svg',
        website: 'https://www.studio-brno.cz/about?x=1',
        figma: true,
        canvases: true,
      },
      canvases: 5,
    });
    expect(brief).toContain(
      "Learn from: the logo at assets/logos/ab12cd34.svg; the website studio-brno.cz; the Figma library, if Figma is connected; the project's own 5 canvases."
    );
    // a path the page made up, or something that is not a host, is dropped
    const odd = makeBrief({
      ...base,
      refs: { logoRef: '../../etc/passwd', website: 'not a host', canvases: true },
      canvases: 0,
    });
    expect(odd).toContain('Nothing else to learn from.');
    expect(odd).not.toContain('passwd');
    expect(hostOf('studio-brno.cz')).toBe('studio-brno.cz');
    expect(hostOf('localhost')).toBeNull();
  });

  test('fits the composer', () => {
    const long = makeBrief({
      ...base,
      sentence: 'ž'.repeat(SENTENCE_MAX + 100),
      refs: {
        logoRef: 'assets/logos/ab12cd34.svg',
        website: 'studio-brno.cz',
        figma: true,
        canvases: true,
      },
      canvases: 12,
    });
    expect(long.length).toBeLessThan(ASK_AI_MAX);
  });
});

describe('the done words say what is missing', () => {
  const section = (over: Record<string, string> = {}) => ({
    brand: 'waiting',
    colour: 'done',
    type: 'done',
    space: 'done',
    motion: 'done',
    components: 'waiting',
    patterns: 'waiting',
    ...over,
  });

  test('reasons become the designer’s words, each once, in a fixed order', () => {
    expect(missingWords(['brand-missing', 'components-missing', 'manifest-stale'])).toEqual([
      'the logo or the icons are missing',
      'the components are not all drawn',
    ]);
    expect(missingWords(['theme-gap', 'single-theme'])).toEqual([
      'a few values have no Dark value',
    ]);
    expect(missingWords(undefined)).toEqual([]);
  });

  test('a partial system is offered, with what it lacks; a section being drawn holds the card back', () => {
    const partial = readiness({
      making: true,
      sections: section(),
      reasons: ['brand-missing', 'components-missing'],
    });
    expect(partial).toEqual({
      show: true,
      complete: false,
      missing: ['the logo or the icons are missing', 'the components are not all drawn'],
    });
    // Stop keeps what landed: nothing is drawing any more, so the card is there for what is
    expect(readiness({ making: true, sections: section({ type: 'done' }), reasons: [] }).show).toBe(
      true
    );
    expect(
      readiness({ making: true, sections: section({ type: 'drawing' }), reasons: [] }).show
    ).toBe(false);
    // nothing has landed yet (the directions only): no card
    expect(
      readiness({
        making: true,
        sections: section({
          colour: 'waiting',
          type: 'waiting',
          space: 'waiting',
          motion: 'waiting',
        }),
        reasons: [],
      }).show
    ).toBe(false);
    // a made system has nothing to finish
    expect(readiness({ making: false, sections: section(), reasons: [] }).show).toBe(false);
    expect(readiness(null).show).toBe(false);
  });

  test('complete means nothing is missing and every section but Patterns is done', () => {
    const all = section({ brand: 'done', components: 'done' });
    expect(readiness({ making: true, sections: all, reasons: [] }).complete).toBe(true);
    expect(readiness({ making: true, sections: all, reasons: ['brand-missing'] }).complete).toBe(
      false
    );
    expect(readiness({ making: true, sections: section(), reasons: [] }).complete).toBe(false);
  });

  test('the sections posted to the canvas are only the known words', () => {
    expect(
      sectionsToPost({ making: true, sections: { type: 'drawing', brand: 'x', colour: 'done' } })
    ).toEqual({
      type: 'drawing',
      colour: 'done',
    });
    expect(sectionsToPost({ making: false, sections: { type: 'done' } })).toBeNull();
  });

  test('against the real engine: finish a half-made system and the result lists what it lacks', async () => {
    const p = await makeProject();
    const mk = createDsMake(p.engine);
    const AI = { kind: 'ai', name: 'Claude' } as const;
    await mk.make({ ds: 'forge', label: 'Forge', by: AI });
    await mk.draft({
      ds: 'forge',
      direction: 'a',
      tokens: { '--bg-0': '#ffffff', '--fg-0': '#111111', '--accent': '#2563eb' },
      by: AI,
    });
    await mk.use({ ds: 'forge', direction: 'a', by: AI });
    // while a run holds Type the engine says so; once the run is stopped what landed stays, nothing is erased
    const drawing = createDsMake(p.engine, { held: () => new Set(['ds-type']) }).sections('forge');
    expect(drawing.sections.type).toBe('drawing');
    const stopped = createDsMake(p.engine).sections('forge');
    expect(stopped.making).toBe(true);
    expect(stopped.sections.type).not.toBe('drawing');
    const r = await mk.done({ ds: 'forge', by: AI });
    expect(r.defaultSet).toBe(true);
    const words = missingWords(r.reasons);
    expect(words).toContain('the logo or the icons are missing');
    expect(words).toContain('the components are not all drawn');
  });
});

describe('the registry names every capability of this slice', () => {
  test('make · use · mix · done are project writes that need Can edit, with an agent path', () => {
    for (const id of ['ds.make', 'ds.draft', 'ds.use-direction', 'ds.mix', 'ds.make-done']) {
      expect(DS_ACTIONS.find((a) => a.id === id)?.visible).toMatchObject({ minRole: 'edit' });
      expect(AGENT_PATHS[id]).toMatchObject({
        effect: 'project',
        minRole: 'edit',
        server: { route: '/_api/ds/make', method: 'POST' },
        agent: { path: 'cli' },
      });
    }
  });
});

/* ---------------------------------------------------------------- the DOM */

const roots: Root[] = [];
// registered at load: the sheets are imported inside the describes below, after the DOM exists
GlobalRegistrator.register();
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => {
  GlobalRegistrator.unregister();
  cleanup();
});
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  resetDsSwitchBus();
});
beforeEach(() => resetDsSwitchBus());

const q = (host: ParentNode, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = async (el: Element | null) => {
  if (!el) throw new Error('missing element');
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
};
const propsOf = (el: Element) => {
  const key = Object.keys(el).find((k) => k.startsWith('__reactProps$')) as string;
  return (el as unknown as Record<string, Record<string, (ev: unknown) => void>>)[key];
};
// a dispatched `input` event does not reach React's onChange under happy-dom: call the handler React attached
const typeInto = async (el: HTMLElement | null, text: string) => {
  if (!el) throw new Error('missing element');
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement : window.HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set?.call(el, text);
    propsOf(el).onChange({ target: el, currentTarget: el });
  });
};
async function render(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  (host as unknown as { __root: Root }).__root = root;
  await act(async () => root.render(node));
  return host;
}
const tick = (ms = 30) => act(async () => new Promise((r) => setTimeout(r, ms)));

describe('the sheet (13 · ds-make-inputs)', async () => {
  const { DsMakeSheet } = await import('../client/v2/ds/make-sheet.jsx');
  const Sheet = DsMakeSheet as unknown as (p: Record<string, unknown>) => React.ReactElement;

  test('title, three inputs, the fine print; Make three directions waits for the sentence', async () => {
    const calls: unknown[] = [];
    const host = await render(
      <Sheet
        project="Studio site"
        canvases={5}
        canAskAI
        onMake={async (i: unknown) => {
          calls.push(i);
          return { ok: true };
        }}
        onClose={() => undefined}
      />
    );
    expect(q(host, 'ds-make-title')?.textContent).toBe('Make a design system for Studio site');
    expect(q(host, 'ds-make-fine')?.textContent).toBe(MAKE_WORDS.fine);
    const go = q(host, 'ds-make-go') as HTMLButtonElement;
    expect(go.textContent).toBe('Make three directions');
    expect(go.disabled).toBe(true);
    // the canvases are on by default and say how many
    expect(q(host, 'ds-make-ref-canvases')?.textContent).toContain('5 in Studio site');
    expect(q(host, 'ds-make-ref-canvases')?.getAttribute('aria-pressed')).toBe('true');
    await typeInto(q(host, 'ds-make-sentence'), SENTENCE);
    expect(go.disabled).toBe(false);
    await click(go);
    expect(calls).toEqual([
      {
        sentence: SENTENCE,
        audience: 'websites',
        refs: { logoRef: null, website: '', figma: false, canvases: true },
      },
    ]);
  });

  test('references toggle, "Mostly for" is one of four, and a project with no canvases has no such chip', async () => {
    const calls: Array<{ audience: string; refs: Record<string, unknown> }> = [];
    const host = await render(
      <Sheet
        project="Studio site"
        canvases={0}
        canAskAI
        onMake={async (i: { audience: string; refs: Record<string, unknown> }) => {
          calls.push(i);
          return { ok: true };
        }}
        onClose={() => undefined}
      />
    );
    expect(q(host, 'ds-make-ref-canvases')).toBeNull();
    await typeInto(q(host, 'ds-make-sentence'), SENTENCE);
    await typeInto(q(host, 'ds-make-website'), 'studio-brno.cz');
    await click(q(host, 'ds-make-ref-figma'));
    await click(q(host, 'ds-make-for-print'));
    expect(q(host, 'ds-make-for-print')?.getAttribute('aria-pressed')).toBe('true');
    expect(q(host, 'ds-make-for-websites')?.getAttribute('aria-pressed')).toBe('false');
    await click(q(host, 'ds-make-go'));
    expect(calls[0].audience).toBe('print');
    expect(calls[0].refs).toMatchObject({
      website: 'studio-brno.cz',
      figma: true,
      canvases: false,
    });
  });

  test('a logo is uploaded, named on its chip, and travels as the server’s path', async () => {
    const calls: Array<{ refs: Record<string, unknown> }> = [];
    const host = await render(
      <Sheet
        project="Studio site"
        canAskAI
        onLogo={async () => ({ ok: true, path: 'assets/logos/ab12cd34.svg' })}
        onMake={async (i: { refs: Record<string, unknown> }) => {
          calls.push(i);
          return { ok: true };
        }}
        onClose={() => undefined}
      />
    );
    const input = q(host, 'ds-make-logo-file') as HTMLInputElement;
    const file = new window.File(['<svg/>'], 'studio-logo.svg', { type: 'image/svg+xml' });
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    expect(q(host, 'ds-make-ref-logo')?.textContent).toContain('studio-logo.svg');
    await typeInto(q(host, 'ds-make-sentence'), SENTENCE);
    await click(q(host, 'ds-make-go'));
    expect(calls[0].refs.logoRef).toBe('assets/logos/ab12cd34.svg');
  });

  test('a refusal stays on the sheet in words; with no AI the button is off and says why', async () => {
    const host = await render(
      <Sheet
        project="Studio site"
        canAskAI
        onMake={async () => ({
          ok: false,
          message: 'A design system with that name already exists.',
        })}
        onClose={() => undefined}
      />
    );
    await typeInto(q(host, 'ds-make-sentence'), SENTENCE);
    await click(q(host, 'ds-make-go'));
    expect(q(host, 'ds-make-error')?.textContent).toBe(
      'A design system with that name already exists.'
    );
    expect(q(host, 'ds-make')).not.toBeNull();
    const none = await render(
      <Sheet
        project="Studio site"
        canAskAI={false}
        onMake={async () => ({ ok: true })}
        onClose={() => undefined}
      />
    );
    await typeInto(q(none, 'ds-make-sentence'), SENTENCE);
    expect((q(none, 'ds-make-go') as HTMLButtonElement).disabled).toBe(true);
    expect(q(none, 'ds-make-fine')?.textContent).toBe(MAKE_WORDS.noAI);
  });
});

describe('the host (13 · 13 → 17)', async () => {
  const { DsMakeHost } = await import('../client/v2/ds/make-host.jsx');
  const Host = DsMakeHost as unknown as (p: Record<string, unknown>) => React.ReactElement;
  let unbind: () => void = () => undefined;
  afterEach(() => unbind());

  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const CFG = {
    designRel: '.design',
    designSystems: [{ name: 'acme', label: 'Acme', path: 'system/acme' }],
    canvasDesignSystems: { '.design/ui/Home.tsx': 'acme', '.design/ui/Pricing.tsx': 'acme' },
    dsConverted: { acme: true },
  };

  test('the door opens the sheet; making posts the outline, hands AI the brief, and opens the canvas', async () => {
    const asked: Array<{ text: string; opts: unknown }> = [];
    unbind = bindPaletteEnv({
      projectName: 'Studio site',
      canAskAI: () => true,
      askAI: (text: string, opts: unknown) => asked.push({ text, opts }),
    });
    const posts: unknown[] = [];
    const opened: string[] = [];
    const toasts: string[] = [];
    const fetchImpl = (async (url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === 'POST') {
        posts.push({ url, body: JSON.parse(init.body as string) });
        return reply({ format: 'maude.ds-result', v: 1, action: 'make', system: 'studio-site' });
      }
      return reply({}, 404);
    }) as unknown as typeof fetch;
    const mounted = (cfg: object) => (
      <Host
        cfg={cfg}
        activePath={null}
        toast={(m: string) => toasts.push(m)}
        fetchImpl={fetchImpl}
        openSystem={(d: string) => opened.push(d)}
      />
    );
    const host = await render(mounted(CFG));
    expect(q(host, 'ds-make')).toBeNull();
    // `ds.make` from the pinned row / Home / ⌘K: the host takes it
    let took = false;
    await act(async () => {
      took = requestDsMake({}, { toast: (m: string) => toasts.push(m) });
    });
    expect(took).toBe(true);
    expect(toasts).toEqual([]);
    expect(q(host, 'ds-make-title')?.textContent).toBe('Make a design system for Studio site');
    await typeInto(q(host, 'ds-make-sentence'), SENTENCE);
    await click(q(host, 'ds-make-go'));
    expect(posts).toEqual([
      { url: '/_api/ds/make', body: { action: 'make', ds: 'studio-site', label: 'Studio site' } },
    ]);
    // AI gets the brief as the person's own gesture, with its origin
    expect(asked).toHaveLength(1);
    expect(asked[0].opts).toEqual({ send: true, origin: 'ds-make' });
    expect(asked[0].text).toContain(`"""${SENTENCE}"""`);
    expect(asked[0].text).toContain('maude design ds draft studio-site');
    expect(toasts[0]).toBe(MAKE_WORDS.started('Studio site'));
    expect(q(host, 'ds-make')).toBeNull();
    // the studio learns of the system a moment later; the canvas opens then, once
    expect(opened).toEqual([]);
    await act(async () =>
      (host as unknown as { __root: Root }).__root.render(
        mounted({
          ...CFG,
          designSystems: [
            ...CFG.designSystems,
            { name: 'studio-site', label: 'Studio site', path: 'system/studio-site' },
          ],
        })
      )
    );
    expect(opened).toEqual(['studio-site']);
  });

  test('a refused make asks AI nothing and says why on the sheet', async () => {
    const asked: unknown[] = [];
    unbind = bindPaletteEnv({
      projectName: 'Studio site',
      canAskAI: () => true,
      askAI: (t: string) => asked.push(t),
    });
    const host = await render(
      <Host
        cfg={CFG}
        activePath={null}
        toast={() => undefined}
        fetchImpl={(async () => reply({ code: 'forbidden' }, 403)) as unknown as typeof fetch}
        openSystem={() => undefined}
      />
    );
    await act(async () => {
      window.dispatchEvent(new window.CustomEvent(DS_MAKE_EVENT, { detail: {}, cancelable: true }));
    });
    await typeInto(q(host, 'ds-make-sentence'), SENTENCE);
    await click(q(host, 'ds-make-go'));
    expect(q(host, 'ds-make-error')?.textContent).toBe(
      'You can’t change this project’s design systems.'
    );
    expect(asked).toEqual([]);
  });

  test('on the canvas of a system being made: the sections are posted, the card appears, Use finishes and offers the review', async () => {
    unbind = bindPaletteEnv({
      projectName: 'Studio site',
      canAskAI: () => true,
      askAI: () => undefined,
    });
    const cfg = {
      designRel: '.design',
      designSystems: [{ name: 'studio-site', label: 'Studio site', path: 'system/studio-site' }],
      dsConverted: { 'studio-site': true },
      canvasOrigin: 'http://127.0.0.1:9',
    };
    let made = false;
    const sections = {
      brand: 'waiting',
      colour: 'done',
      type: 'done',
      space: 'done',
      motion: 'done',
      components: 'waiting',
      patterns: 'waiting',
    };
    const posts: unknown[] = [];
    const fetchImpl = (async (url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === 'POST') {
        posts.push(JSON.parse(init.body as string));
        made = true;
        return reply({
          format: 'maude.ds-result',
          v: 1,
          action: 'make',
          system: 'studio-site',
          defaultSet: true,
          reasons: [],
        });
      }
      return reply({
        format: 'maude.ds-make',
        v: 1,
        system: 'studio-site',
        making: !made,
        sections,
        level: 10,
        reasons: ['brand-missing', 'components-missing'],
        drafts: [],
      });
    }) as unknown as typeof fetch;
    const sent: Array<{ msg: unknown; origin: string }> = [];
    const frame = {
      contentWindow: { postMessage: (msg: unknown, origin: string) => sent.push({ msg, origin }) },
    };
    const asked: unknown[] = [];
    const off = onDsSwitchRequest((r: unknown) => asked.push(r));
    const toasts: string[] = [];
    const host = await render(
      <Host
        cfg={cfg}
        activePath=".design/system/studio-site/design-system.tsx"
        toast={(m: string) => toasts.push(m)}
        frameFor={() => frame}
        fetchImpl={fetchImpl}
        pollMs={20}
      />
    );
    await tick(60);
    expect(sent[0]).toEqual({
      msg: { dgn: 'ds-make-states', sections },
      origin: 'http://127.0.0.1:9',
    });
    expect(q(host, 'ds-make-ready-title')?.textContent).toBe(READY_WORDS.partly('Studio site'));
    expect(q(host, 'ds-make-ready-sub')?.textContent).toBe(
      'Still missing: the logo or the icons are missing, the components are not all drawn.'
    );
    expect(q(host, 'ds-make-use')?.textContent).toBe("Use as Studio site's style");
    await click(q(host, 'ds-make-use'));
    await tick(40);
    expect(posts).toEqual([{ action: 'done', ds: 'studio-site', setDefault: true }]);
    // it became the default: the existing canvases are offered one review, quietly
    expect(asked).toEqual([{ kind: 'switch', to: 'studio-site', scope: 'all', quiet: true }]);
    expect(toasts[0]).toBe(
      'Studio site is now the style for new canvases. Still missing: the logo or the icons are missing, the components are not all drawn.'
    );
    // made: no card any more
    expect(q(host, 'ds-make-ready')).toBeNull();
    off();
  });

  test('no card while a section is being drawn, and none on a system that is made', async () => {
    unbind = bindPaletteEnv({ projectName: 'P', canAskAI: () => true, askAI: () => undefined });
    const cfg = {
      designRel: '.design',
      designSystems: [{ name: 's', label: 'S', path: 'system/s' }],
      dsConverted: { s: true },
    };
    const state = (making: boolean, type: string) =>
      (async () =>
        reply({
          format: 'maude.ds-make',
          v: 1,
          system: 's',
          making,
          sections: {
            brand: 'done',
            colour: 'done',
            type,
            space: 'waiting',
            motion: 'waiting',
            components: 'waiting',
            patterns: 'waiting',
          },
          level: 10,
          reasons: [],
          drafts: [],
        })) as unknown as typeof fetch;
    const drawing = await render(
      <Host
        cfg={cfg}
        activePath=".design/system/s/design-system.tsx"
        fetchImpl={state(true, 'drawing')}
        pollMs={20}
        frameFor={() => null}
      />
    );
    await tick(50);
    expect(q(drawing, 'ds-make-ready')).toBeNull();
    const made = await render(
      <Host
        cfg={cfg}
        activePath=".design/system/s/design-system.tsx"
        fetchImpl={state(false, 'done')}
        pollMs={20}
        frameFor={() => null}
      />
    );
    await tick(50);
    expect(q(made, 'ds-make-ready')).toBeNull();
  });
});

/* ---------------------------------------------------- the direction bar */

describe('the direction bar (13 · ds-make-mix)', async () => {
  const bar = await import('../client/v2/ds/direction-bar.jsx');
  const Panel = bar.DirectionPanel as unknown as (p: Record<string, unknown>) => React.ReactElement;
  const model = (over: Record<string, unknown> = {}) => ({
    making: true,
    directions: [
      {
        direction: 'a',
        label: 'Calm daylight',
        mood: 'cool white · azure · System sans',
        picked: false,
        vars: {},
      },
      {
        direction: 'b',
        label: 'Warm paper',
        mood: 'cream · terracotta · New York',
        picked: false,
        vars: {},
      },
      { direction: 'c', label: 'Night shift', mood: '', picked: false, vars: {} },
    ],
    ...over,
  });

  test('a direction is recognised from its tile or its artboard; the kind is the inspector’s', () => {
    expect(bar.directionIdOf({ attrs: { 'data-ds-direction': 'a' } })).toBe('a');
    expect(bar.directionIdOf({ selector: '[data-dc-screen="ds-dir-c"]' })).toBe('c');
    expect(bar.directionIdOf({ attrs: { 'data-dc-screen': 'ds-dir-b' } })).toBe('b');
    expect(bar.directionIdOf({ selector: '[data-dc-screen="ds-brand"]' })).toBeNull();
    expect(bar.directionIdOf({ attrs: { 'data-ds-direction': 'A"><x' } })).toBeNull();
    expect(resolveKind({ attrs: { 'data-ds-direction': 'a' } }).id).toBe('ds-direction');
    expect(resolveKind({ attrs: { 'data-ds-direction': 'a' } }).bare).toBe(true);
  });

  test('Use A picks the direction through the verb and says so', async () => {
    const used: unknown[] = [];
    let refreshed = 0;
    const host = await render(
      <Panel
        id="a"
        ds="studio-site"
        model={model()}
        onUse={async (a: unknown) => {
          used.push(a);
          return { ok: true };
        }}
        onMix={async () => ({ ok: true })}
        onRefresh={async () => {
          refreshed++;
        }}
      />
    );
    expect(q(host, 'ds-dir-name')?.textContent).toBe('Direction A · Calm daylight');
    expect(q(host, 'ds-dir-mood')?.textContent).toBe('cool white · azure · System sans');
    expect(q(host, 'ds-dir-use')?.textContent).toBe('Use A');
    await click(q(host, 'ds-dir-use'));
    expect(used).toEqual([{ ds: 'studio-site', direction: 'a' }]);
    expect(q(host, 'ds-dir-note')?.textContent).toBe('Using Direction A.');
    expect(refreshed).toBe(1);
  });

  test('Mix with… lists the other directions’ type, colours and corners; the button then reads Use this mix', async () => {
    const mixed: unknown[] = [];
    const host = await render(
      <Panel
        id="a"
        ds="studio-site"
        model={model()}
        onUse={async () => ({ ok: true })}
        onMix={async (a: unknown) => {
          mixed.push(a);
          return { ok: true };
        }}
      />
    );
    expect(q(host, 'ds-dir-mix-menu')).toBeNull();
    await click(q(host, 'ds-dir-mix'));
    // B and C lend parts; A is not offered to itself
    expect(host.querySelectorAll('.ds-dirbar-gl')).toHaveLength(2);
    expect(host.querySelector('.ds-dirbar-gl')?.textContent).toBe('From B · Warm paper');
    expect(q(host, 'ds-dir-mix-type-b')?.textContent).toBe('B’s type');
    await click(q(host, 'ds-dir-mix-type-b'));
    await click(q(host, 'ds-dir-mix-colour-c'));
    expect(q(host, 'ds-dir-summary')?.textContent).toBe('A + B’s type + C’s colours');
    expect(q(host, 'ds-dir-use')?.textContent).toBe('Use this mix');
    await click(q(host, 'ds-dir-use'));
    expect(mixed).toEqual([{ ds: 'studio-site', base: 'a', take: { type: 'b', colour: 'c' } }]);
    // taking the same part again from another direction replaces it; again from the same lets go
    await click(q(host, 'ds-dir-mix'));
    await click(q(host, 'ds-dir-mix-type-b'));
    await click(q(host, 'ds-dir-mix-type-c'));
    expect(q(host, 'ds-dir-summary')?.textContent).toBe('A + C’s type');
    await click(q(host, 'ds-dir-mix-type-c'));
    expect(q(host, 'ds-dir-summary')).toBeNull();
    expect(q(host, 'ds-dir-use')?.textContent).toBe('Use A');
  });

  test('a made system keeps its directions to look at; a viewer sees the buttons off; a refusal is said', async () => {
    const made = await render(
      <Panel
        id="b"
        ds="s"
        model={model({ making: false })}
        onUse={async () => ({ ok: true })}
        onMix={async () => ({ ok: true })}
      />
    );
    expect(q(made, 'ds-dir-made')?.textContent).toBe(
      'This system is made. Its directions stay here to look at.'
    );
    expect(q(made, 'ds-dir-use')).toBeNull();
    const viewer = await render(
      <Panel
        id="a"
        ds="s"
        editable={false}
        model={model()}
        onUse={async () => ({ ok: true })}
        onMix={async () => ({ ok: true })}
      />
    );
    expect((q(viewer, 'ds-dir-use') as HTMLButtonElement).disabled).toBe(true);
    const refused = await render(
      <Panel
        id="a"
        ds="s"
        model={model()}
        onUse={async () => ({ ok: false, message: 'This system is already made.' })}
        onMix={async () => ({ ok: true })}
      />
    );
    await click(q(refused, 'ds-dir-use'));
    expect(q(refused, 'ds-dir-note')?.textContent).toBe('This system is already made.');
    expect(q(refused, 'ds-dir-note')?.getAttribute('data-tone')).toBe('warn');
    // one direction alone cannot be mixed
    const alone = await render(
      <Panel
        id="a"
        ds="s"
        model={model({ directions: [model().directions[0]] })}
        onUse={async () => ({ ok: true })}
        onMix={async () => ({ ok: true })}
      />
    );
    expect((q(alone, 'ds-dir-mix') as HTMLButtonElement).disabled).toBe(true);
    // a direction AI has not drawn yet
    const waiting = await render(
      <Panel
        id="c"
        ds="s"
        model={model({ directions: [model().directions[0]] })}
        onUse={async () => ({ ok: true })}
        onMix={async () => ({ ok: true })}
      />
    );
    expect(q(waiting, 'ds-dir-waiting')).not.toBeNull();
  });
});
