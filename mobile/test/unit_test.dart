import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:syncattend_mobile/api/mock_api_client.dart';
import 'package:syncattend_mobile/core/device_identity.dart';
import 'package:syncattend_mobile/features/attendance/audio_nonce_decoder.dart';
import 'package:syncattend_mobile/models/contract_models.dart';

import 'support/fakes.dart';

void main() {
  group('DeviceIdentity', () {
    test('generates once and restores the same UUID', () async {
      final store = FakeSecureStore();
      final id1 = DeviceIdentity(store);
      final first = await id1.getOrCreate();
      expect(first, isNotEmpty);

      // A new instance backed by the same store restores the same value.
      final id2 = DeviceIdentity(store);
      expect(await id2.wasRestored(), isTrue);
      expect(await id2.getOrCreate(), equals(first));
    });

    test('reports not restored on a fresh store', () async {
      final id = DeviceIdentity(FakeSecureStore());
      expect(await id.wasRestored(), isFalse);
    });
  });

  group('MockApiClient contract behaviour', () {
    test('login rejects non-school email', () async {
      final api = MockApiClient();
      expect(
        () => api.login(email: 'x@gmail.com', password: 'pw'),
        throwsA(isA<ApiError>()),
      );
    });

    test('login accepts @wku.ac.kr and returns student role', () async {
      final api = MockApiClient();
      final pair = await api.login(email: 'a@wku.ac.kr', password: 'pw');
      expect(pair.role, Role.student);
      expect(pair.accessToken, isNotEmpty);
    });

    test('second different UUID triggers 409 binding conflict', () async {
      final api = MockApiClient();
      await api.registerDevice('uuid-a');
      expect(
        () => api.registerDevice('uuid-b'),
        throwsA(isA<ApiError>()
            .having((e) => e.statusCode, 'statusCode', 409)),
      );
    });

    test('reregisterConfirm rebinds with valid code', () async {
      final api = MockApiClient();
      await api.registerDevice('uuid-a');
      final binding = await api.reregisterConfirm(
        email: 'a@wku.ac.kr',
        code: '123456',
        newDeviceUuid: 'uuid-b',
      );
      expect(binding.deviceUuid, 'uuid-b');
    });

    test('verify present then nonce reuse rejected', () async {
      final api = MockApiClient();
      await api.registerDevice('uuid-a');
      const req = VerifyRequest(
        sessionId: 's1',
        qrToken: 'qr',
        audioNonce: 'n1',
        deviceUuid: 'uuid-a',
      );
      final first = await api.verifyAttendance(req);
      expect(first.status, VerifyStatus.present);

      final second = await api.verifyAttendance(req);
      expect(second.status, VerifyStatus.rejected);
      expect(second.reason, VerifyReason.nonceReused);
    });

    test('verify rejects device mismatch', () async {
      final api = MockApiClient();
      await api.registerDevice('uuid-a');
      final res = await api.verifyAttendance(const VerifyRequest(
        sessionId: 's1',
        qrToken: 'qr',
        audioNonce: 'n2',
        deviceUuid: 'uuid-wrong',
      ));
      expect(res.status, VerifyStatus.rejected);
      expect(res.reason, VerifyReason.deviceMismatch);
    });

    test('getMe returns the student profile with an id', () async {
      final api = MockApiClient();
      final me = await api.getMe();
      expect(me.role, Role.student);
      expect(me.id, isNotEmpty);
      expect(me.email, endsWith('@wku.ac.kr'));
    });

    test('getMyAttendance returns history rows with course context', () async {
      final api = MockApiClient();
      final items = await api.getMyAttendance();
      expect(items, isNotEmpty);
      expect(items.first.courseName, isNotEmpty);
      expect(items.first.sessionId, isNotEmpty);
      // status enum covers the present/absent/pending spread.
      final statuses = items.map((e) => e.status).toSet();
      expect(statuses.contains(AttendanceStatus.present), isTrue);
    });
  });

  group('AudioNonceDecoder', () {
    test('detects the dominant tone slot from a synthesized tone', () {
      final decoder = AudioNonceDecoder(
        sampleRate: 44100,
        toneSlots: 16,
        symbolMs: 60,
      );
      const slot = 5;
      final freq = decoder.slotFrequency(slot);
      const n = (44100 * 60) ~/ 1000; // samples per symbol window
      // nextPow2 sizing inside FFT; provide a window at least that large.
      final size = _nextPow2(n);
      final samples = Float64List(size);
      for (var i = 0; i < size; i++) {
        samples[i] = math.sin(2 * math.pi * freq * i / 44100);
      }
      final detected = decoder.decodeSlot(samples);
      expect(detected, slot);
    });
  });
}

int _nextPow2(int n) {
  var p = 1;
  while (p < n) {
    p <<= 1;
  }
  return p;
}
