import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Keychain (iOS) / Keystore (Android) backed storage for:
///  - the app-generated device UUID (identity defense; survives reinstall on iOS
///    Keychain, and app data clears on Android — see [DeviceIdentity] handling),
///  - JWT access/refresh tokens.
class SecureStore {
  SecureStore([FlutterSecureStorage? storage])
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
              iOptions: IOSOptions(
                accessibility: KeychainAccessibility.first_unlock,
              ),
            );

  final FlutterSecureStorage _storage;

  static const _kDeviceUuid = 'syncattend.device_uuid';
  static const _kAccess = 'syncattend.access_token';
  static const _kRefresh = 'syncattend.refresh_token';

  Future<String?> readDeviceUuid() => _storage.read(key: _kDeviceUuid);
  Future<void> writeDeviceUuid(String value) =>
      _storage.write(key: _kDeviceUuid, value: value);

  Future<String?> readAccessToken() => _storage.read(key: _kAccess);
  Future<String?> readRefreshToken() => _storage.read(key: _kRefresh);

  Future<void> writeTokens({
    required String access,
    required String refresh,
  }) async {
    await _storage.write(key: _kAccess, value: access);
    await _storage.write(key: _kRefresh, value: refresh);
  }

  Future<void> clearTokens() async {
    await _storage.delete(key: _kAccess);
    await _storage.delete(key: _kRefresh);
  }
}
