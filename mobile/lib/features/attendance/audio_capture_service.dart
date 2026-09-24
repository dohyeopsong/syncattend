import 'dart:async';
import 'dart:typed_data';

import 'package:record/record.dart';

import 'audio_nonce_decoder.dart';

/// Captures the microphone as a raw PCM16 stream and feeds fixed-size windows to
/// the [AudioNonceDecoder]. Mono, [sampleRate] Hz (default 44.1kHz so the
/// 18–20kHz band is within Nyquist).
class AudioCaptureService {
  AudioCaptureService({
    AudioRecorder? recorder,
    AudioNonceDecoder? decoder,
    this.sampleRate = 44100,
  })  : _recorder = recorder ?? AudioRecorder(),
        decoder = decoder ??
            AudioNonceDecoder(sampleRate: sampleRate);

  final AudioRecorder _recorder;
  final AudioNonceDecoder decoder;
  final int sampleRate;

  StreamSubscription<Uint8List>? _sub;
  StreamController<Float64List>? _windows;

  /// Starts capture and returns a stream of decoded nonce strings.
  Future<Stream<String>> start() async {
    final windowSamples = (sampleRate * decoder.symbolMs) ~/ 1000;
    _windows = StreamController<Float64List>();

    final pcmStream = await _recorder.startStream(
      RecordConfig(
        encoder: AudioEncoder.pcm16bits,
        sampleRate: sampleRate,
        numChannels: 1,
      ),
    );

    final buffer = <double>[];
    _sub = pcmStream.listen((chunk) {
      // PCM16 little-endian → normalized doubles.
      final bytes = ByteData.sublistView(chunk);
      for (var i = 0; i + 1 < chunk.length; i += 2) {
        final sample = bytes.getInt16(i, Endian.little);
        buffer.add(sample / 32768.0);
      }
      while (buffer.length >= windowSamples) {
        final window = Float64List.fromList(buffer.sublist(0, windowSamples));
        buffer.removeRange(0, windowSamples);
        _windows?.add(window);
      }
    });

    return decoder.decodeStream(_windows!.stream);
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
