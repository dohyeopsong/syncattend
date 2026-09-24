import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/design.dart';
import '../../core/providers.dart';
import '../../models/contract_models.dart';

/// All offered courses (GET /courses/catalog). Refreshed after enroll/unenroll.
final courseCatalogProvider = FutureProvider.autoDispose<List<Course>>(
  (ref) => ref.watch(apiClientProvider).getCourseCatalog(),
);

/// The authenticated student's enrolled courses (GET /me/courses) — timetable.
final myCoursesProvider = FutureProvider.autoDispose<List<Course>>(
  (ref) => ref.watch(apiClientProvider).getMyCourses(),
);

/// Human-readable "월 3–4교시" schedule string for a course.
String scheduleLabel(Course c) {
  final day = weekdayLabelKo(c.dayOfWeek);
  return c.startPeriod == c.endPeriod
      ? '$day ${c.startPeriod}교시'
      : '$day ${c.startPeriod}–${c.endPeriod}교시';
}

// ===========================================================================
// 1) Course catalog — list of offered courses with enroll / cancel actions.
// ===========================================================================

class CourseCatalogScreen extends ConsumerWidget {
  const CourseCatalogScreen({super.key});

  Future<void> _toggle(
      BuildContext context, WidgetRef ref, Course c) async {
    final api = ref.read(apiClientProvider);
    final messenger = ScaffoldMessenger.of(context);
    try {
      if (c.enrolled) {
        await api.unenrollSelf(c.id);
        messenger.showSnackBar(
            SnackBar(content: Text('${c.name} 수강신청을 취소했습니다.')));
      } else {
        await api.enrollSelf(c.id);
        messenger.showSnackBar(
            SnackBar(content: Text('${c.name} 수강신청이 완료되었습니다.')));
      }
      // Refresh both the catalog (button state) and the timetable.
      ref.invalidate(courseCatalogProvider);
      ref.invalidate(myCoursesProvider);
    } on ApiError catch (e) {
      messenger.showSnackBar(
          SnackBar(content: Text('처리하지 못했습니다: ${e.detail}')));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('처리하지 못했습니다: $e')));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(courseCatalogProvider);
    return async.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => _ErrorRetry(
        message: '개설강좌를 불러오지 못했습니다.\n$e',
        onRetry: () => ref.invalidate(courseCatalogProvider),
      ),
      data: (courses) {
        if (courses.isEmpty) {
          return const Center(child: Text('개설된 강좌가 없습니다.'));
        }
        return RefreshIndicator(
          onRefresh: () async => ref.invalidate(courseCatalogProvider),
          child: ListView.separated(
            padding: const EdgeInsets.symmetric(vertical: 8),
            itemCount: courses.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (context, i) => _CatalogTile(
                course: courses[i],
                onToggle: () => _toggle(context, ref, courses[i])),
          ),
        );
      },
    );
  }
}

class _CatalogTile extends StatelessWidget {
  const _CatalogTile({required this.course, required this.onToggle});
  final Course course;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    final enrolled = course.enrolled;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(course.name,
                    style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                        color: AppColors.foreground)),
                const SizedBox(height: 2),
                Text('${course.code} · ${course.department} · ${course.professorName}',
                    style: const TextStyle(
                        fontSize: 12, color: AppColors.mutedForeground)),
                const SizedBox(height: 4),
                Text('${scheduleLabel(course)} · ${course.location} · ${course.credits}학점',
                    style: const TextStyle(
                        fontSize: 12, color: AppColors.mutedForeground)),
              ],
            ),
          ),
          const SizedBox(width: 12),
          enrolled
              ? OutlinedButton.icon(
                  onPressed: onToggle,
                  icon: const Icon(Icons.check, size: 16),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.indigo,
                    side: const BorderSide(color: AppColors.indigo),
                  ),
                  label: const Text('신청됨 · 취소'),
                )
              : FilledButton(
                  onPressed: onToggle,
                  style: FilledButton.styleFrom(
                      backgroundColor: AppColors.indigo),
                  child: const Text('수강신청'),
                ),
        ],
      ),
    );
  }
}

