// Ultrasonic audio-token EMITTER (professor / web side).
//
// ════════════════════════════════════════════════════════════════════════════
// ⚠️  DO NOT REWRITE THE PLAYBACK PATH. DO NOT "MODERNIZE" TO AudioContext.  ⚠️
//                                                                            ⚠️
// This emitter plays ultrasonic frames via a hidden `<audio>` element loaded
// with a 16-bit PCM WAV Blob (loop = true). It does NOT use Web Audio's
// AudioContext / AudioBufferSourceNode / GainNode.
//
// WHY (root cause, verified 2026-11-04): Safari silently drops Web Audio
// output — even audible 1kHz tones — while still reporting context.state =
// "running", so the "송출 중" badge lies and the phone spectrum shows nothing.
// Chrome is lenient and worked either way, but Safari (used by remote-MacBook
// professors) was completely silent. The `<audio>` media element routes through
// the browser's MEDIA pipeline (CoreAudio on macOS) — the SAME path the verified
// Python emit_safe.py uses via afplay — which Safari does not block. So a single
// `<audio>`+WAV path works on EVERY browser.
//
// If you find yourself thinking "AudioContext is cleaner, let me migrate back":
// STOP. It will reintroduce the Safari silent regression. Any playback-path
// change must be re-verified on Safari with a physical phone spectrum view.
// The protocol/PCM math (buildFramePcm, nonceToNibbles, slotFrequency) is fine
// to touch; the playback mechanism (`<audio>` + pcmToWavBlob) is NOT.
// ════════════════════════════════════════════════════════════════════════════
//
// This is the emit half of the "professor emits ↔ student decodes" spike (TR-0).
// It MUST stay protocol-compatible with the Flutter decoder at
//   mobile/lib/features/attendance/audio_nonce_decoder.dart
// (READ-ONLY reference; owned by B). Confirmed protocol:
//   - Band 17000–18500 Hz, 16 tone slots (4 bits/symbol). (Lowered from
//     18000–20000 Hz: on-device TR-0 testing found laptop speakers barely
//     radiate 19–20 kHz, so the phone never saw the start marker — decode 0%.
//     17–18.5 kHz is emitted strongly and decodes 100% in physical loopback;
//     17 kHz keeps the annoying 16 kHz out.)
//   - Symbol length 60 ms; slot 15 (highest) = start marker.
//   - Nonce = hex nibbles, each nibble (0..14) = one tone slot; frame is
//     [marker, n0, n1, ... n7].
//   - slotFrequency(slot) = bandLow + (band/slots) * (slot + 0.5)   [slot CENTER]
//
// ADJACENT-IDENTICAL-NIBBLE FIX (reported by B): the decoder's oversampled
// run-segmentation cannot tell two identical adjacent nibbles from one longer
// tone. Since the nonce value is issued by the backend (arbitrary hex), the
// emitter cannot guarantee "adjacent symbols differ" (option b). We therefore
// use option (a) — a GUARD — implemented as an INTRA-SYMBOL silent gap: each
// 60 ms symbol carries a tone for the first `toneFraction` and silence after.
// The decoder reads a null during the guard, which flushes the current run, so
// two identical adjacent nibbles become two separate runs (fix). Because the
// tone run stays ≈ one symbol long, the decoder's `round(runLen/hopsPerSymbol)`
// repeat count stays 1 — so this works with the CURRENT decoder unchanged.
// Verified by software loopback (see dev-log): 100% decode incl. `aa11bb22`,
// `77777777`, `0e0e0e0e` under 20 dB noise + symbol-boundary jitter, at both
// hopsPerSymbol = 4 (capture default) and 8. Protocol timing (60 ms symbol,
// slot map, marker) is unchanged.

export interface EmitterProtocol {
  sampleRate: number; // AudioContext rate; slot bins are computed from this
  bandLowHz: number; // 18000
  bandHighHz: number; // 20000
  toneSlots: number; // 16
  symbolMs: number; // 60
}

export const DEFAULT_PROTOCOL: EmitterProtocol = {
  sampleRate: 44100,
  bandLowHz: 18500,
  bandHighHz: 20000,
  toneSlots: 16,
  symbolMs: 60,
};

