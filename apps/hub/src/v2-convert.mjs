// The cloud's v1 → v2 conversion (Michal: decision `maude/v2-michal-drop-v1-auto-convert`) —
// "With the deploy of the new cloud, all projects should be converted."
//
// WHERE IT RUNS (p8-selfhost-convert widened it): in a cell's hub AND in a self-hosted
// workspace hub (`maude hub workspace-up`) — the same gate, backup and report; `CELL_V2_CONVERT=0`
// stops both. Inside the hub process, at boot, once the project store has been read —
// the same chain that already resumes a half-done switch and adopts a new project's mode
// (`acceptedReady`, server.mjs). Not a separate step in `infra/cell/entrypoint.sh`: the format
// and the save mode live in the project coordinator (`hub-integration.mjs` — the store, the
// barrier, the per-connection notices, the baseline import that reads the live documents), and
// that coordinator exists only inside the running hub. A shell step before `exec node hub` has
// no store; one after it would have to call the hub over HTTP as somebody.
//
// WHO IT RUNS AS: the service itself — `cell:self`, the key the hub already writes its own
// studio's format record under. It calls the coordinator's `setFormat` and `setMode` in-process:
// the exact functions `POST /api/project-format` and `POST /api/projects/current/v1/mode` call
// for the owner's "Update project" (migrate/engine.ts), with the engine's order — format first,
// the save mode last, on the epoch read again after the flip. No person's token is involved.
//
// THE GATE: only an image whose OWN version is a stable release ≥ 2.0.0, read from both layers
// (the hub's package.json and the studio manifest the client is served from). An rc never
// converts — during the rc the fleet stays on 1.10.0 and a format-2 project would be view only
// there for everyone. A 1.x image has no copy of this file at all.
//
// PER PROJECT: skipped when it is already format 2 in accepted revisions (so a second boot
// changes nothing); otherwise a backup FIRST (a full generation — documents + checkout — in the
// cell's durable backup target under `v2-convert/`, never pruned by the regular schedule), then
// the flip, then the switch. A failure is that project's alone: logged, counted, and the project
// left as it was (a format flip whose switch failed is flipped back).
//
// THE REPORT: one parseable line per run, `[v2-convert] converted=N skipped=N failed=N`, and the
// same counts on `/health` as `v2Convert` (`cells-deploy.yml` collects them after the rollout).

import { asFormat } from './project-transactions/store-core.mjs';

export const REPORT_TAG = '[v2-convert]';
export const TARGET_FORMAT = 2;
/** The actor recorded on the store (`changedBy`) — the service, never a person. */
export const CELL_SELF = 'cell:self';
/** Where the pre-conversion backup goes, inside the cell's own backup keyspace. */
export const BACKUP_PREFIX = 'v2-convert';

const STABLE_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const TENANT_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** A stable `X.Y.Z` → its parts; anything else (an rc, build metadata, garbage) → null. */
export function parseStableVersion(v) {
  const m = STABLE_RE.exec(String(v ?? '').trim());
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) } : null;
}

/** The kill switch's name — the same for a cell (projected by apps/cells/cell-config.mjs) and a
 *  self-hosted hub (its own env). */
export const KILL_SWITCH = 'CELL_V2_CONVERT';

/** Is a workspace-mode hub — the env server.mjs reads for `workspaceMode`. */
function isWorkspaceEnv(env) {
  return env.HUB_WORKSPACE_MODE === '1' || env.MAUDE_WORKSPACE_MODE === '1';
}

/**
 * May this process convert? `{ run: true }` or `{ run: false, reason }`.
 *
 * WHO: a cell (a valid MAUDE_TENANT_ID) or a self-hosted workspace hub (`maude hub
 * workspace-up`: workspace mode, no tenant) — the two hubs that hold one project's store
 * (decision maude/v2-michal-selfhost-convert-killswitch-held-conflict). A plain sync relay has
 * no project to convert: `not-a-project-hub`, and nothing on `/health`.
 *
 * THE KILL SWITCH: `CELL_V2_CONVERT` — unset, empty or `1` converts; `0` (or any other value: a
 * kill switch typed wrong fails closed) is `disabled`.
 *
 * THE VERSIONS: both layers must be a stable release ≥ 2.0.0 — a disagreement between them is
 * the signal `/health` already treats as "this image was built wrong", so it never converts.
 */
