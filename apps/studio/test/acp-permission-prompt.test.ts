// SECURITY (ethical-hacker finding, retroactive review of Milestone B) —
// pure unit tests for PermissionPrompt.jsx's default-option selection. The
// bridge-side backend logic (resolvePermission's optionId validation) was
// already correct and covered by test/acp-permission.test.ts; the bug this
// covers lived entirely in the CLIENT affordance — which option Enter/the
// visually-primary button resolves to — a seam no backend test could see.

import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import PermissionPrompt, {
  describeOutOfProject,
  pickDefaultAllow,
  pickDefaultReject,
  sanitizePathForDisplay,
} from '../client/panels/PermissionPrompt.jsx';

describe('pickDefaultAllow', () => {
  test('prefers allow_once over allow_always, regardless of array order', () => {
    // Matches the REAL adapter's own ordering for a routine tool call —
    // allow_always listed BEFORE allow_once — the exact shape that made the
    // original `.find()` grab the wrong one.
    const options = [
      { optionId: 'allow-always', kind: 'allow_always', name: 'Allow always' },
      { optionId: 'allow-once', kind: 'allow_once', name: 'Allow once' },
      { optionId: 'reject-once', kind: 'reject_once', name: 'Reject' },
    ];
    expect(pickDefaultAllow(options)?.optionId).toBe('allow-once');
  });

  test('ExitPlanMode-shaped option set: prefers the once-only "manually approve edits" over auto/acceptEdits', () => {
    // Mirrors the REAL adapter's ExitPlanMode option ordering exactly (see
    // DDR-179 + the ethical-hacker finding): auto/acceptEdits (both
    // allow_always) listed BEFORE the once-only "default" option.
    const options = [
      { optionId: 'auto', kind: 'allow_always', name: 'Yes, and use auto mode' },
      { optionId: 'acceptEdits', kind: 'allow_always', name: 'Yes, and auto-accept edits' },
      { optionId: 'default', kind: 'allow_once', name: 'Yes, manually approve edits' },
      { optionId: 'plan', kind: 'reject_once', name: 'No, keep planning' },
    ];
    expect(pickDefaultAllow(options)?.optionId).toBe('default');
  });

  test('falls back to allow_always only when no once-only option exists', () => {
    const options = [
      { optionId: 'allow-always', kind: 'allow_always', name: 'Allow always' },
      { optionId: 'reject-once', kind: 'reject_once', name: 'Reject' },
    ];
    expect(pickDefaultAllow(options)?.optionId).toBe('allow-always');
  });

  test('no allow-shaped option at all → null, not a reject option', () => {
    const options = [{ optionId: 'reject-once', kind: 'reject_once', name: 'Reject' }];
    expect(pickDefaultAllow(options)).toBeNull();
  });

  test('tolerates missing/malformed input — never throws', () => {
    expect(pickDefaultAllow(undefined)).toBeNull();
    expect(pickDefaultAllow(null)).toBeNull();
    expect(
      pickDefaultAllow([null, undefined, { kind: 'allow_once', optionId: 'x' }])?.optionId
    ).toBe('x');
  });
});

describe('pickDefaultReject', () => {
  test('finds a reject_once/reject_always option regardless of position', () => {
    const options = [
      { optionId: 'allow-once', kind: 'allow_once', name: 'Allow once' },
      { optionId: 'reject-once', kind: 'reject_once', name: 'Reject' },
    ];
    expect(pickDefaultReject(options)?.optionId).toBe('reject-once');
  });

  test('no reject-shaped option → null', () => {
    expect(pickDefaultReject([{ optionId: 'allow-once', kind: 'allow_once' }])).toBeNull();
  });

  test('tolerates missing/malformed input — never throws', () => {
    expect(pickDefaultReject(undefined)).toBeNull();
    expect(pickDefaultReject(null)).toBeNull();
  });
});

// feature-acp-write-path-scope Task 4 — the out-of-project WRITE card.
//
// Same reasoning as the pickDefaultAllow suite above: the affordance IS the
// security control. A card that renders the model's own path string, or that
// still offers an "always allow", is a speed bump rather than a gate — and
// neither failure is visible to any bridge-side test.
const OUT_OF_PROJECT = {
  outOfProjectWrite: true,
  resolvedPaths: ['/Users/x/.zshenv'],
  scopeRoot: '/Users/x/git/project',
  reason: 'outside',
};

