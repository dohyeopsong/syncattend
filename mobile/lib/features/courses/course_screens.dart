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
  if (!c.hasSchedule) return '시간 미정';
  final day = weekdayLabelKo(c.dayOfWeek);
  return c.startPeriod == c.endPeriod
      ? '$day ${c.startPeriod}교시'
      : '$day ${c.startPeriod}–${c.endPeriod}교시';
}

/// Everytime-style pastel block palette. Each entry is a (fill, accent) pair;
/// courses pick one by index so each timetable block has a distinct color.
const _blockPalette = <({Color fill, Color accent})>[
  (fill: Color(0xFFE8EAFE), accent: Color(0xFF6366F1)),
  (fill: Color(0xFFDCFCE7), accent: Color(0xFF16A34A)),
  (fill: Color(0xFFFEE2E2), accent: Color(0xFFEF4444)),
  (fill: Color(0xFFFEF3C7), accent: Color(0xFFD97706)),
  (fill: Color(0xFFE0F2FE), accent: Color(0xFF0284C7)),
  (fill: Color(0xFFF3E8FF), accent: Color(0xFF9333EA)),
  (fill: Color(0xFFFCE7F3), accent: Color(0xFFDB2777)),
  (fill: Color(0xFFCCFBF1), accent: Color(0xFF0D9488)),
];

({Color fill, Color accent}) _blockColor(int index) =>
    _blockPalette[index % _blockPalette.length];

// ===========================================================================
// 1) Course catalog sheet — opened from the timetable "+" button (Everytime-
//    style "시간표 수정 / 수강신청"). A modal bottom sheet listing every offered
//    course with enroll / cancel actions. The timetable grid behind it refreshes
//    live as the user toggles enrollment.
// ===========================================================================

/// Opens the catalog as a half-height modal sheet (Everytime-style "시간표 수정").
/// Half height keeps the timetable grid visible behind the sheet so the user
/// sees enrollment changes reflect live as they toggle courses.
Future<void> showCourseCatalogSheet(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    barrierColor: Colors.black26,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (ctx) => const CourseCatalogSheet(),
  );
}

class CourseCatalogSheet extends ConsumerStatefulWidget {
  const CourseCatalogSheet({super.key});

  @override
  ConsumerState<CourseCatalogSheet> createState() => _CourseCatalogSheetState();
}