export function conversionGate({
  hubVersion,
  releaseVersion,
  env = process.env,
  workspaceMode = isWorkspaceEnv(env),
} = {}) {
  const tenant = String(env.MAUDE_TENANT_ID ?? '');
  const cell = TENANT_RE.test(tenant);
  if (!cell && !workspaceMode) return { run: false, reason: 'not-a-project-hub' };
  // A workspace hub naming a tenant it cannot be is neither a cell nor a plain self-hosted hub.
  if (!cell && tenant !== '') return { run: false, reason: 'invalid-tenant' };
  const sw = env[KILL_SWITCH];
  if (sw !== undefined && sw !== '' && sw !== '1')
    return { run: false, reason: 'disabled', switchValue: String(sw) };
  const versions = [hubVersion, releaseVersion];
  if (versions.some((v) => /-/.test(String(v ?? '')))) return { run: false, reason: 'prerelease' };
  const parsed = versions.map(parseStableVersion);
  if (parsed.some((p) => !p)) return { run: false, reason: 'unknown-version' };
  if (parsed.some((p) => p.major < 2)) return { run: false, reason: 'v1' };
  return { run: true };
}

/** One line, always the same three keys in the same order. */
export function formatReportLine({ converted = 0, skipped = 0, failed = 0 } = {}) {
  return `${REPORT_TAG} converted=${converted} skipped=${skipped} failed=${failed}`;
}

/** The counts out of a log line (anywhere in it; one optional label token after the tag, as
 *  in the deploy's `[v2-convert] fleet …` total), or null when it is not one. */
export function parseReportLine(line) {
  const m = /\[v2-convert\](?: \S+)? converted=(\d+) skipped=(\d+) failed=(\d+)(?:\s|$)/.exec(
    String(line)
  );
  return m ? { converted: Number(m[1]), skipped: Number(m[2]), failed: Number(m[3]) } : null;
}

/** A reason that is safe to log: a code, or a bounded one-line message. */
function reasonOf(err) {
  if (err?.code && typeof err.code === 'string') return err.code;
  return String(err?.message ?? err)
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 200);
}

/**
 * Convert one project. `coordinator` is the hub's accepted-revisions coordinator
 * (`createAcceptedRevisions`): `refresh`, `health`, `setFormat`, `setMode`.
 * `backup()` writes the pre-conversion generation and resolves to where it went.
 * Never throws: `{ outcome: 'converted'|'skipped'|'failed', reason?, backup? }`.
 */
export async function convertProject({ coordinator, backup, by = CELL_SELF }) {
  let before;
  try {
    before = await coordinator.refresh();
  } catch (err) {
    return { outcome: 'failed', reason: `store-unreadable: ${reasonOf(err)}` };
  }
  const format = asFormat(before.formatVersion);
  const legacy = before.mode !== 'transactions';
  if (format > TARGET_FORMAT) return { outcome: 'skipped', reason: 'newer-format' };
  if (format >= TARGET_FORMAT && !legacy) return { outcome: 'skipped', reason: 'already-v2' };

  // What would stop the switch — asked BEFORE anything is written, the way the engine asks its
  // dry run first, so a blocked project is left exactly as it was (no backup, no flip).
  if (legacy) {
    const h = coordinator.health?.({ privileged: true }) ?? {};
    if (h.durable === false) return { outcome: 'failed', reason: 'store-not-durable' };
    if (h.browserPaired === false) return { outcome: 'failed', reason: 'browser-not-paired' };
  }

  let where;
  try {
    where = await backup();
  } catch (err) {
    return { outcome: 'failed', reason: `backup: ${reasonOf(err)}` };
  }

  let flipped = false;
  try {
    if (format < TARGET_FORMAT) {
      await coordinator.setFormat({
        formatVersion: TARGET_FORMAT,
        expectEpoch: before.epoch,
        by,
      });
      flipped = true;
    }
    if (legacy) {
      // The flip advanced the epoch: read it again (engine.ts switchSaveMode).
      const mid = await coordinator.refresh();
      await coordinator.setMode({ mode: 'transactions', expectEpoch: mid.epoch });
    }
    return { outcome: 'converted', backup: where };
  } catch (err) {
    const reason = reasonOf(err);
    if (flipped) {
      // Leave it as it was: a format-2 project still saving the old way is neither.
      try {
        const now = await coordinator.refresh();
        await coordinator.setFormat({ formatVersion: format, expectEpoch: now.epoch, by });
      } catch (undo) {
        return {
          outcome: 'failed',
          reason: `${reason}; the format could not be put back: ${reasonOf(undo)}`,
          backup: where,
        };
      }
    }
    return { outcome: 'failed', reason, backup: where };
  }
}

