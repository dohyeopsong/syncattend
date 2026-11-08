#!/usr/bin/env python3
"""
Safest ultrasonic test emitter — pure stdlib (no numpy/PyAudio), macOS afplay.

Run in stages to isolate WHERE the chain breaks:
  1) tone  — single steady frequency (does the speaker radiate it at all?)
  2) frame — full protocol frame (does the decoder parse it?)

The phone spectrum view should show a clear peak at the played frequency
during `tone`. If it doesn't, the speaker physically can't radiate that band.

USAGE
  python3 emit_safe.py tone --freq 18500 --secs 5
  python3 emit_safe.py tone --freq 19000 --secs 5
  python3 emit_safe.py frame --secs 20
"""
import argparse
import math
import os
import secrets
import struct
import subprocess
import tempfile
import wave

SR = 44100
BAND_LOW = 18500.0
BAND_HIGH = 20000.0
SLOTS = 16
SYMBOL_MS = 60
TONE_FRACTION = 0.6


def slot_freq(slot: int) -> float:
    step = (BAND_HIGH - BAND_LOW) / SLOTS
    return BAND_LOW + step * (slot + 0.5)


def write_wav(path: str, samples: list[float]) -> None:
    with wave.open(path, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = bytearray()
        for s in samples:
            v = max(-1.0, min(1.0, s))
            frames += struct.pack("<h", int(v * 32767))
        w.writeframes(bytes(frames))


def play(samples: list[float], label: str) -> None:
    fd, path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        write_wav(path, samples)
        subprocess.run(["afplay", path], check=True)
    finally:
        os.unlink(path)
    print(f"  [{label}] done.")


def tone(freq: float, secs: float, gain: float) -> None:
    n = int(SR * secs)
    fade = int(SR * 0.05)  # 50ms fade in/out
    two_pi_f = 2 * math.pi * freq
    out = []
    for i in range(n):
        env = 1.0
        if i < fade:
            env = 0.5 * (1 - math.cos(math.pi * i / fade))
        elif i > n - fade:
            env = 0.5 * (1 - math.cos(math.pi * (n - i) / fade))
        out.append(gain * env * math.sin(two_pi_f * i / SR))
    print(f"▶ TONE {freq:.0f} Hz for {secs:.1f}s (gain={gain}). "
          f"Watch phone spectrum for a peak here.")
    play(out, f"tone {freq:.0f}Hz")


def frame(secs: float, gain: float, nonce: str | None) -> None:
    if nonce is None:
        nonce = secrets.token_hex(4)
    nibs = [int(c, 16) for c in nonce.lower()][:8]
    nibs = nibs + [0] * (8 - len(nibs))
    print(f"▶ FRAME nonce={nonce} nibbles={nibs} "
          f"band={BAND_LOW:.0f}–{BAND_HIGH:.0f}Hz repeat=600ms")

    sym_n = int(SR * SYMBOL_MS / 1000)
    tone_n = int(sym_n * TONE_FRACTION)
    ramp_n = max(1, int(SR * 0.008))

    def symbol_pcm(slot: int) -> list[float]:
        f = slot_freq(slot)
        two_pi_f = 2 * math.pi * f
        out = [0.0] * sym_n
        for i in range(tone_n):
            env = 1.0
            if i < ramp_n:
                env = i / ramp_n
            elif i > tone_n - ramp_n:
                env = max(0.0, (tone_n - i) / ramp_n)
            out[i] = env * math.sin(two_pi_f * i / SR)
        return out

    slots = [SLOTS - 1] + nibs  # marker first
    unit: list[float] = []
    for s in slots:
        unit.extend(symbol_pcm(s))
    unit.extend([0.0] * int(SR * 0.008))  # 8ms inter-frame gap
    unit = [s * gain for s in unit]

    repeats = max(1, int(secs * 1000 / 600))
    buf: list[float] = []
    for _ in range(repeats):
        buf.extend(unit)
    play(buf, f"frame {nonce}")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    pt = sub.add_parser("tone", help="single steady frequency")
    pt.add_argument("--freq", type=float, required=True)
    pt.add_argument("--secs", type=float, default=5.0)
    pt.add_argument("--gain", type=float, default=0.8)
    pf = sub.add_parser("frame", help="full protocol frame, repeated")
    pf.add_argument("--secs", type=float, default=20.0)
    pf.add_argument("--gain", type=float, default=0.6)
    pf.add_argument("--nonce", default=None)
    args = p.parse_args()
    if args.cmd == "tone":
        tone(args.freq, args.secs, args.gain)
    else:
        frame(args.secs, args.gain, args.nonce)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