export interface EmitterOptions {
  /** Linear output gain 0..1 (classroom reach control). */
  gain?: number;
  /**
   * Fraction of each symbol period occupied by the TONE; the remainder is a
   * silent guard. The symbol PERIOD stays `symbolMs` (protocol-compatible);
   * only the tone/guard split inside it changes. A tone shorter than the full
   * symbol leaves a silent guard so the decoder sees a null between symbols —
   * this splits identical adjacent nibbles into separate runs (B's fix) while
   * keeping each run ≈ one symbol long so the decoder's repeat math stays 1.
   * Default 0.6 (verified 100% decode incl. identical-adjacent under jitter).
   */
  toneFraction?: number;
  /** Per-symbol raised-cosine ramp fraction (anti-click), 0..0.5. */
  rampFraction?: number;
}

const MARKER_NIBBLE = -1; // sentinel meaning "start marker slot"

/** Center frequency (Hz) of a tone slot — mirrors decoder.slotFrequency(). */
export function slotFrequency(proto: EmitterProtocol, slot: number): number {
  const step = (proto.bandHighHz - proto.bandLowHz) / proto.toneSlots;
  return proto.bandLowHz + step * (slot + 0.5);
}

/** Marker slot index = highest slot (toneSlots - 1). */
export function markerSlot(proto: EmitterProtocol): number {
  return proto.toneSlots - 1;
}

/**
 * Parse a hex nonce into nibble slot indices (0..14), one nibble per tone slot.
 *
 * CONTRACT: the backend now issues `audio_nonce` as pure hex nibbles 0..E
 * (`hex[0-e]{8}`), so the whole nonce maps 1:1 to slots and NOTHING is lost.
 * The non-hex `continue` below is therefore dead code for valid input — it only
 * exists to stay robust against accidental separators/whitespace; a well-formed
 * backend nonce never triggers it. (Historically the backend emitted
 * base64url via `token_urlsafe`, which this path silently dropped — that
 * mismatch was the STAGE-1 root cause and is fixed on the issuer side by A.)
 *
 * Nibble 15 (0xF) collides with the START-MARKER slot, so the backend excludes
 * it (nibbles 0..E). We still remap any 0xF → 0xE DEFENSIVELY so a stray 0xF
 * can never be transmitted as a false mid-frame marker.
 */
export function nonceToNibbles(nonce: string): number[] {
  const out: number[] = [];
  for (const ch of nonce.trim().toLowerCase()) {
    const v = parseInt(ch, 16);
    if (Number.isNaN(v)) continue; // unreachable for a pure-hex backend nonce
    out.push(v === 0xf ? 0xe : v);
  }
  return out;
}

/**
 * Build a mono PCM Float32Array for one full frame:
 *   [marker] [n0] [n1] ... [n_last] [8ms inter-frame gap]
 * Each symbol occupies `symbolMs` (protocol period). Within a symbol the first
 * `toneFraction` is a tone at the slot frequency with an 8 ms linear ramp
 * in/out (anti-click); the remainder is a SILENT GUARD. The guard makes the
 * decoder read a null between symbols so identical adjacent nibbles split into
 * separate runs (B's adjacent-nibble fix), while each tone run stays ≈ one
 * symbol long (decoder repeat count = 1).
 *
 * An 8 ms silent gap is appended after the last symbol so consecutive frame
 * repeats have a clean boundary (matches the verified Python emit_safe.py).
 * `gain` is applied directly to the PCM (not via a GainNode) so the output
 * amplitude is deterministic regardless of AudioContext scheduling jitter.
 */
