import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { surfaceStatistics } from './surface-statistics.mjs';

const cell = (value) =>
  String(value ?? '')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ');
export function writeSurfaceReport(out) {
  const path = join(out, 'surface-results.json');
  if (!existsSync(path)) return;
  const { rows } = JSON.parse(readFileSync(path, 'utf8'));
  const auditPath = join(out, 'source-audit.json');
  const audit = existsSync(auditPath) ? JSON.parse(readFileSync(auditPath, 'utf8')) : null;
  const invalidatedSamples = (audit?.comparisons ?? []).flatMap((r) => {
    const match = r.step.match(/^L06-ui-text-(hub|native|peer)-(\d+)$/);
    return match && r.status !== 'match'
      ? [
          {
            id: 'L06.ui-text-edit',
            direction: `${match[1]}-to-peers`,
            sample: Number(match[2]),
            receiver: r.receiver,
          },
        ]
      : [];
  });
  const cataloguePath = join(out, 'coverage-catalogue.json');
  if (existsSync(cataloguePath)) {
    const catalogue = JSON.parse(readFileSync(cataloguePath, 'utf8'));
    writeFileSync(
      join(out, 'coverage-results.json'),
      JSON.stringify(
        {
          catalogueComplete: catalogue.catalogueComplete,
          baselineComplete: false,
          note: 'Exact case IDs only. Unexpanded requirements and absent observations cannot be covered by a nearby passing case.',
          cases: catalogue.cases.map((entry) => ({
            id: entry.id,
            requiresTargetExpansion: entry.requiresTargetExpansion ?? false,
            directions: entry.directions.map((direction) => ({
              direction,
              observations: rows.filter((r) => r.id === entry.id && r.direction === direction),
              exercised: rows.some(
                (r) =>
                  r.id === entry.id &&
                  r.direction === direction &&
                  ['pass', 'fail'].includes(r.status)
              ),
            })),
          })),
        },
        null,
        2
      )
    );
  }
  const driverPath = join(out, 'driver-result.json');
  const driver = existsSync(driverPath) ? JSON.parse(readFileSync(driverPath, 'utf8')) : null;
  writeFileSync(
    join(out, 'timing-summary.json'),
    JSON.stringify(
      surfaceStatistics(rows, {
        expectedSamples: driver?.expectedSamples,
        driverFailed: driver ? !driver.completed : true,
        invalidatedSamples,
      }),
      null,
      2
    )
  );
  const counts = Object.fromEntries(
    ['pass', 'fail', 'unsupported', 'not-run'].map((status) => [
      status,
      rows.filter((r) => r.status === status).length,
    ])
  );
  const lines = [
    '# Partial local multiplayer baseline',
    '',
    '**Incomplete. This run does not certify T1 or absence of regressions.**',
    `Driver: ${driver ? (driver.completed ? 'completed' : `failed (exit ${driver.exitCode})`) : 'completion unrecorded; percentile claims disabled'}.`,
    '',
    `Result rows: ${counts.pass} pass, ${counts.fail} fail, ${counts.unsupported} unsupported, ${counts['not-run']} not run.`,
    '',
    'WDIO completion only means the observation driver finished. Product failures and missing coverage below remain failures and missing coverage.',
    '',
    'Times are individual observations, not percentiles. Synthetic pointer timings include the scripted gesture duration. Persistence is measured separately when present.',
    '',
    '| Case | Origin / direction | Result | Receiver observations / error |',
    '|---|---|---|---|',
  ];
  if (audit) {
    lines.splice(
      7,
      0,
      `Source audit: ${audit.counts.parsed} TSX files/snapshots parsed, ${audit.counts.syntaxFailures} syntax failures; ${audit.counts.mismatched} final snapshots differ from the expected text edit and ${audit.counts.missing} are missing. Final mismatches invalidate the corresponding timing sample, preserving the raw first-effect observations. See [source-audit.json](source-audit.json).`,
      ''
    );
  }
  for (const row of rows) {
    const details =
      row.observations
        ?.map((r) => {
          const time = r.observedMs ?? r.renderedMs ?? r.visibleMs ?? r.removedMs;
          return `${r.receiver}: ${r.status}${time == null ? '' : `; first effect ${Math.round(time)} ms`}${r.persistedMs == null ? '' : `; persisted ${Math.round(r.persistedMs)} ms`}${r.finalVisible == null ? '' : `; final visible ${r.finalVisible}`}${r.finalPersisted == null ? '' : `; final persisted ${r.finalPersisted}`}${r.error || r.finalError ? ` (${r.error || r.finalError})` : ''}`;
        })
        .join('; ') ??
      row.error ??
      row.reason ??
      row.note ??
      '';
    lines.push(
      `| ${cell(row.id)}${row.sample ? ` #${row.sample}` : ''} | ${cell(row.direction)} | ${cell(row.status)} | ${cell(details)} |`
    );
  }
  lines.push(
    '',
    'Structured observations: [surface-results.json](surface-results.json). Build/fixture provenance and screenshots are stored beside this report.',
    ''
  );
  writeFileSync(join(out, 'report.md'), lines.join('\n'));
  return counts;
}
