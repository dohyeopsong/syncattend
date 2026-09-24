// Data models mirroring contracts/openapi.yaml (single source of truth).
// Owner B consumes the contract read-only; do not diverge from it. If a shape
// change is needed, report a "contract change proposal" to owner A.

enum Role { student, professor, unknown }

Role _roleFromString(String? v) {
  switch (v) {
    case 'student':
      return Role.student;
    case 'professor':
      return Role.professor;
    default:
      return Role.unknown;
  }
}

/// #/components/schemas/TokenPair
class TokenPair {
  const TokenPair({
    required this.accessToken,
    required this.refreshToken,
    required this.tokenType,
    required this.role,
  });

  final String accessToken;
  final String refreshToken;
  final String tokenType;
  final Role role;

  factory TokenPair.fromJson(Map<String, dynamic> json) => TokenPair(
        accessToken: json['access_token'] as String? ?? '',
        refreshToken: json['refresh_token'] as String? ?? '',
        tokenType: json['token_type'] as String? ?? 'bearer',
        role: _roleFromString(json['role'] as String?),
      );
}

/// #/components/schemas/DeviceBinding
class DeviceBinding {
  const DeviceBinding({
    required this.accountId,
    required this.deviceUuid,
    this.boundAt,
  });

  final String accountId;
  final String deviceUuid;
  final DateTime? boundAt;

  factory DeviceBinding.fromJson(Map<String, dynamic> json) => DeviceBinding(
        accountId: json['account_id'] as String? ?? '',
        deviceUuid: json['device_uuid'] as String? ?? '',
        boundAt: json['bound_at'] != null
            ? DateTime.tryParse(json['bound_at'] as String)
            : null,
      );
}

/// #/components/schemas/SessionToken
class SessionToken {
  const SessionToken({
    required this.sessionId,
    required this.qrToken,
    required this.audioNonce,
    required this.expiresIn,
    required this.windowOpen,
    required this.windowRemaining,
  });

  final String sessionId;
  final String qrToken;
  final String audioNonce;
  final int expiresIn;
  final bool windowOpen;
  final int windowRemaining;

  factory SessionToken.fromJson(Map<String, dynamic> json) => SessionToken(
        sessionId: json['session_id'] as String? ?? '',
        qrToken: json['qr_token'] as String? ?? '',
        audioNonce: json['audio_nonce'] as String? ?? '',
        expiresIn: (json['expires_in'] as num?)?.toInt() ?? 15,
        windowOpen: json['window_open'] as bool? ?? false,
        windowRemaining: (json['window_remaining'] as num?)?.toInt() ?? 0,
      );
}

/// #/components/schemas/VerifyRequest
class VerifyRequest {
  const VerifyRequest({
    required this.sessionId,
    required this.qrToken,
    required this.audioNonce,
    required this.deviceUuid,
  });

  final String sessionId;
  final String qrToken;
  final String audioNonce;
  final String deviceUuid;

  Map<String, dynamic> toJson() => {
        'session_id': sessionId,
        'qr_token': qrToken,
        'audio_nonce': audioNonce,
        'device_uuid': deviceUuid,
      };
}

enum VerifyStatus { present, pending, rejected, unknown }

VerifyStatus _verifyStatusFromString(String? v) {
  switch (v) {
    case 'present':
      return VerifyStatus.present;
    case 'pending':
      return VerifyStatus.pending;
    case 'rejected':
      return VerifyStatus.rejected;
    default:
      return VerifyStatus.unknown;
  }
}

/// #/components/schemas/VerifyResult reason enum
enum VerifyReason {
  windowClosed,
  crossVerifyFailed,
  nonceReused,
  deviceMismatch,
  duplicateAttendance,
  none,
}

VerifyReason _verifyReasonFromString(String? v) {
  switch (v) {
    case 'window_closed':
      return VerifyReason.windowClosed;
    case 'cross_verify_failed':
      return VerifyReason.crossVerifyFailed;
    case 'nonce_reused':
      return VerifyReason.nonceReused;
    case 'device_mismatch':
      return VerifyReason.deviceMismatch;
    case 'duplicate_attendance':
      return VerifyReason.duplicateAttendance;
    default:
      return VerifyReason.none;
  }
}

/// #/components/schemas/VerifyResult
class VerifyResult {
  const VerifyResult({
    required this.status,
    required this.crossVerified,
    required this.deviceMatched,
    required this.reason,
    this.riskWarning,
  });

  final VerifyStatus status;
  final bool crossVerified;
  final bool deviceMatched;
  final VerifyReason reason;
  final RiskWarning? riskWarning;

  factory VerifyResult.fromJson(Map<String, dynamic> json) => VerifyResult(
        status: _verifyStatusFromString(json['status'] as String?),
        crossVerified: json['cross_verified'] as bool? ?? false,
        deviceMatched: json['device_matched'] as bool? ?? false,
        reason: _verifyReasonFromString(json['reason'] as String?),
        riskWarning: json['risk_warning'] != null
            ? RiskWarning.fromJson(
                json['risk_warning'] as Map<String, dynamic>)
            : null,
      );
}

enum AttendanceStatus { present, absent, pending, unknown }

