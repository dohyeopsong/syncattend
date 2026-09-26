import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../core/design.dart';
import '../../core/config.dart';
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

/// A distinct icon per rejection reason so each of the 5 reasons is visually
/// recognizable (guide §2: never rely on color alone). Display-only.
IconData verifyReasonIcon(VerifyReason r) {
  switch (r) {
    case VerifyReason.windowClosed:
      return Icons.timer_off;
    case VerifyReason.crossVerifyFailed:
      return Icons.link_off;
    case VerifyReason.nonceReused:
      return Icons.repeat_on;
    case VerifyReason.deviceMismatch:
      return Icons.smartphone;
    case VerifyReason.duplicateAttendance:
      return Icons.content_copy;
    case VerifyReason.none:
      return Icons.info_outline;
  }
}

/// A short, actionable next-step per rejection reason. Display-only guidance —
/// it never changes the verify flow; the professor-in-the-loop remains the
/// authority, so failures read as "retry / ask", not "absent".
String verifyReasonGuidance(VerifyReason r) {
  switch (r) {
    case VerifyReason.windowClosed:
      return '교수님께 인증 창을 다시 열어달라고 요청한 뒤 재인증하세요.';
    case VerifyReason.crossVerifyFailed:
      return 'QR과 음향이 같은 강의실 것인지 확인하고, 스피커 근처에서 다시 시도하세요.';
    case VerifyReason.nonceReused:
      return '최신 QR을 다시 스캔하세요. 이전 화면 캡처는 사용할 수 없습니다.';
    case VerifyReason.deviceMismatch:
      return '기기 변경 재인증(@wku.ac.kr)이 필요할 수 있습니다.';
    case VerifyReason.duplicateAttendance:
      return '이미 출석 처리된 세션입니다. 출결 이력에서 확인하세요.';
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

  /// Bumped on every "다시 시도" so the [MobileScanner] is rebuilt with a fresh
  /// key and the camera cleanly re-attaches and resumes detecting.
  int _retryCount = 0;

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

  /// "다시 시도": restart capture (mic + countdown) AND force the QR scanner to
  /// re-initialise so detection resumes after a completed/failed attempt.
  Future<void> _retry() async {
    await ref.read(attendanceControllerProvider.notifier).restart();
    if (!mounted) return;
    setState(() => _retryCount++);
    // Best-effort camera bounce; the changed key also rebuilds the scanner.
    try {
      await _scanner.stop();
    } catch (_) {}
    try {
      await _scanner.start();
    } catch (_) {}
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
          // QR scanner runs behind the overlay while capturing. The ValueKey
          // (phase + retry count) forces a clean rebuild so detection resumes
          // after "다시 시도".
          if (state.phase == VerifyPhase.capturing)
            Positioned.fill(
              child: MobileScanner(
                key: ValueKey('scanner-${state.phase}-$_retryCount'),
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

          // QR reticle overlay: darken everything EXCEPT the centered square
          // aiming window, with indigo corner markers. Replaces the old uniform
          // full-screen scrim.
          if (state.phase == VerifyPhase.capturing)
            const Positioned.fill(
              child: IgnorePointer(child: _QrReticleOverlay()),
            ),

          // Signal chips + result sit in the LOWER area so they never overlap
          // the reticle window (which occupies the upper/center region).
          SafeArea(
            child: Column(
              children: [
                // Upper region: the status/outcome ring, aligned with the
                // reticle window while capturing.
                Expanded(
                  child: Center(
                    child: _CountdownRing(
                      phase: state.phase,
                      result: state.result,
                    ),
                  ),
                ),
                // Lower region: auth-window countdown + 3-layer defense step
                // indicator + result panel (scrollable).
                SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      // Visual countdown for the 1-minute auth window (display
                      // only — the controller owns the timer/state).
                      if (state.phase == VerifyPhase.capturing)
                        _WindowCountdown(
                          secondsRemaining: state.secondsRemaining,
                          totalSeconds: AppConfig.defaultWindowSeconds,
                        ),
                      if (state.phase == VerifyPhase.capturing)
                        const SizedBox(height: 16),
                      // 3-layer defense: QR 인식 → 음향 수신 → 서버 검증. Each step
                      // flips gray → green as its signal is captured/verified,
                      // making the "3계층 방어" visible during the demo.
                      _DefenseSteps(
                        state: state,
                        audioPulse: (state.phase == VerifyPhase.capturing &&
                                !state.hasAudio)
                            ? _pulse
                            : null,
                      ),
                      const SizedBox(height: 20),
                      _ResultPanel(state: state, onRetry: _retry),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Paints a translucent scrim over the whole screen EXCEPT a centered square
/// "aiming window" (transparent) with indigo corner markers — the familiar QR
/// scanner reticle. Sized to [windowFraction] of the shortest side.
class _QrReticleOverlay extends StatelessWidget {
  const _QrReticleOverlay();

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      size: Size.infinite,
      painter: _ReticlePainter(),
    );
  }
}

class _ReticlePainter extends CustomPainter {
  static const double windowFraction = 0.65;
  static const double corner = 26; // corner marker arm length
  static const double cornerStroke = 4;

  Rect _window(Size size) {
    final side = size.shortestSide * windowFraction;
    // Bias the window slightly above center so lower chips/result have room.
    final center = Offset(size.width / 2, size.height * 0.42);
    return Rect.fromCenter(center: center, width: side, height: side);
  }

  @override
  void paint(Canvas canvas, Size size) {
    final window = _window(size);
    final rWindow = RRect.fromRectAndRadius(window, const Radius.circular(16));

    // Darken everything outside the window (even-odd difference).
    final scrim = Path()
      ..addRect(Offset.zero & size)
      ..addRRect(rWindow)
      ..fillType = PathFillType.evenOdd;
    canvas.drawPath(scrim, Paint()..color = const Color(0x99000000));

    // Indigo corner markers.
    final markerPaint = Paint()
      ..color = const Color(0xFF4F46E5)
      ..style = PaintingStyle.stroke
      ..strokeWidth = cornerStroke
      ..strokeCap = StrokeCap.round;
    final l = window.left, t = window.top, r = window.right, b = window.bottom;
    // Top-left
    canvas.drawPath(
        Path()
          ..moveTo(l, t + corner)
          ..lineTo(l, t)
          ..lineTo(l + corner, t),
        markerPaint);
    // Top-right
    canvas.drawPath(
        Path()
          ..moveTo(r - corner, t)
          ..lineTo(r, t)
          ..lineTo(r, t + corner),
        markerPaint);
    // Bottom-left
    canvas.drawPath(
        Path()
          ..moveTo(l, b - corner)
          ..lineTo(l, b)
          ..lineTo(l + corner, b),
        markerPaint);
    // Bottom-right
    canvas.drawPath(
        Path()
          ..moveTo(r - corner, b)
          ..lineTo(r, b)
          ..lineTo(r, b - corner),
        markerPaint);
  }

  @override
  bool shouldRepaint(covariant _ReticlePainter oldDelegate) => false;
}

/// Large center status ring. While capturing it shows an INDETERMINATE spinner
/// ("인증 대기 중") — no numeric countdown (the local timer was UX-only and the
/// server owns the real window). When done it morphs into the outcome ring
/// (green check on success, amber refresh on failure — never red "absent").
class _CountdownRing extends StatelessWidget {
  const _CountdownRing({
    required this.phase,
    required this.result,
  });

  final VerifyPhase phase;
  final VerifyResult? result;

  @override
  Widget build(BuildContext context) {
    final done = phase == VerifyPhase.done;
    final success = result?.status == VerifyStatus.present;
    final submitting = phase == VerifyPhase.submitting;

    Color ring;
    Widget center;
    bool indeterminate = false;
    if (done && success) {
      ring = AppColors.success;
      center = const _RingCenter(
        icon: Icons.check_circle,
        color: AppColors.success,
        label: '출석',
        animateIcon: true,
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
      indeterminate = true;
      center = const _RingCenter(
        icon: Icons.hourglass_bottom,
        color: AppColors.indigo,
        label: '확인 중',
      );
    } else {
      // Capturing / idle: STATIC ring (no spinner), NO number. A spinning
      // indicator here read like an endless "loading" state; the screen is
      // actually just waiting for QR + audio, so show a calm full ring.
      ring = AppColors.indigo;
      indeterminate = false;
      center = const _RingCenter(
        icon: Icons.qr_code_scanner,
        color: AppColors.indigo,
        label: '인증 대기 중',
      );
    }

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
              // Indeterminate (spinning) while waiting/submitting; full ring
              // once resolved.
              value: indeterminate ? null : 1.0,
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
    required this.color,
    required this.label,
    this.animateIcon = false,
  });

  final IconData? icon;
  final Color color;
  final String label;
  final bool animateIcon;

  @override
  Widget build(BuildContext context) {
    Widget? iconWidget;
    if (icon != null) {
      iconWidget = Icon(icon, size: 56, color: color);
      if (animateIcon) {
        // Subtle one-shot "pop" so a successful check feels satisfying without
        // being flashy (guide: animations not overdone).
        iconWidget = TweenAnimationBuilder<double>(
          tween: Tween<double>(begin: 0.4, end: 1.0),
          duration: const Duration(milliseconds: 450),
          curve: Curves.elasticOut,
          builder: (context, value, child) =>
              Transform.scale(scale: value, child: child),
          child: iconWidget,
        );
      }
    }
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (iconWidget != null) iconWidget,
        const SizedBox(height: 4),
        Text(label,
            style: const TextStyle(
                fontSize: 14, color: AppColors.mutedForeground)),
      ],
    );
  }
}

/// Visual countdown for the 1-minute auth window. Display-only: it renders the
/// controller's [secondsRemaining] as a linear progress bar + MM:SS text. The
/// bar turns amber in the final 10s to nudge the student. The controller owns
/// the actual timer and state transitions.
class _WindowCountdown extends StatelessWidget {
  const _WindowCountdown({
    required this.secondsRemaining,
    required this.totalSeconds,
  });

  final int secondsRemaining;
  final int totalSeconds;

  @override
  Widget build(BuildContext context) {
    final total = totalSeconds <= 0 ? 1 : totalSeconds;
    final remaining = secondsRemaining.clamp(0, total);
    final fraction = remaining / total; // 1.0 → 0.0
    final urgent = remaining <= 10;
    final barColor = urgent ? AppColors.warning : AppColors.indigo;
    final mm = (remaining ~/ 60).toString().padLeft(2, '0');
    final ss = (remaining % 60).toString().padLeft(2, '0');
    return Column(
      children: [
        Row(
          children: [
            Icon(urgent ? Icons.timer : Icons.timer_outlined,
                size: 16, color: barColor),
            const SizedBox(width: 6),
            const Text('인증 창 남은 시간',
                style: TextStyle(
                    fontSize: 13, color: AppColors.mutedForeground)),
            const Spacer(),
            Text('$mm:$ss',
                style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    fontFeatures: const [FontFeature.tabularFigures()],
                    color: barColor)),
          ],
        ),
        const SizedBox(height: 6),
        ClipRRect(
          borderRadius: BorderRadius.circular(999),
          child: TweenAnimationBuilder<double>(
            // Animate the shrink smoothly between the 1-second state ticks.
            tween: Tween<double>(begin: fraction, end: fraction),
            duration: const Duration(milliseconds: 400),
            builder: (context, value, _) => LinearProgressIndicator(
              value: value,
              minHeight: 8,
              backgroundColor: AppColors.border,
              valueColor: AlwaysStoppedAnimation<Color>(barColor),
            ),
          ),
        ),
      ],
    );
  }
}

/// The 3-layer defense visualizer: QR 인식 → 음향 수신 → 서버 검증. Each step is a
/// numbered node (done → green check, active → indigo/pulsing, idle → gray),
/// joined by connectors that fill green as steps complete. Purely derived from
/// [AttendanceState]; it adds NO logic and drives NO transitions.
class _DefenseSteps extends StatelessWidget {
  const _DefenseSteps({required this.state, required this.audioPulse});
  final AttendanceState state;
  final Animation<double>? audioPulse;

  @override
  Widget build(BuildContext context) {
    final present =
        state.phase == VerifyPhase.done && state.result?.status == VerifyStatus.present;
    // Step statuses derived from the (unchanged) controller state.
    final qrDone = state.hasQr;
    final audioDone = state.hasAudio;
    final serverActive = state.phase == VerifyPhase.submitting;
    final serverDone = present;

    final steps = <_StepData>[
      _StepData(
        index: 1,
        label: 'QR 인식',
        icon: Icons.qr_code_2,
        done: qrDone,
        active: state.phase == VerifyPhase.capturing && !qrDone,
      ),
      _StepData(
        index: 2,
        label: '음향 수신',
        icon: Icons.hearing,
        done: audioDone,
        active: state.phase == VerifyPhase.capturing && qrDone && !audioDone,
        pulse: audioPulse,
      ),
      _StepData(
        index: 3,
        label: '서버 검증',
        icon: Icons.verified_user,
        done: serverDone,
        active: serverActive,
      ),
    ];

    return Column(
      children: [
        const Row(
          children: [
            Icon(Icons.shield_outlined, size: 16, color: AppColors.indigo),
            SizedBox(width: 6),
            Text('3계층 방어',
                style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.foreground)),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (var i = 0; i < steps.length; i++) ...[
              _StepNode(data: steps[i]),
              if (i < steps.length - 1)
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.only(top: 17),
                    child: Container(
                      height: 3,
                      decoration: BoxDecoration(
                        color: steps[i].done
                            ? AppColors.success
                            : AppColors.border,
                        borderRadius: BorderRadius.circular(999),
                      ),
                    ),
                  ),
                ),
            ],
          ],
        ),
      ],
    );
  }
}

