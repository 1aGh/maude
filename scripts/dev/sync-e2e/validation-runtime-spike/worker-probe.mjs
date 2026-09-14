import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { evidenceDir, own } from './paths.mjs';

const mfPath = process.env.MAUDE_MINIFLARE_ENTRY || process.env.MAUDE_MINIFLARE;
const { Miniflare, convertV4MiniflareOptions } = createRequire(import.meta.url)(mfPath);
const corpus = JSON.parse(readFileSync(join(own, 'dist/corpus.json'), 'utf8'));
async function probe(script, run) {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script,
      compatibilityDate: '2026-08-04',
      compatibilityFlags: ['nodejs_compat'],
    })
  );
  try {
    return await run(mf);
  } finally {
    await mf.dispose();
  }
}
const native = await probe(
  `import process from 'node:process';export default {fetch(){let error;try{process.dlopen({exports:{}},'/bundle/parser.node')}catch(e){error={name:e.name,message:e.message}}return Response.json({dlopenType:typeof process.dlopen,error})}}`,
  async (mf) => (await mf.dispatchFetch('http://probe/')).json()
);
let typescript;
try {
  typescript = await probe(
    readFileSync(join(own, 'dist/typescript-worker.mjs'), 'utf8'),
    async (mf) => {
      const results = [];
      for (const c of corpus) {
        const res = await mf.dispatchFetch('http://probe/', {
          method: 'POST',
          body: JSON.stringify({ source: c.source }),
        });
        results.push({
          name: c.name,
          expected: c.valid,
          status: res.status,
          result: await res.json(),
        });
      }
      return { ready: true, results };
    }
  );
} catch (error) {
  typescript = { ready: false, error: String(error) };
}
const evidence = { node: process.version, miniflare: mfPath, native, typescript };
writeFileSync(join(evidenceDir, 'worker-runtime-evidence.json'), JSON.stringify(evidence, null, 2));
console.log(
  JSON.stringify({
    native,
    typescript: typescript.ready
      ? {
          ready: true,
          cases: typescript.results.length,
          mismatches: typescript.results.filter((r) => r.result.valid !== r.expected),
        }
      : typescript,
  })
);
