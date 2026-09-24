import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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
    CourseCatalogScreen(),
    InquiryScreen(),
  ];

  static const _titles = ['내 출결', '시간표', '강의 조회', '출결 문의'];

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
    return Scaffold(
      appBar: AppBar(
        title: Text(_titles[_index]),
        actions: [
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
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () {
          Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) => const AttendanceVerifyScreen(),
            ),
          );
        },
        icon: const Icon(Icons.qr_code_scanner),
        label: const Text('출석 인증'),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(
              icon: Icon(Icons.checklist), label: '내 출결'),
          NavigationDestination(
              icon: Icon(Icons.schedule), label: '시간표'),
          NavigationDestination(
              icon: Icon(Icons.menu_book), label: '강의 조회'),
          NavigationDestination(
              icon: Icon(Icons.question_answer), label: '문의'),
        ],
      ),
    );
  }
}
