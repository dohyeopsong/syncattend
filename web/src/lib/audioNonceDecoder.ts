// Ultrasonic audio-token DECODER (student browser side).
//
// Ported from mobile/lib/features/attendance/audio_nonce_decoder.dart (READ-ONLY
// reference). The professor web emitter (ultrasonicEmitter.ts) and the Flutter
// decoder agree on this protocol; this port keeps it identical so a browser
// student (iPhone Safari mic) decodes the SAME frames the professor PC emits.
//
// PROTOCOL (must match emitter + Flutter decoder exactly):
//  - Band: 17000–18500 Hz split into 16 tone slots (4 bits/symbol).
//  - Symbol length: 60 ms per symbol.
//  - Framing: a start marker tone (highest slot, 0xF) precedes the nonce
//    symbols. Because slot 15 == 0xF is reserved as the marker, the nonce
//    alphabet is the 15 remaining nibbles [0..e] only.
//  - Encoding: nonce transmitted as 8 hex nibbles, each nibble = one tone slot.
//
// DIFFERENCE FROM FLUTTER: the Flutter decoder runs its own FFT (fftea) on raw
// PCM windows. Here we consume frequency-bin data from a Web Audio AnalyserNode
// (getFloatFrequencyData), which is the browser's native, optimized FFT. The
// slot-detection math (find the loudest slot in the band, threshold against the
// band median) and the run-segmentation state machine are identical, so the
// decode behaviour matches.

export interface DecoderProtocol {
  sampleRate: number;
  bandLowHz: number;
  bandHighHz: number;
  toneSlots: number;
  symbolMs: number;
}

export const DEFAULT_PROTOCOL: DecoderProtocol = {
  sampleRate: 48000,
  bandLowHz: 17000,
  bandHighHz: 18500,
  toneSlots: 16,
  symbolMs: 60,
};

/** How many times above the band's median bin energy a slot must be to count
 *  as "present" (rejects broadband noise). Mirrors the Flutter decoder. */
const DETECTION_THRESHOLD = 4.0;

/** Nibbles carried per acoustic nonce frame (matches backend hex[0-e]{8}). */
const NONCE_NIBBLES = 8;

/**
 * Decodes the dominant tone slot from one frequency-data snapshot (the output
 * of AnalyserNode.getFloatFrequencyData, in dB). Returns the slot index or null
 * if no slot clears the detection threshold.
 *
 * `binHz` is the frequency resolution (sampleRate / fftSize). `freqData` is the
 * full magnitude spectrum (dB values, typically -100..0).
 */
export function decodeSlot(
  freqData: Float32Array,
  binHz: number,
  proto: DecoderProtocol,
  detectionThreshold = DETECTION_THRESHOLD,
): number | null {
  const lowBin = Math.floor(proto.bandLowHz / binHz);
  const highBin = Math.ceil(proto.bandHighHz / binHz);
  if (highBin <= lowBin || highBin >= freqData.length) return null;

  // Collect band magnitudes for the noise floor (median).
  const bandMags: number[] = [];
  for (let i = lowBin; i <= highBin && i < freqData.length; i++) {
    bandMags.push(freqData[i]);
  }
  if (bandMags.length === 0) return null;
  const sorted = [...bandMags].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  // dB values are negative; louder = closer to 0. Find the loudest slot.
  let bestSlot = -1;
  let bestMag = -Infinity;
  const step = (proto.bandHighHz - proto.bandLowHz) / proto.toneSlots;
  for (let slot = 0; slot < proto.toneSlots; slot++) {
    const freq = proto.bandLowHz + step * (slot + 0.5);
    const bin = Math.round(freq / binHz);
    if (bin < 0 || bin >= freqData.length) continue;
    const m = freqData[bin];
    if (m > bestMag) {
      bestMag = m;
      bestSlot = slot;
    }
  }
  if (bestSlot < 0) return null;
  // Louder than median by the threshold (in dB this is a ratio on the linear
  // scale; 4× ≈ 12 dB). Use an absolute dB margin to stay robust to the
  // AnalyserNode's dB scaling.
  const marginDb = 10 * Math.log10(detectionThreshold);
  if (median > -Infinity && bestMag < median + marginDb) return null;
  return bestSlot;
}

