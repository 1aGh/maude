// AI chat attachments + folder consent — S5.10 (S5-slices row S5.10; 03 AI Chat `ai-attach`,
// `ai-attach-menu`).
//
// Two doors in, and in both the SERVER decides the path the agent gets:
//   • a FILE (drop, paste, Attach files…) arrives as bytes. The bytes are sniffed (the name and
//     Content-Type are never trusted): photos, footage and sound land in Assets
//     (`api.saveAssetFromStream` — content-addressed `assets/<sha8>.<ext>`, its caps and session
//     budget), a PDF lands in this Mac's `_chat/attachments/<sha8>.pdf` (Assets holds no PDFs).
//     The answer is the absolute path of THAT copy — never a path the caller named.
//   • a FOLDER (Choose a folder…, the desktop shell's native picker) arrives as a path. It is
//     resolved to its real path and checked (`ai/attach-grants.ts` resolveFolder); the first time,
//     the answer is `needsConsent` and nothing is recorded — only `consent: true` (Let AI read)
//     records the grant. A granted folder attaches straight away next time (asked once).
//     The grant is the agent's read boundary outside the project (M2, decision
//     maude/v2-michal-m2-read-boundary): the ACP read gate re-reads this chat's attached folders on
//     every read (`chatReadRootsFor`), so a yes counts on the next call and a detach / Reset here
//     puts the folder back behind the permission card — nothing to restart.
//
// MAIN ORIGIN ONLY (`origin: 'main'`): not in CANVAS_SAFE_API, not on the canvas server's routes —
// the untrusted canvas iframe can neither attach, choose a folder, nor list one. The CSRF +
// loopback guard is `guardTableRoute`'s (http.ts). Every write is refused in a read-only session:
// attaching writes Assets (versioned) and a viewer's chat cannot send anyway (S5.6).
//
// Limits, stated: photos 50 MB, footage and sound 100 MB (the Assets caps, env-overridable), PDFs
// 32 MB; nothing else (no SVG, HTML, scripts, archives). Folders: counted to 5000 files / 8 levels,
// listed 500 entries at a time, 200 grants per project.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { currentAccess, notInScopeResponse } from '../access/request.ts';
import type { Access } from '../access/scope.ts';
import { wipeChatScratch } from '../acp/may-scope.ts';
import {
  ATTACH_FOLDER_LIMITS,
  countFiles,
  createGrantStore,
  FOLDER_REFUSAL_WORDS,
  type FolderRefusal,
  type GrantStore,
  isChatId,
  listFolder,
  resolveFolder,
} from '../ai/attach-grants.ts';
import { type SaveAssetResult, sniffAssetType } from '../api.ts';
import type { RouteSpec } from './table.ts';

export const ATTACH_FILE_LIMITS = {
  pdfMaxBytes: 32 * 1024 * 1024,
  /** The ceiling the route reads at all (the largest Assets cap decides per type below it). */
  maxBytes: 100 * 1024 * 1024,
  nameMax: 120,
} as const;

export const ATTACH_TYPE_WORDS =
  'AI can use photos, footage, sound and PDFs. Photos up to 50 MB, footage and sound up to 100 MB, PDFs up to 32 MB.';

const MAX_JSON = 8 * 1024;

export interface ChatAttachDeps {
  designRoot: string;
  projectRoot: string;
  /** `api.saveAssetFromStream` — the Assets writer (sniff, caps, budget, content address). */
  saveAsset: (stream: ReadableStream<Uint8Array>) => Promise<SaveAssetResult>;
  /** THIS request's access; default `currentAccess()` (server.ts sets it per request). */
  access?: () => Access;
  /** tests only */
  grants?: GrantStore;
  home?: string;
}

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const refuse = (status: number, code: FolderRefusal) =>
  json(status, { error: code, message: FOLDER_REFUSAL_WORDS[code] });

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  if (Number(req.headers.get('content-length')) > MAX_JSON) return null;
  const text = await req.text();
  if (text.length > MAX_JSON) return null;
  try {
    const v = text ? JSON.parse(text) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A display name, never a path: last segment, no control characters or brackets, bounded. */
export function displayName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  const last = s.split(/[/\\]/).pop() ?? '';
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  const clean = last.replace(/[\u0000-\u001f\u007f[\]]/g, '').trim();
  return clean.slice(0, ATTACH_FILE_LIMITS.nameMax) || 'attachment';
}

