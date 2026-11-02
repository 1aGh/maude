import { spawnSync } from 'node:child_process';
for (const n of ['01', '02', '05']) {
  const r = spawnSync('node', ['pair.mjs', n, process.argv[2] || 'light,dark'], { cwd: import.meta.dirname, encoding: 'utf8' });
  console.log(n, (r.stdout || '').split('\n').slice(-3).join(' '), (r.stderr || '').slice(-300));
}
