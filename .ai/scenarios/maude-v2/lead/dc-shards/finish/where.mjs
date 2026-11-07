import { readFileSync } from 'node:fs';
const tag = (e) => e.kind;
for (const f of ['a', 'b2', 'F1-old']) {
  const p = JSON.parse(readFileSync(`dcs/${f}.json`, 'utf8'));
  const real = p.errors.filter((e) => !/rig|stub|cloud offline|font/i.test(e.kind) && /409|422|404/.test(e.kind + e.text));
  const by = {};
  for (const e of real) {
    const k = `${e.kind} ${e.text.split('\n')[0].slice(0, 60)} <- ${e.control.slice(0, 50)}`;
    by[k] = (by[k] || 0) + 1;
  }
  console.log('==', f, 'dead:', p.results.filter((r) => r.effect === 'DEAD').map((r) => `${r.mode}|${r.surface}|${r.control}`));
  console.log(' disabled without reason:', p.results.filter((r) => r.effect === 'disabled' && !r.note).map((r) => `${r.mode}|${r.surface}|${r.control}`));
  console.log(' errors:', Object.keys(by).slice(0, 40));
}
