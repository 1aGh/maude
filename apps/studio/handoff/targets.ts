// handoff/targets.ts — S8.10: where the code goes (09 Export · ex-handoff, ex-handoff-ready).
//
// The targets come from the project's settings: `.design/config.json` → `handoff.targets[]`
// (additive, V2-1.12 config row; absent = the four defaults below). Each target is one KIND of
// result — a shadcn registry item for the web, a React Native component, a Lottie animation, or the
// design system's tokens — and the ONE repo-relative file the AI run may write (`out`). Pure: the
// route (routes/handoff.ts) reads the config and the canvas; the sheet reads what the route answers.
//
// The commands under Advanced are today's, unchanged: `/design:handoff`, `/design:to-rn`,
// `/design:to-lottie`, and the `maude design handoff` verb.

export type HandoffKind = 'web' | 'rn' | 'lottie' | 'tokens';
export const HANDOFF_KINDS: readonly HandoffKind[] = ['web', 'rn', 'lottie', 'tokens'];

export interface HandoffTarget {
  /** stable id, kebab (config rows name it; the last-used marker keeps it) */
  id: string;
  kind: HandoffKind;
  /** the option's title, e.g. "Studio web" */
  title: string;
  /** one line under the title */
  sub: string;
  /**
   * The file the run writes, repo-relative, with `{Name}` (PascalCase canvas name), `{slug}`, `{ds}`
   * and `{designRel}` filled in. `web` ignores it: the registry item sits next to the canvas
   * (`maude design handoff` writes `<canvas>.registry.json`).
   */
  out: string | null;
}

/** What is handed off: a canvas (designRoot-relative `.tsx`), or a design system's tokens. */
export interface HandoffSubject {
  canvas?: string | null;
  ds?: string | null;
}

export const DEFAULT_TARGETS: readonly HandoffTarget[] = Object.freeze([
  {
    id: 'web',
    kind: 'web',
    title: 'Web',
    sub: 'Web components — a shadcn registry item',
    out: null,
  },
  {
    id: 'app',
    kind: 'rn',
    title: 'App',
    sub: 'A React Native component',
    out: 'src/components/{Name}.tsx',
  },
  {
    id: 'lottie',
    kind: 'lottie',
    title: 'Lottie animation',
    sub: 'For motion',
    out: '{designRel}/assets/{slug}.json',
  },
  {
    id: 'tokens',
    kind: 'tokens',
    title: 'Design tokens',
    sub: 'Colours, type and spacing as CSS variables',
    out: 'src/styles/{ds}-tokens.css',
  },
]);

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_TARGETS = 12;
const clip = (v: unknown, n: number) =>
  typeof v === 'string'
    ? v
        // biome-ignore lint/suspicious/noControlCharactersInRegex: strips control characters on purpose
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .trim()
        .slice(0, n)
    : '';

/**
 * A repo-relative path a run may write: relative, `/`-separated, no `..`, no empty or hidden
 * segment (no `.git/`, `.claude/`, `.env`…) except the design root itself, never a runtime `_*`
 * folder of the design root other than its versioned `assets/`.
 */
export function isSafeOutRel(p: string, designRel = '.design'): boolean {
  if (typeof p !== 'string' || !p || p.length > 300) return false;
  if (p.startsWith('/') || p.includes('\\') || /^[A-Za-z]:/.test(p)) return false;
  const segs = p.split('/');
  const design = designRel.split('/').filter(Boolean);
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i] ?? '';
    if (!s || s === '.' || s === '..') return false;
    if (s.startsWith('.') && !(i < design.length && s === design[i])) return false;
    // biome-ignore lint/suspicious/noControlCharactersInRegex: strips control characters on purpose
    if (/[\u0000-\u001f\u007f]/.test(s)) return false;
  }
  const inDesign = design.length > 0 && design.every((d, i) => segs[i] === d);
  if (inDesign && (segs[design.length] ?? '').startsWith('_')) return false;
  return /\.[A-Za-z0-9]{1,8}$/.test(p);
}

