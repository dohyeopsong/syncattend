#!/usr/bin/env python3
"""
Standalone ultrasonic frame emitter (Python, macOS afplay).

Mirrors the web emitter protocol (web/src/lib/ultrasonicEmitter.ts) so the
phone decoder can be tested without the web dashboard running:
  - Band 18500–20000 Hz, 16 tone slots (4 bits/symbol)
  - Symbol 60 ms; slot 15 (highest) = start marker
  - Frame = [marker, n0, n1, ... n7] (8 random hex nibbles, 0..e)
  - toneFraction 0.6 (intra-symbol silent guard for adjacent identical nibbles)
  - 8 ms raised-cosine ramp (anti-click), matches the web emitter

Repeats the frame every 600 ms (near-continuous, like the web dashboard).
Play through the laptop speaker; point the phone mic at it.

USAGE
  python3 emit_frame.py                 # random nonce, repeat 60s
  python3 emit_frame.py --secs 30       # 30s
  python3 emit_frame.py --nonce ce87c06c
  python3 emit_frame.py --gain 0.8
"""
import argparse
import math
import os
import secrets
import struct
import subprocess
import tempfile
import wave

SAMPLE_RATE = 44100
BAND_LOW = 18500.0
BAND_HIGH = 20000.0
TONE_SLOTS = 16
SYMBOL_MS = 60
TONE_FRACTION = 0.6
RAMP_FRACTION = 0.1  # of symbol, raised-cosine ramp (anti-click)
REPEAT_MS = 600
MARKER_NIBBLE = -1  # sentinel -> slot 15


def slot_frequency(slot: int) -> float:
    step = (BAND_HIGH - BAND_LOW) / TONE_SLOTS
    return BAND_LOW + step * (slot + 0.5)


def nonce_to_nibbles(nonce: str) -> list[int]:
    out = []
    for ch in nonce.strip().lower():
        v = int(ch, 16)
        out.append(0xe if v == 0xf else v)  # 0xF collides with marker -> remap
    return out


def symbol_samples(slot: int, gain: float) -> list[float]:
    """One symbol: tone for toneFraction, silence for the rest. Raised-cosine
    ramp at both ends so consecutive symbols / frame repeats don't click."""
    n = int(SAMPLE_RATE * SYMBOL_MS / 1000)
    out = [0.0] * n
    if slot < 0:
        return out  # shouldn't happen; marker uses slot 15
    freq = slot_frequency(slot)
    tone_n = int(n * TONE_FRACTION)
    ramp_n = max(1, int(n * RAMP_FRACTION / 2))
    two_pi_f_over_sr = 2 * math.pi * freq / SAMPLE_RATE
    for i in range(tone_n):
        # raised-cosine ramp in/out within the tone portion
        if i < ramp_n:
            env = 0.5 * (1 - math.cos(math.pi * i / ramp_n))
        elif i > tone_n - ramp_n:
            env = 0.5 * (1 - math.cos(math.pi * (tone_n - i) / ramp_n))
        else:
            env = 1.0
        out[i] = gain * env * math.sin(two_pi_f_over_sr * i)
    return out


def frame_samples(nibbles: list[int], gain: float) -> list[float]:
    # nibbles are 0..e; prepend the start marker (slot 15 = highest)
    slots = [TONE_SLOTS - 1] + nibbles
    out: list[float] = []
    for s in slots:
        out.extend(symbol_samples(s, gain))
    return out


def write_wav(path: str, samples: list[float]) -> None:
    with wave.open(path, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        frames = bytearray()
        for s in samples:
            v = max(-1.0, min(1.0, s))
            frames += struct.pack("<h", int(v * 32767))
        w.writeframes(bytes(frames))


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--nonce", help="hex nonce (8 nibbles 0-e). Random if omitted.")
    p.add_argument("--secs", type=float, default=60.0, help="total play seconds")
    p.add_argument("--gain", type=float, default=0.6, help="output gain 0..1")
    args = p.parse_args(argv)

    nonce = args.nonce or secrets.token_hex(4)  # 8 hex nibbles
    nibbles = nonce_to_nibbles(nonce)[:8]
    if len(nibbles) < 8:
        nibbles = nibbles + [0] * (8 - len(nibbles))
    print(f"▶ Emitting nonce={nonce} nibbles={nibbles}")
    print(f"  band={BAND_LOW:.0f}–{BAND_HIGH:.0f} Hz, 16 slots, "
          f"symbol={SYMBOL_MS}ms, repeat={REPEAT_MS}ms, gain={args.gain}")
    print(f"  duration={args.secs:.0f}s. Point phone mic at the speaker.")

    frame = frame_samples(nibbles, args.gain)
    # 8 ms inter-frame silence (matches web emitter fade-out gap)
    gap = [0.0] * int(SAMPLE_RATE * 0.008)
    unit = frame + gap

    # Build the full buffer by repeating the unit.
    repeats = max(1, int(args.secs * 1000 / REPEAT_MS))
    buf: list[float] = []
    for _ in range(repeats):
        buf.extend(unit)

    fd, path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        write_wav(path, buf)
        subprocess.run(["afplay", path], check=True)
    finally:
        os.unlink(path)
    print("done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
