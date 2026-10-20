// generation/registry.ts — the provider/model registry (DDR-16x). Maps a
// provider id → its descriptor + adapter factory, and answers capability
// lookups ("which providers can do image?") for routing + the Settings panel.
//
// Adding a provider = one entry here. Phase 0 ships Gemini (image); Phase 1 adds
// fal, Phase 2 ElevenLabs, etc. — each is a factory + descriptor, no route change.
//
// The registry holds FACTORIES, not live adapters: an adapter is instantiated
// per-request with the resolved key + localizer injected (AdapterContext), so a
// key never lives on a long-held adapter object.

import {
  createElevenLabsAdapter,
  ELEVENLABS_DESCRIPTOR,
  ELEVENLABS_MODELS,
} from './adapters/elevenlabs.ts';
import { createGeminiAdapter, GEMINI_DESCRIPTOR, GEMINI_MODELS } from './adapters/gemini.ts';
import { createGroqAdapter, GROQ_DESCRIPTOR, GROQ_MODELS } from './adapters/groq.ts';
import { createStubAdapter, STUB_DESCRIPTOR, STUB_MODELS } from './adapters/stub.ts';
import type {
  AdapterContext,
  AdapterFactory,
  Modality,
  ModelDescriptor,
  ProviderAdapter,
  ProviderDescriptor,
} from './types.ts';

interface ProviderEntry {
  descriptor: ProviderDescriptor;
  factory: AdapterFactory;
  /** Static model list (aggregators refresh via adapter.listModels at runtime). */
  models: ModelDescriptor[];
}

const PROVIDERS: Record<string, ProviderEntry> = {
  gemini: {
    descriptor: GEMINI_DESCRIPTOR,
    factory: createGeminiAdapter,
    models: GEMINI_MODELS,
  },
  elevenlabs: {
    descriptor: ELEVENLABS_DESCRIPTOR,
    factory: createElevenLabsAdapter,
    models: ELEVENLABS_MODELS,
  },
  // Task 2.6 — Groq managed Whisper STT (transcription only). A CHOSEN cloud
  // engine, never auto-selected; the local whisper.cpp path stays the default.
  groq: {
    descriptor: GROQ_DESCRIPTOR,
    factory: createGroqAdapter,
    models: GROQ_MODELS,
  },
};

// S8.16 — the test provider (adapters/stub.ts: solid PNGs, no network) exists only while
// `MAUDE_GENERATE_STUB=1`, read per call so a test can switch it without re-importing.
const STUB: ProviderEntry = {
  descriptor: STUB_DESCRIPTOR,
  factory: createStubAdapter,
  models: STUB_MODELS,
};
const providers = (): Record<string, ProviderEntry> =>
  process.env.MAUDE_GENERATE_STUB === '1' ? { ...PROVIDERS, stub: STUB } : PROVIDERS;

/** Every registered provider descriptor (inert — safe to serialize to the UI). */
export function listProviders(): ProviderDescriptor[] {
  return Object.values(providers()).map((p) => p.descriptor);
}

/** The descriptor for one provider, or null when unknown. */
export function getProviderDescriptor(id: string): ProviderDescriptor | null {
  return providers()[id]?.descriptor ?? null;
}

/** The static model list for one provider. */
export function getProviderModels(id: string): ModelDescriptor[] {
  return providers()[id]?.models ?? [];
}

/** All providers that can produce a given modality (routing + capability UI). */
export function providersForModality(modality: Modality): ProviderDescriptor[] {
  return listProviders().filter((d) => d.modalities.includes(modality));
}

/** Whether a provider id is registered. */
export function hasProvider(id: string): boolean {
  return Object.hasOwn(providers(), id);
}

/**
 * Instantiate the adapter for `providerId` with a per-request context. Throws on
 * an unknown provider (the route validates first, so this is a defensive guard).
 */
export function createAdapter(providerId: string, ctx: AdapterContext): ProviderAdapter {
  const entry = providers()[providerId];
  if (!entry) throw new Error(`unknown provider: ${providerId}`);
  return entry.factory(ctx);
}
