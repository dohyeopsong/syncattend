import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/config.dart';
import '../../core/providers.dart';
import '../../models/contract_models.dart';
import 'audio_capture_service.dart';

/// UI phase for the attendance verification screen.
enum VerifyPhase { idle, capturing, submitting, done, error }

/// Sentinel for [AttendanceState.copyWith] so every nullable field can be
/// treated the same way: omit the argument to keep the current value, or pass
/// `null` explicitly to clear it. Using a private sentinel (instead of a mix of
/// `field ?? this.field` and one-off `clearXxx` bool flags) removes the old
/// asymmetry where `error` could be cleared but `qrToken`/`audioNonce`/
/// `sessionId`/`result` could not.
const Object _unset = _Unset();

class _Unset {
  const _Unset();
}

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

  /// Returns a copy with the given overrides. Every nullable field follows the
  /// same rule via the [_unset] sentinel: omit the argument to preserve the
  /// current value, or pass `null` explicitly to clear it. Non-nullable fields
  /// ([phase], [secondsRemaining]) keep the usual `?? this.x` form.
  AttendanceState copyWith({
    VerifyPhase? phase,
    int? secondsRemaining,
    Object? qrToken = _unset,
    Object? audioNonce = _unset,
    Object? sessionId = _unset,
    Object? result = _unset,
    Object? error = _unset,
  }) =>
      AttendanceState(
        phase: phase ?? this.phase,
        secondsRemaining: secondsRemaining ?? this.secondsRemaining,
        qrToken: identical(qrToken, _unset) ? this.qrToken : qrToken as String?,
        audioNonce: identical(audioNonce, _unset)
            ? this.audioNonce
            : audioNonce as String?,
        sessionId:
            identical(sessionId, _unset) ? this.sessionId : sessionId as String?,
        result: identical(result, _unset)
            ? this.result
            : result as VerifyResult?,
        error: identical(error, _unset) ? this.error : error as String?,
      );
}

class AttendanceController extends StateNotifier<AttendanceState> {
  AttendanceController(this._ref, {CaptureService? audio})
      : _audio = audio ?? AudioCaptureService(),
        super(const AttendanceState());

  final Ref _ref;
  final CaptureService _audio;

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
    // Defensive: do not submit with an empty session_id (backend returns 404
    // "no session"). The session_id must arrive inside the QR payload as
    // "sessionId|qrToken"; until it does, stay in capturing and wait.
    final hasSession = state.sessionId != null && state.sessionId!.isNotEmpty;
    if (state.bothCaptured &&
        hasSession &&
        state.phase == VerifyPhase.capturing) {
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
    state = state.copyWith(phase: VerifyPhase.submitting, error: null);
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

  /// Full retry: clear state AND begin a fresh capture (mic + countdown). The
  /// bare [reset] only zeroed the state, which left the mic/countdown stopped
  /// so "다시 시도" appeared to do nothing — this is the one the UI must call.
  Future<void> restart() async {
    await reset();
    await startCapture();
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
