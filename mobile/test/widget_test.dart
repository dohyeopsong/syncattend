import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:syncattend_mobile/main.dart';

void main() {
  testWidgets('renders student skeleton scaffold', (tester) async {
    await tester.pumpWidget(const SyncattendApp());
    expect(find.text('Syncattend — Student'), findsOneWidget);
    expect(find.text('Flutter skeleton (owner B)'), findsOneWidget);
    expect(find.byType(FilledButton), findsOneWidget);
  });
}
