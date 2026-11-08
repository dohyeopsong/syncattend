import 'package:flutter/material.dart';

import '../models/contract_models.dart';

/// Soft rounded card surface — white bg, hairline border, soft shadow.
/// Use via [Container] with this decoration for the "floating card" look.
BoxDecoration softCardDecoration({Color? color, double radius = 16}) {
  return BoxDecoration(
    color: color ?? AppColors.cardBg,
    borderRadius: BorderRadius.circular(radius),
    border: Border.all(color: AppColors.border.withValues(alpha: 0.6)),
    boxShadow: AppColors.shadowSoft,
  );
}

/// Shared design tokens — Soft Campus guide.
/// Single soft indigo accent + warm neutrals + exactly 3 status colors. Keep in
/// sync with the web CSS variables (index.css :root is the source of truth).
class AppColors {
  AppColors._();

  static const indigo = Color(0xFF6366F1); // softer accent / primary
  static const indigoHover = Color(0xFF4F46E5);
  static const indigoSubtle = Color(0xFFE8EAFE); // chips, info surfaces
  static const foreground = Color(0xFF1E293B); // primary text — slate-800
  static const mutedForeground = Color(0xFF64748B); // captions — slate-500
  static const border = Color(0xFFE2E8F0); // hairlines — slate-200
  static const mutedBg = Color(0xFFF6F8FC); // warm tinted ground
  static const cardBg = Color(0xFFFFFFFF); // pure white cards float on ground

  // Pastel icon-badge backgrounds — soft, friendly surfaces for icon circles.
  static const badgeIndigoBg = Color(0xFFEEF0FF);
  static const badgeGreenBg = Color(0xFFDCFCE7);
  static const badgeAmberBg = Color(0xFFFEF3C7);
  static const badgeRedBg = Color(0xFFFEE2E2);

  // Exactly 3 status colors (+ neutral). Never encode meaning by color alone —
  // always pair with the Korean label from [statusLabel] and an icon.
  static const success = Color(0xFF22C55E); // present / verified — 출석
  static const warning = Color(0xFFF59E0B); // pending / at-risk — 대기/위험
  static const danger = Color(0xFFEF4444); // absent / rejected — 결석/거부
  static const neutral = Color(0xFF9CA3AF);

  // Soft layered shadows — warm, low-contrast (matches web shadow-soft tokens).
  static const shadowSoft = [
    BoxShadow(
      color: Color(0x0F1E293B), // 6% slate
      blurRadius: 8,
      offset: Offset(0, 2),
      spreadRadius: -2,
    ),
    BoxShadow(
      color: Color(0x0A1E293B), // 4% slate
      blurRadius: 3,
      offset: Offset(0, 1),
      spreadRadius: -1,
    ),
  ];
  static const shadowSoftMd = [
    BoxShadow(
      color: Color(0x141E293B), // 8% slate
      blurRadius: 16,
      offset: Offset(0, 4),
      spreadRadius: -4,
    ),
    BoxShadow(
      color: Color(0x0A1E293B), // 4% slate
      blurRadius: 6,
      offset: Offset(0, 2),
      spreadRadius: -2,
    ),
  ];
}

/// Attendance-status → color / Korean label / icon (guide §2 mapping).
Color attendanceStatusColor(AttendanceStatus s) {
  switch (s) {
    case AttendanceStatus.present:
      return AppColors.success;
    case AttendanceStatus.late:
    case AttendanceStatus.earlyLeave:
    case AttendanceStatus.pending:
      return AppColors.warning;
    case AttendanceStatus.absent:
      return AppColors.danger;
    case AttendanceStatus.unknown:
      return AppColors.neutral;
  }
}

String attendanceStatusLabel(AttendanceStatus s) {
  switch (s) {
    case AttendanceStatus.present:
      return '출석';
    case AttendanceStatus.late:
      return '지각';
    case AttendanceStatus.earlyLeave:
      return '조퇴';
    case AttendanceStatus.pending:
      return '대기';
    case AttendanceStatus.absent:
      return '결석';
    case AttendanceStatus.unknown:
      return '미상';
  }
}

IconData attendanceStatusIcon(AttendanceStatus s) {
  switch (s) {
    case AttendanceStatus.present:
      return Icons.check_circle;
    case AttendanceStatus.late:
      return Icons.timer;
    case AttendanceStatus.earlyLeave:
      return Icons.logout;
    case AttendanceStatus.pending:
      return Icons.schedule;
    case AttendanceStatus.absent:
      return Icons.cancel;
    case AttendanceStatus.unknown:
      return Icons.help_outline;
  }
}
