// p8-sweep-static — the static dead-control checker (V2-8, Michal: "every button must do something").
//
// Red when:
//   · a registry action resolves to nothing that runs it (no shell handler, no canvas lane, no native
//     command / native-menu arm, no surface control) — the ⌘K row, menu row or native row is dead;
//   · a native menu row (menu.actions.json) maps to an unknown action, a native row has no menu.rs arm,
//     or a shell row has no shell handler;
//   · a clickable element in apps/studio/client has no handler, only a noop one, or is disabled for good;
//   · a disabled control that does not say why is NEW (the existing ones are a ratchet, see below).
// Exceptions live in dead-controls.allow.json, each with its reason; a stale entry is red too.
// The scanner is test/_dead-controls.ts (TypeScript compiler API). Evidence table:
// .ai/plans/notes/v2-evidence/V2-8-dead-controls-static.md.
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Finding,
  findingKey,
  handledMenuIds,
  STUDIO,
  scanClient,
  scanRegistry,
  scanSource,
} from './_dead-controls.ts';

interface Allow {
  registrySurfaces: Record<string, { file: string; hook: string }>;
  registryAllow: Record<string, string>;
  client: Record<string, string>;
}
const ALLOW = JSON.parse(
  readFileSync(join(STUDIO, 'test/dead-controls.allow.json'), 'utf8')
) as Allow;

async function registryReport() {
  const { ACTIONS } = await import('../actions/index.ts');
  const mr = await import('../client/v2/shell/menu-runner.js');
  const sk = (await import('../client/actions/shell-key-handlers.js')) as unknown as {
    SHELL_KEY_HANDLERS: Record<string, unknown>;
  };
  // The shell's closures are stubs: the map's KEYS are what is bound; a body is checked for a noop shape.
  const stub = new Proxy({}, { get: () => () => {} });
  return scanRegistry({
    actions: ACTIONS as never,
    handlers: mr.createMenuHandlers(stub) as Record<string, unknown>,
    keyHandlers: sk.SHELL_KEY_HANDLERS,
    nativeCommands: mr.NATIVE_COMMANDS as Record<string, string>,
  });
}

const idOf = (f: Finding) => f.control.split(' — ')[0] as string;

describe('the action registry: every action has something that runs it', () => {
  test('no registry action, native menu row or shell handler is dead', async () => {
    const r = await registryReport();
    expect(r.checked).toBeGreaterThan(400);
    const dead = r.findings
      .filter(
        (f) =>
          !(
            f.finding === 'no-handler' &&
            (idOf(f) in ALLOW.registrySurfaces || idOf(f) in ALLOW.registryAllow)
          )
      )
      .map((f) => `${f.finding} ${f.control}${f.detail ? ` (${f.detail})` : ''}`);
    expect(dead).toEqual([]);
  });

  test('a surface entry names a control that still exists, and only for an action with no registry runner', async () => {
    const r = await registryReport();
    const unrun = new Set(r.findings.filter((f) => f.finding === 'no-handler').map(idOf));
    const bad: string[] = [];
    for (const [id, s] of Object.entries(ALLOW.registrySurfaces)) {
      if (!unrun.has(id)) bad.push(`${id}: has a registry runner now — drop the surface entry`);
      const path = join(STUDIO, s.file);
      if (!existsSync(path)) bad.push(`${id}: ${s.file} is gone`);
      else if (!readFileSync(path, 'utf8').includes(s.hook))
        bad.push(`${id}: “${s.hook}” is not in ${s.file}`);
    }
    for (const id of Object.keys(ALLOW.registryAllow))
      if (!unrun.has(id)) bad.push(`${id}: has a runner now — drop the allow entry`);
    expect(bad).toEqual([]);
  });

  test('the native menu arms menu.rs knows are read (the scrape is not empty)', () => {
    expect(handledMenuIds().size).toBeGreaterThanOrEqual(18);
    expect(handledMenuIds().has('open_project_folder')).toBe(true);
  });
});