class _CourseCatalogSheetState extends ConsumerState<CourseCatalogSheet> {
  final _query = TextEditingController();
  _SearchField _field = _SearchField.all;

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  Future<void> _toggle(Course c) async {
    final api = ref.read(apiClientProvider);
    final messenger = ScaffoldMessenger.of(context);
    try {
      if (c.enrolled) {
        await api.unenrollSelf(c.id);
        messenger.showSnackBar(
            SnackBar(content: Text('${c.name} 수강신청을 취소했습니다.')));
      } else {
        // Pre-check against the student's current timetable: if this course's
        // time slot overlaps an already-enrolled course, block the enroll with
        // a popup naming the conflicting course (the server would also reject
        // via its uniqueness rules, but this gives immediate, clear feedback).
        if (c.hasSchedule) {
          final myCourses =
              ref.read(myCoursesProvider).valueOrNull ?? const <Course>[];
          final clash = myCourses
              .where((e) => e.hasSchedule && Timetable.overlaps(e, c))
              .toList();
          if (clash.isNotEmpty) {
            await _showClashDialog(c, clash);
            return;
          }
        }
        await api.enrollSelf(c.id);
        messenger.showSnackBar(
            SnackBar(content: Text('${c.name} 수강신청이 완료되었습니다.')));
      }
      // Refresh both the catalog (button state) and the timetable behind it.
      ref.invalidate(courseCatalogProvider);
      ref.invalidate(myCoursesProvider);
    } on ApiError catch (e) {
      messenger.showSnackBar(
          SnackBar(content: Text('처리하지 못했습니다: ${e.detail}')));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('처리하지 못했습니다: $e')));
    }
  }

  /// Popup shown when the course the student is trying to add overlaps an
  /// already-enrolled course's time slot.
  Future<void> _showClashDialog(Course c, List<Course> clash) {
    final names = clash.map((e) => '· ${e.name} (${scheduleLabel(e)})').join('\n');
    return showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        icon: const Icon(Icons.warning_amber_rounded,
            color: AppColors.warning, size: 32),
        title: const Text('시간이 겹칩니다'),
        content: Text(
          '「${c.name}」(${scheduleLabel(c)})이(가)\n이미 담은 강의와 시간이 겹칩니다:\n\n$names',
          style: const TextStyle(fontSize: 13, color: AppColors.foreground),
        ),
        actions: [
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('확인'),
          ),
        ],
      ),
    );
  }

  bool _matches(Course c, String q) {
    if (q.isEmpty) return true;
    switch (_field) {
      case _SearchField.name:
        return c.name.toLowerCase().contains(q);
      case _SearchField.professor:
        return c.professorName.toLowerCase().contains(q);
      case _SearchField.code:
        return c.code.toLowerCase().contains(q);
      case _SearchField.all:
        return c.name.toLowerCase().contains(q) ||
            c.professorName.toLowerCase().contains(q) ||
            c.code.toLowerCase().contains(q) ||
            c.department.toLowerCase().contains(q);
    }
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(courseCatalogProvider);
    final height = MediaQuery.of(context).size.height * 0.5;
    return SizedBox(
      height: height,
      child: Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: Column(
          children: [
            // Drag handle + compact header.
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 8, 6),
              child: Column(
                children: [
                  Center(
                    child: Container(
                      width: 32,
                      height: 4,
                      margin: const EdgeInsets.only(bottom: 8),
                      decoration: BoxDecoration(
                        color: AppColors.border,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ),
                  Row(
                    children: [
                      const Expanded(
                        child: Text('시간표 수정 · 수강신청',
                            style: TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w700,
                                color: AppColors.foreground)),
                      ),
                      IconButton(
                        onPressed: () => Navigator.of(context).pop(),
                        icon: const Icon(Icons.close,
                            size: 20, color: AppColors.mutedForeground),
                        visualDensity: VisualDensity.compact,
                      ),
                    ],
                  ),
                ],
              ),
            ),
            // Search bar + field filter (web-style).
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 6),
              child: Row(
                children: [
                  Expanded(
                    child: SizedBox(
                      height: 34,
                      child: TextField(
                        controller: _query,
                        onChanged: (_) => setState(() {}),
                        style: const TextStyle(fontSize: 12),
                        decoration: InputDecoration(
                          hintText: '강좌명 · 교수명 · 학수번호',
                          hintStyle: const TextStyle(
                              fontSize: 12, color: AppColors.mutedForeground),
                          prefixIcon: const Icon(Icons.search,
                              size: 16, color: AppColors.mutedForeground),
                          prefixIconConstraints:
                              const BoxConstraints(minWidth: 32),
                          isDense: true,
                          contentPadding: const EdgeInsets.symmetric(
                              horizontal: 8, vertical: 0),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(10),
                            borderSide:
                                const BorderSide(color: AppColors.border),
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(10),
                            borderSide: const BorderSide(
                                color: AppColors.indigo, width: 1.2),
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),
                  SizedBox(
                    height: 34,
                    child: _FieldDropdown(
                      value: _field,
                      onChanged: (f) => setState(() => _field = f),
                    ),
                  ),
                ],
              ),
            ),
            const Divider(height: 1, color: AppColors.border),
            // Filtered results list.
            Expanded(
              child: async.when(
                loading: () =>
                    const Center(child: CircularProgressIndicator()),
                error: (e, _) => _ErrorRetry(
                  message: '개설강좌를 불러오지 못했습니다.\n$e',
                  onRetry: () => ref.invalidate(courseCatalogProvider),
                ),
                data: (courses) {
                  final q = _query.text.trim().toLowerCase();
                  final filtered =
                      courses.where((c) => _matches(c, q)).toList();
                  if (filtered.isEmpty) {
                    return Center(
                      child: Padding(
                        padding: const EdgeInsets.all(20),
                        child: Text(
                          q.isEmpty ? '개설된 강의가 없습니다.' : '검색 결과가 없습니다.',
                          style: const TextStyle(
                              fontSize: 12, color: AppColors.mutedForeground),
                        ),
                      ),
                    );
                  }
                  return ListView.separated(
                    padding: const EdgeInsets.symmetric(
                        vertical: 4, horizontal: 8),
                    itemCount: filtered.length,
                    separatorBuilder: (_, __) =>
                        const SizedBox(height: 4, child: Divider(height: 1)),
                    itemBuilder: (context, i) => _CatalogTile(
                      course: filtered[i],
                      onToggle: () => _toggle(filtered[i]),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

enum _SearchField { all, name, professor, code }

class _FieldDropdown extends StatelessWidget {
  const _FieldDropdown({required this.value, required this.onChanged});
  final _SearchField value;
  final ValueChanged<_SearchField> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<_SearchField>(
          value: value,
          isDense: true,
          style: const TextStyle(fontSize: 12, color: AppColors.foreground),
          items: const [
            DropdownMenuItem(value: _SearchField.all, child: Text('전체')),
            DropdownMenuItem(value: _SearchField.name, child: Text('강좌명')),
            DropdownMenuItem(value: _SearchField.professor, child: Text('교수명')),
            DropdownMenuItem(value: _SearchField.code, child: Text('학수번호')),
          ],
          onChanged: (v) {
            if (v != null) onChanged(v);
          },
        ),
      ),
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
    return InkWell(
      onTap: onToggle,
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(course.name,
                      style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: AppColors.foreground)),
                  const SizedBox(height: 1),
                  Text(
                      '${course.code} · ${course.professorName} · ${course.department}',
                      style: const TextStyle(
                          fontSize: 10, color: AppColors.mutedForeground)),
                  const SizedBox(height: 1),
                  Text(
                      '${scheduleLabel(course)} · ${course.location} · ${course.credits}학점',
                      style: const TextStyle(
                          fontSize: 10, color: AppColors.mutedForeground)),
                ],
              ),
            ),
            const SizedBox(width: 8),
            enrolled
                ? OutlinedButton(
                    onPressed: onToggle,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.indigo,
                      side: const BorderSide(color: AppColors.indigo),
                      minimumSize: const Size(0, 28),
                      padding: const EdgeInsets.symmetric(horizontal: 10),
                      textStyle: const TextStyle(
                          fontSize: 11, fontWeight: FontWeight.w600),
                    ),
                    child: const Text('취소'),
                  )
                : FilledButton(
                    onPressed: onToggle,
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.indigo,
                      minimumSize: const Size(0, 28),
                      padding: const EdgeInsets.symmetric(horizontal: 10),
                      textStyle: const TextStyle(
                          fontSize: 11, fontWeight: FontWeight.w600),
                    ),
                    child: const Text('담기'),
                  ),
          ],
        ),
      ),
    );
  }
}

