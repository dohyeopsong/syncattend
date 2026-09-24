import 'package:permission_handler/permission_handler.dart';

/// Requests microphone + camera permissions for the attendance verification
/// flow, and exposes a fallback path (open settings) when permanently denied.
class PermissionsService {
  const PermissionsService();

  Future<PermissionOutcome> ensureAttendancePermissions() async {
    final statuses = await [Permission.microphone, Permission.camera].request();
    final mic = statuses[Permission.microphone] ?? PermissionStatus.denied;
    final cam = statuses[Permission.camera] ?? PermissionStatus.denied;

    if (mic.isGranted && cam.isGranted) {
      return const PermissionOutcome(granted: true);
    }
    final permanentlyDenied =
        mic.isPermanentlyDenied || cam.isPermanentlyDenied;
    return PermissionOutcome(
      granted: false,
      micGranted: mic.isGranted,
      cameraGranted: cam.isGranted,
      permanentlyDenied: permanentlyDenied,
    );
  }

  Future<bool> openSettings() => openAppSettings();
}

class PermissionOutcome {
  const PermissionOutcome({
    required this.granted,
    this.micGranted = false,
    this.cameraGranted = false,
    this.permanentlyDenied = false,
  });

  final bool granted;
  final bool micGranted;
  final bool cameraGranted;
  final bool permanentlyDenied;
}
