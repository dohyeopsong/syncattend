import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/config.dart';
import '../../core/providers.dart';
import '../../models/contract_models.dart';
import 'audio_capture_service.dart';

/// UI phase for the attendance verification screen.
enum VerifyPhase { idle, capturing, submitting, done, error }

class AttendanceState {
  const AttendanceState({
    this.phase = VerifyPhase.idle,
    this.qrToken,
    this.audioNonce,
    this.sessionId,
    this.secondsRemaining = AppConfig.defaultWindowSeconds,
    this.result,
    this.error,
  });

  final VerifyPhase phase;
  final String? qrToken;
  final String? audioNonce;
  final String? sessionId;
  final int secondsRemaining;
  final VerifyResult? result;
  final String? error;

  bool get hasQr => qrToken != null && qrToken!.isNotEmpty;
  bool get hasAudio => audioNonce != null && audioNonce!.isNotEmpty;
  bool get bothCaptured => hasQr && hasAudio;

  AttendanceState copyWith({
    VerifyPhase? phase,
    String? qrToken,
    String? audioNonce,
    String? sessionId,
    int? secondsRemaining,
    VerifyResult? result,
    String? error,
    bool clearError = false,
  }) =>
      AttendanceState(
        phase: phase ?? this.phase,
        qrToken: qrToken ?? this.qrToken,
        audioNonce: audioNonce ?? this.audioNonce,
        sessionId: sessionId ?? this.sessionId,
        secondsRemaining: secondsRemaining ?? this.secondsRemaining,
        result: result ?? this.result,
        error: clearError ? null : (error ?? this.error),
      );
}

class AttendanceController extends StateNotifier<AttendanceState> {
  AttendanceController(this._ref, {AudioCaptureService? audio})
      : _audio = audio ?? AudioCaptureService(),
        super(const AttendanceState());

  final Ref _ref;
  final AudioCaptureService _audio;

  Timer? _countdown;
  StreamSubscription<String>? _audioSub;

  /// Starts the 1-minute auth-window countdown and begins microphone decode.
  Future<void> startCapture() async {
    state = const AttendanceState(
      phase: VerifyPhase.capturing,
      secondsRemaining: AppConfig.defaultWindowSeconds,
    );
    _startCountdown();
    try {
      final nonces = await _audio.start();
      _audioSub = nonces.listen((nonce) {
        if (state.phase != VerifyPhase.capturing) return;
        state = state.copyWith(audioNonce: nonce);
        _maybeSubmit();
      });
    } catch (e) {
      // Audio failure is not an immediate absence (fallback: professor extends
      // window / confirms). Surface a soft error but keep the countdown.
      state = state.copyWith(error: 'Audio capture failed: $e');
    }
  }

  /// Called by the QR scanner widget when a code is decoded.
  void onQrDetected(String raw) {
    if (state.phase != VerifyPhase.capturing) return;
    // Contract: qr_token + session_id come from the professor's rotating QR.
    // We accept either a bare token or "sessionId|qrToken" framing.
    String? sessionId = state.sessionId;
    String qr = raw;
    if (raw.contains('|')) {
      final parts = raw.split('|');
      sessionId = parts.first;
      qr = parts.length > 1 ? parts[1] : '';
    }
    state = state.copyWith(qrToken: qr, sessionId: sessionId);
    _maybeSubmit();
  }

  void _maybeSubmit() {
    if (state.bothCaptured && state.phase == VerifyPhase.capturing) {
      unawaited(submit());
    }
  }

  void _startCountdown() {
    _countdown?.cancel();
    _countdown = Timer.periodic(const Duration(seconds: 1), (t) {
      final next = state.secondsRemaining - 1;
      if (next <= 0) {
        t.cancel();
        // Window elapsed locally. This is a UX nudge only; the server is the
        // authority on window state (may still accept if professor extended).
        state = state.copyWith(secondsRemaining: 0);
      } else {
        state = state.copyWith(secondsRemaining: next);
      }
    });
  }

  Future<void> submit() async {
    if (!state.bothCaptured) return;
    _countdown?.cancel();
    await _audio.stop();
    await _audioSub?.cancel();
    state = state.copyWith(phase: VerifyPhase.submitting, clearError: true);
    try {
      final api = _ref.read(apiClientProvider);
      final uuid = await _ref.read(deviceIdentityProvider).getOrCreate();
      final result = await api.verifyAttendance(VerifyRequest(
        sessionId: state.sessionId ?? '',
        qrToken: state.qrToken!,
        audioNonce: state.audioNonce!,
        deviceUuid: uuid,
      ));
      state = state.copyWith(phase: VerifyPhase.done, result: result);
    } on ApiError catch (e) {
      state = state.copyWith(phase: VerifyPhase.error, error: e.detail);
    } catch (e) {
      state = state.copyWith(phase: VerifyPhase.error, error: e.toString());
    }
  }

  Future<void> reset() async {
    _countdown?.cancel();
    await _audio.stop();
    await _audioSub?.cancel();
    state = const AttendanceState();
  }

  @override
  void dispose() {
    _countdown?.cancel();
    _audioSub?.cancel();
    unawaited(_audio.dispose());
    super.dispose();
  }
}

final attendanceControllerProvider =
    StateNotifierProvider.autoDispose<AttendanceController, AttendanceState>(
  (ref) => AttendanceController(ref),
);
