// Shared storage SPIKE policy only. Candidate source/effect validation is absent.
export const DDL = `
CREATE TABLE IF NOT EXISTS heads(project TEXT PRIMARY KEY, epoch INTEGER NOT NULL, revision INTEGER NOT NULL, manifest TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS actions(project TEXT NOT NULL, revision INTEGER NOT NULL, actor TEXT NOT NULL, tx TEXT NOT NULL, bytes TEXT NOT NULL, hash TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(project,revision), UNIQUE(project,actor,tx));
CREATE TABLE IF NOT EXISTS results(project TEXT NOT NULL, actor TEXT NOT NULL, tx TEXT NOT NULL, hash TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(project,actor,tx));`;
export const INITIAL_HASH = 'a'.repeat(64);
export function ensure(db, project) {
  db.exec('INSERT OR IGNORE INTO heads VALUES (?,1,0,?)', project, INITIAL_HASH);
}
export function head(db, project) {
  return db.exec('SELECT * FROM heads WHERE project=?', project)[0];
}
export function lookup(db, project, actor, tx) {
  const row = db.exec(
    'SELECT * FROM results WHERE project=? AND actor=? AND tx=?',
    project,
    actor,
    tx
  )[0];
  return row ? JSON.parse(row.result) : null;
}
export function state(db, project) {
  return {
    head: head(db, project),
    actions: db.exec('SELECT * FROM actions WHERE project=? ORDER BY revision', project),
    results: db.exec('SELECT * FROM results WHERE project=? ORDER BY actor,tx', project),
  };
}
// Shared fixture receipt policy, not source/effect validation or a production kernel.
export function decide(current, old, { project, actor, p, hash }) {
  const common = {
    protocol: 1,
    projectId: project,
    epoch: p.epoch,
    transactionId: p.transactionId,
    proposalHash: hash,
  };
  const rejected = (code) => ({
    ...common,
    status: 'rejected',
    code,
    currentRevision: current.revision,
  });
  // Current membership is checked by the trusted caller before even this lookup.
  // A retained result is a read after handoff, never permission for a new write.
  if (old)
    return {
      retained: true,
      result: old.hash === hash ? JSON.parse(old.result) : rejected('transaction-id-reused'),
    };
  let result;
  if (p.epoch !== current.epoch) result = rejected('epoch-stale');
  else if (p.base.revision !== current.revision || p.base.manifestHash !== current.manifest)
    result = rejected('base-conflict');
  else {
    const operation = p.action.operations[0];
    result = {
      ...common,
      status: 'accepted',
      revision: current.revision + 1,
      parentRevision: current.revision,
      manifestHash: hash,
      actorId: actor,
      origin: p.origin,
      actionId: `action-${current.revision + 1}`,
      effects: [
        {
          effectId: `effect-${current.revision + 1}`,
          operationIndex: 0,
          documentId: operation.documentId,
          generation: operation.generation,
          target: { lane: 'source' },
          previousEffectId: null,
          beforeHash: null,
          afterHash: hash,
          undoable: false,
        },
      ],
      committedAt: 1,
    };
    // The manifest/effect values above are schema-valid fixture receipts, not
    // actual source semantics or a production clock/history implementation.
  }
  return { retained: false, result };
}

// Every call is inside the backend's actual atomic write transaction.
export function append(db, command, fault) {
  const { project, actor, raw, p, hash } = command;
  ensure(db, project);
  const current = head(db, project);
  const old = db.exec(
    'SELECT hash,result FROM results WHERE project=? AND actor=? AND tx=?',
    project,
    actor,
    p.transactionId
  )[0];
  const { result, retained } = decide(current, old, command);
  if (retained) return result;
  if (result.status === 'accepted') {
    db.exec(
      'INSERT INTO actions VALUES (?,?,?,?,?,?,?)',
      project,
      result.revision,
      actor,
      p.transactionId,
      raw,
      hash,
      JSON.stringify(result)
    );
    if (fault === 'after-action') throw new Error('injected-rollback');
    db.exec(
      'UPDATE heads SET revision=?,manifest=? WHERE project=? AND epoch=? AND revision=?',
      result.revision,
      hash,
      project,
      p.epoch,
      current.revision
    );
    if (fault === 'after-head') throw new Error('injected-rollback');
  }
  db.exec(
    'INSERT INTO results VALUES (?,?,?,?,?)',
    project,
    actor,
    p.transactionId,
    hash,
    JSON.stringify(result)
  );
  if (fault === 'after-result') throw new Error('injected-rollback');
  return result;
}
