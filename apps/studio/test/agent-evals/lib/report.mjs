// agent-evals/lib/report.mjs — aggregate trial grades into the A-vs-B table and apply the V2-1.18
// decision rule: keep a split only if it wins on quality or latency at ≤ 1.5× tokens with no drop in
// invariant pass^k.

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

function cell(trials) {
  const valid = trials.filter((t) => !t.harnessFailure);
  const k = valid.length;
  return {
    trials: trials.length,
    valid: k,
    harnessFailures: trials.length - k,
    invPassAll: k > 0 && valid.every((t) => t.invPass), // pass^k
    invPassRate: k ? valid.filter((t) => t.invPass).length / k : null,
    qualPassAny: valid.some((t) => t.qualPass), // pass@k
    qualPassRate: k ? valid.filter((t) => t.qualPass).length / k : null,
    judgePass: k ? valid.filter((t) => t.judge?.verdict === 'pass').length / k : null,
    judgeUnknown: valid.filter((t) => t.judge?.verdict === 'unknown').length,
    tokens: mean(valid.map((t) => t.metrics?.tokens ?? 0)),
    freshTokens: mean(valid.map((t) => t.metrics?.freshTokens ?? 0)),
    costUsd: mean(valid.map((t) => t.metrics?.costUsd ?? 0)),
    wallS: mean(valid.map((t) => (t.run?.wallMs ?? 0) / 1000)),
    subagents: mean(valid.map((t) => t.metrics?.subagents ?? 0)),
    helperSpawns: mean(
      valid.map((t) => (t.agents ?? []).filter((a) => /maude-b:/.test(a.type)).length)
    ),
    failedInvariants: [
      ...new Set(
        valid.flatMap((t) =>
          Object.entries(t.invariants)
            .filter(([, v]) => !v.pass)
            .map(([k2]) => k2)
        )
      ),
    ],
    failedQuality: [
      ...new Set(
        valid.flatMap((t) =>
          Object.entries(t.quality)
            .filter(([, v]) => !v.pass && !v.unknown)
            .map(([k2]) => k2)
        )
      ),
    ],
  };
}

export function summarize(grades) {
  const byTask = {};
  for (const g of grades) {
    byTask[g.task] ??= {
      task: g.task,
      group: g.group,
      delegates: g.delegates,
      A: [],
      B: [],
    };
    byTask[g.task][g.topology].push(g);
  }
  const rows = Object.values(byTask)
    .sort((a, b) => a.task.localeCompare(b.task))
    .map((t) => ({
      task: t.task,
      group: t.group,
      delegates: t.delegates,
      A: cell(t.A),
      B: cell(t.B),
    }));
  const groupBy = (pred) => {
    const sel = rows.filter(pred).filter((r) => r.A.valid && r.B.valid);
    const agg = (side) => ({
      tasks: sel.length,
      invPassAll: sel.filter((r) => r[side].invPassAll).length,
      qualPassAny: sel.filter((r) => r[side].qualPassAny).length,
      qualPassRate: mean(sel.map((r) => r[side].qualPassRate)),
      judgePass: mean(sel.map((r) => r[side].judgePass ?? 0)),
      tokens: mean(sel.map((r) => r[side].tokens)),
      costUsd: mean(sel.map((r) => r[side].costUsd)),
      wallS: mean(sel.map((r) => r[side].wallS)),
      wallMedianS: median(sel.map((r) => r[side].wallS)),
      subagents: mean(sel.map((r) => r[side].subagents)),
    });
    const A = agg('A');
    const B = agg('B');
    const tokenRatio = A.tokens ? B.tokens / A.tokens : null;
    const qualityWin =
      (B.qualPassRate ?? 0) > (A.qualPassRate ?? 0) + 1e-9 ||
      (B.judgePass ?? 0) > (A.judgePass ?? 0) + 1e-9;
    const latencyWin = B.wallS !== null && A.wallS !== null && B.wallS < A.wallS * 0.9;
    const invNoDrop = B.invPassAll >= A.invPassAll;
    return {
      A,
      B,
      tokenRatio,
      qualityWin,
      latencyWin,
      invNoDrop,
      keepSplit:
        sel.length > 0 &&
        (qualityWin || latencyWin) &&
        tokenRatio !== null &&
        tokenRatio <= 1.5 &&
        invNoDrop,
    };
  };
  const helpers = {};
  for (const h of ['board-reader', 'artboard-drafter', 'ds-switcher'])
    helpers[h] = groupBy((r) => r.delegates === h);
  return {
    generatedAt: new Date().toISOString(),
    trials: grades.length,
    harnessFailures: grades.filter((g) => g.harnessFailure).length,
    rows,
    helpers,
    controls: groupBy((r) => !r.delegates),
    overall: groupBy(() => true),
    costUsd: grades.reduce((a, g) => a + (g.metrics?.costUsd ?? 0) + (g.judge?.costUsd ?? 0), 0),
    wallS: grades.reduce((a, g) => a + (g.run?.wallMs ?? 0) / 1000, 0),
  };
}

