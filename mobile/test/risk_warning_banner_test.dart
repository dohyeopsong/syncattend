// Widget tests for RiskWarningBanner (student risk-warning SSE surface):
//  - while the stream has not yet emitted, the banner is collapsed (shrink);
//  - once a warning arrives it renders the message + cumulative absence count,
//    coloured by level (danger/warning/info) with a warning icon;
//  - a stream error collapses the banner (never blocks the UI).
//
// Driven through the real riskWarningProvider.family with an injected fake
// ApiClient so the widget exercises the same async.when() branches as the app.

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:syncattend_mobile/api/api_client.dart';
import 'package:syncattend_mobile/api/mock_api_client.dart';
import 'package:syncattend_mobile/core/providers.dart';
import 'package:syncattend_mobile/features/risk/risk_warning.dart';
import 'package:syncattend_mobile/models/contract_models.dart';

/// Emits a single warning immediately (no artificial delay) so the banner's
/// data branch is deterministic in a widget test.
class _ImmediateWarningApi extends MockApiClient {
  _ImmediateWarningApi(this._warning);
  final RiskWarning _warning;

  @override
  Stream<RiskWarning> riskWarnings(String studentId) async* {
    yield _warning;
  }
}

/// Emits an error so the banner's error branch (collapse) is exercised.
class _ErrorWarningApi extends MockApiClient {
  @override
  Stream<RiskWarning> riskWarnings(String studentId) async* {
    throw const ApiError(detail: 'sse down', statusCode: 500);
  }
}

/// Never emits and never completes (and starts no timer), so the provider
/// stays in the loading state without leaving a pending timer after disposal.
class _PendingWarningApi extends MockApiClient {
  @override
  Stream<RiskWarning> riskWarnings(String studentId) =>
      Stream<RiskWarning>.fromFuture(Completer<RiskWarning>().future);
}

Widget _app(ProviderContainer container) => UncontrolledProviderScope(
      container: container,
      child: const MaterialApp(
        home: Scaffold(body: RiskWarningBanner(studentId: 's-1')),
      ),
    );

void main() {
  testWidgets('collapsed before any warning (loading = shrink)',
      (tester) async {
    // A stream that never emits keeps the provider in the loading state.
    final c = ProviderContainer(overrides: [
      apiClientProvider.overrideWithValue(_PendingWarningApi() as ApiClient),
    ]);
    addTearDown(c.dispose);

    await tester.pumpWidget(_app(c));
    await tester.pump(); // one frame; stream never emits so still loading

    expect(find.byIcon(Icons.warning_amber), findsNothing);
    expect(find.byType(SizedBox), findsWidgets); // SizedBox.shrink placeholder
  });

  testWidgets('renders message + absence count once a warning arrives',
      (tester) async {
    const warning = RiskWarning(
      level: RiskLevel.danger,
      absences: 4,
      message: '결석 위험',
    );
    final c = ProviderContainer(overrides: [
      apiClientProvider
          .overrideWithValue(_ImmediateWarningApi(warning) as ApiClient),
    ]);
    addTearDown(c.dispose);

    await tester.pumpWidget(_app(c));
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.warning_amber), findsOneWidget);
    expect(find.textContaining('결석 위험'), findsOneWidget);
    expect(find.textContaining('누적 결석 4'), findsOneWidget);
  });

  testWidgets('stream error collapses the banner (never blocks UI)',
      (tester) async {
    final c = ProviderContainer(overrides: [
      apiClientProvider.overrideWithValue(_ErrorWarningApi() as ApiClient),
    ]);
    addTearDown(c.dispose);

    await tester.pumpWidget(_app(c));
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.warning_amber), findsNothing);
  });
}
