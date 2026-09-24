# mobile/ — Flutter Student App (Owner B)

Owner **B**.

## Prereqs
Flutter SDK (>=3.4). Verify with `flutter doctor`.

## First-time init
This folder ships the source skeleton (`lib/`, `test/`, `pubspec.yaml`). Generate the
platform folders (android/ios) once:
```bash
cd mobile
flutter create .          # generates android/, ios/ without overwriting lib/
flutter pub get
```

## Run
```bash
flutter run               # emulator/device
flutter test              # widget smoke test
```
Backend URL is configurable: `--dart-define=BACKEND_URL=http://<host>:8000`
(default `http://10.0.2.2:8000` for the Android emulator).

## Boundaries
- Reads the API contract from `../contracts/` (READ-ONLY).
- Identity defense: app-generated UUID stored via `flutter_secure_storage`/`flutter_udid`
  (Keychain/Keystore); `@wku.ac.kr` re-auth on device change. Do not edit backend/web/contracts.
