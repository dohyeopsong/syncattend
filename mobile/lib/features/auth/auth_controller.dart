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
  });

  final AuthPhase phase;
  final Role role;
  final String? error;
  final bool busy;

  AuthState copyWith({
    AuthPhase? phase,
    Role? role,
    String? error,
    bool? busy,
    bool clearError = false,
  }) =>
      AuthState(
        phase: phase ?? this.phase,
        role: role ?? this.role,
        error: clearError ? null : (error ?? this.error),
        busy: busy ?? this.busy,
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
    state = state.copyWith(busy: true, clearError: true);
    try {
      final api = _ref.read(apiClientProvider);
      final pair = await api.login(email: email, password: password);
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
    state = state.copyWith(busy: true, clearError: true);
    try {
      await _ref.read(apiClientProvider).reregisterRequest(email);
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
    state = state.copyWith(busy: true, clearError: true);
    try {
      final api = _ref.read(apiClientProvider);
      final uuid = await _ref.read(deviceIdentityProvider).getOrCreate();
      await api.reregisterConfirm(
          email: email, code: code, newDeviceUuid: uuid);
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

  Future<void> logout() async {
    await _ref.read(secureStoreProvider).clearTokens();
    state = const AuthState(phase: AuthPhase.loggedOut);
  }
}

final authControllerProvider =
    StateNotifierProvider<AuthController, AuthState>(
  (ref) => AuthController(ref),
);
