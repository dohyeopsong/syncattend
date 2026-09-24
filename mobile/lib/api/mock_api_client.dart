import 'dart:async';

import '../core/config.dart';
import '../models/contract_models.dart';
import 'api_client.dart';

/// In-memory mock implementing the student-facing contract, so the app can run
/// login → device register → attendance verify → SSE end-to-end before the
/// backend (owner A) is live. Enable with --dart-define=USE_MOCK=true.
///
/// Behaviour is intentionally simple but contract-shaped:
///  - login accepts any @wku.ac.kr email + non-empty password.
///  - the FIRST device UUID binds (200); a subsequently *different* UUID for the
///    same session triggers a 409 to exercise the email re-auth flow.
///  - verifyAttendance returns `present` when qr+audio+uuid are all present and
///    the audio nonce is not reused; replays return `nonce_reused`.
class MockApiClient implements ApiClient {
  MockApiClient();

  String? _boundUuid;
  final Set<String> _consumedNonces = {};

  @override
  Future<TokenPair> login(
      {required String email, required String password}) async {
    await _latency();
    if (!email.endsWith(AppConfig.schoolEmailDomain) || password.isEmpty) {
      throw const ApiError(
        detail: 'Invalid credentials (mock expects @wku.ac.kr + password)',
        code: 'invalid_credentials',
        statusCode: 401,
      );
    }
    return const TokenPair(
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      tokenType: 'bearer',
      role: Role.student,
    );
  }

  @override
  Future<TokenPair> refresh(String refreshToken) async {
    await _latency();
    return const TokenPair(
      accessToken: 'mock-access-token-2',
      refreshToken: 'mock-refresh-token-2',
      tokenType: 'bearer',
      role: Role.student,
    );
  }

  @override
  Future<DeviceBinding> registerDevice(String deviceUuid) async {
    await _latency();
    if (_boundUuid == null) {
      _boundUuid = deviceUuid;
      return DeviceBinding(
        accountId: 'mock-student',
        deviceUuid: deviceUuid,
        boundAt: DateTime.now(),
      );
    }
    if (_boundUuid == deviceUuid) {
      return DeviceBinding(
        accountId: 'mock-student',
        deviceUuid: deviceUuid,
        boundAt: DateTime.now(),
      );
    }
    throw const ApiError(
      detail: 'Binding conflict — email re-registration required',
      code: 'binding_conflict',
      statusCode: 409,
    );
  }

  @override
  Future<void> reregisterRequest(String email) async {
    await _latency();
    if (!email.endsWith(AppConfig.schoolEmailDomain)) {
      throw const ApiError(
        detail: 'Email must be a ${AppConfig.schoolEmailDomain} address',
        code: 'bad_email',
        statusCode: 400,
      );
    }
    // Mock: code is always "123456".
  }

  @override
  Future<DeviceBinding> reregisterConfirm({
    required String email,
    required String code,
    required String newDeviceUuid,
  }) async {
    await _latency();
    if (code != '123456') {
      throw const ApiError(
        detail: 'Invalid code (mock expects 123456)',
        code: 'bad_code',
        statusCode: 400,
      );
    }
    _boundUuid = newDeviceUuid;
    return DeviceBinding(
      accountId: 'mock-student',
      deviceUuid: newDeviceUuid,
      boundAt: DateTime.now(),
    );
  }

  @override
  Future<DeviceBinding> getMyDevice() async {
    await _latency();
    return DeviceBinding(
      accountId: 'mock-student',
      deviceUuid: _boundUuid ?? 'unbound',
      boundAt: _boundUuid == null ? null : DateTime.now(),
    );
  }

  @override
  Future<VerifyResult> verifyAttendance(VerifyRequest request) async {
    await _latency();

    if (request.qrToken.isEmpty || request.audioNonce.isEmpty) {
      return const VerifyResult(
        status: VerifyStatus.rejected,
        crossVerified: false,
        deviceMatched: true,
        reason: VerifyReason.crossVerifyFailed,
      );
    }
    if (_boundUuid != null && request.deviceUuid != _boundUuid) {
      return const VerifyResult(
        status: VerifyStatus.rejected,
        crossVerified: true,
        deviceMatched: false,
        reason: VerifyReason.deviceMismatch,
      );
    }
    final nonceKey = '${request.sessionId}:${request.audioNonce}';
    if (_consumedNonces.contains(nonceKey)) {
      return const VerifyResult(
        status: VerifyStatus.rejected,
        crossVerified: true,
        deviceMatched: true,
        reason: VerifyReason.nonceReused,
      );
    }
    _consumedNonces.add(nonceKey);
    return const VerifyResult(
      status: VerifyStatus.present,
      crossVerified: true,
      deviceMatched: true,
      reason: VerifyReason.none,
      riskWarning: RiskWarning(
        level: RiskLevel.info,
        absences: 0,
        message: 'Attendance recorded (mock).',
      ),
    );
  }

  @override
  Stream<RiskWarning> riskWarnings(String studentId) async* {
    // Emit a warning shortly after subscribing, to exercise the SSE UI.
    await Future<void>.delayed(const Duration(seconds: 2));
    yield const RiskWarning(
      level: RiskLevel.warning,
      absences: 3,
      message: 'You have 3 absences in this course (mock warning).',
    );
  }

  Future<void> _latency() =>
      Future<void>.delayed(const Duration(milliseconds: 300));
}