// ===========================================================================
// 2) Timetable — weekly grid built from GET /me/courses.
// ===========================================================================

class TimetableScreen extends ConsumerWidget {
  const TimetableScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(myCoursesProvider);
    return async.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => _ErrorRetry(
        message: '시간표를 불러오지 못했습니다.\n$e',
        onRetry: () => ref.invalidate(myCoursesProvider),
      ),
      data: (courses) {
        if (courses.isEmpty) return const _EmptyTimetable();
        return RefreshIndicator(
          onRefresh: () async => ref.invalidate(myCoursesProvider),
          child: SingleChildScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.all(12),
            child: _TimetableGrid(courses: courses),
          ),
        );
      },
    );
  }
}

class _EmptyTimetable extends StatelessWidget {
  const _EmptyTimetable();
  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Padding(
        padding: EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.event_busy, size: 44, color: AppColors.mutedForeground),
            SizedBox(height: 12),
            Text('수강 중인 강의가 없습니다 — 강의 조회에서 신청하세요',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.mutedForeground)),
          ],
        ),
      ),
    );
  }
}

/// The weekly grid: columns = weekdays (Mon..maxDay), rows = periods (1..maxP).
/// Each course is placed at its day column, spanning start..end periods. Any
/// course that clashes with another (same day + overlapping periods) is painted
/// with the warning color and flagged.
class _TimetableGrid extends StatelessWidget {
  const _TimetableGrid({required this.courses});
  final List<Course> courses;

  static const double _rowHeight = 56;
  static const double _headerHeight = 32;
  static const double _timeColWidth = 40;

  @override
  Widget build(BuildContext context) {
    final maxDay = Timetable.maxDay(courses);
    final maxPeriod = Timetable.maxPeriod(courses);
    final conflicts = Timetable.conflictingIds(courses);
    final hasConflict = conflicts.isNotEmpty;

    return LayoutBuilder(builder: (context, constraints) {
      final gridWidth = constraints.maxWidth;
      final dayColWidth =
          ((gridWidth - _timeColWidth) / maxDay).clamp(48.0, 200.0);
      final totalHeight = _headerHeight + maxPeriod * _rowHeight;

      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (hasConflict)
            const Padding(
              padding: EdgeInsets.only(bottom: 8),
              child: Row(
                children: [
                  Icon(Icons.warning_amber_rounded,
                      size: 18, color: AppColors.warning),
                  SizedBox(width: 6),
                  Expanded(
                    child: Text('시간이 겹치는 강의가 있습니다.',
                        style: TextStyle(
                            fontSize: 12, color: AppColors.warning)),
                  ),
                ],
              ),
            ),
          SizedBox(
            height: totalHeight,
            width: _timeColWidth + dayColWidth * maxDay,
            child: Stack(
              children: [
                // Grid background: header + period rows + cell borders.
                _GridSkeleton(
                  maxDay: maxDay,
                  maxPeriod: maxPeriod,
                  rowHeight: _rowHeight,
                  headerHeight: _headerHeight,
                  timeColWidth: _timeColWidth,
                  dayColWidth: dayColWidth,
                ),
                // Course blocks.
                for (final c in courses)
                  _CourseBlock(
                    course: c,
                    conflicting: conflicts.contains(c.id),
                    rowHeight: _rowHeight,
                    headerHeight: _headerHeight,
                    timeColWidth: _timeColWidth,
                    dayColWidth: dayColWidth,
                  ),
              ],
            ),
          ),
        ],
      );
    });
  }
}

class _GridSkeleton extends StatelessWidget {
  const _GridSkeleton({
    required this.maxDay,
    required this.maxPeriod,
    required this.rowHeight,
    required this.headerHeight,
    required this.timeColWidth,
    required this.dayColWidth,
  });

  final int maxDay;
  final int maxPeriod;
  final double rowHeight;
  final double headerHeight;
  final double timeColWidth;
  final double dayColWidth;

