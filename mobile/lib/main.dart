import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

// Student app (owner B). Minimal health screen that pings the backend.
// Real features (QR scan, audio decode, UUID binding) are added by B,
// against the contract in ../contracts/openapi.yaml.

// Android emulator: 10.0.2.2 maps to host. iOS sim / device: use localhost/LAN IP.
const String backendBaseUrl = String.fromEnvironment(
  'BACKEND_URL',
  defaultValue: 'http://10.0.2.2:8000',
);

void main() => runApp(const SyncattendApp());

class SyncattendApp extends StatelessWidget {
  const SyncattendApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Syncattend',
      theme: ThemeData(useMaterial3: true, colorSchemeSeed: Colors.indigo),
      home: const HealthScreen(),
    );
  }
}

class HealthScreen extends StatefulWidget {
  const HealthScreen({super.key});

  @override
  State<HealthScreen> createState() => _HealthScreenState();
}

class _HealthScreenState extends State<HealthScreen> {
  String _status = 'idle';
  String _detail = '';

  Future<void> _checkHealth() async {
    setState(() {
      _status = 'loading';
      _detail = '';
    });
    try {
      final res = await http.get(Uri.parse('$backendBaseUrl/health'));
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      setState(() {
        _status = 'ok';
        _detail = '${body['service']} v${body['version']}';
      });
    } catch (e) {
      setState(() {
        _status = 'error';
        _detail = e.toString();
      });
    }
  }

  @override
  void initState() {
    super.initState();
    _checkHealth();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Syncattend — Student')),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Flutter skeleton (owner B)'),
            const SizedBox(height: 12),
            Text('Backend health: $_status'),
            if (_detail.isNotEmpty) Text(_detail),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _checkHealth,
              child: const Text('Re-check'),
            ),
          ],
        ),
      ),
    );
  }
}
