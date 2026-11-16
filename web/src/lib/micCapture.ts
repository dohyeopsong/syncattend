// Microphone capture + ultrasonic nonce decode (student browser side).
//
// Web Audio API equivalent of the Flutter AudioCaptureService: opens the mic,
// feeds frequency-bin snapshots to an AudioNonceDecoder, and emits decoded
// nonce strings. Designed for iPhone Safari (the mic captures 17–18.5 kHz
// ultrasonic frames emitted by the professor PC speaker, same as the Flutter
// app on the same hardware).
//
// WHY AnalyserNode (not raw PCM + custom FFT): the browser's native AnalyserNode
// performs an optimized FFT and exposes the magnitude spectrum directly via
// getFloatFrequencyData. The slot-detection + run-segmentation logic in
// audioNonceDecoder.ts is identical to the Flutter decoder, so decode behaviour
// matches without reimplementing FFT in JS.

import {
  AudioNonceDecoder,
  DEFAULT_PROTOCOL,
  type DecoderProtocol,
} from "./audioNonceDecoder";

export interface CaptureOptions {
  protocol?: Partial<DecoderProtocol>;
  /** Polling interval (ms). Symbol = 60ms, hopsPerSymbol = 4 → ideal 15ms.
   *  15ms keeps oversampling dense enough for run-segmentation. */
  pollIntervalMs?: number;
  /** AnalyserNode FFT size (power of 2). 2048 → binHz ≈ 23 Hz at 48 kHz,
   *  enough resolution to separate 16 slots across 17000–18500 Hz. */
  fftSize?: number;
}

export class MicCaptureService {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private decoder: AudioNonceDecoder;
  private pollIntervalMs: number;
  private fftSize: number;
  private proto: DecoderProtocol;
  private freqBuf: Float32Array | null = null;

  constructor(opts: CaptureOptions = {}) {
    this.proto = { ...DEFAULT_PROTOCOL, ...opts.protocol };
    this.pollIntervalMs = opts.pollIntervalMs ?? 15;
    this.fftSize = opts.fftSize ?? 2048;
    this.decoder = new AudioNonceDecoder(this.proto);
  }

  /** Diagnostic hook — invoked with every detected slot (or null). */
  set onSlot(fn: (slot: number | null) => void | undefined) {
    this.decoder.onSlot = fn;
  }

  /**
   * Start microphone capture and decode. Resolves once the mic stream is open
   * and the polling loop is running; `onNonce` is called (asynchronously) each
   * time a full nonce frame is decoded.
   *
   * MUST be called from a user gesture (button click) — Safari only grants mic
   * access + starts AudioContext inside a gesture handler.
   */
  async start(onNonce: (nonce: string) => void): Promise<void> {
    if (this.audioCtx) return; // already running

    // Request the mic. Safari prompts for permission on first call.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false, // ultrasonic band must NOT be filtered out
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });

    // Try 48 kHz (iOS hardware-native; matches the Flutter capture). If the
    // browser refuses, it falls back to its default (often 44100) — the decoder
    // uses the ACTUAL context sampleRate so slot bins stay correct.
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    try {
      this.audioCtx = new Ctx({ sampleRate: this.proto.sampleRate });
    } catch {
      this.audioCtx = new Ctx();
    }
    if (this.audioCtx.state === "suspended") {
      await this.audioCtx.resume();
    }

    this.source = this.audioCtx.createMediaStreamSource(this.stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = this.fftSize;
    this.analyser.smoothingTimeConstant = 0; // no inter-frame smoothing — we
    // want each snapshot to reflect the CURRENT tone, not a trailing average.
    this.source.connect(this.analyser);

    // Adjust the protocol sampleRate to the ACTUAL context rate so bin
    // frequencies map correctly (slotFrequency math is rate-independent, but
    // the decoder logs and any future PCM path use it).
    this.proto = { ...this.proto, sampleRate: this.audioCtx.sampleRate };
    this.freqBuf = new Float32Array(this.analyser.frequencyBinCount);

    const binHz = this.audioCtx.sampleRate / this.analyser.fftSize;
    this.decoder.reset();

    this.timer = setInterval(() => {
      if (!this.analyser || !this.freqBuf) return;
      this.analyser.getFloatFrequencyData(
        this.freqBuf as unknown as Float32Array<ArrayBuffer>,
      );
      const nonce = this.decoder.feed(this.freqBuf, binHz);
      if (nonce) onNonce(nonce);
    }, this.pollIntervalMs);
  }

  /** Stop capture (idempotent). Releases the mic and closes the AudioContext. */
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        /* already disconnected */
      }
      this.source = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch {
        /* no-op */
      }
      this.analyser = null;
    }
    if (this.audioCtx) {
      try {
        await this.audioCtx.close();
      } catch {
        /* already closed */
      }
      this.audioCtx = null;
    }
    this.freqBuf = null;
  }
}
