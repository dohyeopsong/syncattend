import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../models/contract_models.dart';
import 'attendance_controller.dart';
import 'permissions_service.dart';

class AttendanceVerifyScreen extends ConsumerStatefulWidget {
  const AttendanceVerifyScreen({super.key});

  @override
  ConsumerState<AttendanceVerifyScreen> createState() =>
      _AttendanceVerifyScreenState();
}

class _AttendanceVerifyScreenState
    extends ConsumerState<AttendanceVerifyScreen> {
  final _scanner = MobileScannerController();
  final _permissions = const PermissionsService();
  bool _permissionChecked = false;
  PermissionOutcome? _permission;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _begin());
  }

  Future<void> _begin() async {
    final outcome = await _permissions.ensureAttendancePermissions();
    if (!mounted) return;
    setState(() {
      _permission = outcome;
      _permissionChecked = true;
    });
    if (outcome.granted) {
      await ref.read(attendanceControllerProvider.notifier).startCapture();
    }
  }

  @override
  void dispose() {
    _scanner.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(attendanceControllerProvider);

    if (_permissionChecked && !(_permission?.granted ?? false)) {
      return _PermissionFallback(
        outcome: _permission!,
        onOpenSettings: () => _permissions.openSettings(),
        onRetry: _begin,
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('출석 인증')),
      body: Column(
        children: [
          _CountdownBar(seconds: state.secondsRemaining),
          Expanded(
            child: Stack(
              children: [
                if (state.phase == VerifyPhase.capturing)
                  MobileScanner(
                    controller: _scanner,
                    onDetect: (capture) {
                      final code = capture.barcodes.isNotEmpty
                          ? capture.barcodes.first.rawValue
                          : null;
                      if (code != null) {
                        ref
                            .read(attendanceControllerProvider.notifier)
                            .onQrDetected(code);
                      }
                    },
                  ),
                if (state.phase != VerifyPhase.capturing)
                  Container(color: Colors.black12),
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: 0,
                  child: _StatusPanel(state: state),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _CountdownBar extends StatelessWidget {
  const _CountdownBar({required this.seconds});
  final int seconds;

  @override
  Widget build(BuildContext context) {
    final expired = seconds <= 0;
    return Container(
      width: double.infinity,
      color: expired ? Colors.orange.shade100 : Colors.indigo.shade50,
      padding: const EdgeInsets.all(12),
      child: Column(
        children: [
          Text(
            expired ? '인증 창이 종료되었습니다' : '남은 시간: ${seconds}s',
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
          ),
          if (expired)
            const Text(
              '실패가 곧 결석은 아닙니다 — 교수님이 창을 연장하거나 확인할 수 있습니다.',
              style: TextStyle(fontSize: 12),
              textAlign: TextAlign.center,
            ),
        ],
      ),
    );
  }
}

class _StatusPanel extends ConsumerWidget {
  const _StatusPanel({required this.state});
  final AttendanceState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Card(
      margin: const EdgeInsets.all(12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                _Indicator(label: 'QR', ok: state.hasQr),
                _Indicator(label: '음향', ok: state.hasAudio),
              ],
            ),
            const SizedBox(height: 12),
            if (state.phase == VerifyPhase.submitting)
              const CircularProgressIndicator(),
            if (state.error != null)
              Text(state.error!,
                  style: const TextStyle(color: Colors.red),
                  textAlign: TextAlign.center),
            if (state.phase == VerifyPhase.done && state.result != null)
              _ResultView(result: state.result!),
            if (state.phase == VerifyPhase.done ||
                state.phase == VerifyPhase.error)
              TextButton(
                onPressed: () => ref
                    .read(attendanceControllerProvider.notifier)
                    .reset(),
                child: const Text('다시 시도'),
              ),
          ],
        ),
      ),
    );
  }
}

class _Indicator extends StatelessWidget {
  const _Indicator({required this.label, required this.ok});
  final String label;
  final bool ok;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Icon(ok ? Icons.check_circle : Icons.radio_button_unchecked,
            color: ok ? Colors.green : Colors.grey),
        Text(label),
      ],
    );
  }
}

class _ResultView extends StatelessWidget {
  const _ResultView({required this.result});
  final VerifyResult result;

  String get _statusText {
    switch (result.status) {
      case VerifyStatus.present:
        return '출석 처리되었습니다';
      case VerifyStatus.pending:
        return '대기 중 (교수 확인 필요)';
      case VerifyStatus.rejected:
        return '거부됨: ${_reasonText(result.reason)}';
      case VerifyStatus.unknown:
        return '알 수 없는 상태';
    }
  }

  String _reasonText(VerifyReason r) {
    switch (r) {
      case VerifyReason.windowClosed:
        return '인증 창 종료';
      case VerifyReason.crossVerifyFailed:
        return 'QR×음향 교차검증 실패';
      case VerifyReason.nonceReused:
        return '토큰 재사용 감지';
      case VerifyReason.deviceMismatch:
        return '기기 UUID 불일치';
      case VerifyReason.duplicateAttendance:
        return '중복 출석';
      case VerifyReason.none:
        return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    final ok = result.status == VerifyStatus.present;
    return Column(
      children: [
        Icon(ok ? Icons.verified : Icons.error,
            size: 48, color: ok ? Colors.green : Colors.red),
        const SizedBox(height: 8),
        Text(_statusText,
            style: const TextStyle(fontSize: 16),
            textAlign: TextAlign.center),
        if (result.reason == VerifyReason.deviceMismatch)
          const Padding(
            padding: EdgeInsets.only(top: 8),
            child: Text('기기 변경 재인증(@wku.ac.kr)이 필요할 수 있습니다.',
                style: TextStyle(fontSize: 12)),
          ),
        if (result.riskWarning != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text('경고: ${result.riskWarning!.message}',
                style: const TextStyle(color: Colors.orange)),
          ),
      ],
    );
  }
}

class _PermissionFallback extends StatelessWidget {
  const _PermissionFallback({
    required this.outcome,
    required this.onOpenSettings,
    required this.onRetry,
  });

  final PermissionOutcome outcome;
  final VoidCallback onOpenSettings;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('권한 필요')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.mic_off, size: 56),
              const SizedBox(height: 16),
              const Text(
                '출석 인증에는 카메라(QR)와 마이크(음향 토큰) 권한이 필요합니다.\n'
                '권한이 없으면 인증을 진행할 수 없습니다. 이는 결석 처리가 아니며,'
                '권한 허용 후 다시 시도하거나 교수님께 확인을 요청하세요.',
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 20),
              if (outcome.permanentlyDenied)
                FilledButton(
                  onPressed: onOpenSettings,
                  child: const Text('설정에서 권한 허용'),
                )
              else
                FilledButton(
                  onPressed: onRetry,
                  child: const Text('권한 다시 요청'),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
