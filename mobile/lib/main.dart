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
      // Clean-minimal design guide §4 (docs/06a_DESIGN_GUIDE_minimal.md):
      // single indigo accent (#4F46E5) shared with the web, white base,
      // elevation-0 cards with a hairline border + 12px radius, flat white AppBar.
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF4F46E5), // same indigo as web
          brightness: Brightness.light,
        ),
        scaffoldBackgroundColor: const Color(0xFFFFFFFF),
        cardTheme: CardThemeData(
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: const BorderSide(color: Color(0xFFE5E7EB)), // hairline border
          ),
        ),
        appBarTheme: const AppBarTheme(
          backgroundColor: Colors.white,
          foregroundColor: Color(0xFF111827),
          elevation: 0,
          scrolledUnderElevation: 0.5,
        ),
      ),
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
