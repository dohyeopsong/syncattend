import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/design.dart';
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
      // Soft Campus design — warm tinted ground, softer indigo accent (#6366F1)
      // shared with the web, white floating cards with soft shadow + 16px
      // radius, flat white AppBar. Matches web index.css :root tokens.
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF6366F1), // softer indigo, same as web
          brightness: Brightness.light,
        ),
        scaffoldBackgroundColor: AppColors.mutedBg, // warm tinted ground
        cardTheme: CardThemeData(
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16), // rounder, friendlier
            side: BorderSide(
              color: AppColors.border.withValues(alpha: 0.6),
            ),
          ),
        ),
        appBarTheme: const AppBarTheme(
          backgroundColor: Colors.white,
          foregroundColor: AppColors.foreground,
          elevation: 0,
          scrolledUnderElevation: 0.5,
        ),
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(
            backgroundColor: AppColors.indigo,
            foregroundColor: Colors.white,
            minimumSize: const Size(0, 48),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
            textStyle: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        inputDecorationTheme: InputDecorationTheme(
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: AppColors.border),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: AppColors.border),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: AppColors.indigo, width: 1.5),
          ),
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 16,
            vertical: 14,
          ),
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
