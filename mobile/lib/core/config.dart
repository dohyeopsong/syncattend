import 'package:flutter/foundation.dart';

/// Runtime configuration.
///
/// [backendBaseUrl] is injected at build time:
///   flutter run --dart-define=BACKEND_URL=http://192.168.0.10:8000
/// Android emulator maps host to 10.0.2.2. iOS sim / device: localhost / LAN IP.
///
/// [useMock] toggles the in-memory mock API so the student app can be built and
/// exercised end-to-end before the backend (owner A) is live. Enable with:
///   flutter run --dart-define=USE_MOCK=true
class AppConfig {
  const AppConfig._();

  static const String backendBaseUrl = String.fromEnvironment(
    'BACKEND_URL',
    defaultValue: 'http://10.0.2.2:8000',
  );

  static const bool useMock = bool.fromEnvironment(
    'USE_MOCK',
    defaultValue: kDebugMode,
  );

  /// School email domain enforced by the device re-registration flow.
  static const String schoolEmailDomain = '@wku.ac.kr';

  /// Default auth-window length shown in the countdown UI when the server does
  /// not report a remaining value yet (contract default is 60s).
  static const int defaultWindowSeconds = 60;

  /// Ultrasonic audio-token band the professor client emits nonces on.
  /// MUST match the web emitter DEFAULT_PROTOCOL (web/src/lib/ultrasonicEmitter.ts)
  /// and the AudioNonceDecoder defaults (audio_nonce_decoder.dart).
  static const double audioBandLowHz = 18500;
  static const double audioBandHighHz = 20000;
}
