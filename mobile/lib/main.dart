import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'features/auth/auth_controller.dart';
import 'features/auth/device_screens.dart';
import 'features/auth/login_screen.dart';
import 'features/home/home_shell.dart';

void main() => runApp(const ProviderScope(child: SyncattendApp()));

class SyncattendApp extends StatelessWidget {
  const SyncattendApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Syncattend',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(useMaterial3: true, colorSchemeSeed: Colors.indigo),
      home: const _RootRouter(),
    );
  }
}

/// Routes based on [AuthPhase]: loading → login → device register → email
/// re-auth → home.
class _RootRouter extends ConsumerWidget {
  const _RootRouter();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final phase = ref.watch(authControllerProvider.select((s) => s.phase));
    switch (phase) {
      case AuthPhase.loading:
        return const Scaffold(
          body: Center(child: CircularProgressIndicator()),
        );
      case AuthPhase.loggedOut:
        return const LoginScreen();
      case AuthPhase.needsDeviceRegistration:
        return const DeviceRegistrationScreen();
      case AuthPhase.needsReauth:
        return const DeviceReauthScreen();
      case AuthPhase.ready:
        return const HomeShell();
    }
  }
}
