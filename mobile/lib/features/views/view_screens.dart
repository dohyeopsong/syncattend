import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/design.dart';
import '../../core/providers.dart';
import '../../models/contract_models.dart';
import '../courses/course_screens.dart';

/// Loads the authenticated student's attendance history from GET /me/attendance.
final myAttendanceProvider = FutureProvider<List<MyAttendanceItem>>(
  (ref) => ref.watch(apiClientProvider).getMyAttendance(),
);

/// "내 출결" 첫 페이지 — 수강 강좌를 카드 목록으로 보여주고, 카드를 탭하면
/// 바텀시트(아래→위 반절, 위로 끌면 확대)로 주차별 출결 표가 올라온다.
/// 카드: 메인 = 교과목명, 서브(작게) = 학수번호 · 요일/시간 · 담당교수 · 강의실.
class MyAttendanceScreen extends ConsumerWidget {
  const MyAttendanceScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(myCoursesProvider);
    return async.when(
      loading: () => const _CourseListSkeleton(),
      error: (e, _) => _LoadError(
        message: '수강 강좌를 불러오지 못했습니다.\n$e',
        onRetry: () => ref.invalidate(myCoursesProvider),
      ),
      data: (courses) {
        if (courses.isEmpty) {
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(myCoursesProvider),
            child: const _NoCoursesState(),
          );
        }
        return RefreshIndicator(
          onRefresh: () async => ref.invalidate(myCoursesProvider),
          child: ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 20, 16, 96),
            itemCount: courses.length + 1,
            separatorBuilder: (_, i) =>
                i == 0 ? const SizedBox(height: 4) : const SizedBox(height: 12),
            itemBuilder: (context, i) {
              if (i == 0) return const _ListHeader();
              final c = courses[i - 1];
              return _CourseCard(course: c);
            },
          ),
        );
      },
    );
  }
}

class _ListHeader extends StatelessWidget {
  const _ListHeader();

  @override
  Widget build(BuildContext context) {
    return const Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('내 출결',
            style: TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.w700,
                color: AppColors.foreground)),
        SizedBox(height: 2),
        Text('강의를 탭하면 주차별 출결 내역이 올라와요.',
            style: TextStyle(fontSize: 13, color: AppColors.mutedForeground)),
      ],
    );
  }
}

/// 수강 강좌 카드. 메인 = 교과목명, 서브 = 학수번호·요일/시간·담당교수·강의실.
/// 탭하면 주차별 출결 바텀시트를 띄운다.
class _CourseCard extends StatelessWidget {
  const _CourseCard({required this.course});
  final Course course;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () => _openAttendanceSheet(context, course),
      borderRadius: BorderRadius.circular(16),
      child: Container(
        decoration: softCardDecoration(),
        padding: const EdgeInsets.fromLTRB(16, 14, 12, 14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: AppColors.indigo.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(12),
              ),
              child: const Icon(Icons.menu_book_outlined,
                  color: AppColors.indigo, size: 20),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(course.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          color: AppColors.foreground)),
                  const SizedBox(height: 4),
                  // 서브 정보: 학수번호 · 요일/시간
                  Text(
                    [if (course.code.isNotEmpty) course.code, scheduleLabel(course)]
                        .where((s) => s.isNotEmpty)
                        .join(' · '),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 12, color: AppColors.mutedForeground),
                  ),
                  const SizedBox(height: 2),
                  // 서브 정보: 담당교수 · 강의실
                  Text(
                    [
                      if (course.professorName.isNotEmpty) course.professorName,
                      if (course.location.isNotEmpty) course.location,
                    ].join(' · '),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontSize: 12, color: AppColors.mutedForeground),
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right,
                color: AppColors.mutedForeground, size: 22),
          ],
        ),
      ),
    );
  }
}

/// 주차별 출결 바텀시트. 반절에서 시작, 위로 끌면 확대, 아래로 끌면 닫힘.
void _openAttendanceSheet(BuildContext context, Course course) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (context) => DraggableScrollableSheet(
      initialChildSize: 0.5,
      minChildSize: 0.25,
      maxChildSize: 0.92,
      builder: (context, scrollController) => Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: _AttendanceSheetBody(
          course: course,
          scrollController: scrollController,
        ),
      ),
    ),
  );
}