const isPdf = (b: Uint8Array) =>
  b.length >= 5 &&
  b[0] === 0x25 &&
  b[1] === 0x50 &&
  b[2] === 0x44 &&
  b[3] === 0x46 &&
  b[4] === 0x2d;

/** Pages, by counting page objects — a scan, not a parse (DDR-148: the server never parses a
 *  container). Compressed object streams hide them; 0 then means "unknown", not "empty". */
export function pdfPageCount(bytes: Uint8Array): number {
  const text = Buffer.from(bytes).toString('latin1');
  const m = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g);
  return m ? Math.min(m.length, 100000) : 0;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export function createChatAttachRoutes(deps: ChatAttachDeps): RouteSpec[] {
  const grants = () =>
    deps.grants ??
    createGrantStore({
      projectRoot: deps.projectRoot,
      designRoot: deps.designRoot,
      home: deps.home,
    });
  const canvasOnly = () => (deps.access ?? currentAccess)().canvasOnly;
  const env = () => ({
    projectRoot: deps.projectRoot,
    designRoot: deps.designRoot,
    home: deps.home,
  });

  return [
    {
      method: 'POST',
      path: '/_api/ai/attach/file',
      origin: 'main',
      readOnly: 'refused',
      handle: async (req) => {
        const declared = Number(req.headers.get('content-length') || '0');
        if (Number.isFinite(declared) && declared > ATTACH_FILE_LIMITS.maxBytes)
          return json(413, { error: 'too-big', message: ATTACH_TYPE_WORDS });
        const name = displayName(new URL(req.url).searchParams.get('name'));
        const reader = req.body?.getReader();
        if (!reader)
          return json(400, { error: 'empty', message: 'Nothing arrived. Attach it again.' });
        const head: Uint8Array[] = [];
        let headLen = 0;
        let done = false;
        while (headLen < 16) {
          const r = await reader.read();
          if (r.done) {
            done = true;
            break;
          }
          head.push(r.value);
          headLen += r.value.length;
        }
        const first = concat(head);
        if (first.length === 0)
          return json(400, { error: 'empty', message: 'That file is empty.' });

        if (isPdf(first)) {
          const chunks = [first];
          let total = first.length;
          while (!done) {
            const r = await reader.read();
            if (r.done) break;
            total += r.value.length;
            if (total > ATTACH_FILE_LIMITS.pdfMaxBytes) {
              await reader.cancel().catch(() => {});
              return json(413, { error: 'too-big', message: ATTACH_TYPE_WORDS });
            }
            chunks.push(r.value);
          }
          const bytes = concat(chunks);
          const sha8 = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
          const dir = join(deps.designRoot, '_chat', 'attachments');
          const abs = join(dir, `${sha8}.pdf`);
          if (resolve(abs) !== join(resolve(dir), `${sha8}.pdf`))
            return json(400, { error: 'bad-path', message: 'Attach it again.' });
          if (!existsSync(abs)) {
            mkdirSync(dir, { recursive: true });
            writeFileSync(abs, bytes);
          }
          const pages = pdfPageCount(bytes);
          return json(201, {
            kind: 'file',
            type: 'pdf',
            name,
            path: abs,
            size: bytes.length,
            pages,
          });
        }

        const type = sniffAssetType(first);
        if (!type) {
          await reader.cancel().catch(() => {});
          return json(415, { error: 'unsupported', message: ATTACH_TYPE_WORDS });
        }
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(first);
            if (done) c.close();
          },
          async pull(c) {
            const r = await reader.read();
            if (r.done) c.close();
            else c.enqueue(r.value);
          },
          cancel() {
            void reader.cancel().catch(() => {});
          },
        });
        const saved = await deps.saveAsset(stream);
        if (!saved.ok || !saved.path)
          return json(saved.status ?? 400, {
            error: 'not-saved',
            message: saved.status === 413 ? ATTACH_TYPE_WORDS : (saved.error ?? 'Attach it again.'),
          });
        return json(201, {
          kind: type.category === 'image' ? 'image' : type.category === 'video' ? 'video' : 'audio',
          type: type.ext,
          name,
          asset: saved.path,
          path: join(deps.designRoot, saved.path),
        });
      },
    },
    {
      // Probe, consent and attach in one door. Without `consent: true` an ungranted folder only
      // answers `needsConsent` — nothing is recorded until the person picks Let AI read.
      method: 'POST',
      path: '/_api/ai/attach/folder',
      origin: 'main',
      readOnly: 'refused',
      handle: async (req) => {
        const b = await readJson(req);
        if (!b) return json(400, { error: 'bad-body' });
        if (!isChatId(b.chatId)) return json(400, { error: 'bad-chat' });
        const r = resolveFolder(b.path, env());
        if (!r.ok) return refuse(r.code === 'not-found' ? 404 : 422, r.code);
        const { count, capped } = countFiles(r.root);
        const shape = {
          root: r.root,
          name: r.name,
          count,
          countCapped: capped,
          outsideProject: r.outsideProject,
        };
        const store = grants();
        if (store.isGranted(r.root)) {
          const a = store.attach(r.root, b.chatId);
          if (!a.ok) return refuse(409, a.code);
          return json(200, { ...shape, granted: true, attached: true });
        }
        if (b.consent !== true) return json(200, { ...shape, granted: false, needsConsent: true });
        const g = store.grant(r, b.chatId);
        if (!g.ok) return refuse(409, g.code);
        return json(201, { ...shape, granted: true, attached: true });
      },
    },
    {
      // The chip's ×. The consent stays (asked once); this chat stops carrying the folder.
      method: 'POST',
      path: '/_api/ai/attach/folder/detach',
      origin: 'main',
      readOnly: 'refused',
      handle: async (req) => {
        const b = await readJson(req);
        if (!b || typeof b.root !== 'string' || !isChatId(b.chatId))
          return json(400, { error: 'bad-body' });
        grants().detach(b.root, b.chatId);
        // V2-8.9 re-check 2 M-b — what this chat copied to its scratch goes with the folder.
        wipeChatScratch(deps.projectRoot, b.chatId);
        return json(200, { ok: true });
      },
    },
    {
      // Advanced › Folders AI may read › Reset. Gone from every chat.
      method: 'POST',
      path: '/_api/ai/attach/folder/revoke',
      origin: 'main',
      readOnly: 'refused',
      handle: async (req) => {
        const b = await readJson(req);
        if (!b || typeof b.root !== 'string') return json(400, { error: 'bad-body' });
        const revoked = grants().revoke(b.root);
        // V2-8.9 re-check 2 M-b — gone from every chat: so is every chat's scratch content.
        wipeChatScratch(deps.projectRoot);
        return json(200, { ok: true, revoked });
      },
    },
    {
      // `project` class (test/_acl-route-classes.ts): the folders AI may read are the project's
      // AI chat's. A canvas-only session gets the not-in-scope answer, granted folders or none.
      method: 'GET',
      path: '/_api/ai/attach/folders',
      origin: 'main',
      readOnly: 'allowed',
      handle: () =>
        canvasOnly()
          ? notInScopeResponse()
          : json(200, { folders: grants().list(), limits: ATTACH_FOLDER_LIMITS }),
    },
    {
      // Read-only listing of a folder THIS chat carries, one level. `sub` is resolved and must
      // stay inside the granted folder; links that leave it are left out.
      method: 'GET',
      path: '/_api/ai/attach/folder/list',
      origin: 'main',
      readOnly: 'allowed',
      handle: (req) => {
        if (canvasOnly()) return notInScopeResponse();
        const q = new URL(req.url).searchParams;
        const chatId = q.get('chatId');
        const root = q.get('root') ?? '';
        if (!isChatId(chatId)) return json(400, { error: 'bad-chat' });
        const store = grants();
        if (!store.isGranted(root)) return refuse(403, 'not-granted');
        if (!store.chatRoots(chatId).includes(root)) return refuse(403, 'not-attached');
        const l = listFolder(root, q.get('sub'));
        if (!l.ok) return refuse(l.code === 'not-found' ? 404 : 403, l.code);
        return json(200, l);
      },
    },
  ];
}
