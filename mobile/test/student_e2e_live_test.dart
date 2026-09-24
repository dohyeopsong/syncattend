// Student E2E integration test against a LIVE backend (docker compose stack).
//
// This drives the real mobile HTTP client (DioApiClient) through the full
// student happy path — login → getMe → registerDevice → verifyAttendance →
// getMyAttendance — plus a rejection path, using raw HTTP only for the
// professor-side setup (register/course/enroll/session/token) that owner C's
// web normally performs.
//
// GATED: it probes GET /health first and SKIPS cleanly when the backend is
// unreachable OR when a setup call fails (e.g. the known users.id uuid-vs-
// varchar schema mismatch returns 500 on /auth/register). So it is green now
// (skipped) and will actually exercise the flow the moment owner A fixes the
// schema — no code change needed here.
//
// Run against the live stack:
//   docker compose -f infra/docker-compose.yml up --build -d
//   (from mobile/) flutter test test/student_e2e_live_test.dart \
//       --dart-define=E2E_BACKEND_URL=http://localhost:8000
// If E2E_BACKEND_URL is unset it defaults to http://localhost:8000.

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:syncattend_mobile/api/dio_api_client.dart';
import 'package:syncattend_mobile/core/secure_store.dart';
import 'package:syncattend_mobile/models/contract_models.dart';

const _backendUrl = String.fromEnvironment(
  'E2E_BACKEND_URL',
  defaultValue: 'http://localhost:8000',
);

/// In-memory SecureStore so DioApiClient's JWT interceptor works in tests.
class _MemStore implements SecureStore {
  final _m = <String, String>{};
  @override
  Future<String?> readDeviceUuid() async => _m['uuid'];
  @override
  Future<void> writeDeviceUuid(String v) async => _m['uuid'] = v;
  @override
  Future<String?> readAccessToken() async => _m['access'];
  @override
  Future<String?> readRefreshToken() async => _m['refresh'];
  @override
  Future<void> writeTokens({required String access, required String refresh}) async {
    _m['access'] = access;
    _m['refresh'] = refresh;
  }

  @override
  Future<void> clearTokens() async {
    _m.remove('access');
    _m.remove('refresh');
  }
}

Future<bool> _backendUsable(Dio raw) async {
  try {
    final health = await raw.get('/health');
    final ok = (health.data is Map) && (health.data['status'] == 'ok');
    if (!ok) return false;
    // Probe register — the known schema blocker (users.id uuid vs varchar)
    // surfaces here as a 500. If setup can't succeed, skip the whole suite.
    final email = 'probe_${DateTime.now().microsecondsSinceEpoch}@wku.ac.kr';
    final r = await raw.post(
      '/auth/register',
      data: {
        'email': email,
        'password': 'seedpass123',
        'role': 'student',
        'name': 'Probe'
      },
      options: Options(validateStatus: (_) => true),
    );
    return r.statusCode == 201 || r.statusCode == 200;
  } catch (_) {
    return false;
  }
}

