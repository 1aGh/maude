// client/v2/assets/generate-ask.jsx — Assets › Generate: the ask (S8.16; 12 · ia-gen-ask, ia-gen-placed).
//
// Say the picture; the selected artboard decides the shape (Gameweek 5 is 4:5, so the takes are 4:5). Before anything
// is sent the studio quotes the run (`POST /_api/generate-takes/quote`): one line says how long and whose account pays,
// one line covers the licence. Generate hands that single-use quote back (`POST /_api/generate-takes`) — no quote, no
// egress; the server refuses without it. When the takes are in, the best one (the first good take) is placed through
// `placeAsset` — empty frames first, the studio picks — and selected; the others stay in Assets and ← → swaps them in.
//
// The model select lives under Advanced (Gate 0 D14). The earlier Generate dialog (provider · model · aspect, video and
// sound too) is re-homed there as "Video or sound…": nothing it did is lost. Nothing here throws.

import { useEffect, useRef, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { placeAsset } from './place-asset.js';
import { primeTakes } from './takes.js';
import { reasonProps } from '../access/disabled-reason.js';
import ConnectKeySheet, { KEY_WORDS } from './connect-key-sheet.jsx';

const NUMBER = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
export const COUNTS = Object.freeze([1, 2, 3, 4]);
export const COUNT_DEFAULT = 4;
const POLL_MS = 1500;
const POLL_LIMIT_MS = 10 * 60 * 1000;
// p8-ia-edges — while a prompt waits for the key the ask looks at which keys are connected this often, for this long
const KEY_POLL_MS = 2000;
const KEY_WAIT_LIMIT_MS = 10 * 60 * 1000;

export const ASK_WORDS = {
  title: 'Generate an image',
  hint: (n) =>
    n > 1
      ? `Describe what should be in the picture. AI makes ${NUMBER[n] ?? n} takes in the artboard's shape and puts the best one in the frame; the others are one key away.`
      : "Describe what should be in the picture. AI makes it in the artboard's shape and puts it in the frame.",
  noTarget: 'Select an artboard first — it sets the picture’s shape.',
  // the calm line under the prompt before an artboard is chosen (12 · ia-gen-ask: the shape chip names the artboard instead)
  needTarget: 'The selected artboard sets the picture’s shape.',
  noProvider: 'No image provider is ready. Add a key in Settings › Connections.',
  noConsent: 'The line above changed. Check it, then press Generate again.',
  busy: 'AI is busy with other pictures. Try again in a moment.',
  failed: 'No take came back. Try again, or change the words.',
  making: (n) => (n > 1 ? `Making ${n} takes…` : 'Making the picture…'),
  // p8-lock-reasons — Generate's reason while the price is being worked out, and before any words
  quoting: 'Working out the price…',
  noWords: 'Describe the picture first.',
  generate: 'Generate',
  cancel: 'Cancel',
  advanced: 'Advanced',
  model: 'Model',
  other: 'Video or sound…',
};

/**
 * p8-lock-reasons — why Generate is off, in the line the person is shown: what it is waiting for first (a picture
 * being made, the key being connected), then what the quote lacks (an artboard, the price), then the words.
 */
export function goReason({ quote, needsKey, err, target, prompt, making, keyStep }) {
  if (making > 0) return ASK_WORDS.making(making);
  if (keyStep === 'waiting') return KEY_WORDS.waiting;
  if (!quote && !needsKey) return err || (target ? ASK_WORDS.quoting : ASK_WORDS.noTarget);
  if (!String(prompt ?? '').trim()) return ASK_WORDS.noWords;
  return '';
}

/** "4 variants" — the count chip (ia-gen-ask). */
export const countLabel = (n) => (n === 1 ? '1 variant' : `${n} variants`);

/**
 * The toast after placing: "Placed take 3 in Gameweek 5. The other three are in Assets › Generated."
 * @param {number} index 0-based take in the frame  @param {number} of how many came back  @param {string | null} where
 */
export function placedLine(index, of, where) {
  const into = where ? ` in ${where}` : '';
  const others = of - 1;
  if (others <= 0) return `Placed the picture${into}.`;
  const rest =
    others === 1
      ? 'The other one is in Assets › Generated.'
      : `The other ${NUMBER[others] ?? others} are in Assets › Generated.`;
  return `Placed take ${index + 1}${into}. ${rest}`;
}

const post = async (get, url, body) => {
  const r = await get(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => null);
  return { status: r.status, j };
};

/**
 * Ask the studio for the consent quote.
 * `noProvider` marks the one refusal that is a question for the person, not an error: no image key is connected.
 * @returns {Promise<{ ok: true, quote: object } | { ok: false, message: string, noProvider?: true }>}
 */
export async function askQuote(target, { n, provider, model } = {}, opts = {}) {
  const get = opts.fetch ?? globalThis.fetch;
  if (!target?.canvas || !target?.artboardId) return { ok: false, message: ASK_WORDS.noTarget };
  try {
    const body = { canvas: target.canvas, artboard: target.artboardId, n };
    if (provider) body.provider = provider;
    if (model) body.model = model;
    const { status, j } = await post(get, '/_api/generate-takes/quote', body);
    if (status === 409 && j?.reason === 'no-provider')
      return { ok: false, message: ASK_WORDS.noProvider, noProvider: true };
    if (!j?.ok || typeof j.quote !== 'string')
      return { ok: false, message: j?.message ?? ASK_WORDS.failed };
    return { ok: true, quote: j };
  } catch {
    return { ok: false, message: 'The studio could not be reached; try again.' };
  }
}

/**
 * Generate with the quote, wait for the takes, place the best, select it.
 * @returns {Promise<{ ok: true, line: string, best: string, takes: string[] } | { ok: false, message: string, requote?: boolean }>}
 */
export async function runGenerate(
  { target, quote, prompt, where },
  { fetch: f, record, select, sleep, now } = {}
) {
  const get = f ?? globalThis.fetch;
  const wait = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const clock = now ?? Date.now;
  let start;
  try {
    start = await post(get, '/_api/generate-takes', {
      quote: quote.quote,
      canvas: target.canvas,
      artboard: target.artboardId,
      prompt,
      provider: quote.provider,
      model: quote.model,
      n: quote.n,
      aspect: quote.aspect,
    });
  } catch {
    return { ok: false, message: 'The studio could not be reached; try again.' };
  }
  if (start.status === 409 && start.j?.reason === 'no-consent')
    return { ok: false, message: ASK_WORDS.noConsent, requote: true };
  if (start.status === 429) return { ok: false, message: ASK_WORDS.busy };
  if (!start.j?.ok || typeof start.j.group !== 'string')
    return { ok: false, message: start.j?.message ?? ASK_WORDS.failed };
  const q = new URLSearchParams({ group: start.j.group, canvas: target.canvas });
  const until = clock() + POLL_LIMIT_MS;
  let g = null;
  while (clock() < until) {
    try {
      const r = await get(`/_api/generate-takes?${q}`);
      const j = await r.json().catch(() => null);
      if (j?.ok && j.status !== 'running') {
        g = j;
        break;
      }
    } catch {
      /* the next poll */
    }
    await wait(POLL_MS);
  }
  if (!g || g.status !== 'done' || typeof g.best !== 'string')
    return { ok: false, message: g?.error ? `${ASK_WORDS.failed} (${g.error})` : ASK_WORDS.failed };
  const takes = Array.isArray(g.takes) ? g.takes : [g.best];
  primeTakes(target.canvas, takes, {
    prompt,
    provider: g.provider ?? quote.provider,
    model: g.model ?? quote.model,
    at: g.at ?? null,
  });
  const placed = await placeAsset({ asset: g.best, target, mode: 'auto' }, { fetch: get, record });
  if (!placed.ok) return { ok: false, message: placed.message };
  if (placed.created[0]) select?.(placed.created[0]);
  return {
    ok: true,
    best: g.best,
    takes,
    line: placedLine(Math.max(0, takes.indexOf(g.best)), takes.length, where),
  };
}

/** The two prompt starters the board's chat offers (12 · ia-gen-ask `ia-chat-sugg`). */
export const SUGGESTIONS = Object.freeze(['Use our photos as a style', 'Daylight instead']);

/**
 * The ask, in the Assets tab.
 * `onConnectKey` opens the one key flow (Settings › Connections); `keyPollMs` is the wait between looks at the
 * connected keys while a prompt waits for one (tests).
 * @param {{ target: object | null, where: string | null, onClose: () => void, onRecord?: (p: object) => void,
 *   onSelect?: (created: { artboard: string, element: string }) => void, onDone?: (line: string) => void,
 *   onOther?: () => void, onConnectKey?: () => void, keyPollMs?: number, fetchImpl?: typeof fetch }} p
 */
export function GenerateAsk({
  target,
  where,
  onClose,
  onRecord,
  onSelect,
  onDone,
  onOther,
  onConnectKey,
  keyPollMs = KEY_POLL_MS,
  fetchImpl,
}) {
  const [prompt, setPrompt] = useState('');
  const [n, setN] = useState(COUNT_DEFAULT);
  const [model, setModel] = useState(null);
  const [quote, setQuote] = useState(null);
  const [err, setErr] = useState('');
  const [making, setMaking] = useState(0);
  // p8-ia-edges (ia-edges H): no image key → Generate asks "Connect a Google key?" and the prompt waits for it.
  // needsKey: the last quote was refused for want of a key · keyStep: idle | ask (the sheet) | waiting (key flow open)
  const [needsKey, setNeedsKey] = useState(false);
  const [keyStep, setKeyStep] = useState('idle');
  const waitingPrompt = useRef('');
  const alive = useRef(true);
  const seq = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const canvas = target?.canvas ?? null;
  const artboard = target?.artboardId ?? null;
  const requote = async () => {
    const mine = ++seq.current;
    setQuote(null);
    setNeedsKey(false);
    if (!canvas || !artboard) {
      // 12 · ia-gen-ask — nothing is wrong yet: the line below the prompt says what sets the shape, calmly
      setErr('');
      return;
    }
    const r = await askQuote(
      target,
      { n, model: model ?? undefined, provider: quote?.provider },
      { fetch: fetchImpl }
    );
    if (!alive.current || mine !== seq.current) return;
    if (r.ok) {
      setQuote(r.quote);
      setErr('');
    } else if (r.noProvider) {
      // not an error: Generate answers with the key sheet (ia-edges H)
      setNeedsKey(true);
      setErr('');
    } else setErr(r.message);
    return r;
  };
  // a fresh quote for every shape, count and model: the line the person reads is the one that is sent
  // biome-ignore lint/correctness/useExhaustiveDependencies: requote reads the same inputs
  useEffect(() => {
    void requote();
  }, [canvas, artboard, n, model]);

  const generate = async () => {
    if (!prompt.trim() || making > 0 || keyStep !== 'idle') return;
    if (!quote) {
      // no key connected: ask, once per press, with the person's words kept for the key (never a silent no-op)
      if (needsKey) {
        waitingPrompt.current = prompt.trim();
        setKeyStep('ask');
      }
      return;
    }
    await run(quote, prompt.trim());
  };

  const run = async (used, words) => {
    setMaking(used.n || n);
    setErr('');
    setQuote(null); // a quote is single-use
    const r = await runGenerate(
      { target, quote: used, prompt: words, where },
      { fetch: fetchImpl, record: onRecord, select: onSelect }
    );
    if (!alive.current) return;
    setMaking(0);
    if (r.ok) {
      onDone?.(r.line);
      onClose();
      return;
    }
    setErr(r.message);
    void requote();
  };

  // The key flow is open and the prompt is waiting: look at the connected keys; when they change, ask for a quote
  // again — and when one comes, run the waiting prompt, once. Closing the ask (unmount) or Cancel stops the looking.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the loop reads the inputs it was started with
  useEffect(() => {
    if (keyStep !== 'waiting') return undefined;
    let stop = false;
    const get = fetchImpl ?? globalThis.fetch;
    const connected = async () => {
      try {
        const r = await get('/_api/generate/keys', { cache: 'no-store' });
        const j = await r.json().catch(() => null);
        return Array.isArray(j?.configured) ? [...j.configured].sort().join(',') : null;
      } catch {
        return null;
      }
    };
    (async () => {
      let seen = await connected();
      const until = Date.now() + KEY_WAIT_LIMIT_MS;
      while (!stop && Date.now() < until) {
        await new Promise((r) => setTimeout(r, keyPollMs));
        if (stop) return;
        const now = await connected();
        if (stop || now === null || now === seen) continue;
        seen = now;
        const q = await askQuote(target, { n, model: model ?? undefined }, { fetch: fetchImpl });
        if (stop || !alive.current) return;
        if (q.ok) {
          setKeyStep('idle');
          setNeedsKey(false);
          await run(q.quote, waitingPrompt.current);
          return;
        }
        if (!q.noProvider) {
          // a different refusal: say it, and stop waiting
          setKeyStep('idle');
          setErr(q.message);
          return;
        }
        // a key arrived, but not one that makes images — keep waiting
      }
      if (!stop && alive.current) setKeyStep('idle'); // gave up waiting; the prompt is still in the box
    })();
    return () => {
      stop = true;
    };
  }, [keyStep]);

  const aspect = quote?.aspect ?? null;
  return (
    <section className="v2-gen" data-testid="generate-ask" aria-label={ASK_WORDS.title}>
      <p className="v2-gen-t">{ASK_WORDS.title}</p>
      <p className="v2-gen-hint">{ASK_WORDS.hint(n)}</p>
      <span className="v2-gen-sugg" data-testid="generate-ask-suggestions">
        {SUGGESTIONS.map((t) => (
          <button
            key={t}
            type="button"
            className="chip v2-gen-sugg-b"
            disabled={making > 0}
            onClick={() => setPrompt((p) => (p.trim() ? `${p.trim()}. ${t}` : t))}
          >
            {t}
          </button>
        ))}
      </span>
      <textarea
        data-testid="generate-ask-prompt"
        aria-label="What should be in the picture"
        value={prompt}
        maxLength={4000}
        disabled={making > 0}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void generate();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <div className="v2-gen-opts">
        {aspect ? (
          <span className="v2-gen-chip chip" data-testid="generate-ask-shape">
            {where ? `${aspect} · from ${where}` : aspect}
          </span>
        ) : (
          <span className="v2-gen-need" data-testid="generate-ask-need">
            {canvas && artboard ? null : ASK_WORDS.needTarget}
          </span>
        )}
        <select
          className="v2-gen-chip"
          data-testid="generate-ask-count"
          aria-label="How many takes"
          value={n}
          disabled={making > 0}
          onChange={(e) => setN(Number(e.target.value))}
        >
          {COUNTS.map((c) => (
            <option key={c} value={c}>
              {countLabel(c)}
            </option>
          ))}
        </select>
      </div>
      {quote ? (
        <>
          <p className="v2-gen-time" data-testid="generate-ask-time">
            <StIcon name="clock" size={11} />
            {quote.lines?.time}
          </p>
          {quote.lines?.licence ? (
            <p className="v2-gen-fine" data-testid="generate-ask-licence">
              {quote.lines.licence}
            </p>
          ) : null}
        </>
      ) : null}
      <details className="v2-gen-adv" data-testid="generate-ask-advanced">
        <summary>{ASK_WORDS.advanced}</summary>
        {quote?.models?.length ? (
          <label>
            {ASK_WORDS.model}
            <select
              className="v2-gen-chip"
              data-testid="generate-ask-model"
              value={model ?? quote.model}
              disabled={making > 0}
              onChange={(e) => setModel(e.target.value)}
            >
              {quote.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label || m.id}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {onOther ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            data-testid="generate-ask-other"
            onClick={onOther}
          >
            {ASK_WORDS.other}
          </button>
        ) : null}
      </details>
      {err ? (
        <p className="v2-gen-err" role="alert" data-testid="generate-ask-error">
          {err}
        </p>
      ) : null}
      {keyStep === 'waiting' ? (
        <p className="v2-gen-time" role="status" data-testid="generate-ask-waiting">
          {KEY_WORDS.waiting}
        </p>
      ) : null}
      {keyStep === 'ask' ? (
        <ConnectKeySheet
          onCancel={() => setKeyStep('idle')}
          onConnect={() => {
            setKeyStep('waiting');
            onConnectKey?.();
          }}
        />
      ) : null}
      {making > 0 ? (
        <p className="v2-gen-time" role="status" data-testid="generate-ask-making">
          {ASK_WORDS.making(making)}
        </p>
      ) : null}
      <div className="v2-gen-row">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
          {ASK_WORDS.cancel}
        </button>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          data-testid="generate-ask-go"
          disabled={(!quote && !needsKey) || !prompt.trim() || making > 0 || keyStep === 'waiting'}
          {...reasonProps(
            (!quote && !needsKey) || !prompt.trim() || making > 0 || keyStep === 'waiting',
            goReason({
              quote,
              needsKey,
              err,
              target: !!(canvas && artboard),
              prompt,
              making,
              keyStep,
            })
          )}
          onClick={() => void generate()}
        >
          {ASK_WORDS.generate}
        </button>
      </div>
    </section>
  );
}