const f = (x, d = 0) =>
  x === null || x === undefined || Number.isNaN(x) ? '–' : Number(x).toFixed(d);
const k = (x) => (x === null || x === undefined ? '–' : `${(x / 1000).toFixed(0)}k`);
const yn = (b) => (b ? 'yes' : 'no');

export function markdown(s) {
  const lines = [];
  lines.push(`# Agent eval — A (one writer + skills) vs B (A + helpers)`, '');
  lines.push(
    `${s.trials} trials · ${s.harnessFailures} infra-failures (excluded, re-run) · agent+judge cost ≈ $${f(s.costUsd, 2)} (list) · agent wall ${f(s.wallS / 60, 1)} min (sum)`,
    ''
  );
  lines.push(
    '| task | group | helper | A inv | B inv | A qual | B qual | A judge | B judge | A tok | B tok | A wall s | B wall s | B agents | failed (A / B) |'
  );
  lines.push(
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
  );
  for (const r of s.rows) {
    const inv = (c) =>
      `${c.valid ? `${f(c.invPassRate * c.valid)}/${c.valid}` : '–'}${c.harnessFailures ? ` (${c.harnessFailures} infra-failure)` : ''}`;
    const ql = (c) => (c.valid ? `${f(c.qualPassRate * c.valid)}/${c.valid}` : '–');
    const jd = (c) =>
      c.valid && c.judgePass !== null
        ? `${f(c.judgePass * c.valid)}/${c.valid}${c.judgeUnknown ? ` (${c.judgeUnknown}?)` : ''}`
        : '–';
    lines.push(
      `| ${r.task} | ${r.group} | ${r.delegates ?? '—'} | ${inv(r.A)} | ${inv(r.B)} | ${ql(r.A)} | ${ql(r.B)} | ${jd(r.A)} | ${jd(r.B)} | ${k(r.A.tokens)} | ${k(r.B.tokens)} | ${f(r.A.wallS)} | ${f(r.B.wallS)} | ${f(r.B.helperSpawns, 1)} | ${[r.A.failedInvariants.join(','), r.B.failedInvariants.join(',')].join(' / ') || '—'} |`
    );
  }
  lines.push(
    '',
    '## Decision rule per helper (keep only if quality or latency wins at ≤ 1.5× tokens, no invariant drop)',
    ''
  );
  lines.push(
    '| helper | tasks | A pass^k | B pass^k | A qual | B qual | A judge | B judge | tokens B/A | A wall s | B wall s | quality win | latency win | keep split |'
  );
  lines.push(
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
  );
  for (const [h, g] of [
    ...Object.entries(s.helpers),
    ['controls', s.controls],
    ['overall', s.overall],
  ]) {
    lines.push(
      `| ${h} | ${g.A.tasks} | ${g.A.invPassAll} | ${g.B.invPassAll} | ${f((g.A.qualPassRate ?? 0) * 100)} % | ${f((g.B.qualPassRate ?? 0) * 100)} % | ${f((g.A.judgePass ?? 0) * 100)} % | ${f((g.B.judgePass ?? 0) * 100)} % | ${f(g.tokenRatio, 2)} | ${f(g.A.wallS)} | ${f(g.B.wallS)} | ${yn(g.qualityWin)} | ${yn(g.latencyWin)} | ${h === 'controls' || h === 'overall' ? '—' : yn(g.keepSplit)} |`
    );
  }
  return `${lines.join('\n')}\n`;
}
