import '../models/contract_models.dart';

/// Contract surface consumed by the student app (subset of openapi.yaml that
/// the student role needs). Two implementations exist: a Dio-backed real client
/// and an in-memory mock for offline / pre-backend development.
abstract class ApiClient {
  // auth
  Future<TokenPair> login({required String email, required String password});
  Future<TokenPair> refresh(String refreshToken);

  /// Authenticated user's profile (GET /auth/me) — resolves the student's own
  /// id for SSE subscription and history without decoding the JWT.
  Future<UserOut> getMe();

  // devices
  /// Binds the app-generated UUID. Throws [ApiError] with statusCode 409 when a
  /// binding conflict requires email re-registration.
  Future<DeviceBinding> registerDevice(String deviceUuid);
  Future<void> reregisterRequest(String email);
  Future<DeviceBinding> reregisterConfirm({
    required String email,
    required String code,
    required String newDeviceUuid,
  });
  Future<DeviceBinding> getMyDevice();

  // attendance
  Future<VerifyResult> verifyAttendance(VerifyRequest request);

  /// Authenticated student's own attendance history (GET /me/attendance).
  Future<List<MyAttendanceItem>> getMyAttendance();

  /// Student risk-warning SSE stream (/sse/students/{id}).
  Stream<RiskWarning> riskWarnings(String studentId);
}
