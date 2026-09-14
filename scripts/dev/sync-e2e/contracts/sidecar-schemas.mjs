// Concrete vocabulary from apps/studio/footage/schema.ts and config.schema.json.
// Shapes are strict; normalization and durable authority remain gateway work.
export const SHOT_KINDS = [
  'wide',
  'medium',
  'close',
  'detail',
  'establishing',
  'action',
  'portrait',
  'product',
  'transition',
  'other',
];
export const MOTION_KINDS = [
  'static',
  'pan',
  'tilt',
  'push-in',
  'pull-out',
  'handheld',
  'tracking',
  'fast',
  'other',
];
export const TRANSITION_PRESENTATIONS = ['none', 'fade', 'slide', 'wipe', 'flip', 'clock-wipe'];
export const TRANSCRIPTION_PROVIDERS = ['auto', 'whisper', 'elevenlabs', 'groq'];
export const KEYFRAME_ENGINES = ['auto', 'gemma', 'ffmpeg', 'blind'];

export function sidecarSchemas({
  l,
  obj,
  str,
  int,
  positive,
  arr,
  nullable,
  en,
  constant,
  logicalPath,
  asset,
  blob,
  hash,
}) {
  const seconds = { type: 'number', minimum: 0, maximum: 86400 };
  const dimensions = { type: 'number', minimum: 0, maximum: 100000 };
  const frames = { ...int, maximum: l.maxTimelineFrames };
  const durationFrames = { ...frames, minimum: 1 };
  const assetPath = str(l.maxPathChars, { pattern: '^assets/[0-9a-f]{8,64}[A-Za-z0-9._-]*$' });
  const assetBinding = obj({ path: assetPath, ...asset.properties });
  const shot = obj(
    {
      start: seconds,
      end: seconds,
      kind: en(...SHOT_KINDS),
      motion: en(...MOTION_KINDS),
      subject: str(500),
      lighting: str(500),
      mood: str(500),
      note: str(1000),
      quality: { type: 'number', minimum: 0, maximum: 1 },
      usable: { type: 'boolean' },
    },
    ['start', 'end']
  );
  const analysis = obj(
    {
      version: constant(1),
      asset: assetPath,
      durationSec: seconds,
      width: dimensions,
      height: dimensions,
      keyframes: int,
      shots: arr(shot, l.maxFootageShots),
      summary: str(4000),
      tags: arr(str(l.maxTagChars), l.maxFootageTags),
      speech: str(4000),
    },
    ['version']
  );
  const overlay = obj({ kind: en('title', 'lower-third', 'caption', 'logo'), text: str(500) }, [
    'kind',
  ]);
  const transition = obj({ presentation: en(...TRANSITION_PRESENTATIONS), frames });
  const beat = obj(
    {
      clip: assetPath,
      startSec: seconds,
      durationFrames,
      why: str(1000),
      transition: nullable(transition),
      overlay: nullable(overlay),
      name: str(120, { minLength: 1 }),
    },
    ['clip', 'startSec', 'durationFrames']
  );
  const music = obj({ asset: assetPath, fadeOutFrames: frames }, ['asset']);
  const audioTrack = obj(
    {
      asset: assetPath,
      kind: en('music', 'voiceover', 'sfx'),
      startFrame: frames,
      durationFrames,
      gainDb: { type: 'number', minimum: -60, maximum: 24 },
      fadeInFrames: frames,
      fadeOutFrames: frames,
      name: str(120, { minLength: 1 }),
    },
    ['asset']
  );
  const cue = obj({ startSec: seconds, endSec: seconds, text: str(2000) });
  const captions = obj(
    { cues: arr(cue, l.maxCaptionCues), style: en('lower-third', 'centered', 'top') },
    ['cues']
  );
  const edl = obj(
    {
      version: constant(1),
      title: str(300),
      fps: { type: 'number', minimum: 1, maximum: 120 },
      width: { ...dimensions, minimum: 1 },
      height: { ...dimensions, minimum: 1 },
      beats: arr(beat, l.maxEdlBeats),
      music: nullable(music),
      audioTracks: arr(audioTrack, l.maxAudioTracks),
      captions: nullable(captions),
    },
    ['version']
  );
  const dsName = str(l.maxIdentifierChars, { pattern: '^[a-z][a-z0-9-]*$' });
  const designSystem = obj(
    {
      name: dsName,
      path: logicalPath,
      description: str(4000),
      tokensCssRel: logicalPath,
      rootClass: str(l.maxIdentifierChars, { pattern: '^[A-Za-z_][A-Za-z0-9_-]*$' }),
      themeDefault: en('dark', 'light'),
      themes: arr(str(l.maxIdentifierChars, { minLength: 1 }), l.maxThemes, 1, true),
      newCanvasDir: logicalPath,
      newComponentDir: logicalPath,
    },
    ['name', 'path']
  );
  return {
    analysis,
    edl,
    manifestReplace: {
      path: logicalPath,
      baseHash: hash,
      content: blob,
      dependencies: arr(asset, l.maxBlobs, 0, true),
    },
    footageAssign: {
      property: constant('analysis'),
      asset,
      assetPath,
      baseHash: nullable(hash),
      value: analysis,
    },
    edlEdit: {
      verb: constant('replace'),
      baseHash: nullable(hash),
      value: edl,
      assets: arr(assetBinding, l.maxBlobs, 0, true),
    },
    configVariants: [
      {
        property: constant('generation.transcription.provider'),
        value: en(...TRANSCRIPTION_PROVIDERS),
      },
      { property: constant('generation.keyframes.engine'), value: en(...KEYFRAME_ENGINES) },
      { property: constant('designSystems.upsert'), value: designSystem },
      { property: constant('designSystems.remove'), name: dsName },
      { property: constant('defaultDesignSystem'), value: nullable(dsName) },
      { property: constant('name'), value: str(l.maxLabelChars, { minLength: 1 }) },
      { property: constant('completenessProfile'), value: en('minimal', 'standard', 'strict') },
    ],
  };
}

