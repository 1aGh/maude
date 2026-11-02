// The directions of a system being made, as the Design system canvas draws them (S10.16b, 13 · ds-make-directions).
//
// Server half (reads `revisions/head.json` `drafts[]` + each draft's immutable revision): a direction is a DRAFT
// revision on the same system (Q8), so there is nothing to store — the tile is derived from the draft's own tokens
// each time the model is built. Only the handful of values a tile draws are kept (the model is inlined into the
// canvas module), every one re-checked as a plain CSS value: a draft is data written by an agent (DDR-172 D8).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TOKENS_JSON_KEY } from '../engine.ts';
import { parseSystem, type TokenModel } from '../generate.ts';
import { readHead } from '../head.ts';
import { type RevisionBody, verifyRevision } from '../revision.ts';
import type { SystemConfig } from '../system.ts';
import { type BoardDirection, safeCssName, safeCssValue } from './types.ts';

/** The tokens a direction tile is drawn from (a name the draft lacks is simply not set). */
export const TILE_VARS = [
  '--bg-0',
  '--bg-1',
  '--bg-2',
  '--fg-0',
  '--fg-1',
  '--fg-2',
  '--border',
  '--accent',
  '--accent-fg',
  '--accent-soft',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--font-display',
  '--font-body',
  '--display-weight',
] as const;

/** At most this many directions travel with the board. */
export const DIRECTIONS_MAX = 6;

const readText = (abs: string): string | null => {
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
};

/** `var(--x)` references resolved against the direction's own tokens, a few levels deep. */
function resolveVars(model: TokenModel, theme: string, raw: string, depth = 0): string {
  if (depth > 4) return raw;
  return raw.replace(/var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,[^)]*)?\)/g, (whole, name: string) => {
    const t = model.tokens[name];
    const v = t?.values[theme] ?? t?.values[model.defaultTheme];
    return v ? resolveVars(model, theme, v, depth + 1) : whole;
  });
}

const firstFamily = (v: string | undefined): string => {
  if (!v) return '';
  const first =
    v
      .split(',')[0]
      ?.trim()
      .replace(/^["']|["']$/g, '') ?? '';
  return /^(system-ui|ui-sans-serif|-apple-system|sans-serif)$/i.test(first)
    ? 'System sans'
    : first.slice(0, 40);
};

/** "cool white · azure · New York" — the colours' own names and the headline face, whatever the draft names. */
function moodOf(model: TokenModel, light: string): string {
  const name = (css: string) => {
    const n = (model.tokens[css]?.data?.valueNames as Record<string, unknown> | undefined)?.[light];
    return typeof n === 'string' ? n.trim().slice(0, 32) : '';
  };
  const face = firstFamily(
    model.tokens['--font-display']?.values[light] ?? model.tokens['--font-body']?.values[light]
  );
  return [name('--bg-0'), name('--accent'), face].filter(Boolean).join(' · ');
}

export function directionsOf(
  designRoot: string,
  sys: SystemConfig,
  themes: string[],
  defaultTheme: string,
  lightTheme: string
): { making: boolean; directions: BoardDirection[] } {
  const dsAbs = path.join(designRoot, sys.path);
  const head = readHead(dsAbs);
  if (head.state !== 'ok') return { making: false, directions: [] };
  const making = head.doc.head === null && head.doc.base === null;
  const tokensKey = path.posix.relative(sys.path, sys.tokensCssRel);
  const working = readText(path.join(dsAbs, tokensKey));
  const out: BoardDirection[] = [];
  for (const d of head.doc.drafts) {
    if (out.length >= DIRECTIONS_MAX) break;
    if (typeof d.direction !== 'string' || !/^[a-z]{1,8}$/.test(d.direction)) continue;
    const text = readText(path.join(dsAbs, 'revisions', `${d.rev}.json`));
    if (text === null) continue; // it has not arrived on this Mac yet
    const v = verifyRevision(d.rev, text);
    if (!v.ok) continue;
    const files = (v.body as RevisionBody).files;
    let model: TokenModel;
    try {
      model = parseSystem({
        config: {
          name: sys.name,
          rootClass: sys.rootClass,
          themes: sys.themes,
          defaultTheme: sys.themeDefault,
          colorSpace: sys.colorSpace,
        },
        tokensCss: files[tokensKey]?.text ?? null,
        tokensJson: files[TOKENS_JSON_KEY]?.text ?? null,
      });
    } catch {
      continue; // a draft whose CSS does not parse is not drawn
    }
    const vars: Record<string, Record<string, string>> = {};
    for (const theme of themes) {
      const row: Record<string, string> = {};
      for (const css of TILE_VARS) {
        const t = model.tokens[css];
        const raw = t?.values[theme] ?? t?.values[defaultTheme];
        if (!raw) continue;
        const value = resolveVars(model, theme, raw);
        if (safeCssName(css) && safeCssValue(value)) row[css] = value.trim();
      }
      vars[theme] = row;
    }
    out.push({
      direction: d.direction,
      label:
        typeof d.label === 'string' && d.label
          ? d.label.slice(0, 64)
          : `Direction ${d.direction.toUpperCase()}`,
      mood: moodOf(model, lightTheme),
      picked: working !== null && files[tokensKey]?.text === working,
      vars,
    });
  }
  out.sort((a, b) => a.direction.localeCompare(b.direction));
  return { making, directions: out };
}
