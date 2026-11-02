/**
 * @canvas      Whisper vs ElevenLabs — local whisper.cpp vs ElevenLabs Scribe subtitle quality, side by side on the same 8s clip
 * @ds          maude
 * @platform    desktop
 * @opt_out     palette
 * @artboards   local-whisper | elevenlabs-scribe
 * @brief       Dogfood of the user-chosen transcription engine feature (DDR-164): the same caaftv-mixzone-8s clip transcribed twice — once through local whisper.cpp (ggml-base multilingual model, no key, segment-level) and once through the dev server's ElevenLabs Scribe cloud route (key resolved server-side). Each artboard plays the source video and lists its own SRT cues underneath, click-to-seek. Purpose is a straight quality comparison, not production subtitle UI.
 * @stack       React 19 · TSX · Bun.build · css_mode=inline (no sibling .css)
 * @history     .design/_history/ui-whisper_vs_elevenlabs/
 *
 * Authored under the `maude` DS ("Unified Pro Studio", dark-first). Tokens arrive
 * via the import below so the canvas renders correctly regardless of which DS the
 * host injects. Both SRT transcripts are embedded verbatim (not paraphrased) so the
 * artboards show exactly what each engine produced.
 */

import "../../system/maude/colors_and_type.css";
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
import { useMemo, useRef, useState } from "react";

/* ─────────────────────────── SRT parsing ──────────────────────────────────── */
type Cue = { start: number; end: number; text: string };

function srtTimeToSeconds(t: string): number {
  const [h, m, rest] = t.trim().split(":");
  const [s, ms] = rest.split(",");
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

function parseSrt(raw: string): Cue[] {
  return raw
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split("\n").filter((l) => l.trim().length > 0);
      const timingLine = lines.find((l) => l.includes("-->"));
      if (!timingLine) return null;
      const [startStr, endStr] = timingLine.split("-->");
      const textLines = lines.slice(lines.indexOf(timingLine) + 1);
      return {
        start: srtTimeToSeconds(startStr),
        end: srtTimeToSeconds(endStr),
        text: textLines.join(" ").trim(),
      };
    })
    .filter((c): c is Cue => c !== null);
}

/* ─────────────────────────── Verbatim engine output ───────────────────────── */
// Local — whisper.cpp, ggml-base.bin (multilingual), --lang cs, segment-level.
// English-only ggml-base.en.bin was tried first and rejected (source is Czech).
const SRT_LOCAL = `
1
00:00:00,000 --> 00:00:02,560
na víci, kři jsou silní je to silnej jsou peč.

2
00:00:02,560 --> 00:00:07,580
Myslali jsme, že to bude vyrovnany útkání a že zvíte zíme na konec, ale dopado to úplněnek.
`;

// Cloud — ElevenLabs Scribe via the dev server's /_api/generate-jobs route.
const SRT_CLOUD = `
1
00:00:00,079 --> 00:00:01,679
Navíc Cíhiři jsou silní, je to silnej

2
00:00:01,699 --> 00:00:02,200
soupeř.

3
00:00:02,659 --> 00:00:04,079
Mysleli jsme si, že to bude vyrovnaný

4
00:00:04,099 --> 00:00:06,259
utkání a že zvítězíme nakonec.

5
00:00:06,379 --> 00:00:07,599
Ale dopadlo to úplně jinak.

6
00:00:07,659 --> 00:00:07,940
My jsme-
`;

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(2).padStart(5, "0");
  return `${m}:${sec}`;
}

/* ─────────────────────────── Transcript panel ──────────────────────────────
 * Plays the source video + lists its own cues underneath. Clicking a cue seeks
 * the video and highlights while playing (no data: URIs — content-addressed
 * assets/ paths only, per project asset convention).
 * ──────────────────────────────────────────────────────────────────────────── */