class _AttendanceSheetBody extends ConsumerWidget {
  const _AttendanceSheetBody(
      {required this.course, required this.scrollController});
  final Course course;
  final ScrollController scrollController;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(myAttendanceProvider);
    return Column(
      children: [
        // Grabber handle
        Padding(
          padding: const EdgeInsets.only(top: 8, bottom: 4),
          child: Container(
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: AppColors.border,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
        ),
        Expanded(
          child: async.when(
            loading: () =>
                const Center(child: CircularProgressIndicator()),
            error: (e, _) => _LoadError(
              message: '출결 이력을 불러오지 못했습니다.\n$e',
              onRetry: () => ref.invalidate(myAttendanceProvider),
            ),
            data: (items) {
              final mine = items
                  .where((e) => e.courseId == course.id)
                  // 아직 세션이 열리지 않은 주차는 표시하지 않는다.
                  // 기록이 존재한다 = 해당 주차 세션이 열렸다.
                  .toList();
              return _AttendanceTable(
                course: course,
                items: mine,
                scrollController: scrollController,
              );
            },
          ),
        ),
      ],
    );
  }
}

/// 시트 본문: 상단 강의 정보 + 주차별 출결 표(행=주차, 열=출석/결석).
class _AttendanceTable extends StatelessWidget {
  const _AttendanceTable({
    required this.course,
    required this.items,
    required this.scrollController,
  });
  final Course course;
  final List<MyAttendanceItem> items;
  final ScrollController scrollController;

  @override
  Widget build(BuildContext context) {
    // 주차 오름차순, 같은 주차면 수업일자 순.
    final sorted = [...items]..sort((a, b) {
        final wa = a.weekNumber ?? 0;
        final wb = b.weekNumber ?? 0;
        if (wa != wb) return wa.compareTo(wb);
        final ta = a.sessionOpenedAt ?? DateTime(1970);
        final tb = b.sessionOpenedAt ?? DateTime(1970);
        return ta.compareTo(tb);
      });

    // 주차별 상태: 더 나쁜 상태가 우선(absent > pending > present).
    final byWeek = <int, AttendanceStatus>{};
    for (final e in sorted) {
      final w = e.weekNumber ?? 0;
      byWeek[w] = _worse(byWeek[w], e.status);
    }
    final weeks = byWeek.keys.toList()..sort();

    final present =
        items.where((e) => e.status == AttendanceStatus.present).length;
    final absent =
        items.where((e) => e.status == AttendanceStatus.absent).length;
    final late =
        items.where((e) => e.status == AttendanceStatus.late).length;
    final earlyLeave =
        items.where((e) => e.status == AttendanceStatus.earlyLeave).length;
    final pending = items.length - present - absent - late - earlyLeave;

    return ListView(
      controller: scrollController,
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
      children: [
        _CourseInfoHeader(course: course),
        const SizedBox(height: 16),
        // 요약 칩
        Row(
          children: [
            _SummaryChip(
                label: '출석', count: present, color: AppColors.success),
            const SizedBox(width: 8),
            _SummaryChip(
                label: '결석', count: absent, color: AppColors.danger),
            if (late > 0) ...[
              const SizedBox(width: 8),
              _SummaryChip(
                  label: '지각', count: late, color: AppColors.warning),
            ],
            if (earlyLeave > 0) ...[
              const SizedBox(width: 8),
              _SummaryChip(
                  label: '조퇴', count: earlyLeave, color: AppColors.warning),
            ],
            if (pending > 0) ...[
              const SizedBox(width: 8),
              _SummaryChip(
                  label: '대기', count: pending, color: AppColors.warning),
            ],
          ],
        ),
        const SizedBox(height: 16),
        // 표 헤더: (빈) | 출석 | 결석
        _WeekTableHeader(),
        const SizedBox(height: 4),
        for (final w in weeks) ...[
          _WeekTableRow(week: w, status: byWeek[w]!),
          const SizedBox(height: 4),
        ],
        if (weeks.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: Center(
              child: Text('아직 출결 기록이 없습니다.',
                  style: TextStyle(
                      color: AppColors.mutedForeground, fontSize: 13)),
            ),
          ),
      ],
    );
  }

  AttendanceStatus _worse(AttendanceStatus? a, AttendanceStatus b) {
    const rank = {
      AttendanceStatus.present: 0,
      AttendanceStatus.late: 1,
      AttendanceStatus.earlyLeave: 1,
      AttendanceStatus.pending: 1,
      AttendanceStatus.unknown: 1,
      AttendanceStatus.absent: 2,
    };
    if (a == null) return b;
    return rank[a]! >= rank[b]! ? a : b;
  }
}

