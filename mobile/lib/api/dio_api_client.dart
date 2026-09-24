import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';

import '../core/config.dart';
import '../core/secure_store.dart';
import '../models/contract_models.dart';
import 'api_client.dart';

/// Real, contract-backed HTTP client (Dio). Attaches the JWT bearer token and
/// transparently refreshes it once on 401.
class DioApiClient implements ApiClient {
  DioApiClient(this._store, {Dio? dio})
      : _dio = dio ??
            Dio(BaseOptions(
              baseUrl: AppConfig.backendBaseUrl,
              connectTimeout: const Duration(seconds: 10),
              receiveTimeout: const Duration(seconds: 15),
              headers: {'Content-Type': 'application/json'},
            )) {
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await _store.readAccessToken();
        if (token != null && token.isNotEmpty) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        handler.next(options);
      },
      onError: (e, handler) async {
        if (e.response?.statusCode == 401 && !_retried) {
          _retried = true;
          final refreshed = await _tryRefresh();
          if (refreshed) {
            final req = e.requestOptions;
            final token = await _store.readAccessToken();
            req.headers['Authorization'] = 'Bearer $token';
            try {
              final clone = await _dio.fetch(req);
              return handler.resolve(clone);
            } catch (_) {
              // fall through to original error
            }
          }
        }
        handler.next(e);
      },
    ));
  }

  final Dio _dio;
  final SecureStore _store;
  bool _retried = false;

  Future<bool> _tryRefresh() async {
    final refresh = await _store.readRefreshToken();
    if (refresh == null || refresh.isEmpty) return false;
    try {
      final res = await _dio.post('/auth/refresh',
          data: {'refresh_token': refresh},
          options: Options(headers: {'Authorization': null}));
      final pair = TokenPair.fromJson(res.data as Map<String, dynamic>);
      await _store.writeTokens(
          access: pair.accessToken, refresh: pair.refreshToken);
      return true;
    } catch (_) {
      return false;
    } finally {
      _retried = false;
    }
  }

  Never _rethrowAsApiError(DioException e) {
    final data = e.response?.data;
    if (data is Map<String, dynamic>) {
      throw ApiError.fromJson(data, statusCode: e.response?.statusCode);
    }
    throw ApiError(
      detail: e.message ?? 'Network error',
      statusCode: e.response?.statusCode,
    );
  }

  @override
  Future<TokenPair> login(
      {required String email, required String password}) async {
    try {
      final res = await _dio.post('/auth/login',
          data: {'email': email, 'password': password});
      return TokenPair.fromJson(res.data as Map<String, dynamic>);
    } on DioException catch (e) {
      _rethrowAsApiError(e);
    }
  }

  @override
  Future<TokenPair> refresh(String refreshToken) async {
    try {
      final res = await _dio
          .post('/auth/refresh', data: {'refresh_token': refreshToken});
      return TokenPair.fromJson(res.data as Map<String, dynamic>);
    } on DioException catch (e) {
      _rethrowAsApiError(e);
    }
  }

  @override
  Future<UserOut> getMe() async {
    try {
      final res = await _dio.get('/auth/me');
      return UserOut.fromJson(res.data as Map<String, dynamic>);
    } on DioException catch (e) {
      _rethrowAsApiError(e);
    }
  }

  @override
  Future<DeviceBinding> registerDevice(String deviceUuid) async {
    try {
      final res = await _dio
          .post('/devices/register', data: {'device_uuid': deviceUuid});
      return DeviceBinding.fromJson(res.data as Map<String, dynamic>);
    } on DioException catch (e) {
      _rethrowAsApiError(e);
    }
  }

  @override
  Future<void> reregisterRequest(String email) async {
    try {
      await _dio.post('/devices/reregister/request', data: {'email': email});
    } on DioException catch (e) {
      _rethrowAsApiError(e);
    }
  }

  @override
  Future<DeviceBinding> reregisterConfirm({
    required String email,
    required String code,
    required String newDeviceUuid,
  }) async {
    try {
      final res = await _dio.post('/devices/reregister/confirm', data: {
        'email': email,
        'code': code,
        'new_device_uuid': newDeviceUuid,
      });
      return DeviceBinding.fromJson(res.data as Map<String, dynamic>);
    } on DioException catch (e) {
      _rethrowAsApiError(e);
    }
  }

  @override
  Future<DeviceBinding> getMyDevice() async {
    try {
      final res = await _dio.get('/devices/me');
      return DeviceBinding.fromJson(res.data as Map<String, dynamic>);
    } on DioException catch (e) {
      _rethrowAsApiError(e);
    }
  }

  @override
  Future<VerifyResult> verifyAttendance(VerifyRequest request) async {
    try {
      final res =
          await _dio.post('/attendance/verify', data: request.toJson());
      return VerifyResult.fromJson(res.data as Map<String, dynamic>);
    } on DioException catch (e) {
      // Contract: 409 also returns a VerifyResult (rejected + reason).
      final data = e.response?.data;
      if (e.response?.statusCode == 409 && data is Map<String, dynamic>) {
        return VerifyResult.fromJson(data);
      }
      _rethrowAsApiError(e);
    }
  }

  @override
  Future<List<MyAttendanceItem>> getMyAttendance() async {
    try {
      final res = await _dio.get('/me/attendance');
      final list = (res.data as List<dynamic>)
          .map((e) => MyAttendanceItem.fromJson(e as Map<String, dynamic>))
          .toList();
      return list;
    } on DioException catch (e) {
      _rethrowAsApiError(e);
    }
  }

  @override
  Stream<RiskWarning> riskWarnings(String studentId) async* {
    final token = await _store.readAccessToken();
    final res = await _dio.get<ResponseBody>(
      '/sse/students/$studentId',
      options: Options(
        responseType: ResponseType.stream,
        headers: {
          'Accept': 'text/event-stream',
          if (token != null) 'Authorization': 'Bearer $token',
        },
      ),
    );
    final stream = res.data!.stream
        .cast<List<int>>()
        .transform(utf8.decoder)
        .transform(const LineSplitter());

    // Minimal SSE frame parser: accumulate `data:` lines until a blank line.
    final buffer = StringBuffer();
    await for (final line in stream) {
      if (line.isEmpty) {
        final payload = buffer.toString().trim();
        buffer.clear();
        if (payload.isEmpty) continue;
        try {
          final json = jsonDecode(payload) as Map<String, dynamic>;
          yield RiskWarning.fromJson(json);
        } catch (_) {
          // ignore malformed frame
        }
      } else if (line.startsWith('data:')) {
        buffer.write(line.substring(5).trim());
      }
    }
  }
}
