// The migrator's `ds.tokens` emitter (V2-1.12 §5.10 = `ds-check --emit` in-process). Wired
// through `migrate/ds-registry.ts` `defaultDsEmitter()`. The seam passes `{name, path,
// tokensCssRel}`; the rest of the system entry (rootClass, themes, themeDefault) and the
// project knobs come from `config.json` through the same `read`, so the bytes equal what
// `maude design ds-check --emit` writes.

import type { DsTokensEmitter } from '../migrate/ds-registry.ts';
import { emitTokensJson } from './emit.ts';
import { indexRegistry, loadRegistry } from './registry.ts';
import { type DsFs, loadSystem, systemConfigsFrom } from './system.ts';

const dec = new TextDecoder();
const enc = new TextEncoder();

export const dsTokensEmitter: DsTokensEmitter = {
  registryVersion: 1,
  emitTokens({ system, read }) {
    const text = (rel: string) => {
      const b = read(rel);
      return b ? dec.decode(b) : null;
    };
    let config: Record<string, unknown> = {};
    const raw = text('config.json');
    if (raw) {
      try {
        config = JSON.parse(raw);
      } catch {
        return { refused: 'config.json is not valid JSON' };
      }
    }
    const cfg = systemConfigsFrom(config).find((s) => s.name === system.name) ?? {
      ...systemConfigsFrom({ designSystems: [system] })[0],
    };
    cfg.tokensCssRel = system.tokensCssRel;
    const fs: DsFs = { read: text, list: () => null };
    const model = loadSystem(fs, cfg);
    if (model.converted)
      return { refused: 'converted system (revisions/head.json) — the app owns tokens.json' };
    if (model.css === null) return { refused: `${system.tokensCssRel} is missing` };
    return { bytes: enc.encode(emitTokensJson(model, indexRegistry(loadRegistry()))) };
  },
};