describe('clickable elements in apps/studio/client', () => {
  const report = scanClient();

  test('scans the client (a non-trivial number of controls)', () => {
    expect(report.files).toBeGreaterThan(300);
    expect(report.checked).toBeGreaterThan(900);
  });

  test('no control without a handler, with only a noop one, or disabled for good', () => {
    const dead = report.findings
      .filter((f) => f.finding !== 'disabled-no-reason')
      .filter((f) => !(findingKey(f) in ALLOW.client))
      .map((f) => `${f.file}:${f.line} ${f.finding} ${f.control} ${f.detail ?? ''}`.trim());
    expect(dead).toEqual([]);
  });

  test('no stale client allow entry', () => {
    const keys = new Set(report.findings.map(findingKey));
    expect(Object.keys(ALLOW.client).filter((k) => !keys.has(k))).toEqual([]);
  });

  // A disabled control must say why — a tooltip `title` + `aria-description`, the shared
  // `{...reasonProps(off, kind)}` (client/v2/access/disabled-reason.js) — unless the reason is on screen already
  // (in flight, an empty field, a line rendered under the same condition — `selfEvidentDisable`). p8-dead-reasons
  // took the old per-file ratchet (96) to zero, so there is no ratchet left: a new one is red.
  test('no control is disabled without saying why', () => {
    const silent = report.findings
      .filter((f) => f.finding === 'disabled-no-reason')
      .map((f) => `${f.file}:${f.line} ${f.control} [${f.detail ?? ''}]`);
    expect(silent).toEqual([]);
  });
});

