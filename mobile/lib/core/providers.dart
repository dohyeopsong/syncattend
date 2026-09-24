import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../api/dio_api_client.dart';
import '../api/mock_api_client.dart';
import 'config.dart';
import 'device_identity.dart';
import 'secure_store.dart';

/// Keychain/Keystore-backed store (JWT + device UUID).
final secureStoreProvider = Provider<SecureStore>((ref) => SecureStore());

/// App-generated UUID device identity.
final deviceIdentityProvider = Provider<DeviceIdentity>(
  (ref) => DeviceIdentity(ref.watch(secureStoreProvider)),
);

/// The device UUID (generated once, restored thereafter).
final deviceUuidProvider = FutureProvider<String>(
  (ref) => ref.watch(deviceIdentityProvider).getOrCreate(),
);

/// The authenticated student's own id, resolved from GET /auth/me. Used to
/// subscribe to /sse/students/{id} and load /me/attendance without decoding the
/// JWT client-side. Replaces the earlier hard-coded "me" placeholder.
final studentIdProvider = FutureProvider<String>(
  (ref) async => (await ref.watch(apiClientProvider).getMe()).id,
);

/// Selects the real or mock API client based on [AppConfig.useMock].
/// Override this provider in tests to inject a fake.
final apiClientProvider = Provider<ApiClient>((ref) {
  if (AppConfig.useMock) {
    return MockApiClient();
  }
  return DioApiClient(ref.watch(secureStoreProvider));
});
