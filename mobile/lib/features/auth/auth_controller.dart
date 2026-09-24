import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../models/contract_models.dart';

/// High-level auth phase for routing.
enum AuthPhase {
  loading,
  loggedOut,
  needsDeviceRegistration, // logged in, UUID not yet bound
  needsReauth, // binding conflict → @wku.ac.kr email flow
  ready, // logged in + device bound
}

class AuthState {
  const AuthState({
    required this.phase,
    this.role = Role.unknown,
    this.error,
    this.busy = false,
    this.lastEmail,
  });

  final AuthPhase phase;
  final Role role;
  final String? error;
  final bool busy;

  /// The email used at login, so the re-auth screen can prefill it (the user
  /// should not have to retype it — a common source of the 422 typo).
  final String? lastEmail;

  AuthState copyWith({
    AuthPhase? phase,
    Role? role,
    String? error,
    bool? busy,
    String? lastEmail,
    bool clearError = false,
  }) =>
      AuthState(
        phase: phase ?? this.phase,
        role: role ?? this.role,
        error: clearError ? null : (error ?? this.error),
        busy: busy ?? this.busy,
        lastEmail: lastEmail ?? this.lastEmail,
      );
}

class AuthController extends StateNotifier<AuthState> {
  AuthController(this._ref)
      : super(const AuthState(phase: AuthPhase.loading)) {
    _bootstrap();
  }

  final Ref _ref;

  Future<void> _bootstrap() async {
    final store = _ref.read(secureStoreProvider);
    final token = await store.readAccessToken();
    if (token == null || token.isEmpty) {
      state = const AuthState(phase: AuthPhase.loggedOut);
    } else {
      // A token exists; assume device needs (re)confirmation on launch.
      state = const AuthState(phase: AuthPhase.needsDeviceRegistration);
    }
  }

  Future<void> login(String email, String password) async {
    final normalized = _normalizeEmail(email);
    state = state.copyWith(busy: true, clearError: true, lastEmail: normalized);
    try {
      final api = _ref.read(apiClientProvider);
      final pair = await api.login(email: normalized, password: password);
      await _ref
          .read(secureStoreProvider)
          .writeTokens(access: pair.accessToken, refresh: pair.refreshToken);
      state = state.copyWith(
        phase: AuthPhase.needsDeviceRegistration,
        role: pair.role,
        busy: false,
      );
      await registerDevice();
    } on ApiError catch (e) {
      state = state.copyWith(busy: false, error: e.detail);
    } catch (e) {
      state = state.copyWith(busy: false, error: e.toString());
    }
  }

  /// Binds the app-generated UUID. On a 409 conflict, routes to email re-auth.
  Future<void> registerDevice() async {
    state = state.copyWith(busy: true, clearError: true);
    try {
      final api = _ref.read(apiClientProvider);
      final uuid = await _ref.read(deviceIdentityProvider).getOrCreate();
      await api.registerDevice(uuid);
      state = state.copyWith(phase: AuthPhase.ready, busy: false);
    } on ApiError catch (e) {
      if (e.statusCode == 409) {
        state = state.copyWith(phase: AuthPhase.needsReauth, busy: false);
      } else {
        state = state.copyWith(busy: false, error: e.detail);
      }
    } catch (e) {
      state = state.copyWith(busy: false, error: e.toString());
    }
  }

  Future<bool> requestReauthCode(String email) async {
    final normalized = _normalizeEmail(email);
    final invalid = _wkuEmailError(normalized);
    if (invalid != null) {
      state = state.copyWith(busy: false, error: invalid);
      return false;
    }
    state = state.copyWith(busy: true, clearError: true);
    try {
      await _ref.read(apiClientProvider).reregisterRequest(normalized);
      state = state.copyWith(busy: false);
      return true;
    } on ApiError catch (e) {
      state = state.copyWith(busy: false, error: e.detail);
      return false;
    } catch (e) {
      state = state.copyWith(busy: false, error: e.toString());
      return false;
    }
  }

  Future<bool> confirmReauth(String email, String code) async {
    final normalized = _normalizeEmail(email);
    final invalid = _wkuEmailError(normalized);
    if (invalid != null) {
      state = state.copyWith(busy: false, error: invalid);
      return false;
    }
    if (code.trim().isEmpty) {
      state = state.copyWith(busy: false, error: '인증 코드를 입력하세요.');
      return false;
    }
    state = state.copyWith(busy: true, clearError: true);
    try {
      final api = _ref.read(apiClientProvider);
      final uuid = await _ref.read(deviceIdentityProvider).getOrCreate();
      await api.reregisterConfirm(
          email: normalized, code: code.trim(), newDeviceUuid: uuid);
      state = state.copyWith(phase: AuthPhase.ready, busy: false);
      return true;
    } on ApiError catch (e) {
      state = state.copyWith(busy: false, error: e.detail);
      return false;
    } catch (e) {
      state = state.copyWith(busy: false, error: e.toString());
      return false;
    }
  }

  /// Trim + lowercase so a stray space / casing does not trip the server's
  /// `EmailStr` validation (observed as a 422 on real devices).
  static String _normalizeEmail(String email) => email.trim().toLowerCase();

  /// Client-side gate: reject empty / non-`@wku.ac.kr` emails before hitting the
  /// server, so we avoid an unnecessary 422 round-trip. Returns an error message
  /// or null when valid.
  static String? _wkuEmailError(String normalized) {
    if (normalized.isEmpty) return '이메일을 입력하세요.';
    final emailRe = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');
    if (!emailRe.hasMatch(normalized)) return '올바른 이메일 형식이 아닙니다.';
    if (!normalized.endsWith('@wku.ac.kr')) {
      return '학교 이메일(@wku.ac.kr)만 사용할 수 있습니다.';
    }
    return null;
  }

  Future<void> logout() async {
    await _ref.read(secureStoreProvider).clearTokens();
    state = const AuthState(phase: AuthPhase.loggedOut);
  }
}

final authControllerProvider =
    StateNotifierProvider<AuthController, AuthState>(
  (ref) => AuthController(ref),
);