function EnginePanel({
  eyebrow,
  title,
  engineNote,
  src,
  vttSrc,
  srt,
  accent,
}: {
  eyebrow: string;
  title: string;
  engineNote: string;
  src: string;
  vttSrc?: string;
  srt: string;
  accent: string;
}) {
  const cues = useMemo(() => parseSrt(srt), [srt]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [activeTime, setActiveTime] = useState(0);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--bg-1)",
        color: "var(--fg-0)",
        fontFamily: "var(--font-body)",
      }}
    >
      <div
        style={{
          padding: "var(--space-6) var(--space-6) var(--space-5)",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--type-xs)",
            letterSpacing: "var(--tracking-wide)",
            textTransform: "uppercase",
            color: accent,
            marginBottom: 6,
          }}
        >
          {eyebrow}
        </div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "var(--type-2xl)",
            lineHeight: "var(--lh-2xl)",
            fontWeight: 700,
            letterSpacing: "var(--tracking-tight)",
          }}
        >
          {title}
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: "var(--type-sm)",
            lineHeight: "var(--lh-sm)",
            color: "var(--fg-2)",
          }}
        >
          {engineNote}
        </div>
      </div>

      <div style={{ padding: "var(--space-5) var(--space-6) 0" }}>
        <video
          ref={videoRef}
          controls
          src={src}
          onTimeUpdate={(e) => setActiveTime(e.currentTarget.currentTime)}
          style={{
            width: "100%",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-default)",
            background: "#000",
            display: "block",
          }}
        >
          {vttSrc ? <track kind="subtitles" src={vttSrc} srcLang="cs" label="Czech" default /> : null}
        </video>
      </div>

      <div
        style={{
          margin: "var(--space-5) var(--space-6) var(--space-6)",
          padding: "var(--space-2)",
          background: "var(--bg-2)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
          overflowY: "auto",
          flex: 1,
        }}
      >
        {cues.map((cue, i) => {
          const isActive = activeTime >= cue.start && activeTime < cue.end;
          return (
            <button
              key={i}
              onClick={() => {
                if (videoRef.current) videoRef.current.currentTime = cue.start;
              }}
              style={{
                display: "flex",
                gap: "var(--space-4)",
                width: "100%",
                textAlign: "left",
                padding: "var(--space-3) var(--space-4)",
                border: "none",
                borderRadius: "var(--radius-sm)",
                background: isActive ? "var(--accent-tint)" : "transparent",
                cursor: "pointer",
                marginBottom: 2,
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--type-xs)",
                  color: isActive ? accent : "var(--fg-3)",
                  paddingTop: 2,
                  minWidth: 48,
                }}
              >
                {fmtTime(cue.start)}
              </span>
              <span
                style={{
                  fontSize: "var(--type-base)",
                  lineHeight: "var(--lh-base)",
                  color: isActive ? "var(--fg-0)" : "var(--fg-1)",
                }}
              >
                {cue.text}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Canvas() {
  return (
    <DesignCanvas>
      <DCSection
        id="comparison"
        title="Whisper vs ElevenLabs"
        subtitle="Same 8s clip (caaftv-mixzone) · local whisper.cpp vs ElevenLabs Scribe · both via `maude design transcribe`"
      >
        <DCArtboard id="local-whisper" label="A · Local whisper" width={640} height={840}>
          <EnginePanel
            eyebrow="Local · whisper.cpp"
            title="Local whisper"
            engineNote="ggml-base.bin (multilingual, ~141MB) · --lang cs · segment-level · no API key · mp4 needed an ffmpeg 16kHz mono WAV pre-convert (homebrew build has no ffmpeg codec)"
            src="assets/caaftv-local.mp4"
            vttSrc="assets/caaftv-local.vtt"
            srt={SRT_LOCAL}
            accent="var(--status-info)"
          />
        </DCArtboard>
        <DCArtboard id="elevenlabs-scribe" label="B · ElevenLabs Scribe" width={640} height={840}>
          <EnginePanel
            eyebrow="Cloud · ElevenLabs Scribe"
            title="ElevenLabs Scribe"
            engineNote="Submitted through the dev server's /_api/generate-jobs route — API key resolved server-side, never passed on the CLI"
            src="assets/fd55083e-cloud.mp4"
            srt={SRT_CLOUD}
            accent="var(--accent)"
          />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