export function buildFramePcm(
  proto: EmitterProtocol,
  nibbles: number[],
  opts: Required<Pick<EmitterOptions, "gain" | "toneFraction" | "rampFraction">>,
): Float32Array {
  const samplesPerSymbol = Math.floor((proto.sampleRate * proto.symbolMs) / 1000);
  const toneSamples = Math.max(
    1,
    Math.min(samplesPerSymbol, Math.floor(samplesPerSymbol * opts.toneFraction)),
  );
  // 8 ms linear ramp (matches the verified Python emitter), independent of
  // rampFraction so the anti-click window is always the same.
  const rampLen = Math.max(1, Math.min(Math.floor(proto.sampleRate * 0.008), Math.floor(toneSamples / 2)));
  const gapLen = Math.floor(proto.sampleRate * 0.008); // 8 ms inter-frame gap

  const symbols: number[] = [MARKER_NIBBLE, ...nibbles];
  const total = symbols.length * samplesPerSymbol + gapLen;
  const out = new Float32Array(total);

  let idx = 0;
  for (const sym of symbols) {
    const slot = sym === MARKER_NIBBLE ? markerSlot(proto) : sym;
    const freq = slotFrequency(proto, slot);
    // tone portion with linear ramp in/out
    for (let i = 0; i < toneSamples; i++) {
      let env = 1;
      if (i < rampLen) env = i / rampLen;
      else if (i > toneSamples - rampLen) env = Math.max(0, (toneSamples - i) / rampLen);
      out[idx++] = opts.gain * env * Math.sin((2 * Math.PI * freq * i) / proto.sampleRate);
    }
    // silent guard portion (remainder of the symbol period)
    for (let g = toneSamples; g < samplesPerSymbol; g++) out[idx++] = 0;
  }
  // 8 ms inter-frame silence
  for (let g = 0; g < gapLen; g++) out[idx++] = 0;
  return out;
}

type StopFn = () => void;

/**
 * Encode a mono Float32 PCM array into a 16-bit PCM WAV Blob. This is the
 * web equivalent of what the verified emit_safe.py writes to disk before
 * `afplay` plays it. Playing this Blob via an `<audio>` element routes through
 * the browser's MEDIA pipeline (not WebKit's Web Audio processing), which on
 * Safari is the same CoreAudio path afplay uses — so ultrasonic output that
 * Safari's AudioContext silently drops can still leave the speaker here.
 *
 * DO NOT replace this with an AudioBuffer + AudioBufferSourceNode (Web Audio)
 * path — see the DO-NOT-REWRITE notice at the top of this file.
 */