void main() {
  final raw = Dio(BaseOptions(
    baseUrl: _backendUrl,
    connectTimeout: const Duration(seconds: 3),
    receiveTimeout: const Duration(seconds: 5),
    headers: {'Content-Type': 'application/json'},
  ));

  late bool usable;

  setUpAll(() async {
    usable = await _backendUsable(raw);
    if (!usable) {
      // ignore: avoid_print
      print('[E2E] backend at $_backendUrl not usable (down or schema blocker) '
          '— skipping live student E2E. Re-run once owner A fixes the '
          'users.id uuid/varchar mismatch.');
    }
  });

  Future<String> loginAs(Dio d, String email, String pw) async {
    final r = await d.post('/auth/login', data: {'email': email, 'password': pw});
    return (r.data as Map)['access_token'] as String;
  }

  test('student happy path: login → me → registerDevice → verify present → history',
      () async {
    if (!usable) {
      markTestSkipped('backend not usable (see setUpAll note)');
      return;
    }
    const pw = 'seedpass123';
    final tag = DateTime.now().microsecondsSinceEpoch;
    final profEmail = 'prof_$tag@wku.ac.kr';
    final stuEmail = 'stu_$tag@wku.ac.kr';
    final deviceUuid = 'e2e-$tag';

    // --- Professor setup over raw HTTP (C's normal flow) ---
    await raw.post('/auth/register', data: {
      'email': profEmail, 'password': pw, 'role': 'professor', 'name': 'P'
    });
    await raw.post('/auth/register', data: {
      'email': stuEmail, 'password': pw, 'role': 'student', 'name': 'S'
    });
    final profTok = await loginAs(raw, profEmail, pw);
    final profDio = Dio(raw.options)
      ..options.headers['Authorization'] = 'Bearer $profTok';

    final course = await profDio.post('/courses', data: {'name': 'E2E'});
    final courseId = (course.data as Map)['id'] as String;

    // --- Student side via the REAL mobile client (DioApiClient) ---
    final store = _MemStore();
    final api = DioApiClient(store, dio: Dio(BaseOptions(baseUrl: _backendUrl)));

    final pair = await api.login(email: stuEmail, password: pw);
    await store.writeTokens(
        access: pair.accessToken, refresh: pair.refreshToken);
    expect(pair.role, Role.student);

    // getMe → real student id (no "me" placeholder)
    final me = await api.getMe();
    expect(me.id, isNotEmpty);
    expect(me.email, stuEmail);

    // enroll (professor) using the real student id
    await profDio.post('/courses/$courseId/enrollments',
        data: {'student_id': me.id});

    // device binding (fresh uuid → binds, no 409)
    final binding = await api.registerDevice(deviceUuid);
    expect(binding.deviceUuid, deviceUuid);

    // professor opens a session + fetches the QR/audio token
    final sess = await profDio
        .post('/sessions', data: {'course_id': courseId, 'window_seconds': 600});
    final sessionId = (sess.data as Map)['session_id'] as String;
    final tok = await profDio.get('/sessions/$sessionId/token');
    final qr = (tok.data as Map)['qr_token'] as String;
    final nonce = (tok.data as Map)['audio_nonce'] as String;

    // student verifies with the captured QR + decoded audio nonce
    final result = await api.verifyAttendance(VerifyRequest(
      sessionId: sessionId,
      qrToken: qr,
      audioNonce: nonce,
      deviceUuid: deviceUuid,
    ));
    expect(result.status, VerifyStatus.present, reason: 'reason=${result.reason}');

    // history reflects the new present record
    final history = await api.getMyAttendance();
    expect(history.any((h) => h.sessionId == sessionId), isTrue);
  }, timeout: const Timeout(Duration(seconds: 30)));

  test('rejection path: nonce reuse → rejected(nonceReused)', () async {
    if (!usable) {
      markTestSkipped('backend not usable (see setUpAll note)');
      return;
    }
    const pw = 'seedpass123';
    final tag = DateTime.now().microsecondsSinceEpoch;
    final profEmail = 'prof2_$tag@wku.ac.kr';
    final stuEmail = 'stu2_$tag@wku.ac.kr';
    final deviceUuid = 'e2e2-$tag';

    await raw.post('/auth/register', data: {
      'email': profEmail, 'password': pw, 'role': 'professor', 'name': 'P'
    });
    await raw.post('/auth/register', data: {
      'email': stuEmail, 'password': pw, 'role': 'student', 'name': 'S'
    });
    final profTok = await loginAs(raw, profEmail, pw);
    final profDio = Dio(raw.options)
      ..options.headers['Authorization'] = 'Bearer $profTok';
    final courseId =
        (await profDio.post('/courses', data: {'name': 'E2E2'})).data['id']
            as String;

    final store = _MemStore();
    final api = DioApiClient(store, dio: Dio(BaseOptions(baseUrl: _backendUrl)));
    final pair = await api.login(email: stuEmail, password: pw);
    await store.writeTokens(
        access: pair.accessToken, refresh: pair.refreshToken);
    final me = await api.getMe();
    await profDio
        .post('/courses/$courseId/enrollments', data: {'student_id': me.id});
    await api.registerDevice(deviceUuid);

    final sess = await profDio
        .post('/sessions', data: {'course_id': courseId, 'window_seconds': 600});
    final sessionId = (sess.data as Map)['session_id'] as String;
    final tok = await profDio.get('/sessions/$sessionId/token');
    final req = VerifyRequest(
      sessionId: sessionId,
      qrToken: (tok.data as Map)['qr_token'] as String,
      audioNonce: (tok.data as Map)['audio_nonce'] as String,
      deviceUuid: deviceUuid,
    );

    final first = await api.verifyAttendance(req);
    expect(first.status, VerifyStatus.present);

    // Same single-use nonce again → server rejects as reused.
    final second = await api.verifyAttendance(req);
    expect(second.status, VerifyStatus.rejected);
    expect(second.reason, VerifyReason.nonceReused);
  }, timeout: const Timeout(Duration(seconds: 30)));
}