  @override
  Widget build(BuildContext context) {
    const border = BorderSide(color: AppColors.border);
    return Column(
      children: [
        // Header row: empty corner + weekday labels.
        SizedBox(
          height: headerHeight,
          child: Row(
            children: [
              SizedBox(width: timeColWidth),
              for (var d = 1; d <= maxDay; d++)
                Container(
                  width: dayColWidth,
                  alignment: Alignment.center,
                  child: Text(weekdayLabelKo(d),
                      style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: AppColors.foreground)),
                ),
            ],
          ),
        ),
        // Period rows.
        for (var p = 1; p <= maxPeriod; p++)
          SizedBox(
            height: rowHeight,
            child: Row(
              children: [
                Container(
                  width: timeColWidth,
                  alignment: Alignment.topCenter,
                  padding: const EdgeInsets.only(top: 4),
                  child: Text('$p',
                      style: const TextStyle(
                          fontSize: 12, color: AppColors.mutedForeground)),
                ),
                for (var d = 1; d <= maxDay; d++)
                  Container(
                    width: dayColWidth,
                    decoration: const BoxDecoration(
                      border: Border(top: border, left: border),
                    ),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}

class _CourseBlock extends StatelessWidget {
  const _CourseBlock({
    required this.course,
    required this.conflicting,
    required this.rowHeight,
    required this.headerHeight,
    required this.timeColWidth,
    required this.dayColWidth,
  });

  final Course course;
  final bool conflicting;
  final double rowHeight;
  final double headerHeight;
  final double timeColWidth;
  final double dayColWidth;

  @override
  Widget build(BuildContext context) {
    // Skip blocks that fall outside the rendered day range (e.g. weekend
    // course when only Mon–Fri are shown would still be included via maxDay).
    final left = timeColWidth + (course.dayOfWeek - 1) * dayColWidth;
    final top = headerHeight + (course.startPeriod - 1) * rowHeight;
    final height = course.periodSpan * rowHeight;

    final base = conflicting ? AppColors.warning : AppColors.indigo;
    return Positioned(
      left: left + 2,
      top: top + 2,
      width: dayColWidth - 4,
      height: height - 4,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () => _showDetail(context),
          borderRadius: BorderRadius.circular(8),
          child: Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(
              color: base.withValues(alpha: 0.14),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: base.withValues(alpha: 0.6)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    if (conflicting)
                      const Padding(
                        padding: EdgeInsets.only(right: 2),
                        child: Icon(Icons.warning_amber_rounded,
                            size: 12, color: AppColors.warning),
                      ),
                    Expanded(
                      child: Text(course.name,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                              color: base)),
                    ),
                  ],
                ),
                const SizedBox(height: 2),
                Text(course.location,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 10, color: AppColors.mutedForeground)),
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _showDetail(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(course.name,
                style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: AppColors.foreground)),
            const SizedBox(height: 12),
            _DetailRow(label: '학수번호', value: course.code),
            _DetailRow(label: '교수', value: course.professorName),
            _DetailRow(label: '학과', value: course.department),
            _DetailRow(label: '시간', value: scheduleLabel(course)),
            _DetailRow(label: '강의실', value: course.location),
            _DetailRow(label: '학점', value: '${course.credits}학점'),
            if (conflicting) ...[
              const SizedBox(height: 8),
              const Row(
                children: [
                  Icon(Icons.warning_amber_rounded,
                      size: 16, color: AppColors.warning),
                  SizedBox(width: 6),
                  Expanded(
                    child: Text('다른 강의와 시간이 겹칩니다.',
                        style: TextStyle(
                            fontSize: 12, color: AppColors.warning)),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({required this.label, required this.value});
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 64,
            child: Text(label,
                style: const TextStyle(
                    fontSize: 13, color: AppColors.mutedForeground)),
          ),
          Expanded(
            child: Text(value,
                style: const TextStyle(
                    fontSize: 14, color: AppColors.foreground)),
          ),
        ],
      ),
    );
  }
}

class _ErrorRetry extends StatelessWidget {
  const _ErrorRetry({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline,
                color: AppColors.warning, size: 40),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            FilledButton(onPressed: onRetry, child: const Text('다시 시도')),
          ],
        ),
      ),
    );
  }
}
