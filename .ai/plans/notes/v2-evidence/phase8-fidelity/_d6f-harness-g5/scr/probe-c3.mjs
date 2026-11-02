import { studioSite } from './fx5.mjs';
export const fixture = async () => studioSite();
export const page = { w: 1440, h: 900 };
export async function run(h) {
  const { page } = h;
  await h.open('ui-homepage', 3000);
  const f = page.frames().find((x) => x !== page.mainFrame() && /canvas-shell/.test(x.url()));
  const out = await f.evaluate(() => {
    const body = document.querySelector('[data-dc-screen="desktop"] .dc-artboard-body');
    const b = body.getBoundingClientRect();
    const tops = [...body.querySelectorAll('[data-cd-id]')].filter((e) => {
      const a = e.parentElement.closest('[data-cd-id]');
      return !a || !body.contains(a);
    });
    const chain = {};
    for (const id of ['services', 'headline', 'see-work', 'card-brand', 'card-small', 'sub']) {
      const btn = document.querySelector(`[data-dc-screen="desktop"] [data-cd-id="${id}"]`);
      const ch = [];
      for (let c = btn; c && c !== body; c = c.parentElement)
        if (c.hasAttribute('data-cd-id')) ch.unshift(c.getAttribute('data-cd-id'));
      chain[id] = ch.length;
    }
    return {
      body: [b.width, b.height],
      tops: tops.map((t) => `${t.getAttribute('data-cd-id')}:${t.getBoundingClientRect().width}x${t.getBoundingClientRect().height}`),
      chain,
    };
  });
  console.log('PROBE', JSON.stringify(out));
}
