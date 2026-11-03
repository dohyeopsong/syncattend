// Regression tests for AuthController._bootstrap() launch routing.
//
// BUG: previously, whenever a token existed the app went to
// `needsDeviceRegistration` on EVERY launch, so the device-registration screen
// reappeared each time the app opened. These tests pin the corrected behaviour:
//   - no token                        -> loggedOut
//   - token + this device bound       -> ready (NO register screen)
//   - token + a different device bound-> needsReauth (never auto-bind)
//   - token + nothing bound yet       -> needsDeviceRegistration

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:syncattend_mobile/api/api_client.dart';
import 'package:syncattend_mobile/api/mock_api_client.dart';
import 'package:syncattend_mobile/core/device_identity.dart';
import 'package:syncattend_mobile/core/providers.dart';
import 'package:syncattend_mobile/core/secure_store.dart';
import 'package:syncattend_mobile/features/auth/auth_controller.dart';

import 'support/fakes.dart';

/// Waits until [test] holds on the auth state or the timeout elapses.
Future<void> _pump(ProviderContainer c, bool Function(AuthState) test) async {
  final deadline = DateTime.now().add(const Duration(seconds: 3));
  while (DateTime.now().isBefore(deadline)) {
    if (test(c.read(authControllerProvider))) return;
    await Future<void>.delayed(const Duration(milliseconds: 20));
  }
}

void main() {
  group('AuthController bootstrap launch routing', () {
    late FakeSecureStore store;
    late MockApiClient api;

    /// Builds a container WITHOUT constructing the controller yet, so callers
    /// can seed token/uuid/binding before _bootstrap() runs on first read.
    ProviderContainer makeContainer() {
      store = FakeSecureStore();
      api = MockApiClient();
      return ProviderContainer(overrides: [
        secureStoreProvider.overrideWithValue(store as SecureStore),
        apiClientProvider.overrideWithValue(api as ApiClient),
        deviceIdentityProvider.overrideWith(
            (ref) => DeviceIdentity(ref.watch(secureStoreProvider))),
      ]);
    }

    test('no token on launch -> loggedOut', () async {
      final c = makeContainer();
      addTearDown(c.dispose);

      // First read triggers _bootstrap().
      await _pump(c, (s) => s.phase != AuthPhase.loading);
      expect(c.read(authControllerProvider).phase, AuthPhase.loggedOut);
    });

    test('token + same device already bound -> ready (no register screen)',
        () async {
      final c = makeContainer();
      addTearDown(c.dispose);
      // Seed a persisted session + device UUID, and bind that UUID server-side.
      await store.writeTokens(access: 'tok', refresh: 'ref');
      await store.writeDeviceUuid('uuid-this-device');
      await api.registerDevice('uuid-this-device');

      // Force a fresh controller so _bootstrap sees the seeded state.
      c.read(authControllerProvider.notifier);
      await _pump(c, (s) => s.phase != AuthPhase.loading);

      expect(c.read(authControllerProvider).phase, AuthPhase.ready);
    });

    test('token + a DIFFERENT device bound -> needsReauth (no auto-bind)',
        () async {
      final c = makeContainer();
      addTearDown(c.dispose);
      await store.writeTokens(access: 'tok', refresh: 'ref');
      await store.writeDeviceUuid('uuid-this-device');
      // Server is bound to some other device.
      await api.registerDevice('uuid-old-device');

      c.read(authControllerProvider.notifier);
      await _pump(c, (s) => s.phase != AuthPhase.loading);

      expect(c.read(authControllerProvider).phase, AuthPhase.needsReauth);
      // Binding must be untouched.
      final binding = await api.getMyDevice();
      expect(binding.deviceUuid, 'uuid-old-device');
    });

    test('token + nothing bound yet -> needsDeviceRegistration', () async {
      final c = makeContainer();
      addTearDown(c.dispose);
      await store.writeTokens(access: 'tok', refresh: 'ref');
      await store.writeDeviceUuid('uuid-this-device');
      // No registerDevice() call → server has no binding (mock: 'unbound').

      c.read(authControllerProvider.notifier);
      await _pump(c, (s) => s.phase != AuthPhase.loading);

      expect(c.read(authControllerProvider).phase,
          AuthPhase.needsDeviceRegistration);
    });
  });
}