export function sidecarSemantics(op, limits) {
  if (op.kind === 'footage.assign') {
    if (op.value.asset && op.value.asset !== op.assetPath) return 'footage-asset-mismatch';
    for (const shot of op.value.shots ?? []) {
      if (shot.end <= shot.start) return 'footage-shot-range';
      // Preserve current validator's half-second probe tolerance explicitly.
      if (op.value.durationSec !== undefined && shot.end > op.value.durationSec + 0.5)
        return 'footage-shot-duration';
    }
  }
  if (op.kind === 'edl.edit') {
    const paths = op.assets.map((a) => a.path);
    if (new Set(paths).size !== paths.length) return 'duplicate-edl-asset-binding';
    const required = [
      ...(op.value.beats ?? []).map((b) => b.clip),
      ...(op.value.music ? [op.value.music.asset] : []),
      ...(op.value.audioTracks ?? []).map((a) => a.asset),
    ];
    if (required.some((path) => !paths.includes(path))) return 'unbound-edl-asset';
    if (paths.some((path) => !required.includes(path))) return 'unused-edl-asset-binding';
    const beatNames = (op.value.beats ?? []).map((b) => b.name).filter(Boolean);
    if (new Set(beatNames).size !== beatNames.length) return 'duplicate-edl-beat-name';
    const trackNames = (op.value.audioTracks ?? []).map((b) => b.name).filter(Boolean);
    if (new Set(trackNames).size !== trackNames.length) return 'duplicate-edl-track-name';
    let totalFrames = 0;
    for (const [i, beat] of (op.value.beats ?? []).entries()) {
      const overlap = beat.transition?.frames ?? 0;
      if (i === 0 && overlap !== 0) return 'edl-first-transition';
      if (
        overlap >= beat.durationFrames ||
        (i > 0 && overlap >= op.value.beats[i - 1].durationFrames)
      )
        return 'edl-transition-duration';
      if (beat.transition?.presentation === 'none' && overlap !== 0) return 'edl-hard-cut-overlap';
      totalFrames += beat.durationFrames - overlap;
      if (!Number.isSafeInteger(totalFrames) || totalFrames > limits.maxTimelineFrames)
        return 'edl-total-frames';
    }
    for (const cue of op.value.captions?.cues ?? [])
      if (cue.endSec <= cue.startSec) return 'edl-caption-range';
    for (const track of op.value.audioTracks ?? []) {
      if ((track.startFrame ?? 0) + (track.durationFrames ?? 0) > limits.maxTimelineFrames)
        return 'edl-audio-frame-range';
      if (
        track.durationFrames !== undefined &&
        ((track.fadeInFrames ?? 0) > track.durationFrames ||
          (track.fadeOutFrames ?? 0) > track.durationFrames)
      )
        return 'edl-audio-fade-range';
    }
  }
  if (
    (op.kind === 'edl.edit' || op.kind === 'footage.assign') &&
    new TextEncoder().encode(JSON.stringify(op.value)).byteLength > limits.maxSidecarBytes
  )
    return 'sidecar-byte-limit';
  if (
    op.kind === 'config.assign' &&
    op.property === 'designSystems.upsert' &&
    op.value.themes &&
    op.value.themeDefault &&
    !op.value.themes.includes(op.value.themeDefault)
  )
    return 'design-system-default-theme';
  return null;
}
