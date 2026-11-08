// Summarise a CDP trace: total X-event duration per (thread, name), top 25; and the longest main-thread tasks.
import { readFileSync } from 'node:fs';
const { traceEvents: ev } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const tname = {};
for (const e of ev) if (e.name === 'thread_name') tname[`${e.pid}:${e.tid}`] = e.args.name;
const agg = {};
for (const e of ev) {
  if (e.ph !== 'X' || !e.dur) continue;
  const k = `${tname[`${e.pid}:${e.tid}`] ?? e.tid} · ${e.name}`;
  agg[k] = (agg[k] ?? 0) + e.dur / 1000;
}
for (const [k, v] of Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(v.toFixed(0).padStart(7), k);
const main = ev.filter((e) => e.ph === 'X' && e.name === 'RunTask' && /CrRendererMain/.test(tname[`${e.pid}:${e.tid}`] ?? ''));
main.sort((a, b) => b.dur - a.dur);
console.log('longest renderer-main tasks (ms):', main.slice(0, 8).map((e) => (e.dur / 1000).toFixed(0)).join(' '));
const top = main[0];
if (top) {
  const inside = ev.filter((e) => e.ph === 'X' && e.pid === top.pid && e.tid === top.tid && e.ts >= top.ts && e.ts + (e.dur ?? 0) <= top.ts + top.dur && e !== top);
  const a2 = {};
  for (const e of inside) a2[e.name] = (a2[e.name] ?? 0) + (e.dur ?? 0) / 1000;
  console.log('inside the longest task:', Object.entries(a2).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' · '));
  const fc = inside.filter((e) => e.name === 'FunctionCall' || e.name === 'EventDispatch' || e.name === 'TimerFire');
  console.log('calls:', fc.slice(0, 6).map((e) => `${e.name} ${(e.dur / 1000).toFixed(0)} ${JSON.stringify(e.args?.data ?? {}).slice(0, 160)}`).join('\n  '));
}
