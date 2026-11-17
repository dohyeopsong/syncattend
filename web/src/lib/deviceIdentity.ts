// Browser device identity (student side).
//
// Mirrors the Flutter DeviceIdentity (mobile/lib/core/device_identity.dart):
// generate a random v4 UUID once and persist it so the server can bind one
// attendance record per device per session.
//
// SECURITY NOTE: the Flutter app stores the UUID in Keychain/Keystore (survives
// reinstall on iOS). A browser has no equivalent secure store, so we use
// localStorage — weaker (clearable, readable by other scripts on the same
// origin). The @wku.ac.kr re-registration gate still applies: a new/unknown
// UUID is treated by the server as requiring email re-auth. This is acceptable
// for the browser auth path, which exists for test convenience, not as the
// primary student client.

const DEVICE_UUID_KEY = "syncattend.device_uuid";

function uuidv4(): string {
  // RFC 4122 v4. crypto.randomUUID is available in all modern browsers
  // (incl. Safari 15.4+); fall back to a manual v4 for older Safari.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  const cryptoObj: Crypto =
    typeof crypto !== "undefined"
      ? crypto
      : (window as unknown as { msCrypto: Crypto }).msCrypto;
  const bytes = new Uint8Array(16);
  cryptoObj.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
  const h = [...bytes].map((b) => b.toString(16).padStart(2, "0"));
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
}

let cached: string | null = null;

/** Returns the persisted device UUID, generating + storing one on first access. */
export function getOrCreateDeviceUuid(): string {
  if (cached) return cached;
  try {
    const existing = localStorage.getItem(DEVICE_UUID_KEY);
    if (existing && existing.length > 0) {
      cached = existing;
      return existing;
    }
  } catch {
    // localStorage unavailable (private mode etc.) — use an in-memory UUID.
  }
  const created = uuidv4();
  try {
    localStorage.setItem(DEVICE_UUID_KEY, created);
  } catch {
    /* in-memory only */
  }
  cached = created;
  return created;
}

export function setDeviceUuid(uuid: string): void {
  const normalized = uuid.trim();
  if (!normalized) return;
  cached = normalized;
  try {
    localStorage.setItem(DEVICE_UUID_KEY, normalized);
  } catch {
    // Keep the in-memory value when localStorage is unavailable.
  }
}

