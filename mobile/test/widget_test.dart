import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:syncattend_mobile/api/mock_api_client.dart';
import 'package:syncattend_mobile/core/providers.dart';
import 'package:syncattend_mobile/features/auth/login_screen.dart';
import 'package:syncattend_mobile/main.dart';

import 'support/fakes.dart';

void main() {
  testWidgets('boots to login screen when no token stored', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          secureStoreProvider.overrideWithValue(FakeSecureStore()),
          apiClientProvider.overrideWith((ref) => MockApiClient()),
        ],
        child: const SyncattendApp(),
      ),
    );
    // Let the auth bootstrap future resolve.
    await tester.pumpAndSettle();

    expect(find.byType(LoginScreen), findsOneWidget);
    expect(find.text('학생 로그인'), findsOneWidget);
  });

  testWidgets('login form validates @wku.ac.kr email', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          secureStoreProvider.overrideWithValue(FakeSecureStore()),
          apiClientProvider.overrideWith((ref) => MockApiClient()),
        ],
        child: const SyncattendApp(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(
        find.byType(TextFormField).first, 'someone@gmail.com');
    await tester.enterText(find.byType(TextFormField).last, 'pw');
    await tester.tap(find.text('로그인'));
    await tester.pump();

    expect(find.text('@wku.ac.kr 주소만 허용됩니다'), findsOneWidget);
  });
}
