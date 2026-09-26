// Widget tests for MyAttendanceScreen (GET /me/attendance rendering):
//  - the loaded history renders one row per record with its course name and a
//    Korean status badge (present/absent/pending) — status is never colour-only;
//  - a failed load surfaces the error affordance with a "다시 시도" retry.
//
// Driven through the real myAttendanceProvider with an injected fake ApiClient
// so the widget exercises the same async.when() branches the device does.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:syncattend_mobile/api/api_client.dart';
import 'package:syncattend_mobile/api/mock_api_client.dart';
import 'package:syncattend_mobile/core/design.dart';
import 'package:syncattend_mobile/core/providers.dart';
import 'package:syncattend_mobile/features/views/view_screens.dart';
import 'package:syncattend_mobile/models/contract_models.dart';

/// An ApiClient whose getMyAttendance always fails, to drive the error branch.
/// All other methods delegate to MockApiClient (unused by this screen).
class _FailingAttendanceApi extends MockApiClient {
  @override
  Future<List<MyAttendanceItem>> getMyAttendance() async {
    throw const ApiError(detail: 'boom', statusCode: 500);
  }
}

Widget _app(ProviderContainer container) => UncontrolledProviderScope(
      container: container,
      child: const MaterialApp(
        home: Scaffold(body: MyAttendanceScreen()),
      ),
    );

void main() {
  testWidgets('renders one row per record with course name + Korean status',
      (tester) async {
    final c = ProviderContainer(overrides: [
      apiClientProvider.overrideWithValue(MockApiClient() as ApiClient),
    ]);
    addTearDown(c.dispose);

    await tester.pumpWidget(_app(c));
    await tester.pumpAndSettle();

    // MockApiClient.getMyAttendance() returns 3 rows (자료구조/운영체제/네트워크).
    expect(find.byType(ListTile), findsNWidgets(3));
    expect(find.text('자료구조'), findsOneWidget);
    expect(find.text('운영체제'), findsOneWidget);
    expect(find.text('네트워크'), findsOneWidget);

    // Status badges carry Korean labels (present/absent/pending spread).
    expect(find.text(attendanceStatusLabel(AttendanceStatus.present)),
        findsWidgets);
    expect(find.text(attendanceStatusLabel(AttendanceStatus.absent)),
        findsWidgets);
    expect(find.text(attendanceStatusLabel(AttendanceStatus.pending)),
        findsWidgets);
  });

  testWidgets('failed load surfaces error + 다시 시도 retry', (tester) async {
    final c = ProviderContainer(overrides: [
      apiClientProvider.overrideWithValue(_FailingAttendanceApi() as ApiClient),
    ]);
    addTearDown(c.dispose);

    await tester.pumpWidget(_app(c));
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.error_outline), findsOneWidget);
    expect(find.textContaining('출결 이력을 불러오지 못했습니다'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, '다시 시도'), findsOneWidget);
  });
}
