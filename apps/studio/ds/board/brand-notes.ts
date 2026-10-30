// What the Brand section says about a system's voice and rules (board 13): read from the words the
// system already carries in SKILL.md / README.md — never invented. A system that carries none draws none.

export interface BrandNotes {
  /** the one line of voice ("Quiet pro with a warm touch."), or null */
  voice: string | null;
  /** a "Say X not Y" pair, or null */
  say: { say: string; not: string } | null;
  /** "Rules for AI and code": the lead sentence of each rule under a heading that names rules */
  rules: string[];
}

const RULES_MAX = 4;
const LINE_MAX = 90;

/** Markdown out, one line of plain words. */
const plain = (s: string): string =>
  s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** The lead sentence (to the first ". "), else the text before a bracket or dash; never past LINE_MAX. */
function lead(s: string): string {
  const t = plain(s);
  const m = /^(.+?[.!?])(?:\s|$)/.exec(t);
  let out = m ? m[1] : t.replace(/\s*[(—–].*$/, '');
  if (out.length > LINE_MAX) out = `${out.slice(0, LINE_MAX - 1).trimEnd()}…`;
  return out;
}

/** A rule's bold lead when it has one ("**Three colour roles, never mixed:** …"), else its lead sentence. */
function ruleOf(it: string): string {
  const b = /^\s*\*\*(.+?)\*\*/.exec(it);
  const bold = b ? plain(b[1]).replace(/[:：.]+$/, '') : '';
  return bold.split(' ').length >= 3 ? `${bold}.` : lead(it);
}

const sentence = (s: string): string => {
  const t = s.trim();
  if (!t) return t;
  const up = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?…]$/.test(up) ? up : `${up}.`;
};

/** Body after a leading list marker, or null for a line that is not a list item. */
const item = (line: string): string | null => {
  const m = /^\s*(?:\d+[.)]|[-*•])\s+(.*)$/.exec(line);
  return m ? m[1] : null;
};

const trimQuotes = (s: string) => s.replace(/^["“]+|["”]+$/g, '').trim();

export function parseBrandNotes(skillMd: string, readmeMd: string): BrandNotes {
  const lines = `${skillMd}\n${readmeMd}`.replace(/^---\n[\s\S]*?\n---\n/, '').split(/\r?\n/);
  const rules: string[] = [];
  let voice: string | null = null;
  let say: BrandNotes['say'] = null;
  let inRules = false;
  let inVoice = false;
  for (const raw of lines) {
    const h = /^#{1,6}\s+(.*)$/.exec(raw);
    if (h) {
      inRules = /\brules?\b/i.test(h[1]);
      inVoice = /^\s*voice\b/i.test(h[1]);
      continue;
    }
    const it = item(raw);
    const body = plain(it ?? raw);
    if (!voice) {
      const v = /^voice\s*[:：]\s*(.+)$/i.exec(body);
      if (v) voice = sentence(v[1].split(/;|\. | — /)[0] ?? '');
      else if (inVoice && it === null && body && !/^say\b/i.test(body))
        voice = sentence(lead(raw).replace(/[.!?]$/, ''));
    }
    if (!say) {
      const s = /^say:?\s+(.+?)\s+(?:not|never|instead of):?\s+(.+)$/i.exec(body);
      if (s) {
        const a = trimQuotes(s[1]);
        const b = trimQuotes(s[2]);
        if (a && b) say = { say: a, not: b };
      }
    }
    // the voice rule is drawn as Voice, not twice
    if (inRules && it !== null && rules.length < RULES_MAX && !/^voice\s*[:：]/i.test(body)) {
      const r = ruleOf(it);
      if (r) rules.push(r);
    }
  }
  return { voice, say, rules };
}
