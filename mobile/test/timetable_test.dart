import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:syncattend_mobile/api/api_client.dart';
import 'package:syncattend_mobile/api/mock_api_client.dart';
import 'package:syncattend_mobile/core/providers.dart';
import 'package:syncattend_mobile/features/courses/course_screens.dart';
import 'package:syncattend_mobile/models/contract_models.dart';

Course _c(
  String id, {
  int day = 1,
  int start = 1,
  int end = 1,
  String name = '과목',
}) =>
    Course(
      id: id,
      code: 'X$id',
      name: name,
      department: '학과',
      professorName: '교수',
      dayOfWeek: day,
      startPeriod: start,
      endPeriod: end,
      location: '강의실',
      credits: 3,
    );

void main() {
  group('Timetable.overlaps', () {
    test('same day, overlapping periods → true', () {
      expect(Timetable.overlaps(_c('a', day: 1, start: 3, end: 4),
              _c('b', day: 1, start: 4, end: 5)),
          isTrue);
    });

    test('same day, adjacent-but-disjoint periods → false', () {
      expect(Timetable.overlaps(_c('a', day: 1, start: 1, end: 2),
              _c('b', day: 1, start: 3, end: 4)),
          isFalse);
    });

    test('different day, same periods → false', () {
      expect(Timetable.overlaps(_c('a', day: 1, start: 3, end: 4),
              _c('b', day: 2, start: 3, end: 4)),
          isFalse);
    });

    test('is symmetric', () {
      final a = _c('a', day: 3, start: 2, end: 5);
      final b = _c('b', day: 3, start: 4, end: 4);
      expect(Timetable.overlaps(a, b), Timetable.overlaps(b, a));
    });
  });

  group('Timetable.conflictingIds', () {
    test('flags exactly the clashing pair', () {
      final courses = [
        _c('ds', day: 1, start: 3, end: 4),
        _c('algo', day: 1, start: 4, end: 5), // clashes with ds
        _c('os', day: 2, start: 5, end: 6), // no clash
      ];
      final ids = Timetable.conflictingIds(courses);
      expect(ids, containsAll(<String>['ds', 'algo']));
      expect(ids.contains('os'), isFalse);
    });

    test('no clashes → empty set', () {
      final courses = [
        _c('a', day: 1, start: 1, end: 1),
        _c('b', day: 2, start: 1, end: 1),
      ];
      expect(Timetable.conflictingIds(courses), isEmpty);
    });
  });

  group('Timetable.maxDay / maxPeriod', () {
    test('clamps to minimums when courses are small', () {
      final courses = [_c('a', day: 1, start: 1, end: 1)];
      expect(Timetable.maxDay(courses), 5); // Mon–Fri floor
      expect(Timetable.maxPeriod(courses), 9); // 9-period floor
    });

    test('grows to fit a Saturday / late-period course', () {
      final courses = [_c('a', day: 6, start: 10, end: 11)];
      expect(Timetable.maxDay(courses), 6);
      expect(Timetable.maxPeriod(courses), 11);
    });
  });

  group('Course model', () {
    test('periodSpan counts inclusive periods', () {
      expect(_c('a', start: 6, end: 8).periodSpan, 3);
      expect(_c('a', start: 2, end: 2).periodSpan, 1);
    });

    test('fromJson tolerates professor / professor_name and snake_case', () {
      final c = Course.fromJson({
        'id': 'c1',
        'code': 'CSE201',
        'name': '자료구조',
        'department': '컴퓨터공학과',
        'professor': '김교수',
        'day_of_week': 1,
        'start_period': 3,
        'end_period': 4,
        'location': '401',
        'credits': 3,
      });
      expect(c.professorName, '김교수');
      expect(c.dayOfWeek, 1);
      expect(c.periodSpan, 2);
    });
  });

  group('weekdayLabelKo', () {
    test('maps 1..7 to 월..일', () {
      expect(weekdayLabelKo(1), '월');
      expect(weekdayLabelKo(5), '금');
      expect(weekdayLabelKo(7), '일');
    });
    test('out-of-range → ?', () {
      expect(weekdayLabelKo(0), '?');
      expect(weekdayLabelKo(8), '?');
    });
  });

  group('MockApiClient course flow', () {
    test('enroll then unenroll toggles my-courses membership', () async {
      final api = MockApiClient();
      final before = await api.getMyCourses();
      expect(before.any((c) => c.id == 'c-net'), isFalse);

      await api.enrollSelf('c-net');
      final after = await api.getMyCourses();
      expect(after.any((c) => c.id == 'c-net'), isTrue);
      expect(after.every((c) => c.enrolled), isTrue);

      await api.unenrollSelf('c-net');
      final removed = await api.getMyCourses();
      expect(removed.any((c) => c.id == 'c-net'), isFalse);
    });

    test('catalog marks enrolled courses', () async {
      final api = MockApiClient();
      final catalog = await api.getCourseCatalog();
      final ds = catalog.firstWhere((c) => c.id == 'c-ds');
      expect(ds.enrolled, isTrue); // seeded
      final net = catalog.firstWhere((c) => c.id == 'c-net');
      expect(net.enrolled, isFalse);
    });

    test('enroll unknown id throws 404 ApiError', () async {
      final api = MockApiClient();
      expect(
        () => api.enrollSelf('nope'),
        throwsA(isA<ApiError>()
            .having((e) => e.statusCode, 'statusCode', 404)),
      );
    });
  });

  group('TimetableScreen widget', () {
    Widget wrap(ApiClient api) => ProviderScope(
          overrides: [apiClientProvider.overrideWithValue(api)],
          child: const MaterialApp(home: Scaffold(body: TimetableScreen())),
        );

    testWidgets('empty enrollment shows the guidance message', (tester) async {
      await tester.pumpWidget(wrap(_InstantCoursesApi(const [])));
      await tester.pumpAndSettle();
      expect(find.textContaining('수강 중인 강의가 없습니다'), findsOneWidget);
    });

    testWidgets('renders course blocks + conflict banner when clashing',
        (tester) async {
      // c-ds Mon3-4 clashes with c-algo Mon4-5; c-os Tue5-6 does not.
      final api = _InstantCoursesApi([
        _c('c-ds', day: 1, start: 3, end: 4, name: '자료구조'),
        _c('c-algo', day: 1, start: 4, end: 5, name: '알고리즘'),
        _c('c-os', day: 2, start: 5, end: 6, name: '운영체제'),
      ]);
      await tester.pumpWidget(wrap(api));
      await tester.pumpAndSettle();

      expect(find.text('자료구조'), findsWidgets);
      expect(find.text('알고리즘'), findsWidgets);
      expect(find.text('시간이 겹치는 강의가 있습니다.'), findsOneWidget);
    });
  });
}

/// Minimal synchronous ApiClient for widget tests: returns the given courses
/// with no latency (avoids the fake-async vs real-timer mismatch that a
/// Future.delayed-based mock causes under [testWidgets]). Only the course
/// methods are exercised here; anything else throws if unexpectedly called.
class _InstantCoursesApi implements ApiClient {
  _InstantCoursesApi(this._courses);
  final List<Course> _courses;

  @override
  Future<List<Course>> getMyCourses() async =>
      _courses.map((c) => c.copyWith(enrolled: true)).toList();

  @override
  Future<List<Course>> getCourseCatalog() async => _courses;

  @override
  Future<void> enrollSelf(String courseId) async {}

  @override
  Future<void> unenrollSelf(String courseId) async {}

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName} not used in test');
}
