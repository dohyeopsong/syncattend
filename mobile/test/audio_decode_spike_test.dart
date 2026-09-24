// Ultrasonic audio-token decode SPIKE / feasibility harness (TR-0, highest risk).
//
// Goal: quantify how reliably `AudioNonceDecoder` recovers a nonce from a
// synthesized ultrasonic transmission under realistic classroom conditions —
// additive noise (varying SNR), distance attenuation, and clock/window jitter —
// without needing physical hardware. Results are printed and summarized so they
// can be transcribed into mobile/README.md.
//
// This models the professor-side EMITTER (owner C) as a signal generator using
// the SAME parameters the decoder expects, then runs the decoder over noisy
// windows. It is a software loopback: it does NOT prove real mic/speaker
// hardware works, but it validates the DSP (FFT + band filter + slot detection
// + framing) and establishes the noise/SNR envelope where decode succeeds.
//
// Run:  flutter test test/audio_decode_spike_test.dart
// (also included in the default `flutter test` run)

import 'dart:async';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:syncattend_mobile/features/attendance/audio_nonce_decoder.dart';

/// Emitter model: builds a continuous PCM signal for a full frame.
/// Frame = [start marker slot] + [nonce nibble slots...], each `symbolMs` long.
/// This mirrors the decoder's protocol so the loopback is self-consistent.
class _Emitter {
  _Emitter({
    required this.sampleRate,
    required this.toneSlots,
    required this.symbolMs,
    required this.decoder,
  });

  final int sampleRate;
  final int toneSlots;
  final int symbolMs;
  final AudioNonceDecoder decoder;

  int get _samplesPerSymbol => (sampleRate * symbolMs) ~/ 1000;

  /// Builds a signal for a start marker followed by [nibbles] (each 0..15).
  Float64List buildFrame(List<int> nibbles, {double amplitude = 0.6}) {
    final markerSlot = toneSlots - 1;
    final slots = <int>[markerSlot, ...nibbles];
    final total = slots.length * _samplesPerSymbol;
    final out = Float64List(total);
    var idx = 0;
    for (final slot in slots) {
      final freq = decoder.slotFrequency(slot);
      for (var i = 0; i < _samplesPerSymbol; i++) {
        // small fade in/out per symbol to reduce inter-symbol clicks
        final env = _envelope(i, _samplesPerSymbol);
        out[idx++] = amplitude * env * math.sin(2 * math.pi * freq * (idx) / sampleRate);
      }
    }
    return out;
  }

  double _envelope(int i, int n) {
    const rampFrac = 0.1;
    final ramp = (n * rampFrac).round().clamp(1, n ~/ 2);
    if (i < ramp) return i / ramp;
    if (i >= n - ramp) return (n - 1 - i) / ramp;
    return 1.0;
  }

  /// Builds a frame mirroring owner C's emitter (web/src/lib/ultrasonicEmitter):
  ///   [marker] guard [n0] guard [n1] guard ... [n_last] guard
  /// with a SILENT inter-symbol guard of [guardFraction] * symbol. The silent
  /// guard makes the decoder flush its run on the silent gap, so even two
  /// identical adjacent nibbles are separated into distinct runs. This lets us
  /// verify software interop with C's guarded protocol WITHOUT the ambiguity
  /// restriction of the guard-less path.
  Float64List buildGuardedFrame(
    List<int> nibbles, {
    double amplitude = 0.6,
    double guardFraction = 0.2,
  }) {
    final markerSlot = toneSlots - 1;
    final slots = <int>[markerSlot, ...nibbles];
    final guard = (_samplesPerSymbol * guardFraction).floor();
    final perSymbol = _samplesPerSymbol + guard;
    final out = Float64List(slots.length * perSymbol);
    var idx = 0;
    for (final slot in slots) {
      final freq = decoder.slotFrequency(slot);
      final base = idx;
      for (var i = 0; i < _samplesPerSymbol; i++) {
        final env = _envelope(i, _samplesPerSymbol);
        out[idx++] =
            amplitude * env * math.sin(2 * math.pi * freq * (i + base) / sampleRate);
      }
      // silent guard
      for (var g = 0; g < guard; g++) {
        out[idx++] = 0;
      }
    }
    return out;
  }
}