// ===========================================================================
// 2) Timetable — Everytime-style weekly grid built from GET /me/courses.
//    The header (year/semester + "+") lives in HomeShell's AppBar; this widget
//    is the grid body. Courses without timetable metadata (hasSchedule == false)
//    are listed in a chip below the grid instead of being stacked on Mon 1교시.
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
            padding: const EdgeInsets.fromLTRB(8, 8, 8, 16),
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
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: const BoxDecoration(
                color: AppColors.badgeIndigoBg,
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.event_busy,
                  size: 32, color: AppColors.indigo),
            ),
            const SizedBox(height: 12),
            const Text('수강 중인 강의가 없습니다 — 우측 상단 + 버튼으로 강의를 담아보세요',
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

  // Compact Everytime-style sizing: short rows + small headers so the whole
  // week fits without crowding, and empty space below the last class stays
  // quiet rather than feeling like dead weight.
  static const double _rowHeight = 42;
  static const double _headerHeight = 24;
  static const double _timeColWidth = 28;

  @override
  Widget build(BuildContext context) {
    // Only courses with a real schedule are placed on the grid; the rest are
    // surfaced as "시간 미정" chips so they are not lost (and not stacked).
    final placed = courses.where((c) => c.hasSchedule).toList();
    final unscheduled = courses.where((c) => !c.hasSchedule).toList();

    if (placed.isEmpty && unscheduled.isEmpty) {
      return const _EmptyTimetable();
    }

    // Lock the grid to Mon..Fri (5 columns) so Wednesday sits on the exact
    // horizontal center. If only weekday-limited courses exist, still show 5
    // columns instead of collapsing (keeps Wednesday centered).
    var maxDay = Timetable.maxDay(placed);
    if (maxDay < 5) maxDay = 5;
    final maxPeriod = Timetable.maxPeriod(placed);
    final conflicts = Timetable.conflictingIds(placed);
    final hasConflict = conflicts.isNotEmpty;

    // Stable color assignment by course index in the placed list.
    final colorOf = <String, ({Color fill, Color accent})>{};
    for (var i = 0; i < placed.length; i++) {
      colorOf[placed[i].id] = _blockColor(i);
    }

    return LayoutBuilder(builder: (context, constraints) {
      final gridWidth = constraints.maxWidth;
      // Day column width is kept as-is (compact Everytime sizing). The grid is
      // made horizontally symmetric by adding a right trailing margin equal to
      // the left time column (_timeColWidth), so Wednesday lands on the exact
      // horizontal center: center = (_timeColWidth + 5*dayCol + _timeColWidth)/2
      // = _timeColWidth + 2.5*dayCol = Wednesday column center.
      final dayColWidth =
          ((gridWidth - _timeColWidth) / (maxDay + 1)).clamp(40.0, 200.0);
      final totalHeight = _headerHeight + maxPeriod * _rowHeight;

      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (hasConflict)
            const Padding(
              padding: EdgeInsets.only(bottom: 8, left: 4),
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
            // + _timeColWidth on the right mirrors the left time column so the
            // grid is symmetric and Wednesday sits at the horizontal center.
            width: _timeColWidth + dayColWidth * maxDay + _timeColWidth,
            child: Stack(
              children: [
                _GridSkeleton(
                  maxDay: maxDay,
                  maxPeriod: maxPeriod,
                  rowHeight: _rowHeight,
                  headerHeight: _headerHeight,
                  timeColWidth: _timeColWidth,
                  dayColWidth: dayColWidth,
                ),
                for (final c in placed)
                  _CourseBlock(
                    course: c,
                    color: conflicts.contains(c.id)
                        ? (fill: AppColors.warning.withValues(alpha: 0.16),
                            accent: AppColors.warning)
                        : colorOf[c.id]!,
                    conflicting: conflicts.contains(c.id),
                    rowHeight: _rowHeight,
                    headerHeight: _headerHeight,
                    timeColWidth: _timeColWidth,
                    dayColWidth: dayColWidth,
                  ),
              ],
            ),
          ),
          if (unscheduled.isNotEmpty) ...[
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final c in unscheduled)
                    Chip(
                      label: Text(c.name),
                      avatar: const Icon(Icons.schedule, size: 16),
                      labelStyle: const TextStyle(
                          fontSize: 12, color: AppColors.foreground),
                      backgroundColor: AppColors.mutedBg,
                      side: const BorderSide(color: AppColors.border),
                      visualDensity: VisualDensity.compact,
                    ),
                ],
              ),
            ),
            const Padding(
              padding: EdgeInsets.only(top: 6, left: 4),
              child: Text('시간이 지정되지 않은 강의',
                  style:
                      TextStyle(fontSize: 11, color: AppColors.mutedForeground)),
            ),
          ],
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
    // Header font is intentionally smaller than the block's 강의실 (8.5px) so the
    // weekday/period axis reads as quiet scaffolding, not content.
    const headerStyle = TextStyle(
        fontSize: 7, fontWeight: FontWeight.w600, color: AppColors.mutedForeground);
    return Column(
      children: [
        // Header row: corner cell (with a right border to start the left axis
        // line) + weekday labels. A bottom border closes the top axis line.
        SizedBox(
          height: headerHeight,
          child: Row(
            children: [
              Container(
                width: timeColWidth,
                decoration: const BoxDecoration(
                  border: Border(right: border, bottom: border),
                ),
              ),
              for (var d = 1; d <= maxDay; d++)
                Container(
                  width: dayColWidth,
                  alignment: Alignment.center,
                  decoration: const BoxDecoration(
                    border: Border(bottom: border),
                  ),
                  child: Text(weekdayLabelKo(d), style: headerStyle),
                ),
            ],
          ),
        ),
        // Period rows. The period number sits in the left axis column, which
        // carries a right border so the left axis line runs the full height.
        for (var p = 1; p <= maxPeriod; p++)
          SizedBox(
            height: rowHeight,
            child: Row(
              children: [
                Container(
                  width: timeColWidth,
                  alignment: Alignment.topCenter,
                  padding: const EdgeInsets.only(top: 2),
                  decoration: const BoxDecoration(
                    border: Border(right: border),
                  ),
                  child: Text('$p', style: headerStyle),
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
    required this.color,
    required this.conflicting,
    required this.rowHeight,
    required this.headerHeight,
    required this.timeColWidth,
    required this.dayColWidth,
  });

  final Course course;
  final ({Color fill, Color accent}) color;
  final bool conflicting;
  final double rowHeight;
  final double headerHeight;
  final double timeColWidth;
  final double dayColWidth;

  @override
  Widget build(BuildContext context) {
    final left = timeColWidth + (course.dayOfWeek - 1) * dayColWidth;
    final top = headerHeight + (course.startPeriod - 1) * rowHeight;
    final height = course.periodSpan * rowHeight;

    return Positioned(
      left: left + 2,
      top: top + 2,
      width: dayColWidth - 4,
      height: height - 4,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () => _showDetail(context),
          borderRadius: BorderRadius.circular(10),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 3),
            decoration: BoxDecoration(
              color: color.fill,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: color.accent.withValues(alpha: 0.5)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    if (conflicting)
                      Padding(
                        padding: const EdgeInsets.only(right: 2),
                        child: Icon(Icons.warning_amber_rounded,
                            size: 10, color: color.accent),
                      ),
                    Expanded(
                      child: Text(course.name,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                              fontSize: 10.5,
                              height: 1.15,
                              fontWeight: FontWeight.w700,
                              color: color.accent)),
                    ),
                  ],
                ),
                const SizedBox(height: 1),
                Text(course.location,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 8.5,
                        height: 1.1,
                        color: AppColors.mutedForeground)),
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
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 36,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: 14),
                  decoration: BoxDecoration(
                    color: AppColors.border,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              Text(course.name,
                  style: const TextStyle(
                      fontSize: 20,
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
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () {
                    // Capture the container BEFORE popping — the sheet's context
                    // is unmounted after pop, so ProviderScope.containerOf would
                    // throw if called afterwards.
                    final container = ProviderScope.containerOf(ctx,
                        listen: false);
                    Navigator.of(ctx).pop();
                    _unenrollFromDetail(container, course);
                  },
                  icon: const Icon(Icons.remove_circle_outline, size: 18),
                  label: const Text('수강 취소'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.danger,
                    side: const BorderSide(color: AppColors.danger),
                    padding: const EdgeInsets.symmetric(vertical: 12),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _unenrollFromDetail(ProviderContainer container, Course course) {
    final api = container.read(apiClientProvider);
    api.unenrollSelf(course.id).then((_) {
      container.invalidate(courseCatalogProvider);
      container.invalidate(myCoursesProvider);
    });
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
            Container(
              width: 64,
              height: 64,
              decoration: const BoxDecoration(
                color: AppColors.badgeAmberBg,
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.error_outline,
                  color: AppColors.warning, size: 32),
            ),
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
