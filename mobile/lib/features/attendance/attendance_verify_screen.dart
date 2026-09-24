import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../core/design.dart';
import '../../models/contract_models.dart';
import 'attendance_controller.dart';
import 'permissions_service.dart';

/// User-facing message for each of the 5 server rejection reasons. Kept as a
/// top-level pure function so the mapping can be unit-tested (each reason must
/// map to a distinct, non-empty message) independently of the widget tree.
String verifyReasonMessage(VerifyReason r) {
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

class AttendanceVerifyScreen extends ConsumerStatefulWidget {
  const AttendanceVerifyScreen({super.key});

  @override
  ConsumerState<AttendanceVerifyScreen> createState() =>
      _AttendanceVerifyScreenState();
}

class _AttendanceVerifyScreenState
    extends ConsumerState<AttendanceVerifyScreen>
    with SingleTickerProviderStateMixin {
  final _scanner = MobileScannerController();
  final _permissions = const PermissionsService();
  bool _permissionChecked = false;
  PermissionOutcome? _permission;

  // Pulse for the "음향" chip while the mic is actively listening.
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  )..repeat(reverse: true);

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
    _pulse.dispose();
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
      body: Stack(
        children: [
          // QR scanner runs behind the overlay while capturing.
          if (state.phase == VerifyPhase.capturing)
            Positioned.fill(
              child: MobileScanner(
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
            )
          else
            const Positioned.fill(child: ColoredBox(color: Colors.white)),

          // Scrim so the overlay reads clearly over the camera feed.
          if (state.phase == VerifyPhase.capturing)
            const Positioned.fill(
              child: ColoredBox(color: Color(0x66000000)),
            ),

          Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _CountdownRing(
                    seconds: state.secondsRemaining,
                    total: 60,
                    phase: state.phase,
                    result: state.result,
                  ),
                  const SizedBox(height: 28),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      _SignalChip(
                        label: 'QR',
                        captured: state.hasQr,
                        pulse: null,
                      ),
                      const SizedBox(width: 16),
                      _SignalChip(
                        label: '음향',
                        captured: state.hasAudio,
                        // Pulse only while listening (capturing + not yet captured).
                        pulse: (state.phase == VerifyPhase.capturing &&
                                !state.hasAudio)
                            ? _pulse
                            : null,
                      ),
                    ],
                  ),
                  const SizedBox(height: 24),
                  _ResultPanel(state: state),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Large center circular countdown for the 1-minute auth window. When done it
/// morphs into the outcome ring (green check on success, amber refresh on
/// failure — never red "absent", per professor-in-the-loop design).
class _CountdownRing extends StatelessWidget {
  const _CountdownRing({
    required this.seconds,
    required this.total,
    required this.phase,
    required this.result,
  });

  final int seconds;
  final int total;
  final VerifyPhase phase;
  final VerifyResult? result;

  @override
  Widget build(BuildContext context) {
    final done = phase == VerifyPhase.done;
    final success = result?.status == VerifyStatus.present;
    final submitting = phase == VerifyPhase.submitting;

    // Ring color: indigo while counting, green on success, amber otherwise.
    Color ring;
    Widget center;
    if (done && success) {
      ring = AppColors.success;
      center = const _RingCenter(
        icon: Icons.check_circle,
        color: AppColors.success,
        label: '출석',
      );
    } else if (done || phase == VerifyPhase.error) {
      ring = AppColors.warning; // failure ≠ absent → amber, not red
      center = const _RingCenter(
        icon: Icons.refresh,
        color: AppColors.warning,
        label: '다시 시도',
      );
    } else if (submitting) {
      ring = AppColors.indigo;
      center = const _RingCenter(
        icon: Icons.hourglass_bottom,
        color: AppColors.indigo,
        label: '확인 중',
      );
    } else {
      final expired = seconds <= 0;
      ring = expired ? AppColors.warning : AppColors.indigo;
      center = _RingCenter(
        big: expired ? '—' : '$seconds',
        color: AppColors.foreground,
        label: expired ? '창 종료' : '초 남음',
      );
    }

    final fraction =
        (done || submitting) ? 1.0 : (seconds.clamp(0, total) / total);

    return SizedBox(
      width: 200,
      height: 200,
      child: Stack(
        alignment: Alignment.center,
        children: [
          SizedBox(
            width: 200,
            height: 200,
            child: CircularProgressIndicator(
              value: (done && !success) ? 1.0 : fraction,
              strokeWidth: 10,
              backgroundColor: AppColors.border,
              valueColor: AlwaysStoppedAnimation<Color>(ring),
            ),
          ),
          center,
        ],
      ),
    );
  }
}

class _RingCenter extends StatelessWidget {
  const _RingCenter({
    this.icon,
    this.big,
    required this.color,
    required this.label,
  });

  final IconData? icon;
  final String? big;
  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (icon != null) Icon(icon, size: 56, color: color),
        if (big != null)
          Text(big!,
              style: TextStyle(
                  fontSize: 48, fontWeight: FontWeight.w700, color: color)),
        const SizedBox(height: 4),
        Text(label,
            style: const TextStyle(
                fontSize: 14, color: AppColors.mutedForeground)),
      ],
    );
  }
}

