import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/config.dart';
import '../../core/design.dart';
import 'auth_controller.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  void _submit() {
    if (_formKey.currentState?.validate() ?? false) {
      ref
          .read(authControllerProvider.notifier)
          .login(_email.text.trim(), _password.text);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authControllerProvider);
    return Scaffold(
      backgroundColor: AppColors.mutedBg,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const _AppBranding(),
                  const SizedBox(height: 32),
                  _LoginCard(
                    formKey: _formKey,
                    email: _email,
                    password: _password,
                    auth: auth,
                    onSubmit: _submit,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Logo mark + product title + subtitle, shown above the form card.
class _AppBranding extends StatelessWidget {
  const _AppBranding();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Container(
          width: 64,
          height: 64,
          decoration: BoxDecoration(
            color: AppColors.indigoSubtle,
            borderRadius: BorderRadius.circular(16),
          ),
          child: const Icon(Icons.verified_user,
              color: AppColors.indigo, size: 32),
        ),
        const SizedBox(height: 16),
        const Text(
          'Syncattend',
          style: TextStyle(
            fontSize: 24,
            fontWeight: FontWeight.w700,
            color: AppColors.foreground,
          ),
        ),
        const SizedBox(height: 4),
        const Text(
          '스마트 출결 · 학생 로그인',
          style: TextStyle(
            fontSize: 14,
            color: AppColors.mutedForeground,
          ),
        ),
      ],
    );
  }
}

class _LoginCard extends StatelessWidget {
  const _LoginCard({
    required this.formKey,
    required this.email,
    required this.password,
    required this.auth,
    required this.onSubmit,
  });

  final GlobalKey<FormState> formKey;
  final TextEditingController email;
  final TextEditingController password;
  final AuthState auth;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Form(
        key: formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              '학생 로그인',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w600,
                color: AppColors.foreground,
              ),
            ),
            const SizedBox(height: 24),
            TextFormField(
              controller: email,
              keyboardType: TextInputType.emailAddress,
              autocorrect: false,
              enableSuggestions: false,
              decoration: const InputDecoration(
                labelText: '학교 이메일',
                hintText: 'student${AppConfig.schoolEmailDomain}',
                prefixIcon: Icon(Icons.mail_outline),
                border: OutlineInputBorder(),
              ),
              validator: (v) {
                if (v == null || v.isEmpty) return '이메일을 입력하세요';
                if (!v.endsWith(AppConfig.schoolEmailDomain)) {
                  return '${AppConfig.schoolEmailDomain} 주소만 허용됩니다';
                }
                return null;
              },
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: password,
              obscureText: true,
              decoration: const InputDecoration(
                labelText: '비밀번호',
                prefixIcon: Icon(Icons.lock_outline),
                border: OutlineInputBorder(),
              ),
              validator: (v) =>
                  (v == null || v.isEmpty) ? '비밀번호를 입력하세요' : null,
            ),
            if (auth.error != null) ...[
              const SizedBox(height: 16),
              _ErrorNotice(message: auth.error!),
            ],
            const SizedBox(height: 24),
            SizedBox(
              height: 48,
              child: FilledButton(
                onPressed: auth.busy ? null : onSubmit,
                child: auth.busy
                    ? const SizedBox(
                        height: 18,
                        width: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('로그인'),
              ),
            ),
            if (AppConfig.useMock) ...[
              const SizedBox(height: 16),
              const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.info_outline,
                      size: 14, color: AppColors.mutedForeground),
                  SizedBox(width: 6),
                  Flexible(
                    child: Text(
                      'MOCK 모드: @wku.ac.kr 이메일 + 아무 비밀번호',
                      style: TextStyle(
                        color: AppColors.mutedForeground,
                        fontSize: 12,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Inline error surface using the shared danger token + icon (never color-only).
class _ErrorNotice extends StatelessWidget {
  const _ErrorNotice({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.danger.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.danger.withValues(alpha: 0.4)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.error_outline, size: 20, color: AppColors.danger),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(color: AppColors.danger, fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}
