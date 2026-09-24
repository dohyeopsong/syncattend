import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../attendance/attendance_verify_screen.dart';
import '../auth/auth_controller.dart';
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

  // Placeholder student id until a "me" endpoint is added to the contract.
  //
  // TODO(A-dep, /me): openapi.yaml has no student id in TokenPair and no
  //   GET /me (only /devices/me for the device binding). When A adds either
  //   (a) `id`/`student_id` to TokenPair, or (b) a GET /me returning the
  //   authenticated student's id, do:
  //     1. store the id on login (AuthController.login → SecureStore / state),
  //     2. expose it via a provider (e.g. studentIdProvider),
  //     3. replace `_studentId` here so RiskWarningBanner subscribes to
  //        /sse/students/{realId} instead of the "me" placeholder.
  //   Do NOT edit contracts/openapi.yaml here — request the change from A.
  static const _studentId = 'me';

  static const _tabs = <Widget>[
    MyAttendanceScreen(),
    TimetableScreen(),
    InquiryScreen(),
  ];

  static const _titles = ['내 출결', '시간표', '출결 문의'];

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
          const RiskWarningBanner(studentId: _studentId),
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
              icon: Icon(Icons.question_answer), label: '문의'),
        ],
      ),
    );
  }
}
