import 'package:flutter/material.dart';

import '../models/contract_models.dart';

/// Shared design tokens — clean-minimal guide (docs/06a_DESIGN_GUIDE_minimal.md).
/// Single indigo accent + neutrals + exactly 3 status colors. Keep in sync with
/// the web CSS variables (§2 is the source of truth).
class AppColors {
  AppColors._();

  static const indigo = Color(0xFF4F46E5); // accent / primary
  static const indigoHover = Color(0xFF4338CA);
  static const indigoSubtle = Color(0xFFEEF2FF); // chips, info surfaces
  static const foreground = Color(0xFF111827); // primary text
  static const mutedForeground = Color(0xFF6B7280); // captions
  static const border = Color(0xFFE5E7EB); // hairlines
  static const mutedBg = Color(0xFFF8FAFC);

  // Exactly 3 status colors (+ neutral). Never encode meaning by color alone —
  // always pair with the Korean label from [statusLabel] and an icon.
  static const success = Color(0xFF22C55E); // present / verified — 출석
  static const warning = Color(0xFFF59E0B); // pending / at-risk — 대기/위험
  static const danger = Color(0xFFEF4444); // absent / rejected — 결석/거부
  static const neutral = Color(0xFF9CA3AF);
}

/// Attendance-status → color / Korean label / icon (guide §2 mapping).
Color attendanceStatusColor(AttendanceStatus s) {
  switch (s) {
    case AttendanceStatus.present:
      return AppColors.success;
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
    case AttendanceStatus.pending:
      return Icons.schedule;
    case AttendanceStatus.absent:
      return Icons.cancel;
    case AttendanceStatus.unknown:
      return Icons.help_outline;
  }
}
