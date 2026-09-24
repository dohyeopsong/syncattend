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
/// PROTOCOL (proposed — confirm with owner C before real-device testing):
///  - Band: 18–20 kHz split into N tone slots (default 16 → 4 bits/symbol).
///  - Symbol length: [symbolMs] ms per symbol (default 60ms).
///  - Framing: a start marker tone (highest slot) precedes the nonce symbols.
///  - Encoding: nonce transmitted as hex nibbles, each nibble = one tone slot.
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
  }) : _fft = FFT(_nextPow2((sampleRate * symbolMs) ~/ 1000));

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
    const startSlotIsMarker = true; // highest slot = start marker

    await for (final window in windows) {
      final slot = decodeSlot(window);
      if (slot == null) continue;
      final isMarker = startSlotIsMarker && slot == toneSlots - 1;

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
        // A nonce of 8 hex nibbles (32-bit) is a reasonable default frame.
        if (symbols.length >= 8) {
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

  static int _nextPow2(int n) {
    var p = 1;
    while (p < n) {
      p <<= 1;
    }
    return p;
  }
}
