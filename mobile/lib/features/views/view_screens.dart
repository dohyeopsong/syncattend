import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/design.dart';
import '../../core/providers.dart';
import '../../models/contract_models.dart';

/// Loads the authenticated student's attendance history from GET /me/attendance.
final myAttendanceProvider = FutureProvider<List<MyAttendanceItem>>(
  (ref) => ref.watch(apiClientProvider).getMyAttendance(),
);

/// My attendance status view — real data from GET /me/attendance (owner A).
class MyAttendanceScreen extends ConsumerWidget {
  const MyAttendanceScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(myAttendanceProvider);
    return async.when(
      loading: () => const _AttendanceLoadingSkeleton(),
      error: (e, _) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.error_outline, color: AppColors.warning, size: 40),
              const SizedBox(height: 12),
              Text('출결 이력을 불러오지 못했습니다.\n$e',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: AppColors.foreground)),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () => ref.invalidate(myAttendanceProvider),
                child: const Text('다시 시도'),
              ),
            ],
          ),
        ),
      ),
      data: (items) {
        if (items.isEmpty) {
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(myAttendanceProvider),
            child: const _AttendanceEmptyState(),
          );
        }
        return RefreshIndicator(
          onRefresh: () async => ref.invalidate(myAttendanceProvider),
          child: ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
            itemCount: items.length + 1,
            separatorBuilder: (_, i) =>
                i == 0 ? const SizedBox(height: 4) : const SizedBox(height: 10),
            itemBuilder: (context, i) {
              if (i == 0) return _AttendanceSummary(items: items);
              final r = items[i - 1];
              return _AttendanceCard(item: r);
            },
          ),
        );
      },
    );
  }
}

/// One attendance row as a hairline card (guide §4: white surface, 12px radius,
/// hairline border, generous padding). Status is shown as color + Korean label
/// + icon via [_StatusBadge] — never color alone.
class _AttendanceCard extends StatelessWidget {
  const _AttendanceCard({required this.item});
  final MyAttendanceItem item;

  @override
  Widget build(BuildContext context) {
    final color = attendanceStatusColor(item.status);
    final title =
        item.courseName.isEmpty ? '세션 ${item.sessionId}' : item.courseName;
    final subtitle = item.verifiedAt != null ? '인증: ${item.verifiedAt}' : '미인증';
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: ListTile(
        contentPadding: EdgeInsets.zero,
        // Leading icon is decorative reinforcement; the canonical status
        // (color+label+icon) is the trailing badge, so meaning is never
        // encoded by color alone.
        leading: Icon(attendanceStatusIcon(item.status), color: color, size: 24),
        title: Text(title,
            style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: AppColors.foreground)),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 2),
          child: Text(subtitle,
              style: const TextStyle(
                  fontSize: 13, color: AppColors.mutedForeground)),
        ),
        trailing: _StatusBadge(status: item.status),
      ),
    );
  }
}

/// Compact header above the list: total count + a per-status tally, each shown
/// as color + label + icon (guide §2), so the summary is not color-only either.
class _AttendanceSummary extends StatelessWidget {
  const _AttendanceSummary({required this.items});
  final List<MyAttendanceItem> items;

  int _count(AttendanceStatus s) => items.where((e) => e.status == s).length;

  @override
  Widget build(BuildContext context) {
    final present = _count(AttendanceStatus.present);
    final pending = _count(AttendanceStatus.pending);
    final absent = _count(AttendanceStatus.absent);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('출결 이력',
            style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w700,
                color: AppColors.foreground)),
        const SizedBox(height: 2),
        Text('총 ${items.length}건',
            style: const TextStyle(
                fontSize: 13, color: AppColors.mutedForeground)),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            _TallyChip(status: AttendanceStatus.present, count: present),
            _TallyChip(status: AttendanceStatus.pending, count: pending),
            _TallyChip(status: AttendanceStatus.absent, count: absent),
          ],
        ),
      ],
    );
  }
}

/// A status tally chip: icon + label + count, colored by status (color is
/// always paired with the Korean label + icon).
class _TallyChip extends StatelessWidget {
  const _TallyChip({required this.status, required this.count});
  final AttendanceStatus status;
  final int count;

  @override
  Widget build(BuildContext context) {
    final color = attendanceStatusColor(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(attendanceStatusIcon(status), size: 16, color: color),
          const SizedBox(width: 6),
          Text('${attendanceStatusLabel(status)} $count',
              style: TextStyle(
                  color: color, fontSize: 13, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}

/// Friendly empty state: icon + one-line explanation + guidance to enroll.
/// Wrapped by a scroll view so RefreshIndicator can pull-to-refresh.
class _AttendanceEmptyState extends StatelessWidget {
  const _AttendanceEmptyState();

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
                      color: AppColors.indigoSubtle,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.event_available,
                        size: 36, color: AppColors.indigo),
                  ),
                  const SizedBox(height: 16),
                  const Text('출결 이력이 없습니다',
                      style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                          color: AppColors.foreground)),
                  const SizedBox(height: 6),
                  const Text(
                    '수업이 시작되면 출석 인증 기록이 여기에 표시됩니다.\n'
                    '아래로 당겨 새로고침할 수 있어요.',
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

/// Loading skeleton: a title placeholder + a few gray card rows with a subtle
/// shimmer, so the wait reads as "content is loading here" rather than a bare
/// spinner. The shimmer also keeps frames pumping (like the old progress
/// indicator) until the data arrives.
class _AttendanceLoadingSkeleton extends StatefulWidget {
  const _AttendanceLoadingSkeleton();

  @override
  State<_AttendanceLoadingSkeleton> createState() =>
      _AttendanceLoadingSkeletonState();
}

class _AttendanceLoadingSkeletonState extends State<_AttendanceLoadingSkeleton>
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
        final opacity = 0.5 + 0.5 * _shimmer.value; // 0.5..1.0
        return Opacity(
          opacity: opacity,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
            children: [
              _skelBox(width: 120, height: 22),
              const SizedBox(height: 8),
              _skelBox(width: 64, height: 14),
              const SizedBox(height: 16),
              for (var i = 0; i < 4; i++) ...[
                _skelCard(),
                const SizedBox(height: 10),
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
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.border),
        ),
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Container(
              width: 24,
              height: 24,
              decoration: const BoxDecoration(
                  color: AppColors.mutedBg, shape: BoxShape.circle),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _skelBox(width: 140, height: 14),
                  const SizedBox(height: 8),
                  _skelBox(width: 90, height: 12),
                ],
              ),
            ),
            const SizedBox(width: 16),
            _skelBox(width: 56, height: 24),
          ],
        ),
      );
}

/// Small status badge: colored pill + Korean label + icon (guide §2).
class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.status});
  final AttendanceStatus status;

  @override
  Widget build(BuildContext context) {
    final color = attendanceStatusColor(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(attendanceStatusIcon(status), size: 14, color: color),
          const SizedBox(width: 4),
          Text(attendanceStatusLabel(status),
              style: TextStyle(
                  color: color, fontSize: 12, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
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
                        ? Colors.indigo.shade100
                        : Colors.grey.shade200,
                    borderRadius: BorderRadius.circular(12),
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
