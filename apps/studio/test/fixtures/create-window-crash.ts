// S6.13 fixture — a studio that queues canvas creates while offline and is
// killed (SIGKILL, no exit handlers) INSIDE the 25 ms create window: before
// the batch timer can fire. Used by `accepted-link-create-durable.test.ts`.
//
//   bun test/fixtures/create-window-crash.ts <designRoot> <hubUrl> <slug:rel>...

import { createAcceptedLink } from '../../sync/accepted-link.ts';

const [designRoot, hubUrl, ...canvases] = process.argv.slice(2);
if (!designRoot || !hubUrl || !canvases.length) process.exit(2);

const link = createAcceptedLink({
  hubUrl,
  token: () => 't',
  designRoot,
  docNameFor: (slug) => slug,
  // Offline: the network never answers.
  fetchImpl: (async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch,
  retryMs: 60_000,
  log: { log() {}, warn() {}, error() {} },
});

for (const c of canvases) {
  const [slug, rel] = c.split(':') as [string, string];
  void link.createDoc(slug, rel, { html: `export default () => <h1>${slug}</h1>;\n` }, 0);
}
// Same tick as the creates: the window's timer has not fired.
process.kill(process.pid, 'SIGKILL');
