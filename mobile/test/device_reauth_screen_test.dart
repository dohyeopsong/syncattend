// Widget tests for DeviceReauthScreen UX (real-device fixes):
//  - after a successful code request, the code field + confirm button appear
//    (_codeSent transition) and a success snackbar shows;
//  - a failed code request surfaces the error prominently (banner + snackbar)
//    and does NOT reveal the code field.
//
// Uses MockApiClient driven through the real AuthController so the test
// exercises the same state machine the device does.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:syncattend_mobile/api/api_client.dart';
import 'package:syncattend_mobile/api/mock_api_client.dart';
import 'package:syncattend_mobile/core/device_identity.dart';
import 'package:syncattend_mobile/core/providers.dart';
import 'package:syncattend_mobile/core/secure_store.dart';
import 'package:syncattend_mobile/features/auth/auth_controller.dart';
import 'package:syncattend_mobile/features/auth/device_screens.dart';

import 'support/fakes.dart';

Widget _app(ProviderContainer container) => UncontrolledProviderScope(
      container: container,
      child: const MaterialApp(home: DeviceReauthScreen()),
    );

void main() {
  ProviderContainer makeContainer({String? lastEmail}) {
    final store = FakeSecureStore()..writeDeviceUuid('uuid-new-device');
    final api = MockApiClient();
    final c = ProviderContainer(overrides: [
      secureStoreProvider.overrideWithValue(store as SecureStore),
      apiClientProvider.overrideWithValue(api as ApiClient),
      deviceIdentityProvider.overrideWith(
          (ref) => DeviceIdentity(ref.watch(secureStoreProvider))),
    ]);
    if (lastEmail != null) {
      // Seed lastEmail via the public login path (mock accepts @wku.ac.kr).
      c.read(authControllerProvider.notifier).login(lastEmail, 'pw');
    }
    return c;
  }

  testWidgets(
      'successful code request reveals code field + confirm button + snackbar',
      (tester) async {
    final c = makeContainer();
    addTearDown(c.dispose);
    await tester.pumpWidget(_app(c));

    // Code field is hidden initially.
    expect(find.widgetWithText(TextField, '인증 코드'), findsNothing);
    expect(find.text('인증 코드 받기'), findsOneWidget);

    // Enter a valid @wku.ac.kr email and request the code.
    await tester.enterText(
        find.widgetWithText(TextField, '학교 이메일 (@wku.ac.kr)'),
        'student@wku.ac.kr');
    await tester.tap(find.text('인증 코드 받기'));
    await tester.pumpAndSettle();

    // Now the code field, confirm button and resend appear + success snackbar.
    expect(find.widgetWithText(TextField, '인증 코드'), findsOneWidget);
    expect(find.text('코드 확인 & 재바인딩'), findsOneWidget);
    expect(find.text('코드 다시 받기'), findsOneWidget);
    expect(find.textContaining('인증 코드를 발송했습니다'), findsOneWidget);
  });

  testWidgets('non-@wku.ac.kr email surfaces error and keeps code field hidden',
      (tester) async {
    final c = makeContainer();
    addTearDown(c.dispose);
    await tester.pumpWidget(_app(c));

    await tester.enterText(
        find.widgetWithText(TextField, '학교 이메일 (@wku.ac.kr)'),
        'someone@gmail.com');
    await tester.tap(find.text('인증 코드 받기'));
    await tester.pumpAndSettle();

    // Error banner shows the @wku.ac.kr message; code field stays hidden.
    expect(find.textContaining('@wku.ac.kr'), findsWidgets);
    expect(find.widgetWithText(TextField, '인증 코드'), findsNothing);
    expect(find.byIcon(Icons.error_outline), findsOneWidget);
  });

  testWidgets('back/logout affordance is present', (tester) async {
    final c = makeContainer();
    addTearDown(c.dispose);
    await tester.pumpWidget(_app(c));

    expect(find.byIcon(Icons.arrow_back), findsOneWidget);
    expect(find.text('로그아웃'), findsOneWidget);
  });
}
