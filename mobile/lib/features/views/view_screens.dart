import 'package:flutter/material.dart';

import '../../models/contract_models.dart';

/// My attendance status view.
///
/// CONTRACT GAP (report to owner A): openapi.yaml currently exposes no
/// student-facing GET for "my attendance history" (only professor session
/// aggregates + PATCH). Until a contract endpoint exists, this renders local /
/// placeholder data so the screen and navigation are complete.
class MyAttendanceScreen extends StatelessWidget {
  const MyAttendanceScreen({super.key});

  static final _placeholder = <AttendanceRecord>[
    AttendanceRecord(
      recordId: 'r1',
      sessionId: 's-101',
      studentId: 'me',
      status: AttendanceStatus.present,
      verifiedAt: DateTime.now().subtract(const Duration(days: 1)),
    ),
    const AttendanceRecord(
      recordId: 'r2',
      sessionId: 's-102',
      studentId: 'me',
      status: AttendanceStatus.absent,
    ),
    const AttendanceRecord(
      recordId: 'r3',
      sessionId: 's-103',
      studentId: 'me',
      status: AttendanceStatus.pending,
    ),
  ];

  Color _statusColor(AttendanceStatus s) {
    switch (s) {
      case AttendanceStatus.present:
        return Colors.green;
      case AttendanceStatus.absent:
        return Colors.red;
      case AttendanceStatus.pending:
        return Colors.orange;
      case AttendanceStatus.unknown:
        return Colors.grey;
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      itemCount: _placeholder.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (context, i) {
        final r = _placeholder[i];
        return ListTile(
          leading: Icon(Icons.circle, color: _statusColor(r.status), size: 14),
          title: Text('세션 ${r.sessionId}'),
          subtitle: Text(r.verifiedAt != null
              ? '인증: ${r.verifiedAt}'
              : '미인증'),
          trailing: Text(r.status.name),
        );
      },
    );
  }
}

/// Weekly timetable view (placeholder; contract endpoint pending from A).
class TimetableScreen extends StatelessWidget {
  const TimetableScreen({super.key});

  static const _rows = [
    ('월', '자료구조', '09:00–10:30'),
    ('화', '운영체제', '11:00–12:30'),
    ('수', '네트워크', '13:00–14:30'),
    ('목', '캡스톤', '15:00–17:00'),
  ];

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: [
        for (final (day, course, time) in _rows)
          ListTile(
            leading: CircleAvatar(child: Text(day)),
            title: Text(course),
            subtitle: Text(time),
          ),
      ],
    );
  }
}

/// Attendance inquiry: compose a question and view answers (placeholder).
class InquiryScreen extends StatefulWidget {
  const InquiryScreen({super.key});

  @override
  State<InquiryScreen> createState() => _InquiryScreenState();
}

class _InquiryScreenState extends State<InquiryScreen> {
  final _controller = TextEditingController();
  final _messages = <(String, String)>[
    ('나', '지난 수업 출석 인증이 실패했는데 확인 가능할까요?'),
    ('교수', '창을 다시 열어드렸습니다. 재인증 부탁드립니다.'),
  ];

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _send() {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    setState(() {
      _messages.add(('나', text));
      _controller.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Expanded(
          child: ListView.builder(
            itemCount: _messages.length,
            itemBuilder: (context, i) {
              final (who, msg) = _messages[i];
              final mine = who == '나';
              return Align(
                alignment:
                    mine ? Alignment.centerRight : Alignment.centerLeft,
                child: Container(
                  margin: const EdgeInsets.all(8),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: mine
                        ? Colors.indigo.shade100
                        : Colors.grey.shade200,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(msg),
                ),
              );
            },
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(8),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _controller,
                  decoration: const InputDecoration(
                    hintText: '출결 문의를 입력하세요',
                    border: OutlineInputBorder(),
                  ),
                ),
              ),
              IconButton(onPressed: _send, icon: const Icon(Icons.send)),
            ],
          ),
        ),
      ],
    );
  }
}
