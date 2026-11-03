import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/config.dart';
import '../../core/design.dart';
import '../../core/providers.dart';
import '../../models/contract_models.dart';

/// Signup screen — email-verification flow with a clean, sectioned layout.
///
/// Pipeline:
///   1. Email input with an inline "발송" button (right-inside the field).
///      Invalid format → button turns red + shake animation + haptic.
///   2. On verify success, that section is disabled (locked).
///   3. Profile (name, student id) + password fields.
///   4. Terms checkbox (no detail sheet — checkbox only).
///   5. Submit is enabled only when: isEmailVerified && passwordMatch &&
///      termsAgreed (logical AND).
class SignupScreen extends ConsumerStatefulWidget {
  const SignupScreen({super.key});

  @override
  ConsumerState<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends ConsumerState<SignupScreen>
    with TickerProviderStateMixin {
  final _email = TextEditingController();
  final _code = TextEditingController();
  final _name = TextEditingController();
  final _studentId = TextEditingController();
  final _password = TextEditingController();
  final _passwordConfirm = TextEditingController();

  bool _isSendingCode = false;
  bool _showVerificationGroup = false;
  bool _isEmailVerified = false;
  bool _isVerifyingCode = false;
  bool _isPasswordValid = false;
  bool _isRegistering = false;
  bool _termsAgreed = false;
  String _sendBtnText = '발송';

  String _emailMsg = '';
  bool _isEmailSuccess = false;
  String _pwdMsg = '';
  bool _isPwdSuccess = false;
  String _pwdConfirmMsg = '';
  bool _isPwdConfirmSuccess = false;

  Timer? _timer;
  int _timeLeft = 900; // 15 minutes

  // Shake animation for invalid email.
  late final AnimationController _shakeController = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 400),
  );
  late final Animation<double> _shakeAnimation = Tween<double>(begin: 0, end: 1)
      .animate(CurvedAnimation(
          parent: _shakeController, curve: Curves.elasticIn));

  // Shake animation for failed verification code (1s red + shake).
  bool _codeError = false;
  late final AnimationController _codeShakeController = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1000),
  );
  late final Animation<double> _codeShakeAnimation =
      Tween<double>(begin: 0, end: 1).animate(
          CurvedAnimation(parent: _codeShakeController, curve: Curves.elasticIn))
        ..addStatusListener((status) {
          // Clear the red error state once the 1s shake completes.
          if (status == AnimationStatus.completed) {
            _codeShakeController.value = 0;
            setState(() => _codeError = false);
          }
        });

  @override
  void dispose() {
    _timer?.cancel();
    _shakeController.dispose();
    _codeShakeController.dispose();
    _email.dispose();
    _code.dispose();
    _name.dispose();
    _studentId.dispose();
    _password.dispose();
    _passwordConfirm.dispose();
    super.dispose();
  }

  // Email format check — school domain required.
  bool get _isEmailValid =>
      _email.text.trim().endsWith(AppConfig.schoolEmailDomain) &&
      _email.text.trim().contains('@');

  // ──────────────────────────────────────────────
  // 1. 인증번호 발송
  // ──────────────────────────────────────────────
  Future<void> _sendVerificationCode() async {
    final email = _email.text.trim();

    if (!_isEmailValid) {
      // Invalid → red button flash + shake + haptic.
      HapticFeedback.heavyImpact();
      _shakeController.forward(from: 0);
      setState(() {
        _emailMsg =
            '${AppConfig.schoolEmailDomain} 도메인의 학교 이메일만 사용 가능합니다.';
        _isEmailSuccess = false;
      });
      return;
    }

    setState(() {
      _emailMsg = '';
      _isEmailSuccess = false;
      _isSendingCode = true;
      _sendBtnText = '발송 중';
    });

    try {
      final api = ref.read(apiClientProvider);
      final res = await api.sendSignupCode(email);
      setState(() {
        _showVerificationGroup = true;
        _emailMsg = res.message;
        _isEmailSuccess = true;
        _sendBtnText = '재발송';
        _isSendingCode = false;
        _isEmailVerified = false;
      });
      _startTimer();
    } on ApiError catch (e) {
      setState(() {
        _emailMsg = e.detail;
        _isEmailSuccess = false;
        _isSendingCode = false;
        _sendBtnText = '발송';
      });
    } catch (_) {
      setState(() {
        _emailMsg = '서버에 연결할 수 없습니다.';
        _isEmailSuccess = false;
        _isSendingCode = false;
        _sendBtnText = '발송';
      });
    }
  }

  void _startTimer() {
    _timer?.cancel();
    setState(() => _timeLeft = 900);
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (_timeLeft <= 1) {
        timer.cancel();
        setState(() {
          _timeLeft = 0;
          _showVerificationGroup = false;
        });
        _showAlert('인증 시간이 초과되었습니다. 다시 시도해주세요.');
      } else {
        setState(() => _timeLeft--);
      }
    });
  }

  String get _timerDisplay {
    final minutes = (_timeLeft ~/ 60).toString().padLeft(2, '0');
    final seconds = (_timeLeft % 60).toString().padLeft(2, '0');
    return '$minutes:$seconds';
  }

  // ──────────────────────────────────────────────
  // 2. 인증번호 확인
  // ──────────────────────────────────────────────
  Future<void> _verifyCode() async {
    final email = _email.text.trim();
    final inputCode = _code.text.trim();

    if (_timeLeft <= 0) {
      _showAlert('인증 시간이 만료되었습니다. 인증번호를 다시 발송해주세요.');
      return;
    }

    setState(() => _isVerifyingCode = true);
    try {
      final api = ref.read(apiClientProvider);
      final res = await api.verifySignupCode(email: email, code: inputCode);
      _timer?.cancel();
      HapticFeedback.lightImpact();
      setState(() {
        _isEmailVerified = true;
        _showVerificationGroup = false;
        _emailMsg = res.message;
        _isEmailSuccess = true;
        _isVerifyingCode = false;
      });
    } on ApiError catch (_) {
      setState(() => _isVerifyingCode = false);
      _triggerCodeError();
    } catch (_) {
      setState(() => _isVerifyingCode = false);
      _triggerCodeError();
    }
  }

  /// Trigger the 1-second red + shake error animation on the code field.
  void _triggerCodeError() {
    HapticFeedback.heavyImpact();
    setState(() => _codeError = true);
    _codeShakeController.forward(from: 0);
  }

  // ──────────────────────────────────────────────
  // 3. 비밀번호 유효성 검사
  // ──────────────────────────────────────────────
  void _validatePassword(String pwd) {
    bool valid = false;
    String msg = '';
    bool isSuccess = false;

    final specialCharRegex = RegExp(r'[!@#$%^&*(),.?":{}|<>]');
    final repeatCharRegex = RegExp(r'(.)\1{2,}');

    if (pwd.length < 8) {
      msg = '비밀번호는 8자리 이상이어야 합니다.';
    } else if (!specialCharRegex.hasMatch(pwd)) {
      msg = '특수문자를 1개 이상 포함해야 합니다.';
    } else if (repeatCharRegex.hasMatch(pwd)) {
      msg = '동일한 문자/숫자를 3번 이상 연속 사용할 수 없습니다 (예: aaa, 111).';
    } else if (_hasSequentialChars(pwd)) {
      msg = '연속되는 문자/숫자(예: 123, abc)를 사용할 수 없습니다.';
    } else {
      msg = '사용 가능한 비밀번호입니다.';
      isSuccess = true;
      valid = true;
    }

    setState(() {
      _isPasswordValid = valid;
      _pwdMsg = msg;
      _isPwdSuccess = isSuccess;
    });

    _checkPasswordMatch(_passwordConfirm.text);
  }

  bool _hasSequentialChars(String str) {
    for (int i = 0; i < str.length - 2; i++) {
      final c1 = str.codeUnitAt(i);
      final c2 = str.codeUnitAt(i + 1);
      final c3 = str.codeUnitAt(i + 2);
      if ((c1 + 1 == c2 && c2 + 1 == c3) || (c1 - 1 == c2 && c2 - 1 == c3)) {
        return true;
      }
    }
    return false;
  }

  // ──────────────────────────────────────────────
  // 4. 비밀번호 재입력 일치 확인
  // ──────────────────────────────────────────────
  void _checkPasswordMatch(String pwdConfirm) {
    final pwd = _password.text;
    if (pwdConfirm.isEmpty) {
      setState(() => _pwdConfirmMsg = '');
      return;
    }
    setState(() {
      if (pwd != pwdConfirm) {
        _pwdConfirmMsg = '비밀번호가 일치하지 않습니다.';
        _isPwdConfirmSuccess = false;
      } else {
        _pwdConfirmMsg = '비밀번호가 일치합니다.';
        _isPwdConfirmSuccess = true;
      }
    });
  }

  // ──────────────────────────────────────────────
  // 5. 최종 가입 제출 — AND 연산
  // ──────────────────────────────────────────────
  bool get _canSubmit =>
      _isEmailVerified &&
      _isPwdConfirmSuccess &&
      _isPasswordValid &&
      _termsAgreed &&
      _name.text.trim().isNotEmpty &&
      _studentId.text.trim().isNotEmpty;

  Future<void> _submitSignup() async {
    if (!_isEmailVerified) {
      _showAlert('이메일 인증을 먼저 완료해주세요.');
      return;
    }
    if (_name.text.trim().isEmpty) {
      _showAlert('이름을 입력해주세요.');
      return;
    }
    if (_studentId.text.trim().isEmpty) {
      _showAlert('학번을 입력해주세요.');
      return;
    }
    if (!_isPasswordValid) {
      _showAlert('비밀번호 양식을 올바르게 작성해주세요.');
      return;
    }
    if (_password.text != _passwordConfirm.text) {
      _showAlert('비밀번호 재입력이 일치하지 않습니다.');
      return;
    }
    if (!_termsAgreed) {
      _showAlert('약관에 동의해주세요.');
      return;
    }

    setState(() => _isRegistering = true);
    try {
      final api = ref.read(apiClientProvider);
      await api.register(
        email: _email.text.trim(),
        password: _password.text,
        role: Role.student,
        name: _name.text.trim(),
        studentId: _studentId.text.trim(),
      );
      if (!mounted) return;
      _showAlert('회원가입이 완료되었습니다. 로그인해주세요.', onConfirm: () {
        // Pop the dialog AND the signup screen, returning to the root
        // LoginScreen that lives inside _RootRouter. Do NOT push a new
        // LoginScreen via pushAndRemoveUntil — that would replace _RootRouter
        // itself and decouple navigation from AuthPhase, so a successful login
        // (phase=ready) would never route to HomeShell until the app restarts.
        Navigator.of(context).popUntil((r) => r.isFirst);
      });
    } on ApiError catch (e) {
      _showAlert(e.detail);
    } catch (_) {
      _showAlert('서버에 연결할 수 없습니다.');
    } finally {
      if (mounted) setState(() => _isRegistering = false);
    }
  }

  void _showAlert(String message, {VoidCallback? onConfirm}) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              onConfirm?.call();
            },
            child: const Text('확인'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.mutedBg,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 28),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const _AppBranding(),
                  const SizedBox(height: 28),
                  _SignupCard(
                    email: _email,
                    code: _code,
                    name: _name,
                    studentId: _studentId,
                    password: _password,
                    passwordConfirm: _passwordConfirm,
                    isEmailValid: _isEmailValid,
                    isEmailVerified: _isEmailVerified,
                    isSendingCode: _isSendingCode,
                    isVerifyingCode: _isVerifyingCode,
                    showVerificationGroup: _showVerificationGroup,
                    isRegistering: _isRegistering,
                    sendBtnText: _sendBtnText,
                    timerDisplay: _timerDisplay,
                    emailMsg: _emailMsg,
                    isEmailSuccess: _isEmailSuccess,
                    pwdMsg: _pwdMsg,
                    isPwdSuccess: _isPwdSuccess,
                    pwdConfirmMsg: _pwdConfirmMsg,
                    isPwdConfirmSuccess: _isPwdConfirmSuccess,
                    termsAgreed: _termsAgreed,
                    canSubmit: _canSubmit,
                    shakeAnimation: _shakeAnimation,
                    codeShakeAnimation: _codeShakeAnimation,
                    codeError: _codeError,
                    onEmailChanged: (_) => setState(() {}),
                    onSendCode: _sendVerificationCode,
                    onVerifyCode: _verifyCode,
                    onPasswordChanged: _validatePassword,
                    onPasswordConfirmChanged: _checkPasswordMatch,
                    onTermsChanged: (v) => setState(() => _termsAgreed = v),
                    onSubmit: _submitSignup,
                    onBack: () => Navigator.of(context).maybePop(),
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
            color: AppColors.indigo,
            borderRadius: BorderRadius.circular(18),
            boxShadow: AppColors.shadowSoftMd,
          ),
          child: const Icon(Icons.person_add, color: Colors.white, size: 32),
        ),
        const SizedBox(height: 14),
        const Text(
          '회원가입',
          style: TextStyle(
            fontSize: 22,
            fontWeight: FontWeight.w700,
            color: AppColors.foreground,
          ),
        ),
        const SizedBox(height: 4),
        const Text(
          '스마트 출결 · 학생 계정 만들기',
          style: TextStyle(fontSize: 13, color: AppColors.mutedForeground),
        ),
      ],
    );
  }
}

