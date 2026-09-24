// Verifies the shared attendance status mapping (design guide §2): each status
// has a distinct color, a non-empty Korean label, and an icon — so meaning is
// never conveyed by color alone.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:syncattend_mobile/core/design.dart';
import 'package:syncattend_mobile/models/contract_models.dart';

void main() {
  group('Attendance status design mapping (§2)', () {
    const all = <AttendanceStatus>[
      AttendanceStatus.present,
      AttendanceStatus.pending,
      AttendanceStatus.absent,
      AttendanceStatus.unknown,
    ];

    test('present/pending/absent use the guide green/amber/red', () {
      expect(attendanceStatusColor(AttendanceStatus.present),
          const Color(0xFF22C55E));
      expect(attendanceStatusColor(AttendanceStatus.pending),
          const Color(0xFFF59E0B));
      expect(attendanceStatusColor(AttendanceStatus.absent),
          const Color(0xFFEF4444));
    });

    test('every status has a non-empty Korean label', () {
      for (final s in all) {
        expect(attendanceStatusLabel(s), isNotEmpty);
      }
      expect(attendanceStatusLabel(AttendanceStatus.present), '출석');
      expect(attendanceStatusLabel(AttendanceStatus.pending), '대기');
      expect(attendanceStatusLabel(AttendanceStatus.absent), '결석');
    });

    test('present/pending/absent labels are distinct (not color-only)', () {
      final labels = {
        attendanceStatusLabel(AttendanceStatus.present),
        attendanceStatusLabel(AttendanceStatus.pending),
        attendanceStatusLabel(AttendanceStatus.absent),
      };
      expect(labels.length, 3);
    });

    test('each status maps to an icon', () {
      for (final s in all) {
        expect(attendanceStatusIcon(s), isA<IconData>());
      }
    });
  });
}
