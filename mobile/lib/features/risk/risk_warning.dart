import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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
        return Colors.red.shade100;
      case RiskLevel.warning:
        return Colors.orange.shade100;
      case RiskLevel.info:
      case RiskLevel.unknown:
        return Colors.blue.shade50;
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
        color: _color(warning.level),
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            const Icon(Icons.warning_amber),
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