/// 시트 상단 고정 강의 정보: 교과목·담당교수·요일/시간·강의실.
class _CourseInfoHeader extends StatelessWidget {
  const _CourseInfoHeader({required this.course});
  final Course course;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.indigo.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(course.name,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                  color: AppColors.foreground)),
          const SizedBox(height: 8),
          _infoRow(Icons.person_outline, course.professorName.isEmpty
              ? '—'
              : course.professorName),
          const SizedBox(height: 4),
          _infoRow(Icons.schedule, scheduleLabel(course)),
          const SizedBox(height: 4),
          _infoRow(Icons.place_outlined,
              course.location.isEmpty ? '—' : course.location),
        ],
      ),
    );
  }

  Widget _infoRow(IconData icon, String text) {
    return Row(
      children: [
        Icon(icon, size: 15, color: AppColors.mutedForeground),
        const SizedBox(width: 6),
        Flexible(
          child: Text(text,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                  fontSize: 13, color: AppColors.mutedForeground)),
        ),
      ],
    );
  }
}

/// 표 헤더 행: (주차) | 출석 | 결석
class _WeekTableHeader extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.mutedBg,
        borderRadius: BorderRadius.circular(10),
      ),
      child: const Row(
        children: [
          Expanded(
            flex: 2,
            child: Text('주차',
                textAlign: TextAlign.center,
                style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: AppColors.mutedForeground)),
          ),
          Expanded(
            flex: 2,
            child: Text('출석',
                textAlign: TextAlign.center,
                style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: AppColors.success)),
          ),
          Expanded(
            flex: 2,
            child: Text('결석',
                textAlign: TextAlign.center,
                style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: AppColors.danger)),
          ),
        ],
      ),
    );
  }
}

/// 한 주차 행: 주차 | (출석 ✓ 또는 빈) | (결석 ✗ 또는 빈). pending → 대기.
class _WeekTableRow extends StatelessWidget {
  const _WeekTableRow({required this.week, required this.status});
  final int week;
  final AttendanceStatus status;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.border, width: 0.5),
      ),
      child: Row(
        children: [
          Expanded(
            flex: 2,
            child: Text(
              week == 0 ? '기타' : '$week주차',
              textAlign: TextAlign.center,
              style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: AppColors.foreground),
            ),
          ),
          // 출석 열 — present ✓, late/early_leave show their label (attended
          // but imperfect), pending/unknown show 대기.
          Expanded(
            flex: 2,
            child: Center(
              child: status == AttendanceStatus.present
                  ? const _Mark(Icons.check, AppColors.success)
                  : status == AttendanceStatus.late
                      ? const Text('지각',
                          style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                              color: AppColors.warning))
                      : status == AttendanceStatus.earlyLeave
                          ? const Text('조퇴',
                              style: TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w600,
                                  color: AppColors.warning))
                          : status == AttendanceStatus.pending ||
                                  status == AttendanceStatus.unknown
                              ? const Text('대기',
                                  style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w600,
                                      color: AppColors.warning))
                              : const SizedBox.shrink(),
            ),
          ),
          // 결석 열
          Expanded(
            flex: 2,
            child: Center(
              child: status == AttendanceStatus.absent
                  ? const _Mark(Icons.close, AppColors.danger)
                  : const SizedBox.shrink(),
            ),
          ),
        ],
      ),
    );
  }
}

class _Mark extends StatelessWidget {
  const _Mark(this.icon, this.color);
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 24,
      height: 24,
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        shape: BoxShape.circle,
      ),
      child: Icon(icon, color: color, size: 16),
    );
  }
}

class _SummaryChip extends StatelessWidget {
  const _SummaryChip(
      {required this.label, required this.count, required this.color});
  final String label;
  final int count;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(attendanceStatusIcon(_iconFor(label)),
              size: 16, color: color),
          const SizedBox(width: 6),
          Text('$label $count',
              style: TextStyle(
                  color: color, fontSize: 13, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }

  AttendanceStatus _iconFor(String label) {
    switch (label) {
      case '출석':
        return AttendanceStatus.present;
      case '결석':
        return AttendanceStatus.absent;
      case '지각':
        return AttendanceStatus.late;
      case '조퇴':
        return AttendanceStatus.earlyLeave;
      default:
        return AttendanceStatus.pending;
    }
  }
}

/// 공용 로딩 에러 화면.
class _LoadError extends StatelessWidget {
  const _LoadError({required this.message, required this.onRetry});
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
            Text(message,
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.foreground)),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: onRetry,
              child: const Text('다시 시도'),
            ),
          ],
        ),
      ),
    );
  }
}