/// Adds white Gaussian noise to reach approximately [targetSnrDb] relative to
/// the signal's RMS. Returns a new buffer.
Float64List _addNoise(Float64List signal, double targetSnrDb, math.Random rng) {
  // signal RMS
  var sumSq = 0.0;
  for (final s in signal) {
    sumSq += s * s;
  }
  final sigRms = math.sqrt(sumSq / signal.length);
  if (sigRms == 0) return Float64List.fromList(signal);
  // noise RMS for target SNR:  SNR_dB = 20*log10(sigRms/noiseRms)
  final noiseRms = sigRms / math.pow(10, targetSnrDb / 20);
  final out = Float64List(signal.length);
  for (var i = 0; i < signal.length; i++) {
    // Box-Muller Gaussian
    final u1 = rng.nextDouble().clamp(1e-12, 1.0);
    final u2 = rng.nextDouble();
    final g = math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2);
    out[i] = signal[i] + g * noiseRms;
  }
  return out;
}

/// Slices a continuous PCM buffer into non-overlapping symbol windows and runs
/// the decoder's framing over them. Returns the decoded hex string (first frame)
/// or null if no full frame was recovered.
String? _decodeBuffer(
  AudioNonceDecoder decoder,
  Float64List pcm,
  int sampleRate,
  int symbolMs, {
  int startOffsetSamples = 0,
}) {
  final windowSamples = (sampleRate * symbolMs) ~/ 1000;
  final symbols = <int>[];
  var receiving = false;
  final markerSlot = decoder.toneSlots - 1;

  for (var start = startOffsetSamples;
      start + windowSamples <= pcm.length;
      start += windowSamples) {
    final window = Float64List.sublistView(pcm, start, start + windowSamples);
    final slot = decoder.decodeSlot(Float64List.fromList(window));
    if (slot == null) continue;
    final isMarker = slot == markerSlot;
    if (isMarker) {
      if (receiving && symbols.isNotEmpty) {
        return _hex(symbols);
      }
      receiving = true;
      symbols.clear();
      continue;
    }
    if (receiving) {
      symbols.add(slot);
      if (symbols.length >= 8) {
        return _hex(symbols);
      }
    }
  }
  if (symbols.length >= 8) return _hex(symbols);
  return null;
}

String _hex(List<int> symbols) {
  final sb = StringBuffer();
  for (final s in symbols) {
    sb.write(s.toRadixString(16));
  }
  return sb.toString();
}

/// Random 8-nibble nonce (32-bit), as nibble list and its expected hex.
({List<int> nibbles, String hex}) _randomNonce(math.Random rng) {
  final nibbles = List<int>.generate(8, (_) => rng.nextInt(15)); // 0..14 (15=marker)
  return (nibbles: nibbles, hex: _hex(nibbles));
}

/// Nonce with no two adjacent nibbles equal — required by the run-segmentation
/// (oversampled) decoder until the emitter (owner C) adds inter-symbol guards.
({List<int> nibbles, String hex}) _randomNonceDistinctAdjacent(math.Random rng) {
  final nibbles = <int>[];
  while (nibbles.length < 8) {
    final n = rng.nextInt(15); // 0..14
    if (nibbles.isEmpty || nibbles.last != n) nibbles.add(n);
  }
  return (nibbles: nibbles, hex: _hex(nibbles));
}

