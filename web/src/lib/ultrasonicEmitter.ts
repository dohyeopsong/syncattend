// Ultrasonic audio-token EMITTER (professor / web side).
//
// This is the emit half of the "professor emits ↔ student decodes" spike (TR-0).
// It MUST stay protocol-compatible with the Flutter decoder at
//   mobile/lib/features/attendance/audio_nonce_decoder.dart
// (READ-ONLY reference; owned by B). Confirmed protocol:
//   - Band 18000–20000 Hz, 16 tone slots (4 bits/symbol).
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
  bandLowHz: 18000,
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
 *   [marker] [n0] [n1] ... [n_last]
 * Each symbol occupies `symbolMs` (protocol period). Within a symbol the first
 * `toneFraction` is a raised-cosine tone at the slot frequency; the remainder is
 * a SILENT GUARD. The guard makes the decoder read a null between symbols so
 * identical adjacent nibbles split into separate runs (B's adjacent-nibble fix),
 * while each tone run stays ≈ one symbol long (decoder repeat count = 1).
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
  const symbols: number[] = [MARKER_NIBBLE, ...nibbles];
  const total = symbols.length * samplesPerSymbol;
  const out = new Float32Array(total);

  const rampLen = Math.max(
    1,
    Math.min(Math.floor(toneSamples * opts.rampFraction), Math.floor(toneSamples / 2)),
  );

  let idx = 0;
  for (const sym of symbols) {
    const slot = sym === MARKER_NIBBLE ? markerSlot(proto) : sym;
    const freq = slotFrequency(proto, slot);
    // tone portion
    for (let i = 0; i < toneSamples; i++) {
      let env = 1;
      if (i < rampLen) env = i / rampLen;
      else if (i >= toneSamples - rampLen) env = (toneSamples - 1 - i) / rampLen;
      out[idx++] =
        opts.gain * env * Math.sin((2 * Math.PI * freq * i) / proto.sampleRate);
    }
    // silent guard portion (remainder of the symbol period)
    for (let g = toneSamples; g < samplesPerSymbol; g++) out[idx++] = 0;
  }
  return out;
}

type StopFn = () => void;

/**
 * Real Web Audio emitter. Schedules the frame as an AudioBuffer and re-arms it
 * on an interval while the auth window is open. All scheduling uses the
 * AudioContext clock for jitter-free symbol timing.
 */
export class UltrasonicEmitter {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private repeatTimer: ReturnType<typeof setInterval> | null = null;
  private currentSource: AudioBufferSourceNode | null = null;

  private proto: EmitterProtocol;
  private gain: number;
  private toneFraction: number;
  private rampFraction: number;

  constructor(proto: Partial<EmitterProtocol> = {}, opts: EmitterOptions = {}) {
    this.proto = { ...DEFAULT_PROTOCOL, ...proto };
    this.gain = opts.gain ?? 0.6;
    this.toneFraction = opts.toneFraction ?? 0.6;
    this.rampFraction = opts.rampFraction ?? 0.1;
  }

  /** Effective sample rate (AudioContext may pick its own; we resync proto). */
  get sampleRate(): number {
    return this.ctx?.sampleRate ?? this.proto.sampleRate;
  }

  setGain(gain: number) {
    this.gain = Math.max(0, Math.min(1, gain));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.gain, this.ctx.currentTime, 0.01);
    }
  }

  setBand(lowHz: number, highHz: number) {
    this.proto = { ...this.proto, bandLowHz: lowHz, bandHighHz: highHz };
  }

  setToneFraction(f: number) {
    this.toneFraction = Math.max(0.3, Math.min(1, f));
  }

  private ensureContext() {
    if (!this.ctx) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new Ctx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.gain;
      this.masterGain.connect(this.ctx.destination);
      // Keep proto sample rate aligned with the real context rate.
      this.proto = { ...this.proto, sampleRate: this.ctx.sampleRate };
    }
    return this.ctx;
  }

  private playFrameOnce(nonce: string) {
    const ctx = this.ensureContext();
    if (!this.masterGain) return;
    const nibbles = nonceToNibbles(nonce).slice(0, 8); // 8-nibble frame
    if (nibbles.length === 0) return;
    const pcm = buildFramePcm(this.proto, nibbles, {
      gain: 1, // masterGain applies output level; keep buffer normalized
      toneFraction: this.toneFraction,
      rampFraction: this.rampFraction,
    });
    const buffer = ctx.createBuffer(1, pcm.length, this.proto.sampleRate);
    buffer.getChannelData(0).set(pcm);

    // Stop any in-flight frame before scheduling the next.
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch {
        // already stopped
      }
      this.currentSource.disconnect();
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.masterGain);
    src.start();
    this.currentSource = src;
  }

  /**
   * Start emitting `nonce` immediately and repeat every `repeatMs` until
   * stopped. The dashboard calls this each time a new nonce arrives from
   * getSessionToken (tokens rotate ~15 s). Returns a stop function.
   */
  async start(nonce: string, repeatMs = 1000): Promise<StopFn> {
    const ctx = this.ensureContext();
    if (ctx.state === "suspended") await ctx.resume();
    this.stop();
    this.playFrameOnce(nonce);
    this.repeatTimer = setInterval(() => this.playFrameOnce(nonce), repeatMs);
    return () => this.stop();
  }

  /** Switch the active nonce without tearing down the context. */
  update(nonce: string, repeatMs = 1000) {
    if (!this.ctx) return;
    this.stop();
    this.playFrameOnce(nonce);
    this.repeatTimer = setInterval(() => this.playFrameOnce(nonce), repeatMs);
  }

  stop() {
    if (this.repeatTimer) {
      clearInterval(this.repeatTimer);
      this.repeatTimer = null;
    }
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch {
        // already stopped
      }
      this.currentSource.disconnect();
      this.currentSource = null;
    }
  }

  /** Fully release the AudioContext. */
  async dispose() {
    this.stop();
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
      this.masterGain = null;
    }
  }
}