class _SignupCard extends StatelessWidget {
  const _SignupCard({
    required this.email,
    required this.code,
    required this.name,
    required this.studentId,
    required this.password,
    required this.passwordConfirm,
    required this.isEmailValid,
    required this.isEmailVerified,
    required this.isSendingCode,
    required this.isVerifyingCode,
    required this.showVerificationGroup,
    required this.isRegistering,
    required this.sendBtnText,
    required this.timerDisplay,
    required this.emailMsg,
    required this.isEmailSuccess,
    required this.pwdMsg,
    required this.isPwdSuccess,
    required this.pwdConfirmMsg,
    required this.isPwdConfirmSuccess,
    required this.termsAgreed,
    required this.canSubmit,
    required this.shakeAnimation,
    required this.codeShakeAnimation,
    required this.codeError,
    required this.onEmailChanged,
    required this.onSendCode,
    required this.onVerifyCode,
    required this.onPasswordChanged,
    required this.onPasswordConfirmChanged,
    required this.onTermsChanged,
    required this.onSubmit,
    required this.onBack,
  });

  final TextEditingController email;
  final TextEditingController code;
  final TextEditingController name;
  final TextEditingController studentId;
  final TextEditingController password;
  final TextEditingController passwordConfirm;
  final bool isEmailValid;
  final bool isEmailVerified;
  final bool isSendingCode;
  final bool isVerifyingCode;
  final bool showVerificationGroup;
  final bool isRegistering;
  final String sendBtnText;
  final String timerDisplay;
  final String emailMsg;
  final bool isEmailSuccess;
  final String pwdMsg;
  final bool isPwdSuccess;
  final String pwdConfirmMsg;
  final bool isPwdConfirmSuccess;
  final bool termsAgreed;
  final bool canSubmit;
  final Animation<double> shakeAnimation;
  final Animation<double> codeShakeAnimation;
  final bool codeError;
  final ValueChanged<String> onEmailChanged;
  final VoidCallback onSendCode;
  final VoidCallback onVerifyCode;
  final ValueChanged<String> onPasswordChanged;
  final ValueChanged<String> onPasswordConfirmChanged;
  final ValueChanged<bool> onTermsChanged;
  final VoidCallback onSubmit;
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(22, 24, 22, 22),
      decoration: softCardDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // ── Section 1: Email + inline 발송 button ──
          _SectionLabel(
            label: '아이디 (학교 이메일)',
            done: isEmailVerified,
          ),
          const Padding(
            padding: EdgeInsets.only(bottom: 8),
            child: Row(
              children: [
                Icon(Icons.info_outline,
                    size: 13, color: AppColors.mutedForeground),
                SizedBox(width: 5),
                Flexible(
                  child: Text(
                    '${AppConfig.schoolEmailDomain} 형식의 이메일만 사용 가능합니다.',
                    style: TextStyle(
                        fontSize: 11, color: AppColors.mutedForeground),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),
          AnimatedBuilder(
            animation: shakeAnimation,
            builder: (context, child) {
              // Translate the field horizontally based on a decaying sine.
              final t = shakeAnimation.value;
              final offset = (1 - t) * 8 * sin(t * pi * 6);
              return Transform.translate(
                offset: Offset(offset, 0),
                child: child,
              );
            },
            child: _EmailFieldWithButton(
              controller: email,
              isEmailValid: isEmailValid,
              isEmailVerified: isEmailVerified,
              isSendingCode: isSendingCode,
              sendBtnText: sendBtnText,
              onChanged: onEmailChanged,
              onSend: onSendCode,
            ),
          ),
          if (emailMsg.isNotEmpty)
            _buildMessage(emailMsg, isEmailSuccess),
          const SizedBox(height: 16),

          // ── Section 2: Verification code (after send, disabled on success) ──
          if (showVerificationGroup || isEmailVerified) ...[
            _SectionLabel(
              label: '인증번호 6자리',
              done: isEmailVerified,
            ),
            AnimatedBuilder(
              animation: codeShakeAnimation,
              builder: (context, child) {
                // Translate the field horizontally based on a decaying sine.
                final t = codeShakeAnimation.value;
                final offset = (1 - t) * 8 * sin(t * pi * 6);
                return Transform.translate(
                  offset: Offset(offset, 0),
                  child: child,
                );
              },
              child: _CodeFieldWithButton(
                controller: code,
                timerDisplay: timerDisplay,
                isEmailVerified: isEmailVerified,
                isVerifyingCode: isVerifyingCode,
                codeError: codeError,
                onVerify: onVerifyCode,
              ),
            ),
            const SizedBox(height: 16),
          ],

          const _Divider(),

          // ── Section 3: Profile ──
          const SizedBox(height: 16),
          const _SectionLabel(label: '이름'),
          TextField(
            controller: name,
            textCapitalization: TextCapitalization.words,
            autocorrect: false,
            enableSuggestions: false,
            decoration: const InputDecoration(
              hintText: '홍길동',
              prefixIcon: Icon(Icons.person_outline),
            ),
          ),
          const SizedBox(height: 16),

          const _SectionLabel(label: '학번'),
          TextField(
            controller: studentId,
            keyboardType: TextInputType.number,
            autocorrect: false,
            enableSuggestions: false,
            maxLength: 32,
            decoration: const InputDecoration(
              hintText: '2026123456',
              prefixIcon: Icon(Icons.badge_outlined),
              counterText: '',
            ),
          ),
          const SizedBox(height: 16),

          const _SectionLabel(label: '비밀번호'),
          const Padding(
            padding: EdgeInsets.only(bottom: 8),
            child: Row(
              children: [
                Icon(Icons.info_outline,
                    size: 13, color: AppColors.mutedForeground),
                SizedBox(width: 5),
                Flexible(
                  child: Text(
                    '8자리 이상, 특수문자 포함 (연속/반복 문자 불가)',
                    style: TextStyle(
                        fontSize: 11, color: AppColors.mutedForeground),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),
          TextField(
            controller: password,
            obscureText: true,
            onChanged: onPasswordChanged,
            decoration: const InputDecoration(
              hintText: 'password',
              prefixIcon: Icon(Icons.lock_outline),
            ),
          ),
          if (pwdMsg.isNotEmpty) _buildMessage(pwdMsg, isPwdSuccess),
          const SizedBox(height: 16),

          const _SectionLabel(label: '비밀번호 재입력'),
          TextField(
            controller: passwordConfirm,
            obscureText: true,
            onChanged: onPasswordConfirmChanged,
            decoration: const InputDecoration(
              hintText: 'password',
              prefixIcon: Icon(Icons.lock_outline),
            ),
          ),
          if (pwdConfirmMsg.isNotEmpty)
            _buildMessage(pwdConfirmMsg, isPwdConfirmSuccess),
          const SizedBox(height: 16),

          // ── Section 4: Terms (checkbox only, no detail sheet) ──
          _TermsCheckbox(
            agreed: termsAgreed,
            onChanged: onTermsChanged,
          ),
          const SizedBox(height: 20),

          // ── Section 5: Submit (AND-gated) ──
          SizedBox(
            height: 50,
            child: FilledButton(
              onPressed: (isRegistering || !canSubmit) ? null : onSubmit,
              child: isRegistering
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('회원가입 완료',
                      style: TextStyle(fontWeight: FontWeight.w700)),
            ),
          ),
          const SizedBox(height: 10),
          TextButton(
            onPressed: onBack,
            child: const Text('이미 계정이 있으신가요? 로그인'),
          ),
        ],
      ),
    );
  }

  Widget _buildMessage(String msg, bool isSuccess) {
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Row(
        children: [
          Icon(
            isSuccess ? Icons.check_circle_outline : Icons.error_outline,
            size: 16,
            color: isSuccess ? AppColors.success : AppColors.danger,
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              msg,
              style: TextStyle(
                color: isSuccess ? AppColors.success : AppColors.danger,
                fontSize: 12,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Section label with an optional "완료" badge when the section is locked.
class _SectionLabel extends StatelessWidget {
  const _SectionLabel({required this.label, this.done = false});
  final String label;
  final bool done;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Text(
            label,
            style: const TextStyle(
              fontWeight: FontWeight.w600,
              color: AppColors.mutedForeground,
              fontSize: 13,
            ),
          ),
          if (done) ...[
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: AppColors.success.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(999),
                border: Border.all(
                    color: AppColors.success.withValues(alpha: 0.3)),
              ),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.check, size: 12, color: AppColors.success),
                  SizedBox(width: 3),
                  Text('완료',
                      style: TextStyle(
                          color: AppColors.success,
                          fontSize: 11,
                          fontWeight: FontWeight.w600)),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Email field with the "발송" button embedded inside on the right.
/// Invalid email → button turns red. Verified → field + button disabled.
class _EmailFieldWithButton extends StatelessWidget {
  const _EmailFieldWithButton({
    required this.controller,
    required this.isEmailValid,
    required this.isEmailVerified,
    required this.isSendingCode,
    required this.sendBtnText,
    required this.onChanged,
    required this.onSend,
  });

  final TextEditingController controller;
  final bool isEmailValid;
  final bool isEmailVerified;
  final bool isSendingCode;
  final String sendBtnText;
  final ValueChanged<String> onChanged;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    final hasText = controller.text.trim().isNotEmpty;
    // Button is red when there's text but the format is invalid.
    final isInvalid = hasText && !isEmailValid && !isEmailVerified;
    final btnColor = isInvalid ? AppColors.danger : AppColors.indigo;

    return TextField(
      controller: controller,
      enabled: !isEmailVerified,
      keyboardType: TextInputType.emailAddress,
      autocorrect: false,
      enableSuggestions: false,
      onChanged: onChanged,
      decoration: InputDecoration(
        hintText: 'email',
        prefixIcon: const Icon(Icons.mail_outline),
        // Inline button on the right, inside the field.
        suffixIcon: Padding(
          padding: const EdgeInsets.only(right: 6, top: 6, bottom: 6),
          child: SizedBox(
            height: 38,
            child: FilledButton(
              onPressed: (isEmailVerified || isSendingCode) ? null : onSend,
              style: FilledButton.styleFrom(
                backgroundColor: btnColor,
                disabledBackgroundColor:
                    btnColor.withValues(alpha: isEmailVerified ? 0.3 : 0.5),
                padding: const EdgeInsets.symmetric(horizontal: 14),
                minimumSize: const Size(0, 38),
              ),
              child: isSendingCode
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(sendBtnText,
                      style: const TextStyle(
                          fontSize: 13, fontWeight: FontWeight.w600)),
            ),
          ),
        ),
      ),
    );
  }
}

/// Verification code field + timer + 확인 button. Disabled on success.
class _CodeFieldWithButton extends StatelessWidget {
  const _CodeFieldWithButton({
    required this.controller,
    required this.timerDisplay,
    required this.isEmailVerified,
    required this.isVerifyingCode,
    required this.codeError,
    required this.onVerify,
  });

  final TextEditingController controller;
  final String timerDisplay;
  final bool isEmailVerified;
  final bool isVerifyingCode;
  final bool codeError;
  final VoidCallback onVerify;

  @override
  Widget build(BuildContext context) {
    // Red border + button while the failed-verify shake animation runs.
    const errorColor = AppColors.danger;
    final border = codeError
        ? OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: errorColor, width: 1.5),
          )
        : const UnderlineInputBorder();
    final btnColor = codeError ? errorColor : AppColors.indigo;

    return TextField(
      controller: controller,
      enabled: !isEmailVerified,
      maxLength: 6,
      keyboardType: TextInputType.number,
      decoration: InputDecoration(
        hintText: '인증번호 입력',
        counterText: '',
        enabledBorder: border,
        focusedBorder: border,
        suffixIcon: Padding(
          padding: const EdgeInsets.only(right: 6, top: 6, bottom: 6),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (!isEmailVerified)
                Text(
                  timerDisplay,
                  style: const TextStyle(
                    color: AppColors.danger,
                    fontWeight: FontWeight.bold,
                    fontSize: 13,
                  ),
                ),
              const SizedBox(width: 8),
              SizedBox(
                height: 38,
                child: FilledButton(
                  onPressed: (isEmailVerified || isVerifyingCode) ? null : onVerify,
                  style: FilledButton.styleFrom(
                    backgroundColor: btnColor,
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                    minimumSize: const Size(0, 38),
                  ),
                  child: isVerifyingCode
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text(isEmailVerified ? '완료' : '확인',
                          style: const TextStyle(
                              fontSize: 13, fontWeight: FontWeight.w600)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Terms checkbox — checkbox only, no detail sheet (per spec).
class _TermsCheckbox extends StatelessWidget {
  const _TermsCheckbox({required this.agreed, required this.onChanged});
  final bool agreed;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () => onChanged(!agreed),
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          children: [
            SizedBox(
              width: 24,
              height: 24,
              child: Checkbox(
                value: agreed,
                onChanged: (v) => onChanged(v ?? false),
                activeColor: AppColors.indigo,
                shape: const RoundedRectangleBorder(
                  borderRadius: BorderRadius.all(Radius.circular(6)),
                ),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                '이용약관 및 개인정보처리방침에 동의합니다',
                style: TextStyle(
                  fontSize: 13,
                  color: agreed ? AppColors.foreground : AppColors.mutedForeground,
                  fontWeight: agreed ? FontWeight.w600 : FontWeight.w400,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Divider extends StatelessWidget {
  const _Divider();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: 4),
      child: Divider(height: 1, color: AppColors.border),
    );
  }
}
