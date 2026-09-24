// Tests for the attendance controller UX fixes:
//  - restart() clears state AND re-enters capturing (the old reset() left the
//    mic/countdown stopped, so "다시 시도" appeared to do nothing);
//  - _maybeSubmit does NOT submit while session_id is empty (empty session_id
//    made the backend return 404 "no session"); it submits once a QR payload
//    supplies "sessionId|qrToken".

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:syncattend_mobile/api/api_client.dart';
import 'package:syncattend_mobile/api/mock_api_client.dart';
import 'package:syncattend_mobile/core/providers.dart';
import 'package:syncattend_mobile/core/secure_store.dart';
import 'package:syncattend_mobile/features/attendance/attendance_controller.dart';
import 'package:syncattend_mobile/features/attendance/audio_capture_service.dart';

import 'support/fakes.dart';

/// A capture service that never touches a real mic. Emits nonces on demand via
/// [push] so tests control the audio-capture signal deterministically.
class _FakeAudioCaptureService implements CaptureService {
  _FakeAudioCaptureService();

  StreamController<String>? _controller;
  int startCount = 0;
  int stopCount = 0;

  @override
  Future<Stream<String>> start({int hopsPerSymbol = 4}) async {
    startCount++;
    _controller = StreamController<String>.broadcast();
    return _controller!.stream;
  }

  void push(String nonce) => _controller?.add(nonce);

  @override
  Future<void> stop() async {
    stopCount++;
  }

  @override
  Future<void> dispose() async {
    await _controller?.close();
  }
}

Future<void> _pump(
    ProviderContainer c, bool Function(AttendanceState) test) async {
  final deadline = DateTime.now().add(const Duration(seconds: 2));
  while (DateTime.now().isBefore(deadline)) {
    if (test(c.read(attendanceControllerProvider))) return;
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
}

void main() {
  late _FakeAudioCaptureService audio;
  late MockApiClient api;

  ProviderContainer makeContainer() {
    audio = _FakeAudioCaptureService();
    api = MockApiClient();
    final store = FakeSecureStore()..writeDeviceUuid('uuid-test');
    final c = ProviderContainer(overrides: [
      secureStoreProvider.overrideWithValue(store as SecureStore),
      apiClientProvider.overrideWithValue(api as ApiClient),
      attendanceControllerProvider.overrideWith(
          (ref) => AttendanceController(ref, audio: audio)),
    ]);
    // Keep the autoDispose provider alive for the duration of the test.
    c.listen(attendanceControllerProvider, (_, __) {}, fireImmediately: true);
    return c;
  }

  test('restart() re-enters capturing and restarts the mic', () async {
    final c = makeContainer();
    addTearDown(c.dispose);
    final notifier = c.read(attendanceControllerProvider.notifier);

    await notifier.startCapture();
    await _pump(c, (s) => s.phase == VerifyPhase.capturing);
    expect(audio.startCount, 1);

    // Simulate a completed attempt by resetting to done via a full flow:
    await notifier.reset();
    expect(c.read(attendanceControllerProvider).phase, VerifyPhase.idle);

    // restart() must both clear AND start capture again.
    await notifier.restart();
    await _pump(c, (s) => s.phase == VerifyPhase.capturing);
    expect(c.read(attendanceControllerProvider).phase, VerifyPhase.capturing);
    expect(audio.startCount, 2, reason: 'restart must start the mic again');
  });

  test('does NOT submit while session_id is empty (avoids backend 404)',
      () async {
    final c = makeContainer();
    addTearDown(c.dispose);
    final notifier = c.read(attendanceControllerProvider.notifier);

    await notifier.startCapture();
    await _pump(c, (s) => s.phase == VerifyPhase.capturing);
    expect(c.read(attendanceControllerProvider).phase, VerifyPhase.capturing);

    // Bare QR token WITHOUT a session id → sets qr but no session.
    notifier.onQrDetected('just-a-token-no-session');
    expect(c.read(attendanceControllerProvider).hasQr, isTrue);

    // Audio arrives → still must NOT submit (no session id).
    audio.push('a1b2c3d4');
    await Future<void>.delayed(const Duration(milliseconds: 100));

    final s = c.read(attendanceControllerProvider);
    expect(s.hasAudio, isTrue);
    // Stayed in capturing — no submit fired without a session id.
    expect(s.phase, VerifyPhase.capturing);
    expect(s.sessionId == null || s.sessionId!.isEmpty, isTrue);
  });

  test('submits once QR supplies "sessionId|qrToken"', () async {
    final c = makeContainer();
    addTearDown(c.dispose);
    final notifier = c.read(attendanceControllerProvider.notifier);

    await notifier.startCapture();
    await _pump(c, (s) => s.phase == VerifyPhase.capturing);

    // QR payload carries the session id → session parsed.
    notifier.onQrDetected('session-123|qr-token-abc');
    expect(c.read(attendanceControllerProvider).sessionId, 'session-123');

    // Audio arrives → submit proceeds (both signals + session id present).
    audio.push('a1b2c3d4');
    await _pump(c, (s) =>
        s.phase == VerifyPhase.done || s.phase == VerifyPhase.error);
    final s = c.read(attendanceControllerProvider);
    expect(s.phase, anyOf(VerifyPhase.done, VerifyPhase.error));
  });
}