/** `handoff.targets[]` from a parsed `config.json`; a bad row is dropped, none left = the defaults. */
export function targetsFromConfig(config: unknown, designRel = '.design'): HandoffTarget[] {
  const cfg = config as { handoff?: { targets?: unknown }; handoffTargets?: unknown } | null;
  let raw = cfg?.handoff?.targets;
  // the v1 `handoffTargets[]` ({label, path, platform}) still names targets when the v2 key is absent:
  // `registry:item` / web → the registry item, mobile → the app component, its label the title
  if (!Array.isArray(raw) && Array.isArray(cfg?.handoffTargets) && cfg.handoffTargets.length) {
    raw = (cfg.handoffTargets as Array<Record<string, unknown>>).map((t) => ({
      kind:
        t?.path === 'registry:item' || t?.platform === 'web'
          ? 'web'
          : t?.platform === 'mobile'
            ? 'rn'
            : null,
      title: t?.label,
    }));
  }
  if (!Array.isArray(raw)) return DEFAULT_TARGETS.map((t) => ({ ...t }));
  const out: HandoffTarget[] = [];
  const seen = new Set<string>();
  for (const row of raw.slice(0, MAX_TARGETS)) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const kind = r.kind as HandoffKind;
    if (!HANDOFF_KINDS.includes(kind)) continue;
    const id = typeof r.id === 'string' && ID_RE.test(r.id) ? r.id : kind;
    if (seen.has(id)) continue;
    const def = DEFAULT_TARGETS.find((t) => t.kind === kind) as HandoffTarget;
    const outRaw = typeof r.out === 'string' ? r.out.trim() : '';
    const probe = fillOut(outRaw, { Name: 'X', slug: 'x', ds: 'x', designRel });
    out.push({
      id,
      kind,
      title: clip(r.title, 60) || def.title,
      sub: clip(r.sub, 140) || def.sub,
      out: kind === 'web' ? null : outRaw && isSafeOutRel(probe, designRel) ? outRaw : def.out,
    });
    seen.add(id);
  }
  return out.length ? out : DEFAULT_TARGETS.map((t) => ({ ...t }));
}

