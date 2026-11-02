// Pure parser for the `usage` WS frame (Milestone D — context-window meter +
// cost + single-window rate-limit banner). Scope is deliberately the genuinely
// dynamic subset the ACP adapter exposes today (see the plan's Milestone D
// research): a context-window gauge + session cost (from `usage_update`) and
// an event-driven SINGLE-window rate-limit signal (`SDKRateLimitInfo` riding
// `_meta["_claude/rateLimit"]`). The full multi-window "Plan usage limits"
// panel is explicitly OUT of scope — that data isn't reachable through the
// pinned adapter version; do not fabricate it here.

const RATE_LIMIT_LABELS = {
  five_hour: '5-hour limit',
  seven_day: 'Weekly limit',
  seven_day_opus: 'Weekly · Opus',
  seven_day_sonnet: 'Weekly · Sonnet',
  seven_day_overage_included: 'Weekly (overage included)',
  overage: 'Overage',
};

/** A friendly label for an `SDKRateLimitInfo.rateLimitType` — an unrecognized
 *  or missing type falls back to a generic label rather than `undefined`, so
 *  a future rate-limit-type the adapter adds still renders something sane. */
function rateLimitLabel(type) {
  return RATE_LIMIT_LABELS[type] || 'Usage limit';
}

/**
 * `{ used, size, cost?, rateLimit? }` (the bridge's `BridgeUsage` shape, sent
 * verbatim in a `{t:'usage', usage}` frame) → the render-ready shape:
 *   { context: { used, size, pct } | null, cost: {amount,currency} | null,
 *     rateLimit: { type, label, pct, resetsAt, status } | null, asOf }
 * Tolerant of a missing/malformed frame or `_meta` — always returns a valid,
 * renderable (if mostly-null) shape rather than throwing. `now` defaults to
 * `Date.now()`; callers (tests) can inject a fixed value for determinism.
 */
export function parseUsage(frame, now = Date.now()) {
  const usage = frame && typeof frame === 'object' ? frame.usage : null;
  const asOf = now;
  if (!usage || typeof usage !== 'object') {
    return { context: null, cost: null, rateLimit: null, asOf };
  }
  const used = typeof usage.used === 'number' ? usage.used : null;
  const size = typeof usage.size === 'number' ? usage.size : null;
  const context =
    used != null && size != null && size > 0
      ? { used, size, pct: Math.max(0, Math.min(100, Math.round((used / size) * 100))) }
      : null;
  const cost =
    usage.cost && typeof usage.cost === 'object' && typeof usage.cost.amount === 'number'
      ? { amount: usage.cost.amount, currency: usage.cost.currency || 'USD' }
      : null;

  const raw = usage.rateLimit;
  let rateLimit = null;
  if (raw && typeof raw === 'object' && typeof raw.status === 'string') {
    rateLimit = {
      type: raw.rateLimitType || null,
      label: rateLimitLabel(raw.rateLimitType),
      pct:
        typeof raw.utilization === 'number'
          ? Math.max(0, Math.min(100, Math.round(raw.utilization)))
          : null,
      resetsAt: raw.resetsAt || null,
      status: raw.status,
    };
  }

  return { context, cost, rateLimit, asOf };
}
