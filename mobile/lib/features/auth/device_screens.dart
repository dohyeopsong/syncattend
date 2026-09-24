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

  @override
  void dispose() {
    _email.dispose();
    _code.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authControllerProvider);
    final notifier = ref.read(authControllerProvider.notifier);
    return Scaffold(
      appBar: AppBar(title: const Text('기기 변경 재인증')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
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
                decoration: const InputDecoration(
                  labelText: '인증 코드',
                  border: OutlineInputBorder(),
                ),
              ),
            const SizedBox(height: 16),
            if (auth.error != null)
              Text(auth.error!, style: const TextStyle(color: Colors.red)),
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: auth.busy
                    ? null
                    : () async {
                        if (!_codeSent) {
                          final ok = await notifier
                              .requestReauthCode(_email.text.trim());
                          if (ok && mounted) {
                            setState(() => _codeSent = true);
                          }
                        } else {
                          await notifier.confirmReauth(
                              _email.text.trim(), _code.text.trim());
                        }
                      },
                child: auth.busy
                    ? const SizedBox(
                        height: 18,
                        width: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(_codeSent ? '코드 확인 & 재바인딩' : '인증 코드 받기'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