class _StepData {
  const _StepData({
    required this.index,
    required this.label,
    required this.icon,
    required this.done,
    required this.active,
    this.pulse,
  });
  final int index;
  final String label;
  final IconData icon;
  final bool done;
  final bool active;
  final Animation<double>? pulse;
}

/// A single step node: a circular badge (check when done, icon when active,
/// number when idle) + a Korean label below. Meaning is never color-only — the
/// icon and label always accompany the color.
class _StepNode extends StatelessWidget {
  const _StepNode({required this.data});
  final _StepData data;

  @override
  Widget build(BuildContext context) {
    final Color color = data.done
        ? AppColors.success
        : (data.active ? AppColors.indigo : AppColors.neutral);
    final Widget badge = Container(
      width: 36,
      height: 36,
      decoration: BoxDecoration(
        color: data.done
            ? AppColors.success.withValues(alpha: 0.12)
            : (data.active
                ? AppColors.indigoSubtle
                : AppColors.mutedBg),
        shape: BoxShape.circle,
        border: Border.all(color: color, width: 2),
      ),
      alignment: Alignment.center,
      child: data.done
          ? const Icon(Icons.check, size: 20, color: AppColors.success)
          : (data.active
              ? Icon(data.icon, size: 18, color: color)
              : Text('${data.index}',
                  style: TextStyle(
                      color: color,
                      fontWeight: FontWeight.w700,
                      fontSize: 15))),
    );
    final animated = (data.active && data.pulse != null)
        ? AnimatedBuilder(
            animation: data.pulse!,
            builder: (context, child) {
              final t = data.pulse!.value;
              return Transform.scale(scale: 0.94 + 0.10 * t, child: child);
            },
            child: badge,
          )
        : badge;
    return SizedBox(
      width: 64,
      child: Column(
        children: [
          animated,
          const SizedBox(height: 6),
          Text(
            data.label,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 12,
              height: 1.2,
              fontWeight: data.done || data.active
                  ? FontWeight.w600
                  : FontWeight.w400,
              color: data.done || data.active
                  ? AppColors.foreground
                  : AppColors.mutedForeground,
            ),
          ),
        ],
      ),
    );
  }
}


