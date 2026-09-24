import 'dart:async';
import 'package:flutter/foundation.dart';

import 'package:record/record.dart';

import 'audio_nonce_decoder.dart';

/// Captures the microphone as a raw PCM16 stream and feeds fixed-size windows to
/// the [AudioNonceDecoder]. Mono, [sampleRate] Hz.
///
/// Default 48 kHz (not 44.1): iOS mic hardware captures natively at 48 kHz. If
/// we request 44.1 kHz, `record`'s iOS layer inserts an AVAudioConverter that
/// downsamples 48→44.1 kHz, and the resampler's anti-aliasing low-pass heavily
/// attenuates our 18–20 kHz band (it sits right at the filter edge, ~90% of the
/// 22.05 kHz Nyquist). Capturing at the hardware-native 48 kHz avoids that
/// converter entirely, preserving the ultrasonic band. 20 kHz is well within
/// 48 kHz Nyquist (24 kHz). The decoder is initialised at the same rate so its
/// FFT bins map to the correct absolute slot frequencies.
class AudioCaptureService {
  AudioCaptureService({
    AudioRecorder? recorder,
    AudioNonceDecoder? decoder,
    this.sampleRate = 48000,
  })  : _recorder = recorder ?? AudioRecorder(),
        decoder = decoder ??
            AudioNonceDecoder(sampleRate: sampleRate);

  final AudioRecorder _recorder;
  final AudioNonceDecoder decoder;
  final int sampleRate;

  StreamSubscription<Uint8List>? _sub;
  StreamController<Float64List>? _windows;

  /// Thrown by [start] when the OS microphone permission is not granted, so the
  /// UI can surface an actionable message instead of silently capturing nothing.
  static const permissionDeniedMessage =
      'Microphone permission denied — enable it in Settings to detect the '
      'ultrasonic attendance token.';

  /// Starts capture and returns a stream of decoded nonce strings.
  ///
  /// Emits OVERSAMPLED overlapping windows (hop = symbol / [hopsPerSymbol]) so the
  /// robust decoder can recover symbols even when capture is not phase-aligned to
  /// the emitter's symbol boundaries (see TR-0 jitter finding).
  ///
  /// Ensures the microphone permission is granted FIRST (`record` does not
  /// request it implicitly on `startStream`; without this the iOS stream yields
  /// no audio and decode silently fails), then uses the REAL-TIME decoder so a
  /// nonce is emitted as soon as a frame is captured (the live mic stream never
  /// closes, so the buffer-until-close decoder would deadlock on device).
  Future<Stream<String>> start({int hopsPerSymbol = 4}) async {
    // 1) Permission — request explicitly; iOS shows the prompt on first call.
    final granted = await _recorder.hasPermission();
    debugPrint('[audio] mic permission granted=$granted');
    if (!granted) {
      throw StateError(permissionDeniedMessage);
    }

    final windowSamples = (sampleRate * decoder.symbolMs) ~/ 1000;
    final hopSamples = (windowSamples ~/ hopsPerSymbol).clamp(1, windowSamples);
    _windows = StreamController<Float64List>();

    final pcmStream = await _recorder.startStream(
      RecordConfig(
        encoder: AudioEncoder.pcm16bits,
        sampleRate: sampleRate,
        numChannels: 1,
      ),
    );
    debugPrint(
        '[audio] capture started: sampleRate=$sampleRate window=$windowSamples hop=$hopSamples');

    // Diagnostics: confirm PCM is actually flowing and how loud the signal is.
    var chunkCount = 0;
    final buffer = <double>[];
    _sub = pcmStream.listen((chunk) {
      // PCM16 little-endian → normalized doubles.
      final bytes = ByteData.sublistView(chunk);
      var peak = 0.0;
      for (var i = 0; i + 1 < chunk.length; i += 2) {
        final sample = bytes.getInt16(i, Endian.little) / 32768.0;
        buffer.add(sample);
        final a = sample.abs();
        if (a > peak) peak = a;
      }
      // Log the first few chunks and then periodically, with peak amplitude so
      // we can tell "mic is dead/muted" (peak≈0) from "mic works but no tone".
      if (chunkCount < 5 || chunkCount % 50 == 0) {
        // Also probe the ultrasonic band on the most recent full window so we
        // see whether 18–20 kHz energy is arriving even when it's below the
        // detection threshold (ratio vs threshold tells us louder/closer vs
        // lower-threshold is the fix).
        String bandInfo = '';
        if (buffer.length >= windowSamples) {
          final w = Float64List.fromList(
              buffer.sublist(buffer.length - windowSamples));
          final d = decoder.diagnoseBand(w);
          if (d != null) {
            bandInfo =
                ' band[slot=${d.slot} best=${d.bestMag.toStringAsFixed(3)} '
                'med=${d.median.toStringAsFixed(3)} ratio=${d.ratio.toStringAsFixed(2)} '
                'thr=${decoder.detectionThreshold}]';
          }
        }
        debugPrint(
            '[audio] pcm #$chunkCount bytes=${chunk.length} peak=${peak.toStringAsFixed(4)}$bandInfo');
      }
      chunkCount++;
      // Slide a window of `windowSamples` forward by `hopSamples` each step so
      // consecutive windows overlap (oversampling).
      while (buffer.length >= windowSamples) {
        final window = Float64List.fromList(buffer.sublist(0, windowSamples));
        buffer.removeRange(0, hopSamples);
        _windows?.add(window);
      }
    }, onError: (Object e, StackTrace st) {
      debugPrint('[audio] pcm stream error: $e');
    });

    // Diagnostics: log detected slots so we can see if the 18–20 kHz band ever
    // clears the detection threshold on this hardware.
    var slotLogCount = 0;
    return decoder.decodeStreamRealtime(
      _windows!.stream,
      hopsPerSymbol: hopsPerSymbol,
      onSlot: (slot) {
        if (slot != null && (slotLogCount < 40 || slotLogCount % 20 == 0)) {
          debugPrint('[audio] slot detected=$slot');
        }
        if (slot != null) slotLogCount++;
      },
    );
  }

  Future<void> stop() async {
    await _sub?.cancel();
    _sub = null;
    await _windows?.close();
    _windows = null;
    if (await _recorder.isRecording()) {
      await _recorder.stop();
    }
  }

  Future<void> dispose() async {
    await stop();
    await _recorder.dispose();
  }
}
