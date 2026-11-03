// Widget tests for the "내 출결" first page + per-course attendance bottom sheet:
//  - the first page lists enrolled courses as cards (main = course name,
//    sub = code · schedule · professor · location);
//  - tapping a card opens a draggable bottom sheet showing the course info
//    header + a week×(출석/결석) table where a present week shows ✓ in the
//    출석 column and an absent week shows ✗ in the 결석 column;
//  - a failed course load surfaces the error affordance with "다시 시도" retry.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:syncattend_mobile/api/api_client.dart';
import 'package:syncattend_mobile/api/mock_api_client.dart';
import 'package:syncattend_mobile/core/providers.dart';
import 'package:syncattend_mobile/features/views/view_screens.dart';
import 'package:syncattend_mobile/models/contract_models.dart';

/// An ApiClient whose getMyCourses always fails, to drive the error branch.
/// getMyAttendance returns immediately (no _latency timer) so pumpAndSettle
/// doesn't leave a pending Future.delayed timer behind.
class _FailingCoursesApi extends MockApiClient {
  @override
  Future<List<Course>> getMyCourses() async {
    throw const ApiError(detail: 'boom', statusCode: 500);
  }

  @override
  Future<List<MyAttendanceItem>> getMyAttendance() async => const [];
}

Widget _app(ProviderContainer container) => UncontrolledProviderScope(
      container: container,
      child: const MaterialApp(
        home: Scaffold(body: MyAttendanceScreen()),
      ),
    );

void main() {
  testWidgets(
      'first page lists enrolled courses as cards; tapping opens the '
      'week×status bottom sheet', (tester) async {
    final c = ProviderContainer(overrides: [
      apiClientProvider.overrideWithValue(MockApiClient() as ApiClient),
    ]);
    addTearDown(c.dispose);

    await tester.pumpWidget(_app(c));
    await tester.pumpAndSettle();

    // Two enrolled courses appear as cards. 데이터구조 is NOT enrolled.
    expect(find.text('컴퓨터개론'), findsOneWidget);
    expect(find.text('파이썬프로그래밍'), findsOneWidget);
    expect(find.text('데이터구조'), findsNothing);

    // Tap the 컴퓨터개론 card → opens the bottom sheet.
    await tester.tap(find.text('컴퓨터개론'));
    await tester.pumpAndSettle();

    // 컴퓨터개론 mock record: week 1, present.
    // Sheet shows the course name header + table columns + week row with ✓.
    expect(find.text('컴퓨터개론'), findsWidgets);
    expect(find.text('출석'), findsWidgets);
    expect(find.text('결석'), findsWidgets);
    expect(find.text('1주차'), findsOneWidget);
    expect(find.byIcon(Icons.check), findsOneWidget);
  });

  testWidgets('failed course load surfaces error + 다시 시도 retry',
      (tester) async {
    final c = ProviderContainer(overrides: [
      apiClientProvider.overrideWithValue(_FailingCoursesApi() as ApiClient),
    ]);
    addTearDown(c.dispose);

    await tester.pumpWidget(_app(c));
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.error_outline), findsOneWidget);
    expect(find.textContaining('수강 강좌를 불러오지 못했습니다'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, '다시 시도'), findsOneWidget);
  });
}
