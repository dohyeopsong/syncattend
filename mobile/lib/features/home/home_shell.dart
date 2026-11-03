import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/design.dart';
import '../../core/providers.dart';
import '../attendance/attendance_verify_screen.dart';
import '../auth/auth_controller.dart';
import '../courses/course_screens.dart';
import '../risk/risk_warning.dart';
import '../views/view_screens.dart';

/// Main authenticated shell. Bottom nav across the student views, a persistent
/// risk-warning banner (SSE), and a prominent entry to attendance verification.
class HomeShell extends ConsumerStatefulWidget {
  const HomeShell({super.key});

  @override
  ConsumerState<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends ConsumerState<HomeShell> {
  int _index = 0;

  static const _tabs = <Widget>[
    MyAttendanceScreen(),
    TimetableScreen(),
    InquiryScreen(),
  ];

  static const _titles = ['내 출결', '시간표', '출결 문의'];

  // Timetable tab index — the only tab whose AppBar shows the year/semester
  // title and a "+" action to open the course-catalog (수강신청) sheet.
  static const _timetableIndex = 1;

  Future<void> _confirmLogout() async {
    // Light UX nudge only (no hard cooldown/lock — server owns uniqueness).
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('로그아웃'),
        content: const Text('계정을 전환/로그아웃하시겠습니까?'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('취소')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('로그아웃')),
        ],
      ),
    );
    if (ok ?? false) {
      await ref.read(authControllerProvider.notifier).logout();
    }
  }

  @override
  Widget build(BuildContext context) {
    final isTimetable = _index == _timetableIndex;
    return Scaffold(
      appBar: AppBar(
        // Everytime-style header: the timetable tab shows year/semester +
        // timetable name on the left and a "+" (시간표 수정) action on the right.
        title: isTimetable
            ? const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('2026년 2학기',
                      style: TextStyle(
                          fontSize: 16, fontWeight: FontWeight.w700)),
                  Text('내 시간표',
                      style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w400,
                          color: AppColors.mutedForeground)),
                ],
              )
            : Text(_titles[_index]),
        actions: [
          if (isTimetable)
            IconButton(
              onPressed: () => showCourseCatalogSheet(context),
              icon: const Icon(Icons.add),
              tooltip: '시간표 수정 · 수강신청',
            ),
          IconButton(
            onPressed: _confirmLogout,
            icon: const Icon(Icons.logout),
            tooltip: '로그아웃',
          ),
        ],
      ),
      body: Column(
        children: [
          // Real student id from GET /auth/me (studentIdProvider). The banner
          // only subscribes to /sse/students/{id} once the id resolves.
          ref.watch(studentIdProvider).maybeWhen(
                data: (id) => RiskWarningBanner(studentId: id),
                orElse: () => const SizedBox.shrink(),
              ),
          Expanded(child: _tabs[_index]),
        ],
      ),
      // Attendance verify entry: only on the "내 출결" tab (index 0). Hidden on
      // other tabs so it doesn't crowd timetable/catalog/inquiry views.
      floatingActionButton: _index == 0
          ? FloatingActionButton.extended(
              onPressed: () {
                Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => const AttendanceVerifyScreen(),
                  ),
                );
              },
              backgroundColor: AppColors.indigo,
              foregroundColor: Colors.white,
              elevation: 0,
              extendedPadding:
                  const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
              icon: const Icon(Icons.qr_code_scanner),
              label: const Text(
                '출석 인증',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
            )
          : null,
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        backgroundColor: Colors.white,
        indicatorColor: AppColors.indigo.withValues(alpha: 0.12),
        indicatorShape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(12)),
        ),
        destinations: const [
          NavigationDestination(
              icon: Icon(Icons.checklist), label: '내 출결'),
          NavigationDestination(
              icon: Icon(Icons.schedule), label: '시간표'),
          NavigationDestination(
              icon: Icon(Icons.question_answer), label: '문의'),
        ],
      ),
    );
  }
}