/// A capture-signal chip that flips gray → green when its signal is captured.
/// Meaning is never color-only: it always shows the Korean label + an icon,
/// and (when [pulse] is provided) animates while actively listening.
class _SignalChip extends StatelessWidget {
  const _SignalChip({
    required this.label,
    required this.captured,
    required this.pulse,
  });

  final String label;
  final bool captured;
  final Animation<double>? pulse;

  @override
  Widget build(BuildContext context) {
    final color = captured ? AppColors.success : AppColors.neutral;
    final chip = Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: BoxDecoration(
        color: captured ? const Color(0xFFECFDF3) : AppColors.mutedBg,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: captured ? AppColors.success : AppColors.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            captured
                ? Icons.check_circle
                : (label == '음향' ? Icons.hearing : Icons.qr_code_2),
            size: 18,
            color: color,
          ),
          const SizedBox(width: 6),
          Text(label,
              style: TextStyle(
                  color: captured ? AppColors.foreground : AppColors.mutedForeground,
                  fontWeight: FontWeight.w600)),
        ],
      ),
    );
    if (pulse == null) return chip;
    return AnimatedBuilder(
      animation: pulse!,
      builder: (context, child) {
        final t = pulse!.value; // 0..1
        return Opacity(
          opacity: 0.6 + 0.4 * t,
          child: Transform.scale(scale: 0.97 + 0.06 * t, child: child),
        );
      },
      child: chip,
    );
  }
}

/// Below the ring: submit spinner, soft error text, result detail, and the
/// amber "다시 시도" action. Failure is presented as retry, not as absence.
class _ResultPanel extends ConsumerWidget {
  const _ResultPanel({required this.state});
  final AttendanceState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final showRetry = state.phase == VerifyPhase.done ||
        state.phase == VerifyPhase.error;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (state.phase == VerifyPhase.submitting)
              const CircularProgressIndicator(),
            if (state.error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  state.error!,
                  style: const TextStyle(color: AppColors.warning),
                  textAlign: TextAlign.center,
                ),
              ),
            if (state.phase == VerifyPhase.done && state.result != null)
              _ResultDetail(result: state.result!),
            if (showRetry) ...[
              const SizedBox(height: 4),
              const Text(
                '실패는 결석이 아닙니다 — 교수님이 창을 연장하거나 확인할 수 있습니다.',
                style: TextStyle(fontSize: 12, color: AppColors.mutedForeground),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              FilledButton.icon(
                style: FilledButton.styleFrom(
                    backgroundColor: AppColors.warning),
                onPressed: () =>
                    ref.read(attendanceControllerProvider.notifier).reset(),
                icon: const Icon(Icons.refresh),
                label: const Text('다시 시도'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ResultDetail extends StatelessWidget {
  const _ResultDetail({required this.result});
  final VerifyResult result;

  String get _statusText {
    switch (result.status) {
      case VerifyStatus.present:
        return '출석 처리되었습니다';
      case VerifyStatus.pending:
        return '대기 중 (교수 확인 필요)';
      case VerifyStatus.rejected:
        return '거부됨: ${verifyReasonMessage(result.reason)}';
      case VerifyStatus.unknown:
        return '알 수 없는 상태';
    }
  }

  @override
  Widget build(BuildContext context) {
    final present = result.status == VerifyStatus.present;
    final pending = result.status == VerifyStatus.pending;
    // present=green, pending=amber, rejected=amber (retry) — never red "absent".
    final color = present
        ? AppColors.success
        : (pending ? AppColors.warning : AppColors.warning);
    return Column(
      children: [
        Text(
          _statusText,
          style: TextStyle(
              fontSize: 16, fontWeight: FontWeight.w600, color: color),
          textAlign: TextAlign.center,
        ),
        if (result.reason == VerifyReason.deviceMismatch)
          const Padding(
            padding: EdgeInsets.only(top: 8),
            child: Text('기기 변경 재인증(@wku.ac.kr)이 필요할 수 있습니다.',
                style: TextStyle(
                    fontSize: 12, color: AppColors.mutedForeground)),
          ),
        if (result.riskWarning != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text('위험 경고: ${result.riskWarning!.message}',
                style: const TextStyle(color: AppColors.warning)),
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