describe('describeOutOfProject', () => {
  test('absent scope → null (an ordinary permission card is unchanged)', () => {
    expect(describeOutOfProject(undefined)).toBeNull();
    expect(describeOutOfProject(null)).toBeNull();
    // A scope object that isn't explicitly flagged must NOT trigger the copy —
    // the discriminator is checked, not merely the object's presence.
    expect(describeOutOfProject({ resolvedPaths: ['/etc/passwd'] })).toBeNull();
  });

  test('carries the resolved paths + root verbatim', () => {
    const d = describeOutOfProject(OUT_OF_PROJECT);
    expect(d?.paths).toEqual(['/Users/x/.zshenv']);
    expect(d?.scopeRoot).toBe('/Users/x/git/project');
    expect(d?.lead).toContain('outside this project');
  });

  test('plural lead for a multi-target write', () => {
    const d = describeOutOfProject({ ...OUT_OF_PROJECT, resolvedPaths: ['/a', '/b'] });
    expect(d?.lead).toContain('files outside this project');
  });

  test('the fail-closed reasons get their own honest copy, not "outside"', () => {
    // `no-target` and `disagreement` are NOT "the file is outside the project" —
    // saying so would be a claim the server never made. They are "we could not
    // tell what will be written", which is a different thing to ask a human about.
    expect(describeOutOfProject({ ...OUT_OF_PROJECT, reason: 'no-target' })?.lead).toContain(
      'did not say which one'
    );
    expect(describeOutOfProject({ ...OUT_OF_PROJECT, reason: 'disagreement' })?.lead).toContain(
      'two different files'
    );
  });

  test('tolerates a malformed resolvedPaths — never throws', () => {
    expect(describeOutOfProject({ outOfProjectWrite: true })?.paths).toEqual([]);
    expect(
      describeOutOfProject({ outOfProjectWrite: true, resolvedPaths: [null, '', '/ok'] })?.paths
    ).toEqual(['/ok']);
  });
});

describe('PermissionPrompt — render', () => {
  const OPTIONS = [
    { optionId: 'allow_always', kind: 'allow_always', name: 'Always Allow' },
    { optionId: 'allow', kind: 'allow_once', name: 'Allow' },
    { optionId: 'reject', kind: 'reject_once', name: 'Reject' },
  ];
  const render = (request) =>
    renderToStaticMarkup(createElement(PermissionPrompt, { request, onRespond: () => {} }));

  test('an ORDINARY request renders the generic copy and every offered option', () => {
    const out = render({ id: '1', toolCall: { title: 'Run command' }, options: OPTIONS });
    expect(out).toContain('Claude wants permission to continue');
    expect(out).not.toContain('chat-perm-outside');
    expect(out).toContain('Always Allow');
  });

  test('an OUT-OF-PROJECT write renders the RESOLVED path, never the model string', () => {
    const out = render({
      id: '1',
      // `rawInput.file_path` is the model-authored string. It reads like a docs
      // edit; only the resolution tells the truth, so the card must show the
      // latter. Same lesson as the deep-link modal's truncated project name.
      toolCall: {
        title: 'Write docs/../../../.zshenv',
        rawInput: { file_path: 'docs/../../../.zshenv' },
      },
      options: OPTIONS,
      scope: OUT_OF_PROJECT,
    });
    expect(out).toContain('/Users/x/.zshenv');
    expect(out).not.toContain('docs/../../../.zshenv');
    expect(out).toContain('outside this project');
    expect(out).toContain('/Users/x/git/project');
  });

  test('DECISION D — the out-of-project card offers NO "always" option', () => {
    const out = render({
      id: '1',
      toolCall: { title: 'Write' },
      options: OPTIONS,
      scope: OUT_OF_PROJECT,
    });
    expect(out).not.toContain('Always Allow');
    expect(out).toContain('Allow');
    expect(out).toContain('Reject');
    expect(out).toContain('for this request only');
  });

  test('the out-of-project card is distinguishable, not just differently worded', () => {
    // A card that LOOKS identical to the routine one gets clicked through at the
    // same rate, which is the whole prompt-fatigue failure mode.
    const out = render({
      id: '1',
      toolCall: { title: 'Write' },
      options: OPTIONS,
      scope: OUT_OF_PROJECT,
    });
    expect(out).toContain('chat-perm--outside');
    expect(out).toContain('file outside this project'); // aria-label
  });
});

