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
          cases: catalogue.cases.map((entry) => {
            // A contract requirement is exercised by the rows it NAMES, and
            // only when EVERY one of them ran in that direction. Anything
            // looser would let one executed row carry a whole surface, which
            // is the shape of the blanket placeholder this expansion replaced.
            const covers = entry.covers ?? [];
            // Not every covering row is emitted per direction. Some are
            // single-sided by nature — a restart happens on ONE machine, and
            // `open-and-render` is labelled by who created the canvas — so
            // demanding all three directions of them reported a gap that was
            // only ever a labelling difference. A covering row counts for a
            // direction when it ran in that direction, OR when it is never
            // emitted in any of the three peer directions at all.
            const peerDirections = new Set(['hub-to-peers', 'native-to-peers', 'peer-to-peers']);
            const directional = new Set(
              rows.filter((r) => peerDirections.has(r.direction)).map((r) => r.id)
            );
            const ran = (id, direction) =>
              rows.some(
                (r) =>
                  r.id === id &&
                  ['pass', 'fail'].includes(r.status) &&
                  (directional.has(id) ? r.direction === direction : true)
              );
            return {
              id: entry.id,
              requiresTargetExpansion: entry.requiresTargetExpansion ?? false,
              ...(covers.length > 0 ? { covers } : {}),
              ...(entry.unresolved ? { unresolved: entry.unresolved } : {}),
              directions: entry.directions.map((direction) => ({
                direction,
                observations: rows.filter((r) => r.id === entry.id && r.direction === direction),
                exercised:
                  covers.length > 0
                    ? covers.every((id) => ran(id, direction))
                    : ran(entry.id, direction),
                ...(covers.length > 0
                  ? { missing: covers.filter((id) => !ran(id, direction)) }
                  : {}),
              })),
            };
          }),
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
