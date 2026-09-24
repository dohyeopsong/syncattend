import 'package:syncattend_mobile/core/secure_store.dart';

/// In-memory [SecureStore] replacement so tests do not touch platform channels.
class FakeSecureStore implements SecureStore {
  final Map<String, String> _data = {};

  @override
  Future<String?> readDeviceUuid() async => _data['uuid'];

  @override
  Future<void> writeDeviceUuid(String value) async => _data['uuid'] = value;

  @override
  Future<String?> readAccessToken() async => _data['access'];

  @override
  Future<String?> readRefreshToken() async => _data['refresh'];

  @override
  Future<void> writeTokens(
      {required String access, required String refresh}) async {
    _data['access'] = access;
    _data['refresh'] = refresh;
  }

  @override
  Future<void> clearTokens() async {
    _data.remove('access');
    _data.remove('refresh');
  }
}