// SECURITY (security-auditor F3) — the resolved path's non-existent tail is
// whatever the model asked to create, so it is attacker-influenced text in the
// one card whose entire job is to be read accurately. React escapes markup; it
// does NOT neutralize bidi overrides, so a path can be made to READ as harmless
// while resolving somewhere else. Written as \u escapes on purpose: a literal
// override in this source would reorder the test file itself in every editor.
const RLO = '\u202E';
const PDF = '\u202C';

describe('sanitizePathForDisplay (F3)', () => {
  test('neutralizes bidi overrides — the visual-spoofing primitive', () => {
    const out = sanitizePathForDisplay(`/Users/x/safe/${RLO}gnp.esriv${PDF}`);
    expect(out).not.toContain(RLO);
    expect(out).not.toContain(PDF);
    // Replaced, not deleted — a tampered path should look ODD, not just shorter.
    expect(out).toContain('\uFFFD');
  });

  test('neutralizes C0 controls (newline/CR can hide a whole path segment)', () => {
    const out = sanitizePathForDisplay('/Users/x/a\nb\rc');
    expect(out).not.toMatch(/[\n\r]/);
  });

  test('also covers zero-width, directional marks and soft hyphen (F3 nit)', () => {
    // Zero-width joiners and directional marks are invisible, so they can split
    // or re-order a path name without leaving any visible trace at all — the
    // same class of trick as the overrides, just quieter.
    const sneaky = '/Users/x/\u200Bzsh\u200Cenv\u061C\u00AD';
    const out = sanitizePathForDisplay(sneaky);
    for (const ch of ['\u200B', '\u200C', '\u061C', '\u00AD']) {
      expect(out).not.toContain(ch);
    }
  });

  test('leaves an ordinary path completely untouched', () => {
    const p = '/Users/x/git/project/.design/ui/home.tsx';
    expect(sanitizePathForDisplay(p)).toBe(p);
  });

  test('describeOutOfProject sanitizes BOTH the paths and the scope root', () => {
    const d = describeOutOfProject({
      outOfProjectWrite: true,
      reason: 'outside',
      resolvedPaths: [`/Users/x/${RLO}evil`],
      scopeRoot: `/Users/x/${RLO}root`,
    });
    expect(d.paths[0]).not.toContain(RLO);
    expect(d.scopeRoot).not.toContain(RLO);
  });
});

// V2-8.9 H1 — the audience card: inside the project, so never "outside"; it names the file AI read,
// the canvas it writes and who can see that canvas.
describe('the audience card (V2-8.9 H1)', () => {
  const AUDIENCE = {
    outOfProjectWrite: true,
    resolvedPaths: ['/Users/x/p/.design/ui/Campaign.tsx'],
    scopeRoot: '/Users/x/p',
    reason: 'audience',
    audience: { canvas: 'ui/Campaign.tsx', who: ['Grace'], sources: ['ui/Pricing-internal.tsx'] },
  };
  test('the lead names source, canvas and who — and never says "outside"', () => {
    const d = describeOutOfProject(AUDIENCE);
    expect(d?.lead).toBe(
      'This may put text from Pricing-internal.tsx into Campaign.tsx, which Grace can also see.'
    );
    expect(d?.lead).not.toContain('outside');
    expect(d?.audience).toBe(true);
  });
  test('the rendered card: its own headline, no "always allow"', () => {
    const html = renderToStaticMarkup(
      createElement(PermissionPrompt, {
        request: {
          id: 'p1',
          toolCall: { title: 'Edit ui/Campaign.tsx' },
          options: [
            { optionId: 'allow_always', name: 'Always Allow', kind: 'allow_always' },
            { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
          ],
          scope: AUDIENCE,
        },
        onRespond: () => {},
      })
    );
    expect(html).toContain('Write to a canvas others can see');
    expect(html).not.toContain('Always Allow');
    expect(html).not.toContain('outside this project');
  });
  test('names are sanitised; a long list is cut', () => {
    const d = describeOutOfProject({
      ...AUDIENCE,
      audience: {
        canvas: `ui/${RLO}x.tsx`,
        who: ['A', 'B', 'C', 'D'],
        sources: ['a', 'b', 'c', 'd'],
      },
    });
    expect(d?.lead).not.toContain(RLO);
    expect(d?.lead).toContain('and other files');
    expect(d?.lead).toContain('and others');
  });
  test('audience-unknown has its own words', () => {
    expect(describeOutOfProject({ ...AUDIENCE, reason: 'audience-unknown' })?.lead).toContain(
      'couldn’t check who can see'
    );
  });
});
