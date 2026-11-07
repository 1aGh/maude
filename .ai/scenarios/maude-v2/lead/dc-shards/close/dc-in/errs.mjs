import { readFileSync } from 'node:fs';
for (const f of process.argv.slice(2)) {
  const j = JSON.parse(readFileSync(f, 'utf8'));
  const errs = (j.errors || []).filter((e) => /_health|edit-op/.test(JSON.stringify(e)));
  for (const e of errs)
    console.log(
      f.split('/').pop(),
      e.mode,
      e.shell,
      JSON.stringify(e.control),
      e.kind,
      String(e.surface || '').slice(0, 90)
    );
  console.log(f.split('/').pop(), 'redone', (j.redone || []).length, 'errors', (j.errors || []).length);
}
