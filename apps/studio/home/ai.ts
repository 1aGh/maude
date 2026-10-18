// home/ai.ts — Home's "Connect AI" (S6.6): AI-editing readiness plus the existing Claude
// install / sign-in module (acp/login-state.ts, DDR-166). Nothing new is spawned here: install
// runs the module's official installer, sign-in drives the user's own `claude auth login`, both
// single-flight and polled. Home only fronts them behind its page secret.
//
//   GET  /_home/ai/status   → { available, claudeInstalled, reason, install, signinInFlight }
//   POST /_home/ai/connect  { step: 'install' | 'signin' | 'cancel' }
//
// The status carries no filesystem path (the probe's `claudePath` / `adapterEntry` stay here).

import {
  cancelInstall,
  cancelSignin,
  getInstallState,
  isSigninInFlight,
  startInstall,
  startSignin,
} from '../acp/login-state.ts';
import { type AcpAvailability, probeAcpAvailabilityAuthed } from '../acp/probe.ts';
import type { HomeAnswer } from './signin.ts';

export interface HomeAiDeps {
  probe: () => Promise<AcpAvailability>;
  installState: () => unknown;
  signinInFlight: () => boolean;
  startInstall: () => { ok: boolean; reason?: string };
  startSignin: () => { ok: boolean; reason?: string };
  cancelSignin: () => void;
  cancelInstall: () => void;
}

const REAL: HomeAiDeps = {
  probe: probeAcpAvailabilityAuthed,
  installState: getInstallState,
  signinInFlight: isSigninInFlight,
  startInstall,
  startSignin,
  cancelSignin,
  cancelInstall,
};

export interface HomeAi {
  status(): Promise<HomeAnswer>;
  connect(body: unknown): Promise<HomeAnswer>;
}

export function createHomeAi(deps: HomeAiDeps = REAL): HomeAi {
  async function status(): Promise<HomeAnswer> {
    const a = await deps.probe();
    return {
      status: 200,
      body: {
        ok: true,
        available: a.available === true,
        claudeInstalled: !!a.claudePath,
        reason: typeof a.reason === 'string' ? a.reason : null,
        install: deps.installState(),
        signinInFlight: deps.signinInFlight(),
      },
    };
  }

  async function connect(body: unknown): Promise<HomeAnswer> {
    const step = body && typeof body === 'object' ? (body as { step?: unknown }).step : undefined;
    if (step === 'cancel') {
      deps.cancelSignin();
      deps.cancelInstall();
      return { status: 200, body: { ok: true } };
    }
    if (step !== 'install' && step !== 'signin')
      return { status: 400, body: { ok: false, error: 'bad step' } };
    const r = step === 'install' ? deps.startInstall() : deps.startSignin();
    return r.ok
      ? { status: 200, body: { ok: true } }
      : { status: 409, body: { ok: false, error: r.reason ?? 'Could not start.' } };
  }

  return { status, connect };
}
