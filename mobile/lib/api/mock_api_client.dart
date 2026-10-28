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

  // --- Signup email verification (team member's flow) ---
  // Mock: any @wku.ac.kr email is "sent" a code; any 6-digit code verifies.
  final Set<String> _verifiedEmails = {};

  @override
  Future<VerifyCodeResult> sendSignupCode(String email) async {
    await _latency();
    if (!email.endsWith(AppConfig.schoolEmailDomain)) {
      throw ApiError(
        detail: '${AppConfig.schoolEmailDomain} 도메인의 학교 이메일만 사용 가능합니다.',
        statusCode: 400,
      );
    }
    _verifiedEmails.remove(email);
    return const VerifyCodeResult(
      verified: false,
      message: '인증번호가 이메일로 발송되었습니다. (mock: 아무 6자리 숫자)',
    );
  }

  @override
  Future<VerifyCodeResult> verifySignupCode({
    required String email,
    required String code,
  }) async {
    await _latency();
    if (code.length != 6 || int.tryParse(code) == null) {
      throw const ApiError(
        detail: '인증번호가 일치하지 않거나 만료되었습니다.',
        statusCode: 400,
      );
    }
    _verifiedEmails.add(email);
    return const VerifyCodeResult(
      verified: true,
      message: '이메일 인증이 완료되었습니다.',
    );
  }

  @override
  Future<UserOut> register({
    required String email,
    required String password,
    required Role role,
    String? name,
    String? studentId,
  }) async {
    await _latency();
    if (!_verifiedEmails.contains(email)) {
      throw const ApiError(
        detail: '이메일 인증을 먼저 완료해주세요.',
        statusCode: 400,
      );
    }
    if (password.length < 8) {
      throw const ApiError(
        detail: '비밀번호는 8자리 이상이어야 합니다.',
        statusCode: 422,
      );
    }
    if (role == Role.student && (studentId == null || studentId.isEmpty)) {
      throw const ApiError(
        detail: '학생(student) 회원가입에는 학번(student_id)이 필요합니다.',
        statusCode: 422,
      );
    }
    _verifiedEmails.remove(email);
    return UserOut(
      id: 'mock-${DateTime.now().millisecondsSinceEpoch}',
      email: email,
      role: role,
      name: name,
      studentId: role == Role.student ? studentId : null,
    );
  }

  @override
  Future<UserOut> getMe() async {
    await _latency();
    return const UserOut(
      id: 'mock-student',
      email: 'student@wku.ac.kr',
      role: Role.student,
      name: '홍길동',
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
  Future<List<MyAttendanceItem>> getMyAttendance() async {
    await _latency();
    final now = DateTime.now();
    return [
      MyAttendanceItem(
        recordId: 'r1',
        sessionId: 's-101',
        courseId: '4b8b48f6-7e20-4f34-abed-4b34dca8721b',
        courseName: '컴퓨터개론',
        weekNumber: 1,
        status: AttendanceStatus.present,
        verifiedAt: now.subtract(const Duration(days: 1)),
        sessionOpenedAt: now.subtract(const Duration(days: 1, minutes: 2)),
      ),
      MyAttendanceItem(
        recordId: 'r2',
        sessionId: 's-102',
        courseId: '98902951-0d19-4b24-9c34-2056b9657da0',
        courseName: '파이썬프로그래밍',
        weekNumber: 2,
        status: AttendanceStatus.absent,
        sessionOpenedAt: now.subtract(const Duration(days: 3)),
      ),
      MyAttendanceItem(
        recordId: 'r3',
        sessionId: 's-103',
        courseId: 'fd673fbe-6b14-4a8a-a74f-accfb5afcf1f',
        courseName: '데이터구조',
        weekNumber: 3,
        status: AttendanceStatus.pending,
        sessionOpenedAt: now.subtract(const Duration(hours: 2)),
      ),
    ];
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

  // ---- courses (in-memory catalog + enrolled set) ----

  /// Static offered-courses catalog for offline/mock development. Mirrors the
  /// real DB rows (as of 2026-10-28) so the mock app matches what the web
  /// dashboard shows. day_of_week is 1=Mon..7=Sun (app model convention); the
  /// DB stores 0=Mon..6=Sun, so values here are already +1. IDs are the real
  /// course UUIDs. The two C언어프로그래밍 rows share code 374142 and overlap
  /// on Mon 3교시, which exercises the clash UI with real data.
  static const List<Course> _catalog = [
    Course(
      id: '4b8b48f6-7e20-4f34-abed-4b34dca8721b',
      code: '374140',
      name: '컴퓨터개론',
      department: '컴퓨터·소프트웨어공학과',
      professorName: '김영수',
      dayOfWeek: 1,
      startPeriod: 1,
      endPeriod: 2,
      location: '공대 401',
      credits: 3,
    ),
    Course(
      id: '98902951-0d19-4b24-9c34-2056b9657da0',
      code: '374141',
      name: '파이썬프로그래밍',
      department: '컴퓨터·소프트웨어공학과',
      professorName: '김영수',
      dayOfWeek: 2,
      startPeriod: 1,
      endPeriod: 2,
      location: '공대 403',
      credits: 3,
    ),
    Course(
      id: 'e0068e9a-da44-4f30-ab08-d308439d3d90',
      code: '374142',
      name: 'C언어프로그래밍',
      department: '컴퓨터·소프트웨어공학과',
      professorName: '김영수',
      dayOfWeek: 1,
      startPeriod: 1,
      endPeriod: 3,
      location: '공대 402',
      credits: 3,
    ),
    Course(
      id: '57ff561b-2da1-4fc4-9d93-81523809d3f7',
      code: '374142',
      name: 'C언어프로그래밍',
      department: '컴퓨터·소프트웨어공학과',
      professorName: '김영수',
      dayOfWeek: 1,
      startPeriod: 3,
      endPeriod: 4,
      location: '공대 402',
      credits: 3,
    ),
    Course(
      id: '71e62e46-9ad8-479f-af71-dd5dd738cb4c',
      code: '374143',
      name: '고급프로그래밍언어',
      department: '컴퓨터·소프트웨어공학과',
      professorName: '김영수',
      dayOfWeek: 2,
      startPeriod: 3,
      endPeriod: 4,
      location: '공대 404',
      credits: 3,
    ),
    Course(
      id: 'c42911ff-7c77-46b1-8b5a-6cd70e79f6c1',
      code: '374152',
      name: '웹(HTML5)프로그래밍',
      department: '컴퓨터·소프트웨어공학과',
      professorName: '김영수',
      dayOfWeek: 5,
      startPeriod: 3,
      endPeriod: 4,
      location: '공대 408',
      credits: 3,
    ),
    Course(
      id: '2a068520-fe78-4301-82ce-95474f0ef9ba',
      code: '374004',
      name: '창의공학설계',
      department: '컴퓨터·소프트웨어공학과',
      professorName: '김영수',
      dayOfWeek: 3,
      startPeriod: 1,
      endPeriod: 2,
      location: '공대 405',
      credits: 3,
    ),
    Course(
      id: 'fd673fbe-6b14-4a8a-a74f-accfb5afcf1f',
      code: '375210',
      name: '데이터구조',
      department: '콘텐츠미디어SW융합전공',
      professorName: '김영수',
      dayOfWeek: 1,
      startPeriod: 5,
      endPeriod: 6,
      location: '미디어관 201',
      credits: 3,
    ),
    Course(
      id: '06d5e98f-0dcc-454b-a304-942e1e55f955',
      code: '375212',
      name: '과학적데이터처리',
      department: '콘텐츠미디어SW융합전공',
      professorName: '김영수',
      dayOfWeek: 3,
      startPeriod: 5,
      endPeriod: 6,
      location: '미디어관 203',
      credits: 3,
    ),
    Course(
      id: 'a66118f9-66b0-4de4-ad12-3d0920a7999c',
      code: '375211',
      name: '컴퓨팅적사고력',
      department: '콘텐츠미디어SW융합전공',
      professorName: '김영수',
      dayOfWeek: 2,
      startPeriod: 5,
      endPeriod: 6,
      location: '미디어관 202',
      credits: 3,
    ),
    Course(
      id: '7bac278e-2f31-4ec0-a4b3-1b16665611ef',
      code: '375213',
      name: '디지털콘텐츠디자인',
      department: '콘텐츠미디어SW융합전공',
      professorName: '김영수',
      dayOfWeek: 4,
      startPeriod: 3,
      endPeriod: 4,
      location: '미디어관 204',
      credits: 3,
    ),
    Course(
      id: 'e292f971-3640-4c1e-8fdd-117df8966464',
      code: '375214',
      name: '인터랙티브미디어',
      department: '콘텐츠미디어SW융합전공',
      professorName: '김영수',
      dayOfWeek: 5,
      startPeriod: 5,
      endPeriod: 6,
      location: '미디어관 205',
      credits: 3,
    ),
    Course(
      id: 'f6c8b878-7518-4f9a-8886-2d5ab1bbd290',
      code: '376320',
      name: '소프트웨어융합개론',
      department: '인공지능융합학과',
      professorName: '김영수',
      dayOfWeek: 1,
      startPeriod: 7,
      endPeriod: 8,
      location: 'AI관 301',
      credits: 3,
    ),
    Course(
      id: 'd79847ac-5196-4e17-8e0c-f9212c3e6a30',
      code: '376321',
      name: '기계학습기초',
      department: '인공지능융합학과',
      professorName: '김영수',
      dayOfWeek: 3,
      startPeriod: 7,
      endPeriod: 8,
      location: 'AI관 302',
      credits: 3,
    ),
    Course(
      id: 'fbae43f3-55a9-4144-a67c-45a8ac5cf7b8',
      code: '374151',
      name: '객체지향프로그래밍',
      department: '컴퓨터·소프트웨어공학과',
      professorName: '김영수',
      dayOfWeek: 4,
      startPeriod: 1,
      endPeriod: 2,
      location: '공대 407',
      credits: 3,
    ),
  ];

  /// Ids the mock student is currently enrolled in. Seeded with a couple so the
  /// timetable is non-empty on first run (컴퓨터개론 + 파이썬프로그래밍: no clash).
  final Set<String> _enrolled = {
    '4b8b48f6-7e20-4f34-abed-4b34dca8721b',
    '98902951-0d19-4b24-9c34-2056b9657da0',
  };

  @override
  Future<List<Course>> getCourseCatalog() async {
    await _latency();
    return _catalog
        .map((c) => c.copyWith(enrolled: _enrolled.contains(c.id)))
        .toList();
  }

  @override
  Future<void> enrollSelf(String courseId) async {
    await _latency();
    if (!_catalog.any((c) => c.id == courseId)) {
      throw const ApiError(
        detail: 'Course not found',
        code: 'not_found',
        statusCode: 404,
      );
    }
    _enrolled.add(courseId);
  }

  @override
  Future<void> unenrollSelf(String courseId) async {
    await _latency();
    _enrolled.remove(courseId);
  }

  @override
  Future<List<Course>> getMyCourses() async {
    await _latency();
    return _catalog
        .where((c) => _enrolled.contains(c.id))
        .map((c) => c.copyWith(enrolled: true))
        .toList();
  }

  Future<void> _latency() =>
      Future<void>.delayed(const Duration(milliseconds: 300));
}