///
/// Retry is offered for unresolved/failed outcomes:
///   • [VerifyPhase.error] — client/network error before a result, or
///   • [VerifyPhase.done] with a result that is NOT [VerifyStatus.present]
///     (i.e. pending → awaiting professor, rejected → can re-attempt).
///
/// A successful [VerifyStatus.present] intentionally hides retry: re-capturing
/// after success only produces duplicate verifies (backend 409s).
bool shouldShowRetry(AttendanceState state) {
  if (state.phase == VerifyPhase.error) return true;
  if (state.phase == VerifyPhase.done) {
    return state.result?.status != VerifyStatus.present;
  }
  return false;
}

/// Below the ring: submit spinner, soft error text, result detail, and the
/// amber "다시 시도" action. Failure is presented as retry, not as absence.
class _ResultPanel extends StatelessWidget {
  const _ResultPanel({required this.state, required this.onRetry});
  final AttendanceState state;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final showRetry = shouldShowRetry(state);
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
                onPressed: () => onRetry(),
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
    final rejected = result.status == VerifyStatus.rejected;
    // present=green, pending=amber, rejected=amber (retry) — never red "absent".
    final color = present ? AppColors.success : AppColors.warning;

    return Column(
      children: [
        // Headline status line with a matching status icon.
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              present
                  ? Icons.check_circle
                  : (pending ? Icons.schedule : Icons.error_outline),
              size: 20,
              color: color,
            ),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                _statusText,
                style: TextStyle(
                    fontSize: 16, fontWeight: FontWeight.w600, color: color),
                textAlign: TextAlign.center,
              ),
            ),
          ],
        ),
        // Rejected: per-reason icon + guidance in a soft amber card so each of
        // the 5 reasons is clearly distinguishable and actionable.
        if (rejected && result.reason != VerifyReason.none) ...[
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.warning.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(10),
              border:
                  Border.all(color: AppColors.warning.withValues(alpha: 0.30)),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(verifyReasonIcon(result.reason),
                    size: 18, color: AppColors.warning),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    verifyReasonGuidance(result.reason),
                    style: const TextStyle(
                        fontSize: 12, color: AppColors.foreground, height: 1.35),
                  ),
                ),
              ],
            ),
          ),
        ] else if (result.reason == VerifyReason.deviceMismatch)
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