export function kebab(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function pascal(s: string): string {
  const p = kebab(s)
    .split('-')
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join('');
  return /^[A-Za-z]/.test(p) ? p : `C${p}`;
}

function fillOut(tpl: string, v: { Name: string; slug: string; ds: string; designRel: string }) {
  return tpl
    .replace(/\{Name\}/g, v.Name)
    .replace(/\{slug\}/g, v.slug)
    .replace(/\{ds\}/g, v.ds)
    .replace(/\{designRel\}/g, v.designRel);
}

const stem = (canvas: string) => (canvas.split('/').pop() ?? canvas).replace(/\.(tsx|jsx)$/, '');

/** The display name of what is handed off ("Pricing", or the system's name). */
export function subjectName(subject: HandoffSubject): string {
  if (subject.canvas) return stem(subject.canvas);
  return subject.ds ?? '';
}

/**
 * The ONE file the run writes, repo-relative — or null when this target cannot take this subject
 * (tokens need a design system; the others need a canvas) or the result would be unsafe.
 */
export function outPathFor(
  target: HandoffTarget,
  subject: HandoffSubject,
  designRel = '.design'
): string | null {
  const canvas = subject.canvas ?? null;
  if (target.kind === 'tokens') {
    if (!subject.ds) return null;
  } else if (!canvas || !/\.tsx$/.test(canvas)) return null;
  let rel: string;
  if (target.kind === 'web') {
    rel = `${designRel}/${(canvas as string).replace(/\.tsx$/, '.registry.json')}`;
  } else {
    const name = canvas ? stem(canvas) : (subject.ds ?? '');
    rel = fillOut(target.out ?? '', {
      Name: pascal(name),
      slug: kebab(name) || 'handoff',
      ds: kebab(subject.ds ?? '') || 'system',
      designRel,
    });
  }
  // the registry item is a versioned sidecar next to the canvas; every other target is checked whole
  if (target.kind === 'web') return /(^|\/)\.\.(\/|$)/.test(rel) ? null : rel;
  return isSafeOutRel(rel, designRel) ? rel : null;
}

/** Does this canvas have a frame that moves (what a Lottie animation is made from)? */
export function hasAnimatedFrame(source: string): boolean {
  return (
    /@keyframes\s/.test(source) ||
    /from\s+['"]motion(\/react)?['"]/.test(source) ||
    /\bkind\s*=\s*["'](video|motion)["']/.test(source) ||
    /\buseCurrentFrame\s*\(/.test(source) ||
    /\banimation\s*:\s*['"`][^'"`]*\d/.test(source)
  );
}

export interface ReadyLine {
  /** the small label next to a line under Advanced: "Any machine", "This Mac only", "Claude Code", "Terminal" */
  note: string;
  text: string;
}

export interface ReadyFacts {
  /** the one primary button's words */
  copyLabel: 'Copy command' | 'Copy code';
  /** what that button copies; null for "Copy code" until the run wrote the file (the client reads it) */
  copy: string | null;
  /** "Writes <out>" under Advanced (repo-relative), null for the registry item (its lines say where) */
  writes: string | null;
  /** a snippet shown under Advanced (the Lottie view) */
  snippet: string | null;
  lines: ReadyLine[];
}

/**
 * What the ready card shows (ex-handoff-ready): one thing to copy, and under Advanced the file, the
 * Claude Code command and the terminal verb. `registryUrl` is the cloud address of the registry item
 * (`…/r/<name>.json`) — only for a linked project whose cell serves it (S8 Q12); otherwise the web
 * result copies the `file://` command, which works on this Mac only.
 */
export function readyFacts(
  target: HandoffTarget,
  subject: HandoffSubject,
  o: { designRel: string; repoRoot: string; outRel: string; registryUrl: string | null }
): ReadyFacts {
  const canvas = subject.canvas ?? '';
  const canvasRepoRel = canvas ? `${o.designRel}/${canvas}` : '';
  const abs = `${o.repoRoot.replace(/\/$/, '')}/${o.outRel}`;
  switch (target.kind) {
    case 'web': {
      const fileCmd = `bunx shadcn add file://${abs}`;
      const urlCmd = o.registryUrl ? `bunx shadcn add ${o.registryUrl}` : null;
      return {
        copyLabel: 'Copy command',
        copy: urlCmd ?? fileCmd,
        writes: null,
        snippet: null,
        lines: [
          ...(urlCmd ? [{ note: 'Any machine', text: urlCmd }] : []),
          { note: 'This Mac only', text: fileCmd },
          { note: 'Claude Code', text: `/design:handoff ${canvas}` },
          { note: 'Terminal', text: `maude design handoff ${canvasRepoRel} ${o.designRel}` },
        ],
      };
    }
    case 'rn':
      return {
        copyLabel: 'Copy code',
        copy: null,
        writes: o.outRel,
        snippet: null,
        lines: [{ note: 'Claude Code', text: `/design:to-rn "${canvas}" --out ${o.outRel}` }],
      };
    case 'lottie': {
      const file = o.outRel.split('/').pop() ?? o.outRel;
      const snippet = `<LottieView\n  source={require("./${file}")}\n  autoPlay loop />`;
      return {
        copyLabel: 'Copy code',
        copy: snippet,
        writes: o.outRel,
        snippet,
        lines: [{ note: 'Claude Code', text: `/design:to-lottie "${canvas}" --verify` }],
      };
    }
    default:
      return {
        copyLabel: 'Copy code',
        copy: null,
        writes: o.outRel,
        snippet: null,
        lines: [
          {
            note: 'From',
            text: `${o.designRel}/system/${subject.ds ?? ''}/colors_and_type.css`,
          },
        ],
      };
  }
}