/**
 * Convert every project, one at a time; one project's failure never stops the next.
 * `projects`: `[{ id, coordinator, backup }]`. Logs a line per project that is not skipped,
 * then the report line. Resolves to the counts + per-project results.
 */
export async function convertAll(projects, { log = console } = {}) {
  const counts = { converted: 0, skipped: 0, failed: 0 };
  const results = [];
  for (const p of projects) {
    let r;
    try {
      r = await convertProject(p);
    } catch (err) {
      r = { outcome: 'failed', reason: reasonOf(err) };
    }
    counts[r.outcome] += 1;
    results.push({ id: p.id, ...r });
    if (r.outcome === 'converted')
      log.log?.(
        `${REPORT_TAG} ${p.id}: converted to format 2, accepted revisions (backup ${r.backup ?? 'n/a'})`
      );
    else if (r.outcome === 'failed')
      log.error?.(`${REPORT_TAG} ${p.id}: FAILED (${r.reason}) — left as it was`);
  }
  log.log?.(formatReportLine(counts));
  return { ...counts, results };
}

/**
 * The hub's handle: `run()` once per boot (idempotent within the process), `health()` for
 * `/health` (null when this process holds no project). Never throws into the boot.
 * `disabled` (the kill switch) logs one line on the first `run()` and reports
 * `{ state: 'disabled', by: 'CELL_V2_CONVERT=0' }`.
 */
export function createV2Conversion({ gate, projects, log = console, now = () => new Date() }) {
  let report = null;
  // The switch's value as it may be echoed: a short plain token, never a line of its own.
  const by =
    gate.reason === 'disabled'
      ? `${KILL_SWITCH}=${/^[A-Za-z0-9._-]{1,16}$/.test(String(gate.switchValue ?? '')) ? gate.switchValue : '(invalid)'}`
      : null;
  if (gate.run) report = { state: 'pending' };
  else if (gate.reason === 'disabled') report = { state: 'disabled', by };
  else if (gate.reason !== 'not-a-project-hub' && gate.reason !== 'off')
    report = { state: 'gated', reason: gate.reason };
  let running = null;
  let announced = false;
  return {
    run() {
      if (gate.reason === 'disabled' && !announced) {
        announced = true;
        log.log?.(`${REPORT_TAG} disabled by ${by}`);
      }
      if (!gate.run) return Promise.resolve(null);
      running ??= (async () => {
        report = { state: 'running' };
        try {
          const out = await convertAll(projects(), { log });
          report = {
            state: 'done',
            converted: out.converted,
            skipped: out.skipped,
            failed: out.failed,
            at: now().toISOString(),
          };
          return out;
        } catch (err) {
          // convertAll does not throw; this is the belt for `projects()` itself.
          log.error?.(`${REPORT_TAG} did not run: ${reasonOf(err)}`);
          report = { state: 'done', converted: 0, skipped: 0, failed: 1, at: now().toISOString() };
          log.log?.(formatReportLine(report));
          return null;
        }
      })();
      return running;
    },
    health() {
      return report ? { ...report } : null;
    },
  };
}
