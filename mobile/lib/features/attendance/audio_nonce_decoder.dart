import 'dart:async';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:fftea/fftea.dart';

/// Ultrasonic audio-token decoder (student side).
///
/// HIGHEST-RISK component (TR-0 / docs/11_TRD.md). This implements the decode
/// half of the "professor emits ↔ student decodes" spike. The exact protocol
/// (frequency map, symbol length, encoding) MUST be agreed with owner C.
///
/// PROTOCOL (CONFIRMED with owner A's contract + owner C's emitter, 2026-09-25):
///  - Band: 18–20 kHz split into N tone slots (default 16 → 4 bits/symbol).
///  - Symbol length: [symbolMs] ms per symbol (default 60ms).
///  - Framing: a start marker tone (highest slot, 0xF) precedes the nonce
///    symbols. Because slot 15 == 0xF is reserved as the marker, the nonce
///    alphabet is the 15 remaining nibbles [0-e] only.
///  - Encoding: nonce transmitted as [nonceNibbles] hex nibbles, each nibble =
///    one tone slot.
///
/// ALPHABET ALIGNMENT: the backend now issues `audio_nonce` as `hex[0-e]{8}`
/// (8 nibbles, no `f`), which matches this decoder's frame exactly — an acoustic
/// round-trip of the *real* server nonce is now end-to-end valid. (Previously
/// the backend issued a base64url `token_urlsafe` string whose non-hex chars
/// were silently dropped by the emitter, so no faithful round-trip was possible.
/// No `f` can appear in a well-formed nonce, so the old `0xF→0xE` marker-collision
/// remap can no longer corrupt a real nonce.)
///
/// If real-classroom feasibility is insufficient, the fallback (per TR-0) is a
/// lower audible band or an on-screen assist code; this decoder's slot map is
/// parameterised so only [bandLowHz]/[bandHighHz] need to change.
class AudioNonceDecoder {
  AudioNonceDecoder({
    this.sampleRate = 44100,
    this.bandLowHz = 18000,
    this.bandHighHz = 20000,
    this.toneSlots = 16,
    this.symbolMs = 60,
    this.detectionThreshold = 4.0,
  }) : _fft = FFT(_fftSizeForSymbol((sampleRate * symbolMs) ~/ 1000));

  final int sampleRate;
  final double bandLowHz;
  final double bandHighHz;

  /// Number of discrete tone slots in the band. 16 slots → 4 bits/symbol.
  final int toneSlots;

  /// Duration of one transmitted symbol.
  final int symbolMs;

  /// How many times above the band's median bin energy a slot must be to count
  /// as "present" (rejects broadband noise).
  final double detectionThreshold;

  final FFT _fft;

  /// The tone slot reserved as the frame START MARKER: the highest slot
  /// ([toneSlots] - 1), i.e. 15 == 0xF for the default 16-slot map. Reserving
  /// this slot is why the nonce alphabet excludes `f` (see [nonceAlphabet]).
  int get markerSlot => toneSlots - 1;

  /// Nibbles carried per acoustic nonce frame. Matches the backend's
  /// `audio_nonce = hex[0-e]{8}`.
  static const int defaultNonceNibbles = 8;

  /// The valid hex nibbles a well-formed acoustic nonce may contain: `0..e`.
  /// `f` is excluded because slot 0xF is the start marker ([markerSlot]).
  static const String nonceAlphabet = '0123456789abcde';

  int get _windowSize => _fft.size;

  /// Frequency (Hz) at the center of tone slot [slot].
  double slotFrequency(int slot) {
    final step = (bandHighHz - bandLowHz) / toneSlots;
    return bandLowHz + step * (slot + 0.5);
  }

  /// Decodes the dominant tone slot from one window of PCM samples (mono,
  /// [-1,1] floats). Returns null if no slot clears [detectionThreshold].
  int? decodeSlot(Float64List window) {
    if (window.length < _windowSize) return null;
    final frame = Float64List(_windowSize);
    // Hann window to reduce spectral leakage.
    for (var i = 0; i < _windowSize; i++) {
      final w = 0.5 - 0.5 * math.cos(2 * math.pi * i / (_windowSize - 1));
      frame[i] = window[i] * w;
    }
    final freq = _fft.realFft(frame);
    final mags = freq.magnitudes();

    final binHz = sampleRate / _windowSize;
    final lowBin = (bandLowHz / binHz).floor().clamp(0, mags.length - 1);
    final highBin = (bandHighHz / binHz).ceil().clamp(0, mags.length - 1);
    if (highBin <= lowBin) return null;

    // Median band energy for the noise floor.
    final bandMags = mags.sublist(lowBin, highBin).toList()..sort();
    final median = bandMags.isEmpty
        ? 0.0
        : bandMags[bandMags.length ~/ 2];

    var bestSlot = -1;
    var bestMag = 0.0;
    for (var slot = 0; slot < toneSlots; slot++) {
      final f = slotFrequency(slot);
      final bin = (f / binHz).round().clamp(0, mags.length - 1);
      final m = mags[bin];
      if (m > bestMag) {
        bestMag = m;
        bestSlot = slot;
      }
    }
    if (bestSlot < 0) return null;
    if (median > 0 && bestMag < median * detectionThreshold) return null;
    return bestSlot;
  }

