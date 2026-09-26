import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/design.dart';
import 'auth_controller.dart';

/// Circular indigo-subtle badge used to anchor each onboarding screen.
class _IconBadge extends StatelessWidget {
  const _IconBadge(this.icon);

  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 72,
      height: 72,
      decoration: const BoxDecoration(
        color: AppColors.indigoSubtle,
        shape: BoxShape.circle,
      ),
      child: Icon(icon, size: 36, color: AppColors.indigo),
    );
  }
}

/// Shared inline error surface: danger token + icon (never color-only).
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
          const Icon(Icons.error_outline, color: AppColors.danger, size: 20),
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

/// Shown while the app-generated UUID is being bound to the account.
class DeviceRegistrationScreen extends ConsumerWidget {
  const DeviceRegistrationScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    return Scaffold(
      backgroundColor: AppColors.mutedBg,
      appBar: AppBar(title: const Text('기기 등록')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const _IconBadge(Icons.smartphone),
                  const SizedBox(height: 24),
                  const Text(
                    '이 기기를 계정에 등록합니다',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w600,
                      color: AppColors.foreground,
                    ),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    '앱이 생성한 고유 UUID가 안전 저장소(키체인/키스토어)에 '
                    '보관되어 출석 인증에 사용됩니다.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 14,
                      height: 1.5,
                      color: AppColors.mutedForeground,
                    ),
                  ),
                  const SizedBox(height: 24),
                  if (auth.error != null) ...[
                    _ErrorNotice(message: auth.error!),
                    const SizedBox(height: 16),
                  ],
                  SizedBox(
                    width: double.infinity,
                    height: 48,
                    child: FilledButton(
                      onPressed: auth.busy
                          ? null
                          : () => ref
                              .read(authControllerProvider.notifier)
                              .registerDevice(),
                      child: auth.busy
                          ? const SizedBox(
                              height: 18,
                              width: 18,
                              child:
                                  CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Text('기기 등록 다시 시도'),
                    ),
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

/// Email (@wku.ac.kr) re-authentication when a UUID binding conflict occurs
/// (device changed / app data cleared → new UUID). Two steps: request code,
/// then confirm code + rebind.
class DeviceReauthScreen extends ConsumerStatefulWidget {
  const DeviceReauthScreen({super.key});

  @override
  ConsumerState<DeviceReauthScreen> createState() => _DeviceReauthScreenState();
}

class _DeviceReauthScreenState extends ConsumerState<DeviceReauthScreen> {
  final _email = TextEditingController();
  final _code = TextEditingController();
  bool _codeSent = false;
  bool _prefilled = false;

  @override
  void dispose() {
    _email.dispose();
    _code.dispose();
    super.dispose();
  }

  void _snack(String msg, {bool error = false}) {
    if (!mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      SnackBar(
        content: Text(msg),
        backgroundColor: error ? AppColors.danger : null,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  Future<void> _requestCode() async {
    final notifier = ref.read(authControllerProvider.notifier);
    final ok = await notifier.requestReauthCode(_email.text);
    if (!mounted) return;
    if (ok) {
      setState(() => _codeSent = true);
      _snack('인증 코드를 발송했습니다. 이메일을 확인하세요.');
    } else {
      _snack(ref.read(authControllerProvider).error ?? '코드 요청에 실패했습니다.',
          error: true);
    }
  }

  Future<void> _confirmCode() async {
    final notifier = ref.read(authControllerProvider.notifier);
    final ok = await notifier.confirmReauth(_email.text, _code.text);
    if (!mounted) return;
    if (ok) {
      _snack('재바인딩이 완료되었습니다.');
      // Routing to home is driven by AuthPhase.ready in the app shell.
    } else {
      _snack(ref.read(authControllerProvider).error ?? '코드 확인에 실패했습니다.',
          error: true);
    }
  }

  Future<void> _backToLogin() async {
    await ref.read(authControllerProvider.notifier).logout();
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authControllerProvider);

    // Prefill the email used at login exactly once, so the user need not retype
    // it (retyping was a source of the 422 email-validation failure).
    if (!_prefilled) {
      final prefill = auth.lastEmail;
      if (prefill != null && prefill.isNotEmpty) {
        _email.text = prefill;
      }
      _prefilled = true;
    }

    return Scaffold(
      backgroundColor: AppColors.mutedBg,
      appBar: AppBar(
        title: const Text('기기 변경 재인증'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          tooltip: '로그인으로 돌아가기',
          onPressed: auth.busy ? null : _backToLogin,
        ),
        actions: [
          TextButton(
            onPressed: auth.busy ? null : _backToLogin,
            child: const Text('로그아웃'),
          ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Center(child: _IconBadge(Icons.phonelink_setup)),
                  const SizedBox(height: 24),
                  const Text(
                    '기기 변경이 감지되었습니다',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w600,
                      color: AppColors.foreground,
                    ),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    '다른 기기(또는 새 UUID)가 감지되었습니다. 학교 이메일'
                    '(@wku.ac.kr)로 인증 후 이 기기로 재바인딩합니다.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 14,
                      height: 1.5,
                      color: AppColors.mutedForeground,
                    ),
                  ),
                  const SizedBox(height: 24),
                  TextField(
                    controller: _email,
                    keyboardType: TextInputType.emailAddress,
                    autocorrect: false,
                    enableSuggestions: false,
                    textInputAction: TextInputAction.next,
                    decoration: const InputDecoration(
                      labelText: '학교 이메일 (@wku.ac.kr)',
                      prefixIcon: Icon(Icons.mail_outline),
                      border: OutlineInputBorder(),
                    ),
                  ),
                  if (_codeSent) ...[
                    const SizedBox(height: 12),
                    TextField(
                      controller: _code,
                      keyboardType: TextInputType.number,
                      textInputAction: TextInputAction.done,
                      onSubmitted: (_) => auth.busy ? null : _confirmCode(),
                      decoration: const InputDecoration(
                        labelText: '인증 코드',
                        prefixIcon: Icon(Icons.pin_outlined),
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ],
                  if (auth.error != null) ...[
                    const SizedBox(height: 12),
                    _ErrorNotice(message: auth.error!),
                  ],
                  const SizedBox(height: 16),
                  SizedBox(
                    height: 48,
                    child: FilledButton(
                      onPressed: auth.busy
                          ? null
                          : (_codeSent ? _confirmCode : _requestCode),
                      child: auth.busy
                          ? const SizedBox(
                              height: 18,
                              width: 18,
                              child:
                                  CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Text(_codeSent ? '코드 확인 & 재바인딩' : '인증 코드 받기'),
                    ),
                  ),
                  if (_codeSent) ...[
                    const SizedBox(height: 8),
                    TextButton(
                      onPressed: auth.busy ? null : _requestCode,
                      child: const Text('코드 다시 받기'),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