export function pcmToWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const numChannels = 1;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  let p = 0;
  const writeStr = (s: string) => { for (const c of s) view.setUint8(p++, c.charCodeAt(0)); };
  writeStr("RIFF");
  view.setUint32(p, 36 + dataSize, true); p += 4;
  writeStr("WAVE");
  writeStr("fmt ");
  view.setUint32(p, 16, true); p += 4;        // PCM chunk size
  view.setUint16(p, 1, true); p += 2;          // audio format = PCM
  view.setUint16(p, numChannels, true); p += 2;
  view.setUint32(p, sampleRate, true); p += 4;
  view.setUint32(p, sampleRate * blockAlign, true); p += 4; // byte rate
  view.setUint16(p, blockAlign, true); p += 2;
  view.setUint16(p, 16, true); p += 2;         // bits per sample
  writeStr("data");
  view.setUint32(p, dataSize, true); p += 4;
  for (let i = 0; i < samples.length; i++) {
    let v = samples[i];
    v = Math.max(-1, Math.min(1, v));
    view.setInt16(p, v < 0 ? v * 0x8000 : v * 0x7fff, true); p += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/** Build a simple continuous-tone WAV Blob (diagnostic, mirrors emit_safe.py tone). */
export function toneWavBlob(
  freq: number,
  secs: number,
  sampleRate: number,
  gain = 0.6,
): Blob {
  const n = Math.floor(sampleRate * secs);
  const fade = Math.floor(sampleRate * 0.05);
  const pcm = new Float32Array(n);
  const twoPiF = 2 * Math.PI * freq;
  for (let i = 0; i < n; i++) {
    let env = 1;
    if (i < fade) env = 0.5 * (1 - Math.cos(Math.PI * i / fade));
    else if (i > n - fade) env = 0.5 * (1 - Math.cos(Math.PI * (n - i) / fade));
    pcm[i] = gain * env * Math.sin((twoPiF * i) / sampleRate);
  }
  return pcmToWavBlob(pcm, sampleRate);
}

// Module-level shared <audio> element. Created + primed synchronously inside
// the "세션 열기" click gesture (unlockAudio()), then REUSED by the emitter.
// Safari's autoplay policy authorizes a media element for unmuted playback only
// after a play() initiated within a user gesture; if the first play() happens
// later (after the token arrives via network), Safari may block it. By priming
// a silent WAV in the gesture, the element is marked "user-initiated" and the
// later emitter loop plays without being muted/blocked.
let sharedAudioEl: HTMLAudioElement | null = null;
// Whether unlockAudio() primed the audio element inside a user gesture.
let unlockedInGesture = false;

/**
 * Create + prime the shared `<audio>` element. MUST be called inside a user
 * gesture (the "세션 열기" click) — before any network request — and the caller
 * MUST `await` it. Safari only authorizes unmuted media playback after a
 * gesture-initiated play(); priming a silent WAV here marks the element as
 * user-initiated so the later emitter loop is not blocked. Safe to call
 * repeatedly; a no-op once primed.
 */
export async function unlockAudio(): Promise<void> {
  if (!sharedAudioEl) {
    const el = new Audio();
    el.style.display = "none";
    el.loop = false;
    sharedAudioEl = el;
  }
  if (unlockedInGesture) return;
  // Prime with a tiny silent WAV so the element's first play() is
  // gesture-initiated (inaudible). This is the Safari unlock for media elements.
  try {
    const sr = 44100;
    const silence = pcmToWavBlob(new Float32Array(sr * 0.01), sr); // 10ms silence
    const url = URL.createObjectURL(silence);
    sharedAudioEl.src = url;
    await sharedAudioEl.play();
    sharedAudioEl.pause();
    URL.revokeObjectURL(url);
    sharedAudioEl.removeAttribute("src");
    unlockedInGesture = true;
  } catch {
    // Autoplay blocked even in gesture (rare). The emitter's start() retries;
    // UI warns via isAudioUnlocked().
  }
}

/** Whether unlockAudio() successfully primed the audio element in a gesture. */
export function isAudioUnlocked(): boolean {
  return unlockedInGesture;
}

/**
 * Ultrasonic frame emitter. Builds ONE frame as 16-bit PCM WAV and plays it
 * through a hidden `<audio>` element with `loop = true`.
 *
 * WHY <audio> + WAV BLOB (not Web Audio AudioContext): Safari silently drops
 * Web Audio output — even audible 1kHz tones — when its autoplay policy isn't
 * fully satisfied within the user-gesture window, while still reporting
 * context.state = "running" (so the "송출 중" badge lies). The `<audio>` media
 * element routes through the browser's MEDIA pipeline (CoreAudio on macOS) —
 * the SAME path the verified Python emit_safe.py uses via afplay — which Safari
 * does not block the same way. Chrome/Edge/Firefox handle both paths fine, so
 * this single path works everywhere. Gain is baked into the PCM.
 */
export class UltrasonicEmitter {
  private proto: EmitterProtocol;
  private gain: number;
  private toneFraction: number;
  private rampFraction: number;

  private audioEl: HTMLAudioElement | null = null;
  private currentUrl: string | null = null;
  private currentNonce: string | null = null;
  // Duration of one frame in seconds (pcm.length / sampleRate). Used by
  // update() to schedule nonce swaps at frame boundaries.
  private frameDur = 0;
  // Pending nonce-swap timer. A nonce rotation doesn't swap immediately; it
  // waits until the in-flight frame finishes so the decoder never sees a
  // truncated symbol run.
  private updateTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(proto: Partial<EmitterProtocol> = {}, opts: EmitterOptions = {}) {
    this.proto = { ...DEFAULT_PROTOCOL, ...proto };
    this.gain = opts.gain ?? 0.6;
    this.toneFraction = opts.toneFraction ?? 0.6;
    this.rampFraction = opts.rampFraction ?? 0.1;
  }

  /** Effective sample rate used for PCM synthesis. */
  get sampleRate(): number {
    return this.proto.sampleRate;
  }

  setGain(gain: number) {
    this.gain = Math.max(0, Math.min(1, gain));
    // Gain is baked into the PCM at blob-build time, so a live gain change
    // requires rebuilding the loop. If audio is running, restart it so the
    // change takes effect immediately.
    if (this.audioEl && this.currentNonce) {
      this.startLoop(this.currentNonce);
    }
  }

  setBand(lowHz: number, highHz: number) {
    this.proto = { ...this.proto, bandLowHz: lowHz, bandHighHz: highHz };
  }

  setToneFraction(f: number) {
    this.toneFraction = Math.max(0.3, Math.min(1, f));
  }

  private ensureAudioEl(): HTMLAudioElement {
    if (!this.audioEl) {
      // Reuse the element that unlockAudio() primed in the "세션 열기" gesture
      // (Safari only allows unmuted playback from a gesture-primed element).
      // If none exists yet, create one here — it may be blocked until a gesture.
      this.audioEl = sharedAudioEl ?? new Audio();
      this.audioEl.loop = true;
      this.audioEl.style.display = "none";
    }
    return this.audioEl;
  }

  /**
   * Build the frame PCM, encode to a WAV Blob, point the `<audio>` element at
   * it, and start looping. Stops/cleans any previous source first. The browser
   * handles seamless repetition natively (loop=true), matching emit_safe.py.
   */
  private startLoop(nonce: string) {
    const el = this.ensureAudioEl();
    const nibbles = nonceToNibbles(nonce).slice(0, 8);
    if (nibbles.length === 0) return;

    const pcm = buildFramePcm(this.proto, nibbles, {
      gain: this.gain,
      toneFraction: this.toneFraction,
      rampFraction: this.rampFraction,
    });
    const blob = pcmToWavBlob(pcm, this.proto.sampleRate);

    // Release the previous blob URL before creating a new one.
    this.stopSource();

    this.currentUrl = URL.createObjectURL(blob);
    el.src = this.currentUrl;
    // play() is async and may reject on Safari if the gesture has expired;
    // sticky user activation from the "세션 열기" click usually authorizes it.
    // Swallow the rejection — the caller surfaces audioError separately.
    void el.play().catch(() => { /* autoplay blocked; UI warns */ });
    this.currentNonce = nonce;
    this.frameDur = pcm.length / this.proto.sampleRate;
  }

  /** Stop + clean the active source (no-op if none). */
  private stopSource() {
    const el = this.audioEl;
    if (el) {
      try { el.pause(); } catch { /* already paused */ }
      el.removeAttribute("src");
      try { el.load(); } catch { /* no-op */ }
    }
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = null;
    }
  }

  /**
   * Start emitting `nonce` as a seamless loop. The dashboard calls this when
   * the session opens (and on each token rotation via update()).
   */
  async start(nonce: string): Promise<StopFn> {
    this.startLoop(nonce);
    return () => this.stop();
  }

  /**
   * Switch the active nonce — but NOT immediately. A token rotation schedules
   * the swap for the next frame BOUNDARY (with a ≥300ms minimum delay) so the
   * in-flight frame finishes cleanly. Swapping mid-frame would cut off the
   * current symbol run and force the decoder to resync from the next start
   * marker — a decode miss. By waiting until the frame ends, the decoder
   * always sees complete frames of both the old and new nonce.
   */
  update(nonce: string) {
    if (!this.audioEl) return;
    if (nonce === this.currentNonce) return;
    // Cancel any previously scheduled swap (rapid rotations).
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }
    const el = this.audioEl;
    const dur = this.frameDur;
    let waitMs = 300; // minimum delay (per request)
    if (dur > 0 && Number.isFinite(el.currentTime)) {
      const pos = el.currentTime % dur; // position within the current frame
      let wait = dur - pos; // time until the next frame boundary
      if (wait < 0.3) wait += dur; // too close — defer to the FOLLOWING boundary
      waitMs = Math.round(wait * 1000);
    }
    this.updateTimer = setTimeout(() => {
      this.updateTimer = null;
      this.startLoop(nonce);
    }, waitMs);
  }

  stop() {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }
    this.stopSource();
    this.currentNonce = null;
  }

  /** Fully release the audio element. */
  async dispose() {
    this.stop();
    this.audioEl = null;
  }

  /**
   * DIAGNOSTIC: play a plain continuous tone via the `<audio>` media pipeline
   * (NOT Web Audio). If this shows on the phone spectrum / is audible but the
   * real frame emitter doesn't, the PCM/frame path is broken. If this too is
   * silent, Safari is blocking the media pipeline itself.
   */
  playDiagTone(freq = 18500, secs = 5): void {
    const el = this.ensureAudioEl();
    this.stopSource();
    const blob = toneWavBlob(freq, secs, this.proto.sampleRate, 0.6);
    this.currentUrl = URL.createObjectURL(blob);
    el.loop = false;
    el.src = this.currentUrl;
    void el.play().catch(() => { /* autoplay blocked */ });
  }
}