/**
 * Real-time run-segmentation decoder for a LIVE microphone stream. Mirrors the
 * Flutter `decodeStreamRealtime` state machine: a sustained tone spans
 * ~hopsPerSymbol oversampled readings; we commit one symbol once a run reaches
 * half a symbol, emitting a nonce the moment a full frame (marker + 8 nibbles)
 * is captured.
 *
 * Usage: create one instance per capture session, call `feed(freqData, binHz)`
 * on every AnalyserNode snapshot (≈ every 15–20 ms), and read the returned
 * nonce string (or null).
 */
export class AudioNonceDecoder {
  private proto: DecoderProtocol;
  private hopsPerSymbol: number;
  private nonceNibbles: number;
  private detectionThreshold: number;

  private markerSlot: number;
  private confirmLen: number;

  private curSlot: number | null = null;
  private curLen = 0;
  private committedInRun = 0;
  private symbols: number[] = [];
  private receiving = false;

  /** Optional diagnostic hook — invoked with every detected slot (or null). */
  onSlot?: (slot: number | null) => void;

  constructor(
    proto: Partial<DecoderProtocol> = {},
    opts: { hopsPerSymbol?: number; nonceNibbles?: number; detectionThreshold?: number } = {},
  ) {
    this.proto = { ...DEFAULT_PROTOCOL, ...proto };
    this.hopsPerSymbol = opts.hopsPerSymbol ?? 4;
    this.nonceNibbles = opts.nonceNibbles ?? NONCE_NIBBLES;
    this.detectionThreshold = opts.detectionThreshold ?? DETECTION_THRESHOLD;
    this.markerSlot = this.proto.toneSlots - 1;
    this.confirmLen = Math.max(
      1,
      Math.min(this.hopsPerSymbol, Math.round(this.hopsPerSymbol / 2)),
    );
  }

  /** Center frequency (Hz) of a tone slot — mirrors decoder.slotFrequency(). */
  slotFrequency(slot: number): number {
    const step = (this.proto.bandHighHz - this.proto.bandLowHz) / this.proto.toneSlots;
    return this.proto.bandLowHz + step * (slot + 0.5);
  }

  /** Reset the framing state (e.g. before a fresh capture). */
  reset() {
    this.curSlot = null;
    this.curLen = 0;
    this.committedInRun = 0;
    this.symbols = [];
    this.receiving = false;
  }

  /**
   * Feed one frequency-data snapshot. Returns a completed nonce string if this
   * reading filled the frame, else null.
   */
  feed(freqData: Float32Array, binHz: number): string | null {
    const slot = decodeSlot(freqData, binHz, this.proto, this.detectionThreshold);
    this.onSlot?.(slot);

    if (slot === this.curSlot) {
      this.curLen++;
    } else {
      this.curSlot = slot;
      this.curLen = slot === null ? 0 : 1;
      this.committedInRun = 0;
    }

    if (slot === null) return null;

    // Emit confirmed symbols online (mirrors the Flutter due/commit logic).
    const due =
      this.curLen < this.confirmLen
        ? 0
        : 1 + Math.floor((this.curLen - this.confirmLen) / this.hopsPerSymbol);
    while (this.committedInRun < due) {
      this.committedInRun++;
      const hex = this.feedSymbol(slot);
      if (hex !== null) return hex;
    }
    return null;
  }

  private feedSymbol(slot: number): string | null {
    if (slot === this.markerSlot) {
      this.receiving = true;
      this.symbols = [];
      return null;
    }
    if (!this.receiving) return null;
    this.symbols.push(slot);
    if (this.symbols.length >= this.nonceNibbles) {
      const hex = this.symbols
        .slice(0, this.nonceNibbles)
        .map((s) => s.toString(16))
        .join("");
      this.symbols = [];
      this.receiving = false;
      return hex;
    }
    return null;
  }
}
