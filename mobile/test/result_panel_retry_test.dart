import 'package:flutter_test/flutter_test.dart';
import 'package:syncattend_mobile/features/attendance/attendance_controller.dart';
import 'package:syncattend_mobile/features/attendance/attendance_verify_screen.dart';
import 'package:syncattend_mobile/models/contract_models.dart';

VerifyResult _result(VerifyStatus status) => VerifyResult(
      status: status,
      crossVerified: status == VerifyStatus.present,
      deviceMatched: true,
      reason: status == VerifyStatus.rejected
          ? VerifyReason.crossVerifyFailed
          : VerifyReason.none,
    );

void main() {
  group('shouldShowRetry', () {
    test('present success hides retry (prevents duplicate verify / 409)', () {
      final state = AttendanceState(
        phase: VerifyPhase.done,
        result: _result(VerifyStatus.present),
      );
      expect(shouldShowRetry(state), isFalse);
    });

    test('rejected shows retry (can re-attempt)', () {
      final state = AttendanceState(
        phase: VerifyPhase.done,
        result: _result(VerifyStatus.rejected),
      );
      expect(shouldShowRetry(state), isTrue);
    });

    test('pending shows retry (still unresolved, awaiting professor)', () {
      final state = AttendanceState(
        phase: VerifyPhase.done,
        result: _result(VerifyStatus.pending),
      );
      expect(shouldShowRetry(state), isTrue);
    });

    test('error phase shows retry', () {
      const state = AttendanceState(
        phase: VerifyPhase.error,
        error: 'network down',
      );
      expect(shouldShowRetry(state), isTrue);
    });

    test('idle / capturing / submitting do not show retry', () {
      for (final p in [
        VerifyPhase.idle,
        VerifyPhase.capturing,
        VerifyPhase.submitting,
      ]) {
        expect(shouldShowRetry(AttendanceState(phase: p)), isFalse,
            reason: 'phase $p should not offer retry');
      }
    });
  });
}
