// Verifies the attendance-result screen maps each of the 5 server rejection
// reasons to a DISTINCT, non-empty, user-facing message (contract enum:
// window_closed / cross_verify_failed / nonce_reused / device_mismatch /
// duplicate_attendance).

import 'package:flutter_test/flutter_test.dart';
import 'package:syncattend_mobile/features/attendance/attendance_verify_screen.dart';
import 'package:syncattend_mobile/models/contract_models.dart';

void main() {
  group('Rejection reason messages', () {
    const rejectionReasons = <VerifyReason>[
      VerifyReason.windowClosed,
      VerifyReason.crossVerifyFailed,
      VerifyReason.nonceReused,
      VerifyReason.deviceMismatch,
      VerifyReason.duplicateAttendance,
    ];

    test('all 5 rejection reasons have a non-empty message', () {
      for (final r in rejectionReasons) {
        expect(verifyReasonMessage(r), isNotEmpty,
            reason: '$r must have a user-facing message');
      }
    });

    test('all 5 rejection messages are distinct', () {
      final messages = rejectionReasons.map(verifyReasonMessage).toList();
      final unique = messages.toSet();
      expect(unique.length, rejectionReasons.length,
          reason: 'each reason must be distinguishable: $messages');
    });

    test('none-reason maps to empty (no spurious rejection text)', () {
      expect(verifyReasonMessage(VerifyReason.none), isEmpty);
    });

    test('device mismatch message references the device/UUID', () {
      // The screen also shows a re-auth hint for this case; the base message
      // should still make the cause clear.
      expect(verifyReasonMessage(VerifyReason.deviceMismatch), contains('기기'));
    });
  });
}