  /// Consumes a stream of PCM sample windows and yields decoded nonce strings
  /// once a full frame (start marker + symbols) is captured.
  ///
  /// This is a pragmatic spike-level decoder; the framing state machine will be
  /// tuned against owner C's real emitter.
  Stream<String> decodeStream(Stream<Float64List> windows) async* {
    final symbols = <int>[];
    var receiving = false;

    await for (final window in windows) {
      final slot = decodeSlot(window);
      if (slot == null) continue;
      final isMarker = slot == markerSlot; // highest slot (0xF) = start marker

      if (isMarker) {
        if (receiving && symbols.isNotEmpty) {
          yield _symbolsToHex(symbols);
          symbols.clear();
        }
        receiving = true;
        continue;
      }
      if (receiving) {
        symbols.add(slot);
        // A nonce of [defaultNonceNibbles] hex nibbles matches the backend's
        // hex[0-e]{8} audio_nonce.
        if (symbols.length >= defaultNonceNibbles) {
          yield _symbolsToHex(symbols);
          symbols.clear();
          receiving = false;
        }
      }
    }
  }

  String _symbolsToHex(List<int> symbols) {
    final sb = StringBuffer();
    for (final s in symbols) {
      sb.write(s.toRadixString(16));
    }
    return sb.toString();
  }

  /// Robust variant of [decodeStream] for OVERSAMPLED input, where the capture
  /// layer emits [hopsPerSymbol] overlapping windows per symbol (hop =
  /// symbol/[hopsPerSymbol]). A single non-overlapping window per symbol is
  /// fragile under symbol-boundary jitter (measured ~42%). This variant is
  /// alignment-free: it segments the oversampled slot readings into RUNS of the
  /// same slot (each sustained tone = one run ≈ [hopsPerSymbol] readings long),
  /// which naturally recovers symbol boundaries no matter where capture started.
  ///
  /// PROTOCOL NOTE (report to owner C): run segmentation cannot distinguish two
  /// identical adjacent nibbles from one longer tone. The emitter must therefore
  /// either (a) insert a short guard/marker tone between symbols, or (b) use an
  /// encoding where adjacent symbols differ. Until then, run length is also used
  /// to split unusually long runs (≈2× a symbol) into repeated symbols as a
  /// best-effort heuristic.
  ///
  /// This is the reliability hook called out in TR-0 for real-classroom use; it
  /// keeps the same framing (highest slot = start marker, then 8 hex nibbles).
  Stream<String> decodeStreamOversampled(
    Stream<Float64List> windows, {
    int hopsPerSymbol = 4,
    int nonceNibbles = defaultNonceNibbles,
  }) async* {
    final markerSlot = this.markerSlot;
    final readings = <int?>[];
    await for (final window in windows) {
      readings.add(decodeSlot(window));
    }

    // Segment into runs of equal slot, ignoring nulls (silence/gaps break runs).
    final runs = <({int slot, int len})>[];
    int? cur;
    var len = 0;
    void flush() {
      if (cur != null && len > 0) runs.add((slot: cur!, len: len));
      cur = null;
      len = 0;
    }

    for (final r in readings) {
      if (r == null) {
        flush();
        continue;
      }
      if (r == cur) {
        len++;
      } else {
        flush();
        cur = r;
        len = 1;
      }
    }
    flush();

    // A valid symbol run should be roughly one symbol long. Runs much shorter
    // than a symbol are transition/edge artifacts and are dropped. Runs much
    // longer are split into repeats (best-effort; see PROTOCOL NOTE).
    final minRun = (hopsPerSymbol / 2).floor().clamp(1, hopsPerSymbol);
    final symbols = <int>[];
    var receiving = false;

    void addSlot(int slot, int runLen) {
      final repeats = (runLen / hopsPerSymbol).round().clamp(1, 8);
      for (var i = 0; i < repeats; i++) {
        if (slot == markerSlot) {
          receiving = true;
          symbols.clear();
        } else if (receiving) {
          symbols.add(slot);
        }
      }
    }

    for (final run in runs) {
      if (run.len < minRun && run.slot != markerSlot) continue;
      addSlot(run.slot, run.len);
      if (symbols.length >= nonceNibbles) {
        yield _symbolsToHex(symbols.sublist(0, nonceNibbles));
        return;
      }
    }
  }

  /// Largest power-of-two FFT size that still fits within one symbol window of
  /// [samplesPerSymbol] samples. Using a floor (not ceil) power of two ensures a
  /// full symbol produces a complete FFT frame — otherwise the capture service,
  /// which emits windows of `samplesPerSymbol`, would never satisfy the frame
  /// size and every decode would return null.
  static int _fftSizeForSymbol(int samplesPerSymbol) {
    var p = 1;
    while (p << 1 <= samplesPerSymbol) {
      p <<= 1;
    }
    return p;
  }
}