/// 수강 강좌가 없을 때 안내.
class _NoCoursesState extends StatelessWidget {
  const _NoCoursesState();

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) => SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        child: ConstrainedBox(
          constraints: BoxConstraints(minHeight: constraints.maxHeight),
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 72,
                    height: 72,
                    decoration: const BoxDecoration(
                      color: AppColors.badgeIndigoBg,
                      shape: BoxShape.circle,
                      boxShadow: AppColors.shadowSoft,
                    ),
                    child: const Icon(Icons.event_available,
                        size: 36, color: AppColors.indigo),
                  ),
                  const SizedBox(height: 16),
                  const Text('수강 중인 강좌가 없습니다',
                      style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                          color: AppColors.foreground)),
                  const SizedBox(height: 6),
                  const Text(
                    '시간표 탭에서 수강신청을 완료하면\n강좌별 출결을 여기서 볼 수 있어요.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                        fontSize: 13, color: AppColors.mutedForeground),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// 강좌 목록 로딩 스켈레톤.
class _CourseListSkeleton extends StatefulWidget {
  const _CourseListSkeleton();

  @override
  State<_CourseListSkeleton> createState() => _CourseListSkeletonState();
}

class _CourseListSkeletonState extends State<_CourseListSkeleton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _shimmer = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _shimmer.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _shimmer,
      builder: (context, _) {
        final opacity = 0.5 + 0.5 * _shimmer.value;
        return Opacity(
          opacity: opacity,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 20, 16, 24),
            children: [
              _skelBox(width: 120, height: 22),
              const SizedBox(height: 8),
              _skelBox(width: 200, height: 14),
              const SizedBox(height: 16),
              for (var i = 0; i < 4; i++) ...[
                _skelCard(),
                const SizedBox(height: 12),
              ],
            ],
          ),
        );
      },
    );
  }

  static Widget _skelBox({required double width, required double height}) =>
      Container(
        width: width,
        height: height,
        decoration: BoxDecoration(
          color: AppColors.mutedBg,
          borderRadius: BorderRadius.circular(6),
        ),
      );

  static Widget _skelCard() => Container(
        decoration: softCardDecoration(),
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                  color: AppColors.mutedBg,
                  borderRadius: BorderRadius.circular(12)),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _skelBox(width: 140, height: 15),
                  const SizedBox(height: 8),
                  _skelBox(width: 110, height: 11),
                  const SizedBox(height: 6),
                  _skelBox(width: 90, height: 11),
                ],
              ),
            ),
          ],
        ),
      );
}

/// Attendance inquiry: compose a question and view answers (placeholder).
class InquiryScreen extends StatefulWidget {
  const InquiryScreen({super.key});

  @override
  State<InquiryScreen> createState() => _InquiryScreenState();
}

class _InquiryScreenState extends State<InquiryScreen> {
  final _controller = TextEditingController();
  final _messages = <(String, String)>[
    ('나', '지난 수업 출석 인증이 실패했는데 확인 가능할까요?'),
    ('교수', '창을 다시 열어드렸습니다. 재인증 부탁드립니다.'),
  ];

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _send() {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    setState(() {
      _messages.add(('나', text));
      _controller.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Expanded(
          child: ListView.builder(
            itemCount: _messages.length,
            itemBuilder: (context, i) {
              final (who, msg) = _messages[i];
              final mine = who == '나';
              return Align(
                alignment:
                    mine ? Alignment.centerRight : Alignment.centerLeft,
                child: Container(
                  margin: const EdgeInsets.all(8),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: mine
                        ? AppColors.badgeIndigoBg
                        : AppColors.mutedBg,
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Text(msg),
                ),
              );
            },
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(8),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _controller,
                  decoration: const InputDecoration(
                    hintText: '출결 문의를 입력하세요',
                    border: OutlineInputBorder(),
                  ),
                ),
              ),
              IconButton(onPressed: _send, icon: const Icon(Icons.send)),
            ],
          ),
        ),
      ],
    );
  }
}
