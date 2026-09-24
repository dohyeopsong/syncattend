// Smoke test for the on-device audio loopback harness screen. Physical mic/
// speaker measurement itself needs hardware (manual), but we verify the screen
// builds and starts in the idle/waiting state with scoring hidden until an
// expected nonce is entered.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:syncattend_mobile/features/attendance/audio_loopback_harness_screen.dart';

void main() {
  testWidgets('loopback harness renders idle with start enabled', (tester) async {
    await tester.pumpWidget(const ProviderScope(
      child: MaterialApp(home: AudioLoopbackHarnessScreen()),
    ));
    await tester.pump();

    expect(find.text('음향 복호 실측 하니스 (TR-0)'), findsOneWidget);
    expect(find.text('측정 시작'), findsOneWidget);
    expect(find.text('중지'), findsOneWidget);
    // Idle state before any capture.
    expect(find.text('대기'), findsOneWidget);
    expect(find.text('복호 시도: 0'), findsOneWidget);
    // Scoring row hidden until an expected nonce is entered.
    expect(find.textContaining('성공률'), findsNothing);
  });

  testWidgets('entering expected nonce reveals scoring row', (tester) async {
    await tester.pumpWidget(const ProviderScope(
      child: MaterialApp(home: AudioLoopbackHarnessScreen()),
    ));
    await tester.pump();

    await tester.enterText(find.byType(TextField), '1a2b3c4d');
    await tester.pump();

    expect(find.textContaining('성공률'), findsOneWidget);
    expect(find.text('일치: 0'), findsOneWidget);
  });
}
