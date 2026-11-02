// Full-text search over the chat store (S5.7): title + body, accent-folded, with a
// highlighted snippet per hit. Reads `<designRoot>/_chat/*.jsonl` through the bounded
// tail reader — a transcript's size must not decide the cost of searching it (#119).
//
// "Body" is what the person would call the conversation: their messages (the attached
// context block stripped) and the assistant's text. Tool calls, thoughts and the
// bootstrap brief are not searched.

import { join } from 'node:path';

import { listSearchableChats, stripContextBlock } from './transcript.ts';
import { readTailLines } from './transcript-io.ts';

/** How much of one transcript's tail search will look at. */
export const SEARCH_SCAN_BYTES = 2 * 1024 * 1024;
/** Longest body (chars) kept per chat — a runaway transcript still costs a fixed amount. */
const MAX_BODY_CHARS = 400_000;
const MAX_TERMS = 8;
const MAX_HITS = 50;
/** Snippet window around the first match, in characters of the original text. */
const BEFORE = 40;
const AFTER = 70;

export type Range = [start: number, end: number];

export interface ChatSearchHit {
  id: string;
  title: string;
  updated: number;
  canvas?: string;
  archived?: boolean;
  /** Where the query matched inside `title` (empty when it only matched the body). */
  titleRanges: Range[];
  /** The body around the first match, with the matched words' ranges; `null` when the
   *  query matched only the title. */
  snippet: { text: string; ranges: Range[] } | null;
  /** Occurrences of the query's words in the body. */
  matches: number;
}

interface Folded {
  text: string;
  /** folded index → index in the original; `null` = identical (pure ASCII) */
  map: number[] | null;
}

function isAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) return false;
  return true;
}

/** Lower-case and strip accents, remembering where each folded char came from so a match
 *  can be shown on the ORIGINAL text. */
export function fold(s: string): Folded {
  if (isAscii(s)) return { text: s.toLowerCase(), map: null };
  let text = '';
  const map: number[] = [];
  for (let i = 0; i < s.length; ) {
    const cp = s.codePointAt(i) as number;
    const ch = String.fromCodePoint(cp);
    const f =
      cp < 128 ? ch.toLowerCase() : ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (let k = 0; k < f.length; k++) map.push(i);
    text += f;
    i += ch.length;
  }
  return { text, map };
}

/** Index of the folded char `fi` in the original (`fi === length` = the original's end). */
function toOriginal(f: Folded, fi: number, originalLength: number): number {
  if (!f.map) return fi;
  return fi >= f.map.length ? originalLength : (f.map[fi] as number);
}

/** The search terms of a query: folded, deduped, at most `MAX_TERMS`. */
export function queryTerms(q: string): string[] {
  const terms = fold(q.normalize('NFC')).text.split(/\s+/).filter(Boolean);
  return [...new Set(terms)].slice(0, MAX_TERMS);
}

/** Every [start,end) of any term in the folded text, merged and sorted. */
function occurrences(folded: string, terms: string[], from = 0, to = folded.length): Range[] {
  const out: Range[] = [];
  for (const t of terms) {
    let i = folded.indexOf(t, from);
    while (i !== -1 && i + t.length <= to) {
      out.push([i, i + t.length]);
      i = folded.indexOf(t, i + t.length);
    }
  }
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Range[] = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** The conversation text of one transcript: user turns and assistant text, in order. */
function readBody(file: string): string {
  const { lines } = readTailLines(file, SEARCH_SCAN_BYTES);
  const parts: string[] = [];
  let inAgentRun = false;
  for (const raw of lines) {
    // A cheap substring test first: most lines are tool plumbing, and parsing them is the cost.
    const isUser = raw.includes('"role":"user"');
    if (!isUser && !raw.includes('agent_message_chunk')) continue;
    let line: Record<string, unknown>;
    try {
      line = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (line.role === 'user' && typeof line.text === 'string') {
      parts.push(stripContextBlock(line.text));
      inAgentRun = false;
      continue;
    }
    const update = line.update as {
      sessionUpdate?: string;
      content?: { type?: string; text?: unknown };
    };
    if (line.role !== 'agent' || update?.sessionUpdate !== 'agent_message_chunk') continue;
    const text = update.content?.type === 'text' ? update.content.text : null;
    if (typeof text !== 'string') continue;
    if (inAgentRun) parts[parts.length - 1] += text;
    else parts.push(text);
    inAgentRun = true;
  }
  const body = parts.join('\n');
  return body.length > MAX_BODY_CHARS ? body.slice(body.length - MAX_BODY_CHARS) : body;
}

function snippetOf(body: string, folded: Folded, terms: string[]) {
  const first = occurrences(folded.text, terms)[0];
  if (!first) return null;
  const fs = Math.max(0, first[0] - BEFORE);
  const fe = Math.min(folded.text.length, first[1] + AFTER);
  const os = toOriginal(folded, fs, body.length);
  const oe = toOriginal(folded, fe, body.length);
  // Newlines read as spaces in a one-line snippet; same length, so the ranges stay true.
  const core = body.slice(os, oe).replace(/\s/g, ' ');
  const lead = os > 0 ? '…' : '';
  const tail = oe < body.length ? '…' : '';
  const ranges = occurrences(folded.text, terms, fs, fe).map(
    ([a, b]): Range => [
      toOriginal(folded, a, body.length) - os + lead.length,
      toOriginal(folded, b, body.length) - os + lead.length,
    ]
  );
  return { text: `${lead}${core}${tail}`, ranges };
}

/**
 * Chats whose title or body contains every word of `query`, folded for case and accents.
 * A title hit ranks above a body-only hit; ties go to the most recently updated. Chats in
 * the trash are not searched; archived ones are (and say so).
 */
export function searchChats(designRoot: string, query: string, limit = MAX_HITS): ChatSearchHit[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const hits: Array<ChatSearchHit & { inTitle: boolean }> = [];
  for (const chat of listSearchableChats(designRoot)) {
    const titleFolded = fold(chat.title);
    const titleHas = terms.map((t) => titleFolded.text.includes(t));
    const body = readBody(join(designRoot, '_chat', `${chat.id}.jsonl`));
    const bodyFolded = fold(body);
    const bodyHas = terms.map((t) => bodyFolded.text.includes(t));
    // Every word must turn up somewhere in the chat — title or body.
    if (!terms.every((_, i) => titleHas[i] || bodyHas[i])) continue;
    const titleRanges = occurrences(titleFolded.text, terms).map(
      ([a, b]): Range => [
        toOriginal(titleFolded, a, chat.title.length),
        toOriginal(titleFolded, b, chat.title.length),
      ]
    );
    const snippet = bodyHas.some(Boolean) ? snippetOf(body, bodyFolded, terms) : null;
    hits.push({
      id: chat.id,
      title: chat.title,
      updated: chat.updated,
      ...(chat.canvas ? { canvas: chat.canvas } : {}),
      ...(chat.archived ? { archived: true } : {}),
      titleRanges,
      snippet,
      matches: occurrences(bodyFolded.text, terms).length,
      inTitle: titleRanges.length > 0,
    });
  }
  hits.sort((a, b) => Number(b.inTitle) - Number(a.inTitle) || b.updated - a.updated);
  return hits.slice(0, limit).map(({ inTitle: _t, ...h }) => h);
}
