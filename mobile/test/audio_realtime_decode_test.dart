// Verifies the REAL-TIME streaming decoder (`decodeStreamRealtime`) used by the
// on-device capture path.
//
// The previous `decodeStreamOversampled` buffered every reading with `await for`
// and only decoded AFTER the input stream closed. A live microphone stream never
// closes on its own, so on device it deadlocked: the caller stops the mic only
// after a nonce arrives, but a nonce arrives only after the mic stops. This test
// proves the real-time decoder emits a nonce from an OPEN (never-closed) stream,
// mirroring the guarded emitter protocol (owner C's web emitter).
import 'dart:async';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:syncattend_mobile/features/attendance/audio_nonce_decoder.dart';

const _sampleRate = 48000;
const _symbolMs = 60;
const _toneSlots = 16;

int get _samplesPerSymbol => (_sampleRate * _symbolMs) ~/ 1000;

double _envelope(int i, int n) {
  const rampFrac = 0.1;
  final ramp = (n * rampFrac).round().clamp(1, n ~/ 2);
  if (i < ramp) return i / ramp;
  if (i >= n - ramp) return (n - 1 - i) / ramp;
  return 1.0;
}

/// Mirrors the web emitter: [marker] tone + silent guard, then each nibble tone
/// + silent guard. The guard makes the decoder read a null between symbols so
/// runs segment cleanly (including identical adjacent nibbles).
Float64List _buildGuardedFrame(
  AudioNonceDecoder decoder,
  List<int> nibbles, {
  double amplitude = 0.6,
  double toneFraction = 0.6,
}) {
  const markerSlot = _toneSlots - 1;
  final slots = <int>[markerSlot, ...nibbles];
  final toneSamples = (_samplesPerSymbol * toneFraction).floor();
  final out = Float64List(slots.length * _samplesPerSymbol);
  var idx = 0;
  for (final slot in slots) {
    final freq = decoder.slotFrequency(slot);
    for (var i = 0; i < toneSamples; i++) {
      final env = _envelope(i, toneSamples);
      out[idx++] = amplitude * env * math.sin(2 * math.pi * freq * i / _sampleRate);
    }
    for (var g = toneSamples; g < _samplesPerSymbol; g++) {
      out[idx++] = 0; // silent guard
    }
  }
  return out;
}

/// Emits oversampled overlapping windows onto a controller WITHOUT closing it,
/// exactly like [AudioCaptureService] does with a live mic. Returns the
/// controller so the test can assert a nonce arrived while it is still OPEN.
StreamController<Float64List> _pushOversampledWindows(
  Float64List pcm, {
  int hopsPerSymbol = 4,
}) {
  final windowSamples = _samplesPerSymbol;
  final hop = (windowSamples ~/ hopsPerSymbol).clamp(1, windowSamples);
  final controller = StreamController<Float64List>();
  // Push synchronously; the stream stays OPEN (never closed) to model a live mic.
  scheduleMicrotask(() {
    for (var start = 0; start + windowSamples <= pcm.length; start += hop) {
      controller.add(Float64List.sublistView(pcm, start, start + windowSamples));
    }
    // Intentionally DO NOT close: proves real-time emission from an open stream.
  });
  return controller;
}

void main() {
  group('decodeStreamRealtime', () {
    test('emits a nonce from a still-OPEN live stream (no close needed)',
        () async {
      final decoder = AudioNonceDecoder(sampleRate: _sampleRate);
      const nonceHex = 'a1b2c3d4';
      final nibbles = nonceHex.split('').map((c) => int.parse(c, radix: 16)).toList();
      final pcm = _buildGuardedFrame(decoder, nibbles);
      final controller = _pushOversampledWindows(pcm);

      final decoded = await decoder
          .decodeStreamRealtime(controller.stream)
          .first
          .timeout(const Duration(seconds: 3));

      expect(decoded, nonceHex);
      expect(controller.isClosed, isFalse,
          reason: 'nonce must arrive while the mic stream is still open');
      await controller.close();
    });

    test('recovers identical adjacent nibbles via the silent guard', () async {
      final decoder = AudioNonceDecoder(sampleRate: _sampleRate);
      const nonceHex = 'aa11bb22';
      final nibbles = nonceHex.split('').map((c) => int.parse(c, radix: 16)).toList();
      final pcm = _buildGuardedFrame(decoder, nibbles);
      final controller = _pushOversampledWindows(pcm);

      final decoded = await decoder
          .decodeStreamRealtime(controller.stream)
          .first
          .timeout(const Duration(seconds: 3));

      expect(decoded, nonceHex);
      await controller.close();
    });

    test('onSlot diagnostic hook observes detected slots', () async {
      final decoder = AudioNonceDecoder(sampleRate: _sampleRate);
      const nonceHex = '0e0e0e0e';
      final nibbles = nonceHex.split('').map((c) => int.parse(c, radix: 16)).toList();
      final pcm = _buildGuardedFrame(decoder, nibbles);
      final controller = _pushOversampledWindows(pcm);

      final seen = <int>{};
      final decoded = await decoder
          .decodeStreamRealtime(controller.stream, onSlot: (s) {
            if (s != null) seen.add(s);
          })
          .first
          .timeout(const Duration(seconds: 3));

      expect(decoded, nonceHex);
      // Should have seen the marker slot (15) and nibble slots 0 and 14.
      expect(seen.contains(15), isTrue);
      expect(seen.contains(0) || seen.contains(14), isTrue);
      await controller.close();
    });
  });
}