describe('the scanner itself (fixtures)', () => {
  const run = (src: string) =>
    (scanSource('client/fixture.jsx', src)?.findings ?? []).map((f) => f.finding).sort();

  test('flags a button with no handler, a noop handler, href="#", disabled for good', () => {
    expect(run('const A = () => <button type="button">Go</button>;')).toEqual(['missing-handler']);
    expect(run('const A = () => <button onClick={() => {}}>Go</button>;')).toEqual([
      'noop-handler',
    ]);
    expect(run('const A = () => <button onClick={(e) => e.preventDefault()}>Go</button>;')).toEqual(
      ['noop-handler']
    );
    expect(run('const A = () => <button onClick={() => console.log(1)}>Go</button>;')).toEqual([
      'noop-handler',
    ]);
    expect(
      run('const noop = () => {}; const A = () => <div role="menuitem" onClick={noop}>Go</div>;')
    ).toEqual(['noop-handler']);
    expect(run('const A = () => <a href="#">Go</a>;')).toEqual(['href-hash']);
    expect(run('const A = () => <button disabled onClick={go}>Go</button>;')).toEqual([
      'disabled-for-good',
    ]);
    expect(run('const A = () => <Btn onClick={() => {}}>Go</Btn>;')).toEqual(['noop-handler']);
    expect(run('const A = () => <button disabled={!canEdit} onClick={go}>Go</button>;')).toEqual([
      'disabled-no-reason',
    ]);
  });

  test('does not flag a wired, delegated, submitted, linked or self-evidently disabled control', () => {
    expect(run('const A = () => <button onClick={go}>Go</button>;')).toEqual([]);
    expect(run('const A = () => <ul onClick={pick}><li role="option">x</li></ul>;')).toEqual([]);
    expect(
      run('const A = () => <form onSubmit={s}><button type="submit">Go</button></form>;')
    ).toEqual([]);
    expect(run('const A = () => <a href="/x">Go</a>;')).toEqual([]);
    expect(run('const A = (p) => <button {...p}>Go</button>;')).toEqual([]);
    expect(run('const A = () => <button disabled={busy} onClick={go}>Go</button>;')).toEqual([]);
    expect(
      run('const A = () => <button disabled={!name.trim()} onClick={go}>Go</button>;')
    ).toEqual([]);
    expect(
      run('const A = () => <button disabled={!canEdit} title="Can view" onClick={go}>Go</button>;')
    ).toEqual([]);
    // p8-dead-reasons — the shared reason helper is a reason
    expect(
      run(
        "const A = () => <button disabled={!native} {...reasonProps(!native, 'macApp')} onClick={go}>Go</button>;"
      )
    ).toEqual([]);
    // a click guard on a control that also has a real handler is not a noop control
    expect(
      run(
        'const A = () => <button onPointerDown={(e) => e.stopPropagation()} onClick={go}>Go</button>;'
      )
    ).toEqual([]);
  });

  // p8-dead-reasons: the reason is on screen already, in ways the scanner now reads precisely.
  test('a reason rendered under the same condition, beside the control, is a reason', () => {
    // `{cond && <p>why</p>}` / `{cond ? <p>why</p> : …}` in the same component
    expect(
      run(
        'function A() { return <div>{held && <p role="alert">Held</p>}<button disabled={busy || held} onClick={go}>Keep</button></div>; }'
      )
    ).toEqual([]);
    expect(
      run(
        'function A() { return <div>{kind === "ask" && !view.canAsk ? <p>No AI</p> : null}<button disabled={busy || !view.canAsk} onClick={go}>Ask</button></div>; }'
      )
    ).toEqual([]);
    // the else branch of a ternary is shown under the negation
    expect(
      run(
        'function A() { return <div>{canAskAI ? <p>fine</p> : <p>no AI</p>}<button disabled={!canAskAI} onClick={go}>Make</button></div>; }'
      )
    ).toEqual([]);
    // `!!refused` rendered as `{refused ? …}`, `x.length` as `x.length > 0`
    expect(
      run(
        'function A() { return <div>{refused ? <p>no</p> : null}{model.refused.length > 0 && <p>x</p>}<button disabled={busy || !!refused || !!model.refused.length} onClick={go}>Go</button></div>; }'
      )
    ).toEqual([]);
    // a condition rendered in ANOTHER component does not count
    expect(
      run(
        'function B() { return held && <p>Held</p>; } function A() { return <button disabled={held} onClick={go}>Keep</button>; }'
      )
    ).toEqual(['disabled-no-reason']);
  });

  test('a local const is read through: `!canSend` where canSend is an empty-field check', () => {
    expect(
      run(
        'function A() { const canPreview = description.trim().length > 0; return <button disabled={!canPreview} onClick={go}>Go</button>; }'
      )
    ).toEqual([]);
    expect(
      run(
        'function A() { const ok = url.trim() && email.trim() && password; return <button disabled={!ok || !!busy} onClick={go}>Go</button>; }'
      )
    ).toEqual([]);
    expect(
      run(
        'function A() { const ready = looksLikeEmail(email) && !busy; return <button disabled={!ready} onClick={go}>Go</button>; }'
      )
    ).toEqual([]);
    expect(
      run(
        'function A() { const verdict = checkName(draft); return <button disabled={busy || !verdict.ok} onClick={go}>Go</button>; }'
      )
    ).toEqual([]);
    // a role in the const is still a reason to say
    expect(
      run(
        'function A() { const canSend = native && prompt.trim().length > 0; return <button disabled={!canSend} onClick={go}>Go</button>; }'
      )
    ).toEqual(['disabled-no-reason']);
  });

  test('more on-screen states: in flight, nothing there yet, a pager at its end', () => {
    for (const cond of [
      "list.phase === 'signing-in'",
      'busy === w.id',
      '!!folding',
      'downloading',
      '!units.length',
      '!log.total',
      '!hasText',
      '!logoFile && !wantsSite',
      "!canStep(position, 'next')",
    ])
      expect([
        cond,
        run(`const A = () => <button disabled={${cond}} onClick={go}>Go</button>;`),
      ]).toEqual([cond, []]);
    // read through a const / a host callback / a sheet's submit gate
    for (const [decl, cond] of [
      ['const ready = relink ? !!(url.trim() || grant.trim()) : !!url.trim();', 'busy || !ready'],
      ['const kind = figmaLinkKind(url);', "busy || kind === 'none'"],
      ['const ok = hub.url.trim() && hub.email.trim() && hub.password;', '!ok'],
      ['const ok = qs.filter((q) => q.required).every((q) => isAnswered(q, a));', '!ok'],
      ['', 'bgBusy || !onRemoveBackground'],
      ['', "onJoin ? undefined : 'true'"],
      ['', '!canSubmit || busy || !onSubmit'],
    ])
      expect([
        cond,
        run(`function A() { ${decl} return <button disabled={${cond}} onClick={go}>Go</button>; }`),
      ]).toEqual([cond, []]);
    // a text ternary rendered as a child counts as shown; one in an attribute does not
    expect(
      run(
        'function A() { return <p>{linked ? W.view : held ? W.keepHeld : W.fine}<button disabled={busy || held} onClick={go}>Keep</button></p>; }'
      )
    ).toEqual([]);
    expect(
      run(
        'function A() { return <button className={held ? "a" : "b"} disabled={held} onClick={go}>Keep</button>; }'
      )
    ).toEqual(['disabled-no-reason']);
    // already added: the thing this control adds is on screen
    expect(
      run(
        "function A() { return ['v2', 'm2'].map((id) => { const there = have.includes(id); return <button disabled={there} onClick={() => onAddTrack(id)}>Add</button>; }); }"
      )
    ).toEqual([]);
    expect(
      run(
        "function A() { return ['v2'].map((id) => { const there = have.includes(id); return <button disabled={there} onClick={go}>Add</button>; }); }"
      )
    ).toEqual(['disabled-no-reason']);
    // a `canStep` that is a role, not a pager end, still says why
    expect(run('const A = () => <button disabled={!canStep} onClick={go}>Go</button>;')).toEqual([
      'disabled-no-reason',
    ]);
  });
});
