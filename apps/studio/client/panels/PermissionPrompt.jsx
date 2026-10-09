// The inline approve/deny card (Milestone B — retires DDR-125 F2's blanket
// auto-approve). Renders whatever `options[]` the agent actually offered —
// NOT a fixed Allow/Reject pair — because ExitPlanMode rides this SAME
// requestPermission path with its own multi-way option set ("Yes, and use
// auto mode" / "Yes, and auto-accept edits" / "No, keep planning", …). Only
// mounted while a request is pending for the ACTIVE chat (ChatThread gates
// this — one card at a time, oldest first).

import { useEffect, useRef } from 'react';

function toolTarget(toolCall) {
  const raw = toolCall?.rawInput;
  const fromInput =
    raw && typeof raw === 'object'
      ? raw.path || raw.file_path || raw.abs_path || raw.filePath
      : undefined;
  const fromLocation = Array.isArray(toolCall?.locations) ? toolCall.locations[0]?.path : undefined;
  const path = fromInput || fromLocation;
  return path ? String(path).split('/').pop() : null;
}

// Visual bucket for a PermissionOptionKind — drives which button style reads
// as "the safe default" (allow-once) vs "the escape hatch" (reject). Note
// `allow_always` is deliberately NOT primary-styled — see `pickDefaultAllow`
// below for why.
function kindClass(kind) {
  if (kind === 'reject_once' || kind === 'reject_always') return 'btn btn--danger';
  if (kind === 'allow_once') return 'btn btn--primary';
  return 'btn';
}

// SECURITY (ethical-hacker finding) — pure, exported for direct unit testing
// (test/acp-permission-prompt.test.ts) without needing to render the
// component. Prefers `allow_once` over `allow_always` as the default (Enter
// key + visually primary button). The adapter's own option ordering for BOTH
// a routine tool call and an ExitPlanMode request happens to list the
// most-permissive standing-exemption option FIRST (`allow_always`, or
// ExitPlanMode's `auto` mode) — a plain `.find()` over an unordered
// preference grabbed whichever came first, which meant Enter/the one bold
// button on an ORDINARY tool-call card silently granted a session-scoped
// standing exemption instead of a one-time approval, and on an ExitPlanMode
// card silently flipped the whole session into an unattended auto mode
// (after which `requestPermission` is never called again — DDR-179's own
// bypassPermissions short-circuit). Only fall back to `allow_always` when no
// once-only option was offered at all, so there's always SOME allow default
// rather than none.
export function pickDefaultAllow(options) {
  const list = Array.isArray(options) ? options : [];
  return (
    list.find((o) => o?.kind === 'allow_once') ??
    list.find((o) => o?.kind === 'allow_always') ??
    null
  );
}

export function pickDefaultReject(options) {
  const list = Array.isArray(options) ? options : [];
  return list.find((o) => o?.kind === 'reject_once' || o?.kind === 'reject_always') ?? null;
}

// feature-acp-write-path-scope Task 4 — the out-of-project write case.
//
// `scope` is attached by the SERVER (bridge.ts `classifyWrite` → index.ts's
// `permission-request` frame) and only ever for a write tool the path gate
// refused to auto-approve. Everything this renders comes from that payload: the
// paths are the bridge's REALPATH-RESOLVED absolutes, never `toolCall.rawInput`,
// because the model's own string is what makes the write look harmless
// (`docs/../../../.zshenv` reads as a docs edit). Same lesson as the deep-link
// modal's truncated project name.
//
// Exported pure so the copy is unit-testable without rendering (mirrors
// pickDefaultAllow's rationale — the affordance IS the security control here).
// SECURITY (security-auditor F3) — the resolved path is REAL filesystem data,
// but its non-existent tail is whatever the model asked to create, so it is
// attacker-influenced text rendered in the one card whose entire job is to be
// read accurately. React escapes markup; it does NOT neutralize bidi overrides
// or C0 controls, so `~/safe/‮gnp.esriv/…` can be made to READ as a
// harmless path while resolving somewhere else entirely.
//
// Stripped at RENDER time rather than in the frame: the frame should carry the
// true path (it is also an audit record), and only the display needs to be
// unspoofable. Replaced with U+FFFD rather than deleted so a tampered path is
// visibly odd instead of silently shorter.
// Written as \u escapes, never literal characters (security-auditor F3 nit) —
// the same reasoning applied to the tests: a literal RLO in this source would
// reorder THIS FILE in every editor and code-review diff that renders it.
//   \p{Cc}          C0/C1 controls (newline, CR, NUL — hide a whole segment)
//   202A-202E,2066-2069  bidi embeddings/overrides/isolates (visual reversal)
//   200E,200F,061C  LRM/RLM/ALM — directional marks, same class of trick
//   200B-200D,FEFF  zero-width space/non-joiner/joiner/BOM (invisible splits)
//   00AD            soft hyphen (invisible, but may render as a break)
const UNSAFE_DISPLAY =
  /[\p{Cc}\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C\u200B-\u200D\uFEFF\u00AD]/gu;
export function sanitizePathForDisplay(p) {
  return String(p).replace(UNSAFE_DISPLAY, '�');
}

