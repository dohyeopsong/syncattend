import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'audio_capture_service.dart';
import 'permissions_service.dart';

/// ON-DEVICE physical loopback harness for the ultrasonic audio-token decode
/// (TR-0, highest risk). The software spike (`test/audio_decode_spike_test.dart`)
/// validates the DSP; THIS screen validates the real acoustic path — physical
/// speaker → air → microphone — which cannot be automated in CI.
///
/// HOW TO RUN (manual, needs hardware):
///  1. Have owner C's emitter (or any tool) play the agreed 18–20 kHz frames
///     (start marker + 8 hex nibbles) from a speaker.
///  2. Open this screen on a real device (or macOS with mic entitlement) at a
///     known distance / noise condition.
///  3. Enter the EXPECTED nonce (what the emitter is sending) to auto-score, or
///     leave blank to just observe decoded values.
///  4. Read the live success rate and transcribe it into mobile/README.md
///     (Real-device checklist), one row per distance / noise condition.
///
/// This introduces NO new dependency (reuses `record` via AudioCaptureService)
/// and stays entirely within mobile/.
///
/// TODO(C-dep, Stage-1 emitter): as of 2026-09-25 the web SessionTokenPanel only
///   DISPLAYS `audio_nonce` as text — it does not yet emit ultrasonic audio.
///   Stage-1 real-rate measurement is blocked until C ships an emitter that
///   plays the agreed frames (start marker + 8 hex nibbles + inter-symbol guard
///   tone). When it lands: deploy this app to a real device, enter the emitted
///   nonce, run, and fill the "Real-device checklist" rates in mobile/README.md.
///   Do NOT emit from here or edit web/ — that is owner C's surface.
class AudioLoopbackHarnessScreen extends ConsumerStatefulWidget {
  const AudioLoopbackHarnessScreen({super.key});

  /// Whether the dev harness may be surfaced. It is a developer-only tool, so
  /// it is gated OFF in release builds. Debug/profile builds keep it available.
  /// A release build can still opt in explicitly with:
  ///   flutter build ... --dart-define=ENABLE_AUDIO_HARNESS=true
  static const bool isAvailable = !kReleaseMode ||
      bool.fromEnvironment('ENABLE_AUDIO_HARNESS', defaultValue: false);

  /// Guarded navigation entry point. In release builds (where [isAvailable] is
  /// false) this is a no-op, so the harness can never be pushed onto the
  /// navigator; in debug/profile it pushes the screen as usual. Prefer this
  /// over constructing/pushing the screen directly from UI code.
  static Future<void> open(BuildContext context) {
    if (!isAvailable) return Future<void>.value();
    return Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => const AudioLoopbackHarnessScreen(),
      ),
    );
  }

  @override
  ConsumerState<AudioLoopbackHarnessScreen> createState() =>
      _AudioLoopbackHarnessScreenState();
}

class _AudioLoopbackHarnessScreenState
    extends ConsumerState<AudioLoopbackHarnessScreen> {
  final _permissions = const PermissionsService();
  final _expected = TextEditingController();

  AudioCaptureService? _capture;
  StreamSubscription<String>? _sub;

  bool _running = false;
  String? _permissionError;
  final List<String> _decoded = [];
  int _attempts = 0;
  int _matches = 0;

  @override
  void dispose() {
    _expected.dispose();
    unawaited(_stop());
    super.dispose();
  }

  Future<void> _start() async {
    setState(() {
      _permissionError = null;
      _decoded.clear();
      _attempts = 0;
      _matches = 0;
    });
    final outcome = await _permissions.ensureAttendancePermissions();
    if (!outcome.granted) {
      setState(() => _permissionError =
          '마이크 권한이 필요합니다. (${outcome.permanentlyDenied ? "설정에서 허용" : "권한 요청 거부됨"})');
      return;
    }
    final capture = AudioCaptureService();
    _capture = capture;
    try {
      final stream = await capture.start();
      _sub = stream.listen(_onDecoded);
      setState(() => _running = true);
    } catch (e) {
      setState(() => _permissionError = '캡처 시작 실패: $e');
    }
  }

  void _onDecoded(String nonce) {
    final expected = _expected.text.trim();
    setState(() {
      _attempts++;
      if (expected.isNotEmpty && nonce == expected) _matches++;
      _decoded.insert(0, nonce);
      if (_decoded.length > 20) _decoded.removeLast();
    });
  }

  Future<void> _stop() async {
    await _sub?.cancel();
    _sub = null;
    await _capture?.stop();
    await _capture?.dispose();
    _capture = null;
    if (mounted) setState(() => _running = false);
  }

  double get _rate => _attempts == 0 ? 0 : _matches / _attempts;

  @override
  Widget build(BuildContext context) {
    // Defense in depth: even if this screen is constructed directly (bypassing
    // [AudioLoopbackHarnessScreen.open]) in a release build, do not expose the
    // live-mic dev harness — render an inert placeholder instead.
    if (!AudioLoopbackHarnessScreen.isAvailable) {
      return const Scaffold(
        body: Center(child: Text('Not available in release builds.')),
      );
    }
    final scoring = _expected.text.trim().isNotEmpty;
    return Scaffold(
      appBar: AppBar(title: const Text('음향 복호 실측 하니스 (TR-0)')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              '실기기에서 스피커→마이크 물리 루프백으로 초음파 nonce 복호를 실측합니다.\n'
              'emitter(교수 측/도구)가 18–20kHz 프레임을 재생하는 동안 측정하세요.',
              style: TextStyle(fontSize: 13),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _expected,
              enabled: !_running,
              decoration: const InputDecoration(
                labelText: '기대 nonce (선택 — 입력 시 자동 채점)',
                hintText: '예: 1a2b3c4d',
                border: OutlineInputBorder(),
              ),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: _running ? null : _start,
                    icon: const Icon(Icons.mic),
                    label: const Text('측정 시작'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _running ? _stop : null,
                    icon: const Icon(Icons.stop),
                    label: const Text('중지'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            if (_permissionError != null)
              Text(_permissionError!,
                  style: const TextStyle(color: Colors.red)),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  children: [
                    Text(_running ? '측정 중…' : '대기',
                        style: const TextStyle(fontWeight: FontWeight.bold)),
                    const SizedBox(height: 4),
                    Text('복호 시도: $_attempts'),
                    if (scoring) ...[
                      Text('일치: $_matches'),
                      Text('성공률: ${(_rate * 100).toStringAsFixed(1)}%',
                          style: const TextStyle(
                              fontSize: 18, fontWeight: FontWeight.bold)),
                    ],
                  ],
                ),
              ),
            ),
            const SizedBox(height: 8),
            const Align(
              alignment: Alignment.centerLeft,
              child: Text('최근 복호값', style: TextStyle(fontWeight: FontWeight.bold)),
            ),
            Expanded(
              child: ListView.builder(
                itemCount: _decoded.length,
                itemBuilder: (context, i) {
                  final v = _decoded[i];
                  final ok = scoring && v == _expected.text.trim();
                  return ListTile(
                    dense: true,
                    leading: Icon(
                      scoring
                          ? (ok ? Icons.check_circle : Icons.cancel)
                          : Icons.hearing,
                      color: scoring
                          ? (ok ? Colors.green : Colors.red)
                          : Colors.grey,
                    ),
                    title: Text(v, style: const TextStyle(fontFamily: 'monospace')),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