AttendanceStatus attendanceStatusFromString(String? v) {
  switch (v) {
    case 'present':
      return AttendanceStatus.present;
    case 'absent':
      return AttendanceStatus.absent;
    case 'pending':
      return AttendanceStatus.pending;
    default:
      return AttendanceStatus.unknown;
  }
}

/// #/components/schemas/AttendanceRecord
class AttendanceRecord {
  const AttendanceRecord({
    required this.recordId,
    required this.sessionId,
    required this.studentId,
    required this.status,
    this.verifiedAt,
  });

  final String recordId;
  final String sessionId;
  final String studentId;
  final AttendanceStatus status;
  final DateTime? verifiedAt;

  factory AttendanceRecord.fromJson(Map<String, dynamic> json) =>
      AttendanceRecord(
        recordId: json['record_id'] as String? ?? '',
        sessionId: json['session_id'] as String? ?? '',
        studentId: json['student_id'] as String? ?? '',
        status: attendanceStatusFromString(json['status'] as String?),
        verifiedAt: json['verified_at'] != null
            ? DateTime.tryParse(json['verified_at'] as String)
            : null,
      );
}

enum RiskLevel { info, warning, danger, unknown }

RiskLevel _riskLevelFromString(String? v) {
  switch (v) {
    case 'info':
      return RiskLevel.info;
    case 'warning':
      return RiskLevel.warning;
    case 'danger':
      return RiskLevel.danger;
    default:
      return RiskLevel.unknown;
  }
}

/// #/components/schemas/RiskWarning
class RiskWarning {
  const RiskWarning({
    required this.level,
    required this.absences,
    required this.message,
  });

  final RiskLevel level;
  final int absences;
  final String message;

  factory RiskWarning.fromJson(Map<String, dynamic> json) => RiskWarning(
        level: _riskLevelFromString(json['level'] as String?),
        absences: (json['absences'] as num?)?.toInt() ?? 0,
        message: json['message'] as String? ?? '',
      );
}

/// #/components/schemas/Error
class ApiError implements Exception {
  const ApiError({required this.detail, this.code, this.statusCode});

  final String detail;
  final String? code;
  final int? statusCode;

  factory ApiError.fromJson(Map<String, dynamic> json, {int? statusCode}) =>
      ApiError(
        detail: _parseDetail(json['detail']),
        code: json['code'] as String?,
        statusCode: statusCode,
      );

  /// FastAPI returns `detail` either as a string (HTTPException) or as a list of
  /// validation errors for 422 (`[{loc, msg, type}, ...]`). Flatten the list
  /// form into a human-readable message instead of dropping it as "Unknown".
  static String _parseDetail(Object? detail) {
    if (detail is String && detail.isNotEmpty) return detail;
    if (detail is List) {
      final msgs = <String>[];
      for (final item in detail) {
        if (item is Map) {
          final msg = item['msg']?.toString();
          final loc = item['loc'];
          final field = (loc is List && loc.isNotEmpty)
              ? loc.where((p) => p != 'body').join('.')
              : null;
          if (msg != null && msg.isNotEmpty) {
            msgs.add(field != null && field.isNotEmpty ? '$field: $msg' : msg);
          }
        } else if (item != null) {
          msgs.add(item.toString());
        }
      }
      if (msgs.isNotEmpty) return msgs.join('\n');
    }
    return 'Unknown error';
  }

  @override
  String toString() => 'ApiError($statusCode, $code): $detail';
}


/// #/components/schemas/UserOut — authenticated user's profile (GET /auth/me).
class UserOut {
  const UserOut({
    required this.id,
    required this.email,
    required this.role,
    this.name,
  });

  final String id;
  final String email;
  final Role role;
  final String? name;

  factory UserOut.fromJson(Map<String, dynamic> json) => UserOut(
        id: json['id'] as String? ?? '',
        email: json['email'] as String? ?? '',
        role: _roleFromString(json['role'] as String?),
        name: json['name'] as String?,
      );
}

/// #/components/schemas/MyAttendanceItem — one row of the student's own
/// attendance history with course context (GET /me/attendance).
class MyAttendanceItem {
  const MyAttendanceItem({
    required this.recordId,
    required this.sessionId,
    required this.courseId,
    required this.courseName,
    required this.status,
    this.verifiedAt,
    this.sessionOpenedAt,
  });

  final String recordId;
  final String sessionId;
  final String courseId;
  final String courseName;
  final AttendanceStatus status;
  final DateTime? verifiedAt;
  final DateTime? sessionOpenedAt;

  factory MyAttendanceItem.fromJson(Map<String, dynamic> json) =>
      MyAttendanceItem(
        recordId: json['record_id'] as String? ?? '',
        sessionId: json['session_id'] as String? ?? '',
        courseId: json['course_id'] as String? ?? '',
        courseName: json['course_name'] as String? ?? '',
        status: attendanceStatusFromString(json['status'] as String?),
        verifiedAt: json['verified_at'] != null
            ? DateTime.tryParse(json['verified_at'] as String)
            : null,
        sessionOpenedAt: json['session_opened_at'] != null
            ? DateTime.tryParse(json['session_opened_at'] as String)
            : null,
      );
}
