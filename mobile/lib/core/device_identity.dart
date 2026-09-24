import 'package:uuid/uuid.dart';

import 'secure_store.dart';

/// App-generated UUID device binding (identity defense).
///
/// Rationale (docs/06_FRONTEND_DESIGN.md): we deliberately do NOT use hardware
/// / OS identifiers (device_info_plus, IMEI, etc.) — those change on reinstall
/// or OS reset and cause false rejections, and are privacy-sensitive. Instead
/// we generate a random v4 UUID once and persist it in Keychain/Keystore.
///
/// On first launch (or after data clear on Android) the UUID is (re)generated;
/// the server treats a new/unknown UUID as requiring @wku.ac.kr re-auth rather
/// than auto-binding it (contract: /devices/register may 409).
class DeviceIdentity {
  DeviceIdentity(this._store, [Uuid? uuid]) : _uuid = uuid ?? const Uuid();

  final SecureStore _store;
  final Uuid _uuid;

  String? _cached;

  /// Returns the persisted UUID, generating and storing one on first access.
  Future<String> getOrCreate() async {
    if (_cached != null) return _cached!;
    final existing = await _store.readDeviceUuid();
    if (existing != null && existing.isNotEmpty) {
      _cached = existing;
      return existing;
    }
    final created = _uuid.v4();
    await _store.writeDeviceUuid(created);
    _cached = created;
    return created;
  }

  /// True if a UUID already existed before this launch (i.e. restored, not new).
  Future<bool> wasRestored() async {
    final existing = await _store.readDeviceUuid();
    return existing != null && existing.isNotEmpty;
  }
}
