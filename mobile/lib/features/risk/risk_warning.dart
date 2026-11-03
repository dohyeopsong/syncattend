import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/design.dart';
import '../../core/providers.dart';
import '../../models/contract_models.dart';

/// Subscribes to the student risk-warning SSE stream (/sse/students/{id}).
/// The studentId is passed via [.family]. In mock mode the mock client emits a
/// sample warning shortly after subscription.
final riskWarningProvider =
    StreamProvider.family<RiskWarning, String>((ref, studentId) {
  return ref.watch(apiClientProvider).riskWarnings(studentId);
});

/// A dismissible banner that surfaces the latest risk warning.
class RiskWarningBanner extends ConsumerWidget {
  const RiskWarningBanner({super.key, required this.studentId});

  final String studentId;

  Color _color(RiskLevel level) {
    switch (level) {
      case RiskLevel.danger:
        return AppColors.badgeRedBg;
      case RiskLevel.warning:
        return AppColors.badgeAmberBg;
      case RiskLevel.info:
      case RiskLevel.unknown:
        return AppColors.badgeIndigoBg;
    }
  }

  Color _iconColor(RiskLevel level) {
    switch (level) {
      case RiskLevel.danger:
        return AppColors.danger;
      case RiskLevel.warning:
        return AppColors.warning;
      case RiskLevel.info:
      case RiskLevel.unknown:
        return AppColors.indigo;
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(riskWarningProvider(studentId));
    return async.when(
      loading: () => const SizedBox.shrink(),
      error: (_, __) => const SizedBox.shrink(),
      data: (warning) => Container(
        width: double.infinity,
        decoration: BoxDecoration(
          color: _color(warning.level),
          border: Border(
            bottom: BorderSide(color: AppColors.border.withValues(alpha: 0.5)),
          ),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: [
            Icon(Icons.warning_amber, color: _iconColor(warning.level)),
            const SizedBox(width: 8),
            Expanded(
              child: Text('${warning.message} (누적 결석 ${warning.absences})'),
            ),
          ],
        ),
      ),
    );
  }
}
