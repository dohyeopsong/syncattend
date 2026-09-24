import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'auth_controller.dart';

/// Shown while the app-generated UUID is being bound to the account.
class DeviceRegistrationScreen extends ConsumerWidget {
  const DeviceRegistrationScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('기기 등록')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.smartphone, size: 64),
              const SizedBox(height: 16),
              const Text(
                '이 기기를 계정에 등록합니다.\n앱이 생성한 고유 UUID가 안전 저장소'
                '(키체인/키스토어)에 보관되어 출석 인증에 사용됩니다.',
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 24),
              if (auth.busy) const CircularProgressIndicator(),
              if (auth.error != null)
                Text(auth.error!,
                    style: const TextStyle(color: Colors.red)),
              const SizedBox(height: 16),
              if (!auth.busy)
                FilledButton(
                  onPressed: () => ref
                      .read(authControllerProvider.notifier)
                      .registerDevice(),
                  child: const Text('기기 등록 다시 시도'),
                ),
            ],
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
        backgroundColor: error ? Colors.red.shade700 : null,
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
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              '다른 기기(또는 새 UUID)가 감지되었습니다. 학교 이메일'
              '(@wku.ac.kr)로 인증 후 이 기기로 재바인딩합니다.',
              textAlign: TextAlign.center,
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
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            if (_codeSent)
              TextField(
                controller: _code,
                keyboardType: TextInputType.number,
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => auth.busy ? null : _confirmCode(),
                decoration: const InputDecoration(
                  labelText: '인증 코드',
                  border: OutlineInputBorder(),
                ),
              ),
            if (auth.error != null) ...[
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.red.shade50,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: Colors.red.shade200),
                ),
                child: Row(
                  children: [
                    Icon(Icons.error_outline, color: Colors.red.shade700),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        auth.error!,
                        style: TextStyle(color: Colors.red.shade900),
                      ),
                    ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 16),
            FilledButton(
              onPressed: auth.busy
                  ? null
                  : (_codeSent ? _confirmCode : _requestCode),
              child: auth.busy
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(_codeSent ? '코드 확인 & 재바인딩' : '인증 코드 받기'),
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
    );
  }
}
