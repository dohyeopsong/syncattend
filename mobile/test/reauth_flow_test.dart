// E2E flow test (mock API): device UUID loss / change → @wku.ac.kr email
// re-authentication → rebinding, driving the real AuthController state machine.
//
// Verifies the NO-AUTO-BIND rule: an unknown/changed UUID must NOT be silently
// bound. It must route to `needsReauth`, and rebinding may only happen after an
// explicit email + code confirmation.

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
  group('Device re-auth / rebind E2E (mock)', () {
    late FakeSecureStore store;
    late MockApiClient api;

    ProviderContainer makeContainer(String deviceUuid) {
      store = FakeSecureStore();
      // Seed the device UUID so DeviceIdentity.getOrCreate() is deterministic.
      store.writeDeviceUuid(deviceUuid);
      api = MockApiClient();
      return ProviderContainer(overrides: [
        secureStoreProvider.overrideWithValue(store as SecureStore),
        apiClientProvider.overrideWithValue(api as ApiClient),
        deviceIdentityProvider.overrideWith(
            (ref) => DeviceIdentity(ref.watch(secureStoreProvider))),
      ]);
    }

    test('happy path: fresh device binds and reaches ready', () async {
      final c = makeContainer('uuid-new');
      addTearDown(c.dispose);
      final notifier = c.read(authControllerProvider.notifier);

      await notifier.login('student@wku.ac.kr', 'pw');
      await _pump(c, (s) => s.phase == AuthPhase.ready);

      expect(c.read(authControllerProvider).phase, AuthPhase.ready);
    });

    test('changed UUID is NOT auto-bound -> routes to needsReauth', () async {
      final c = makeContainer('uuid-new-device');
      addTearDown(c.dispose);
      // Simulate the account already bound to a DIFFERENT (old) device UUID.
      await api.registerDevice('uuid-old-device');

      final notifier = c.read(authControllerProvider.notifier);
      await notifier.login('student@wku.ac.kr', 'pw');
      await _pump(c, (s) => s.phase == AuthPhase.needsReauth);

      final state = c.read(authControllerProvider);
      // Must land on re-auth, NOT silently ready — proves no auto-bind.
      expect(state.phase, AuthPhase.needsReauth);

      // And the server binding is unchanged (still the old device).
      final binding = await api.getMyDevice();
      expect(binding.deviceUuid, 'uuid-old-device');
    });

    test('email re-auth with valid code rebinds to the new UUID -> ready',
        () async {
      final c = makeContainer('uuid-new-device');
      addTearDown(c.dispose);
      await api.registerDevice('uuid-old-device');
      final notifier = c.read(authControllerProvider.notifier);

      await notifier.login('student@wku.ac.kr', 'pw');
      await _pump(c, (s) => s.phase == AuthPhase.needsReauth);
      expect(c.read(authControllerProvider).phase, AuthPhase.needsReauth);

      // Step 1: request code (mock accepts any @wku.ac.kr).
      final sent = await notifier.requestReauthCode('student@wku.ac.kr');
      expect(sent, isTrue);

      // Step 2: confirm with valid code → rebind to THIS device's UUID.
      final ok = await notifier.confirmReauth('student@wku.ac.kr', '123456');
      expect(ok, isTrue);
      expect(c.read(authControllerProvider).phase, AuthPhase.ready);

      final binding = await api.getMyDevice();
      expect(binding.deviceUuid, 'uuid-new-device');
    });

    test('re-auth with WRONG code does not rebind and surfaces an error',
        () async {
      final c = makeContainer('uuid-new-device');
      addTearDown(c.dispose);
      await api.registerDevice('uuid-old-device');
      final notifier = c.read(authControllerProvider.notifier);

      await notifier.login('student@wku.ac.kr', 'pw');
      await _pump(c, (s) => s.phase == AuthPhase.needsReauth);

      final ok = await notifier.confirmReauth('student@wku.ac.kr', '000000');
      expect(ok, isFalse);
      // Still not ready; binding untouched.
      expect(c.read(authControllerProvider).phase, AuthPhase.needsReauth);
      expect(c.read(authControllerProvider).error, isNotNull);
      final binding = await api.getMyDevice();
      expect(binding.deviceUuid, 'uuid-old-device');
    });

    test('non-@wku.ac.kr email is rejected at code request', () async {
      final c = makeContainer('uuid-new-device');
      addTearDown(c.dispose);
      await api.registerDevice('uuid-old-device');
      final notifier = c.read(authControllerProvider.notifier);

      await notifier.login('student@wku.ac.kr', 'pw');
      await _pump(c, (s) => s.phase == AuthPhase.needsReauth);

      final sent = await notifier.requestReauthCode('someone@gmail.com');
      expect(sent, isFalse);
      expect(c.read(authControllerProvider).error, isNotNull);
    });
  });
}