export function describeOutOfProject(scope) {
  if (!scope || scope.outOfProjectWrite !== true) return null;
  const paths = Array.isArray(scope.resolvedPaths)
    ? scope.resolvedPaths.filter(Boolean).map(sanitizePathForDisplay)
    : [];
  const lead =
    scope.reason === 'no-target'
      ? 'Claude asked to write a file but did not say which one.'
      : scope.reason === 'disagreement'
        ? 'Claude named two different files for one write.'
        : // `in-project-denied` is INSIDE the project — saying "outside" would be
          // a plain lie, and the reason it's being asked about is different in
          // kind: not "where is this going" but "this file runs".
          scope.reason === 'in-project-denied'
          ? 'This file is part of how your project RUNS, not part of its design.'
          : paths.length > 1
            ? 'Claude wants to write files outside this project.'
            : 'Claude wants to write a file outside this project.';
  return {
    lead,
    paths,
    scopeRoot: typeof scope.scopeRoot === 'string' ? sanitizePathForDisplay(scope.scopeRoot) : '',
    // Decision D — the server already stripped every `allow_always` option, so
    // there is no "always allow" to explain away. Say so, rather than leaving
    // the user wondering where the usual option went.
    note: 'This is allowed once, for this request only.',
    /** Inside the project, but denied for an execution reason — the copy above
     *  must not claim "outside". */
    inProjectDenied: scope.reason === 'in-project-denied',
  };
}

// Decision D is enforced SERVER-side (bridge.ts filters `allow_always` out of
// the offered set, and validates a response against that same filtered set).
// This is a second, client-side pass purely so a stale/racing frame can never
// paint a button that the server would reject anyway — belt-and-braces, not the
// control itself.
function visibleOptions(options, outOfProject) {
  const list = Array.isArray(options) ? options : [];
  return outOfProject ? list.filter((o) => o?.kind !== 'allow_always') : list;
}

export default function PermissionPrompt({ request, onRespond, queueLength = 1 }) {
  const cardRef = useRef(null);
  const { toolCall } = request;
  const target = toolTarget(toolCall);
  const outOfProject = describeOutOfProject(request.scope);
  const options = visibleOptions(request.options, !!outOfProject);
  // See the header comment in the JSX below for why an out-of-project write
  // gets a substituted headline + target instead of the adapter's own.
  const headline =
    request.scope?.reason === 'in-project-denied'
      ? 'Write to a file that runs'
      : 'Write outside this project';
  const headerTarget = outOfProject
    ? outOfProject.paths.length === 1
      ? String(outOfProject.paths[0]).split('/').pop()
      : null
    : target;

  const firstAllow = pickDefaultAllow(options);
  const firstReject = pickDefaultReject(options);

  useEffect(() => {
    cardRef.current?.focus();
    function onKey(e) {
      if (e.key === 'Enter' && firstAllow) {
        e.preventDefault();
        onRespond(firstAllow.optionId);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onRespond(firstReject ? firstReject.optionId : 'cancelled');
      }
    }
    const el = cardRef.current;
    el?.addEventListener('keydown', onKey);
    return () => el?.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id]);

  return (
    <div
      className={'chat-perm' + (outOfProject ? ' chat-perm--outside' : '')}
      role="alertdialog"
      aria-label={
        outOfProject
          ? outOfProject.inProjectDenied
            ? 'Permission request — file that runs code'
            : 'Permission request — file outside this project'
          : 'Permission request'
      }
      tabIndex={-1}
      ref={cardRef}
      data-testid="chat-permission-prompt"
    >
      <div className="chat-perm-hd">
        {/* SECURITY (feature-acp-write-path-scope Task 4) — for an out-of-project
            write the header must NOT echo `toolCall.title`/`rawInput`. Both are
            built from the model's own path string, and the adapter passes it
            through verbatim (see acp/write-scope.ts's measured contract), so the
            title of a write to `~/.zshenv` reads literally "Write
            docs/../../../.zshenv" — a docs edit, to any human skimming the
            header. The card's whole job is to be read; a truthful body under a
            misleading headline is worse than no headline. Substitute a fixed
            label + the RESOLVED basename, and let the body carry the full path. */}
        <b title={outOfProject ? headline : toolCall?.title || 'Tool call'}>
          {outOfProject ? headline : toolCall?.title || 'Tool call'}
        </b>
        {headerTarget ? <span className="chat-tool-path">{headerTarget}</span> : null}
        {/* SECURITY (ethical-hacker finding) — a growing backlog was
            invisible (always "1 of 1"), which is what manufactures the
            reflexive-Enter-mashing precondition the wrong-default bug
            depended on. Now visible whenever more than one is queued. */}
        {queueLength > 1 ? (
          <span className="chat-perm-queue" data-testid="chat-perm-queue">
            +{queueLength - 1} more waiting
          </span>
        ) : null}
      </div>
      {outOfProject ? (
        <div className="chat-perm-outside" data-testid="chat-perm-outside">
          <p className="chat-perm-body">{outOfProject.lead}</p>
          {outOfProject.paths.length > 0 ? (
            <ul className="chat-perm-paths" data-testid="chat-perm-paths">
              {outOfProject.paths.map((p) => (
                <li key={p} className="chat-perm-path">
                  {p}
                </li>
              ))}
            </ul>
          ) : null}
          {outOfProject.scopeRoot ? (
            <p className="chat-perm-scope">
              {outOfProject.inProjectDenied ? (
                <>
                  Git hooks and Claude settings can execute code later, so Maude asks even though
                  they live inside this project.
                </>
              ) : (
                <>
                  This project is <span className="chat-perm-root">{outOfProject.scopeRoot}</span>.
                  Edits inside it never ask.
                </>
              )}
            </p>
          ) : null}
          <p className="chat-perm-note">{outOfProject.note}</p>
        </div>
      ) : (
        <p className="chat-perm-body">Claude wants permission to continue. Choose an option:</p>
      )}
      <div className="chat-perm-actions">
        {options.map((o) => (
          <button
            key={o.optionId}
            type="button"
            className={kindClass(o.kind)}
            onClick={() => onRespond(o.optionId)}
          >
            {o.name}
          </button>
        ))}
      </div>
    </div>
  );
}
