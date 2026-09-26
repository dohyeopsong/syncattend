// Widget + unit tests for AttendanceVerifyScreen.
//
// The screen requests camera+mic permission in initState via
// permission_handler (a platform channel) and only mounts the MobileScanner
// once permission is granted. To keep the test hermetic (no real camera/mic),
// we stub the permission_handler MethodChannel:
//
//  - DENIED  → the screen shows the _PermissionFallback ("권한 필요") with the
//              settings/retry affordance and NEVER mounts the scanner. This is
//              the branch we can assert deterministically without the native
//              mobile_scanner texture, and it is a genuinely important UX path
//              (permission denial is explicitly "not an absence").
//
// We also cover the screen's two pure, top-level, unit-testable functions:
//  - verifyReasonMessage(): every server reason maps to a distinct non-empty
//    message (and none → empty);
//  - shouldShowRetry(): success hides retry, everything unresolved offers it.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:syncattend_mobile/features/attendance/attendance_controller.dart';
import 'package:syncattend_mobile/features/attendance/attendance_verify_screen.dart';
import 'package:syncattend_mobile/models/contract_models.dart';

// permission_handler platform channel (see permission_handler_platform_interface).
const _permMethods = MethodChannel('flutter.baseflow.com/permissions/methods');

Widget _app() => const ProviderScope(
      child: MaterialApp(home: AttendanceVerifyScreen()),
    );

VerifyResult _result(VerifyStatus status, [VerifyReason reason = VerifyReason.none]) =>
    VerifyResult(
      status: status,
      crossVerified: status == VerifyStatus.present,
      deviceMatched: true,
      reason: reason,
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;

  tearDown(() {
    messenger.setMockMethodCallHandler(_permMethods, null);
  });

  testWidgets(
      'permission denied → shows 권한 필요 fallback and does NOT mount the scanner',
      (tester) async {
    // Stub permission_handler: report every permission as permanently denied.
    //  checkPermissionStatus / requestPermissions → 2 (permanentlyDenied)
    //  code 0=denied,1=granted,2=restricted... in the plugin's enum; we use the
    //  requestPermissions result map {permissionValue: statusValue}.
    messenger.setMockMethodCallHandler(_permMethods, (call) async {
      switch (call.method) {
        case 'checkServiceStatus':
          return 1; // enabled
        case 'checkPermissionStatus':
          return 4; // permanentlyDenied
        case 'requestPermissions':
          final perms = (call.arguments as List).cast<int>();
          return {for (final p in perms) p: 4}; // all permanentlyDenied
        default:
          return null;
      }
    });

    await tester.pumpWidget(_app());
    await tester.pumpAndSettle();

    // Fallback screen is shown; the scanner is never mounted.
    expect(find.text('권한 필요'), findsOneWidget);
    expect(find.byIcon(Icons.mic_off), findsOneWidget);
    expect(find.textContaining('카메라(QR)와 마이크'), findsOneWidget);
    // Permanently denied → offers "설정에서 권한 허용".
    expect(find.text('설정에서 권한 허용'), findsOneWidget);
  });

  group('verifyReasonMessage', () {
    test('every reason maps to a distinct, non-empty message (none → empty)',
        () {
      final reasons = [
        VerifyReason.windowClosed,
        VerifyReason.crossVerifyFailed,
        VerifyReason.nonceReused,
        VerifyReason.deviceMismatch,
        VerifyReason.duplicateAttendance,
      ];
      final messages = reasons.map(verifyReasonMessage).toList();
      for (final m in messages) {
        expect(m, isNotEmpty);
      }
      // All distinct.
      expect(messages.toSet().length, messages.length);
      // none → empty
      expect(verifyReasonMessage(VerifyReason.none), isEmpty);
    });
  });

  group('shouldShowRetry (screen-owned policy)', () {
    test('present success hides retry', () {
      expect(
        shouldShowRetry(AttendanceState(
          phase: VerifyPhase.done,
          result: _result(VerifyStatus.present),
        )),
        isFalse,
      );
    });

    test('rejected / pending / error offer retry', () {
      expect(
        shouldShowRetry(AttendanceState(
          phase: VerifyPhase.done,
          result: _result(VerifyStatus.rejected, VerifyReason.crossVerifyFailed),
        )),
        isTrue,
      );
      expect(
        shouldShowRetry(AttendanceState(
          phase: VerifyPhase.done,
          result: _result(VerifyStatus.pending),
        )),
        isTrue,
      );
      expect(
        shouldShowRetry(const AttendanceState(
          phase: VerifyPhase.error,
          error: 'network down',
        )),
        isTrue,
      );
    });
  });
}