void main() {
  const sampleRate = 44100;
  const toneSlots = 16;
  const symbolMs = 60;

  AudioNonceDecoder makeDecoder({double threshold = 4.0}) => AudioNonceDecoder(
        sampleRate: sampleRate,
        toneSlots: toneSlots,
        symbolMs: symbolMs,
        detectionThreshold: threshold,
      );

  group('Audio decode — clean loopback', () {
    test('recovers full nonce frame with no noise', () {
      final decoder = makeDecoder();
      final emitter = _Emitter(
        sampleRate: sampleRate,
        toneSlots: toneSlots,
        symbolMs: symbolMs,
        decoder: decoder,
      );
      final rng = math.Random(1);
      var ok = 0;
      const trials = 50;
      for (var t = 0; t < trials; t++) {
        final nonce = _randomNonce(rng);
        final pcm = emitter.buildFrame(nonce.nibbles);
        final decoded = _decodeBuffer(decoder, pcm, sampleRate, symbolMs);
        if (decoded == nonce.hex) ok++;
      }
      final rate = ok / trials;
      // ignore: avoid_print
      print('[AUDIO SPIKE] clean loopback: ${(rate * 100).toStringAsFixed(1)}% ($ok/$trials)');
      expect(rate, greaterThanOrEqualTo(0.95),
          reason: 'clean-channel decode must be near-perfect');
    });
  });

  group('Audio decode — SNR sweep (additive white noise)', () {
    // Measures full-frame decode success rate vs SNR. Classroom ambient noise
    // in the ultrasonic band is typically low, so effective in-band SNR is
    // usually high; this maps the cliff edge.
    const trialsPerSnr = 40;
    final snrs = <double>[30, 20, 12, 6, 0, -6];

    final summary = <String, double>{};

    for (final snr in snrs) {
      test('SNR ${snr.toStringAsFixed(0)} dB', () {
        final decoder = makeDecoder();
        final emitter = _Emitter(
          sampleRate: sampleRate,
          toneSlots: toneSlots,
          symbolMs: symbolMs,
          decoder: decoder,
        );
        final rng = math.Random(1000 + snr.toInt());
        var ok = 0;
        for (var t = 0; t < trialsPerSnr; t++) {
          final nonce = _randomNonce(rng);
          final clean = emitter.buildFrame(nonce.nibbles);
          final noisy = _addNoise(clean, snr, rng);
          final decoded = _decodeBuffer(decoder, noisy, sampleRate, symbolMs);
          if (decoded == nonce.hex) ok++;
        }
        final rate = ok / trialsPerSnr;
        summary['${snr.toStringAsFixed(0)}dB'] = rate;
        // ignore: avoid_print
        print('[AUDIO SPIKE] SNR ${snr.toStringAsFixed(0)}dB: '
            '${(rate * 100).toStringAsFixed(1)}% ($ok/$trialsPerSnr)');
        // No hard threshold here except at high SNR — this test documents the
        // envelope. At >=20dB in-band SNR decode should be reliable.
        if (snr >= 20) {
          expect(rate, greaterThanOrEqualTo(0.9),
              reason: 'high in-band SNR should decode reliably');
        }
      });
    }
  });

  group('Audio decode — distance attenuation', () {
    // Ultrasonic attenuates faster with distance/air absorption. We model this
    // purely as reduced signal amplitude against a fixed noise floor.
    test('amplitude sweep (proxy for distance)', () {
      final decoder = makeDecoder();
      final emitter = _Emitter(
        sampleRate: sampleRate,
        toneSlots: toneSlots,
        symbolMs: symbolMs,
        decoder: decoder,
      );
      final rng = math.Random(7);
      // Fixed absolute noise floor; amplitude drops with "distance".
      const noiseFloor = 0.01;
      final amps = <double>[0.6, 0.3, 0.15, 0.07, 0.03];
      for (final amp in amps) {
        var ok = 0;
        const trials = 30;
        for (var t = 0; t < trials; t++) {
          final nonce = _randomNonce(rng);
          final clean = emitter.buildFrame(nonce.nibbles, amplitude: amp);
          // add fixed-floor noise
          final noisy = Float64List(clean.length);
          for (var i = 0; i < clean.length; i++) {
            final u1 = rng.nextDouble().clamp(1e-12, 1.0);
            final u2 = rng.nextDouble();
            final g = math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2);
            noisy[i] = clean[i] + g * noiseFloor;
          }
          final decoded = _decodeBuffer(decoder, noisy, sampleRate, symbolMs);
          if (decoded == nonce.hex) ok++;
        }
        final rate = ok / trials;
        final effSnr = 20 * math.log(amp / noiseFloor) / math.ln10;
        // ignore: avoid_print
        print('[AUDIO SPIKE] amp ${amp.toStringAsFixed(2)} '
            '(~${effSnr.toStringAsFixed(0)}dB): ${(rate * 100).toStringAsFixed(1)}% ($ok/$trials)');
      }
    });
  });

  group('Audio decode — window/clock jitter', () {
    // Real capture won't be phase-aligned to symbol boundaries. Offset the
    // decode start to simulate the receiver being out of sync with the emitter.
    test('random start offset within a symbol', () {
      final decoder = makeDecoder();
      final emitter = _Emitter(
        sampleRate: sampleRate,
        toneSlots: toneSlots,
        symbolMs: symbolMs,
        decoder: decoder,
      );
      final rng = math.Random(42);
      const windowSamples = (sampleRate * symbolMs) ~/ 1000;
      var ok = 0;
      const trials = 40;
      for (var t = 0; t < trials; t++) {
        final nonce = _randomNonce(rng);
        // Pre-pad with silence of a random sub-symbol length to force misalignment.
        final offset = rng.nextInt(windowSamples);
        final clean = emitter.buildFrame(nonce.nibbles);
        final padded = Float64List(offset + clean.length)
          ..setRange(offset, offset + clean.length, clean);
        final noisy = _addNoise(padded, 20, rng);
        final decoded = _decodeBuffer(decoder, noisy, sampleRate, symbolMs);
        if (decoded == nonce.hex) ok++;
      }
      final rate = ok / trials;
      // ignore: avoid_print
      print('[AUDIO SPIKE] misaligned start, non-overlap (20dB): '
          '${(rate * 100).toStringAsFixed(1)}% ($ok/$trials)');
      // This is expected to be LOWER: non-overlapping windows + no resync means
      // jitter hurts. Documents the need for a sync/oversampling improvement.
    });

    test('oversampled robust decode recovers under the same jitter', () async {
      final decoder = makeDecoder();
      final emitter = _Emitter(
        sampleRate: sampleRate,
        toneSlots: toneSlots,
        symbolMs: symbolMs,
        decoder: decoder,
      );
      final rng = math.Random(42);
      const windowSamples = (sampleRate * symbolMs) ~/ 1000;
      const hopsPerSymbol = 8;
      const hop = windowSamples ~/ hopsPerSymbol;
      var ok = 0;
      const trials = 40;
      for (var t = 0; t < trials; t++) {
        final nonce = _randomNonceDistinctAdjacent(rng);
        final offset = rng.nextInt(windowSamples);
        final clean = emitter.buildFrame(nonce.nibbles);
        // Leading jitter offset + trailing silence guard so the final symbol is
        // captured by a full-width window (mirrors a real emitter's end gap).
        const tail = windowSamples;
        final padded = Float64List(offset + clean.length + tail)
          ..setRange(offset, offset + clean.length, clean);
        final noisy = _addNoise(padded, 20, rng);
        // Feed overlapping windows exactly like AudioCaptureService.start does.
        final windows = <Float64List>[];
        for (var s = 0; s + windowSamples <= noisy.length; s += hop) {
          windows.add(Float64List.sublistView(noisy, s, s + windowSamples));
        }
        final decoded = await decoder
            .decodeStreamOversampled(
              Stream.fromIterable(windows),
              hopsPerSymbol: hopsPerSymbol,
            )
            .firstWhere((_) => true, orElse: () => '')
            .timeout(const Duration(seconds: 2), onTimeout: () => '');
        if (decoded == nonce.hex) ok++;
      }
      final rate = ok / trials;
      // ignore: avoid_print
      print('[AUDIO SPIKE] misaligned start, OVERSAMPLED x$hopsPerSymbol (20dB): '
          '${(rate * 100).toStringAsFixed(1)}% ($ok/$trials)');
      expect(rate, greaterThan(0.8),
          reason: 'oversampled robust decode should tolerate symbol-boundary jitter');
    });
  });

  group('Audio decode — guarded frame interop (owner C emitter)', () {
    // Owner C's emitter (web/src/lib/ultrasonicEmitter.ts) inserts a SILENT
    // inter-symbol guard (option a) so adjacent identical nibbles are separable.
    // This verifies — in software — that this decoder recovers ARBITRARY nonces
    // (including adjacent-identical nibbles) from a C-shaped guarded frame under
    // jitter + noise, i.e. protocol interop before any hardware run.
    test('recovers arbitrary nonce (incl. adjacent-identical) from guarded frame',
        () async {
      final decoder = makeDecoder();
      final emitter = _Emitter(
        sampleRate: sampleRate,
        toneSlots: toneSlots,
        symbolMs: symbolMs,
        decoder: decoder,
      );
      final rng = math.Random(99);
      const windowSamples = (sampleRate * symbolMs) ~/ 1000;
      const hopsPerSymbol = 8;
      const hop = windowSamples ~/ hopsPerSymbol;
      var ok = 0;
      const trials = 40;
      var sawAdjacentDup = false;
      for (var t = 0; t < trials; t++) {
        // Arbitrary nonce: nibbles 0..14 (0xF collides with marker, excluded —
        // matches C's emitter remapping 0xF→0xE).
        final nibbles = List<int>.generate(8, (_) => rng.nextInt(15));
        for (var i = 1; i < nibbles.length; i++) {
          if (nibbles[i] == nibbles[i - 1]) sawAdjacentDup = true;
        }
        final hex = _hex(nibbles);
        final offset = rng.nextInt(windowSamples);
        final clean = emitter.buildGuardedFrame(nibbles);
        const tail = windowSamples;
        final padded = Float64List(offset + clean.length + tail)
          ..setRange(offset, offset + clean.length, clean);
        final noisy = _addNoise(padded, 20, rng);
        final windows = <Float64List>[];
        for (var s = 0; s + windowSamples <= noisy.length; s += hop) {
          windows.add(Float64List.sublistView(noisy, s, s + windowSamples));
        }
        final decoded = await decoder
            .decodeStreamOversampled(
              Stream.fromIterable(windows),
              hopsPerSymbol: hopsPerSymbol,
            )
            .firstWhere((_) => true, orElse: () => '')
            .timeout(const Duration(seconds: 2), onTimeout: () => '');
        if (decoded == hex) ok++;
      }
      final rate = ok / trials;
      // ignore: avoid_print
      print('[AUDIO SPIKE] guarded frame, arbitrary nonce (20dB): '
          '${(rate * 100).toStringAsFixed(1)}% ($ok/$trials), '
          'adjacent-dup present=$sawAdjacentDup');
      // With guards, adjacent-identical nibbles must no longer break decode.
      expect(sawAdjacentDup, isTrue,
          reason: 'sanity: the trial set should include adjacent-identical nibbles');
      expect(rate, greaterThan(0.8),
          reason: 'guarded frames must decode arbitrary nonces reliably');
    });
  });

  group('Audio decode — backend hex[0-e]{8} alphabet (aligned nonce)', () {
    // Owner A now issues `audio_nonce = hex[0-e]{8}` — exactly 8 nibbles from the
    // alphabet 0..e (no `f`, since slot 0xF is the acoustic start marker). This
    // means the acoustic frame carries the REAL server nonce verbatim, so the
    // decoded string can be sent straight back as VerifyRequest.audioNonce.
    //
    // These deterministic cases assert exact round-trip for representative
    // nonces, including the adjacent-identical patterns that motivated C's
    // silent inter-symbol guard. A nonce containing `f` can no longer occur
    // under the new alphabet, so the old 0xF→0xE marker-collision remap is moot.
    const cases = <String>['a1b2c3d4', '0e0e0e0e', '77777777'];

    // Guard against a decoder/const drift away from the agreed alphabet.
    test('decoder frame contract matches backend alphabet', () {
      final decoder = makeDecoder();
      expect(AudioNonceDecoder.defaultNonceNibbles, 8);
      expect(AudioNonceDecoder.nonceAlphabet, '0123456789abcde');
      expect(decoder.markerSlot, toneSlots - 1); // 0xF reserved as marker
      for (final c in cases) {
        expect(c.length, AudioNonceDecoder.defaultNonceNibbles);
        expect(RegExp(r'^[0-9a-e]{8}$').hasMatch(c), isTrue,
            reason: '$c must be a valid hex[0-e]{8} nonce (no f)');
      }
    });

    for (final hex in cases) {
      test('round-trips $hex from a guarded frame (20dB + jitter)', () async {
        final decoder = makeDecoder();
        final emitter = _Emitter(
          sampleRate: sampleRate,
          toneSlots: toneSlots,
          symbolMs: symbolMs,
          decoder: decoder,
        );
        final rng = math.Random(hex.hashCode);
        final nibbles =
            hex.split('').map((c) => int.parse(c, radix: 16)).toList();
        const windowSamples = (sampleRate * symbolMs) ~/ 1000;
        const hopsPerSymbol = 8;
        const hop = windowSamples ~/ hopsPerSymbol;
        final offset = rng.nextInt(windowSamples);
        final clean = emitter.buildGuardedFrame(nibbles);
        const tail = windowSamples;
        final padded = Float64List(offset + clean.length + tail)
          ..setRange(offset, offset + clean.length, clean);
        final noisy = _addNoise(padded, 20, rng);
        final windows = <Float64List>[];
        for (var s = 0; s + windowSamples <= noisy.length; s += hop) {
          windows.add(Float64List.sublistView(noisy, s, s + windowSamples));
        }
        final decoded = await decoder
            .decodeStreamOversampled(
              Stream.fromIterable(windows),
              hopsPerSymbol: hopsPerSymbol,
            )
            .firstWhere((_) => true, orElse: () => '')
            .timeout(const Duration(seconds: 2), onTimeout: () => '');
        expect(decoded, hex,
            reason: 'aligned hex nonce must round-trip exactly for verify');
      });
    }
  });
}
