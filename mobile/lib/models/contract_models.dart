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


/// #/components/schemas/Course — an offered course with its weekly schedule.
///
/// Contract shape (owner A, GET /courses/catalog & GET /me/courses):
///   id, code, name, department, professor_name, day_of_week (1=Mon..7=Sun),
///   start_period, end_period (inclusive class periods), location, credits.
/// `enrolled` is a client-side/derived flag the catalog uses to toggle the
/// 수강신청 / 신청됨 button; the my-courses endpoint returns only enrolled ones.
class Course {
  const Course({
    required this.id,
    required this.code,
    required this.name,
    required this.department,
    required this.professorName,
    required this.dayOfWeek,
    required this.startPeriod,
    required this.endPeriod,
    required this.location,
    required this.credits,
    this.enrolled = false,
  });

  final String id;
  final String code;
  final String name;
  final String department;
  final String professorName;

  /// ISO-ish weekday: 1=Mon, 2=Tue, ... 7=Sun (matches DateTime.weekday).
  final int dayOfWeek;

  /// Inclusive class-period range (1..N). A single-period class has
  /// startPeriod == endPeriod.
  final int startPeriod;
  final int endPeriod;

  final String location;
  final int credits;

  /// True when the authenticated student is enrolled in this course.
  final bool enrolled;

  /// Number of periods this course spans (>= 1).
  int get periodSpan =>
      (endPeriod >= startPeriod) ? (endPeriod - startPeriod + 1) : 1;

  Course copyWith({bool? enrolled}) => Course(
        id: id,
        code: code,
        name: name,
        department: department,
        professorName: professorName,
        dayOfWeek: dayOfWeek,
        startPeriod: startPeriod,
        endPeriod: endPeriod,
        location: location,
        credits: credits,
        enrolled: enrolled ?? this.enrolled,
      );

  factory Course.fromJson(Map<String, dynamic> json) => Course(
        id: json['id'] as String? ?? '',
        code: json['code'] as String? ?? '',
        name: json['name'] as String? ?? '',
        department: json['department'] as String? ?? '',
        professorName:
            json['professor_name'] as String? ?? json['professor'] as String? ?? '',
        dayOfWeek: (json['day_of_week'] as num?)?.toInt() ?? 1,
        startPeriod: (json['start_period'] as num?)?.toInt() ?? 1,
        endPeriod: (json['end_period'] as num?)?.toInt() ??
            (json['start_period'] as num?)?.toInt() ??
            1,
        location: json['location'] as String? ?? '',
        credits: (json['credits'] as num?)?.toInt() ?? 0,
        enrolled: json['enrolled'] as bool? ?? false,
      );
}

/// Korean single-char weekday label for a 1=Mon..7=Sun value ('?' if invalid).
String weekdayLabelKo(int dayOfWeek) {
  const labels = ['월', '화', '수', '목', '금', '토', '일'];
  if (dayOfWeek < 1 || dayOfWeek > 7) return '?';
  return labels[dayOfWeek - 1];
}

/// Pure timetable helpers — kept free of Flutter so the placement/overlap logic
/// is unit-testable without a widget tree.
class Timetable {
  const Timetable._();

  /// Two courses overlap when they share the same weekday AND their inclusive
  /// period ranges intersect. A well-formed range has start <= end; malformed
  /// ranges are normalised so the test is symmetric.
  static bool overlaps(Course a, Course b) {
    if (a.dayOfWeek != b.dayOfWeek) return false;
    final aStart = a.startPeriod <= a.endPeriod ? a.startPeriod : a.endPeriod;
    final aEnd = a.startPeriod <= a.endPeriod ? a.endPeriod : a.startPeriod;
    final bStart = b.startPeriod <= b.endPeriod ? b.startPeriod : b.endPeriod;
    final bEnd = b.startPeriod <= b.endPeriod ? b.endPeriod : b.startPeriod;
    return aStart <= bEnd && bStart <= aEnd;
  }

  /// The set of course ids that clash with at least one other course in
  /// [courses] (same day + overlapping periods). Used to paint clashing blocks
  /// with the warning color.
  static Set<String> conflictingIds(List<Course> courses) {
    final clashing = <String>{};
    for (var i = 0; i < courses.length; i++) {
      for (var j = i + 1; j < courses.length; j++) {
        if (overlaps(courses[i], courses[j])) {
          clashing.add(courses[i].id);
          clashing.add(courses[j].id);
        }
      }
    }
    return clashing;
  }

  /// The inclusive maximum period across all courses, clamped to at least
  /// [minPeriods] so the grid always shows a sensible number of rows.
  static int maxPeriod(List<Course> courses, {int minPeriods = 9}) {
    var maxP = minPeriods;
    for (final c in courses) {
      final end = c.endPeriod >= c.startPeriod ? c.endPeriod : c.startPeriod;
      if (end > maxP) maxP = end;
    }
    return maxP;
  }

  /// The inclusive maximum weekday across all courses, clamped between
  /// [minDays] (Mon–Fri) and 7 (adds Sat/Sun only when a class needs it).
  static int maxDay(List<Course> courses, {int minDays = 5}) {
    var maxD = minDays;
    for (final c in courses) {
      if (c.dayOfWeek > maxD && c.dayOfWeek <= 7) maxD = c.dayOfWeek;
    }
    return maxD;
  }
}
