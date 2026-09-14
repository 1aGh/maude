// Review proposal only. T8 must measure and approve these values before rollout.
export const REVIEW_LIMITS = Object.freeze({
  maxProposalBytes: 1048576,
  maxResponseBytes: 2097152,
  maxJsonDepth: 24,
  maxIdentifierChars: 96,
  maxLabelChars: 160,
  maxPathChars: 1024,
  maxOperations: 128,
  maxReadConditions: 1024,
  maxWriteTargets: 1024,
  maxDependencies: 128,
  maxDependencyDepth: 32,
  maxBlobs: 256,
  maxBlobBytes: 10737418240,
  maxActionBlobBytes: 21474836480,
  maxTextChars: 65536,
  maxPropertyChars: 4096,
  maxAnnotationPoints: 8192,
  maxCommentChars: 4000,
  maxEffectIds: 1024,
  maxEffects: 4096,
  maxSidecarBytes: 262144,
  maxFootageShots: 512,
  maxFootageTags: 64,
  maxTagChars: 120,
  maxEdlBeats: 512,
  maxAudioTracks: 64,
  maxCaptionCues: 5000,
  maxTimelineFrames: 10368000,
  maxThemes: 16,
  maxRetryAfterMs: 3600000,
  offlineReplayHorizonMs: 2592000000,
});
export function checkedLimits(overrides = {}) {
  for (const key of Object.keys(overrides)) {
    if (!Object.hasOwn(REVIEW_LIMITS, key)) throw new TypeError(`Unknown limit ${key}`);
  }
  const limits = { ...REVIEW_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`Invalid limit ${key}`);
  }
  if (limits.maxBlobBytes > limits.maxActionBlobBytes)
    throw new TypeError('Blob limit exceeds action limit');
  return Object.freeze(limits);
}
