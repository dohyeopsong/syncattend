#!/usr/bin/env python3
"""
Stage-0 ultrasonic feasibility test — Syncattend V3.

Purpose: verify that this laptop's built-in speaker can actually EMIT
high-frequency tones (18-20 kHz) loudly enough for a phone mic to detect.
This is the project's #1 technical risk (audio proximity token). If the
speaker can't emit and the phone can't receive, the audio-token design must
fall back (lower audible band / on-screen aux signal).

No external dependencies — uses only Python stdlib + macOS `afplay`.

USAGE
-----
  # Play a sweep across audible->ultrasonic so you can HEAR where it cuts off:
  python3 stage0_ultrasonic_tone.py sweep

  # Play a steady single tone (default 19000 Hz, 5 seconds):
  python3 stage0_ultrasonic_tone.py tone
  python3 stage0_ultrasonic_tone.py tone --freq 18000 --secs 8
  python3 stage0_ultrasonic_tone.py tone --freq 20000

  # Step through 15/16/17/18/19/20 kHz, 3s each, announced:
  python3 stage0_ultrasonic_tone.py steps

HOW TO MEASURE (with your iPhone)
---------------------------------
1. On the iPhone, install a free spectrum-analyzer app
   (e.g. "SpectrumView" or "Spectrum Analyzer") and open it.
2. Set laptop volume to ~80-90% (not max — max can distort).
3. Run `steps` (or `tone --freq 19000`). Point the phone mic at the laptop
   speaker, ~50 cm away first.
4. Watch the analyzer: does a clear peak appear at the played frequency?
   - Peak visible at 18-20 kHz  -> emit+receive works, proceed to Stage 1.
   - Peak fades above ~17-18 kHz -> speaker high-end rolls off; note the
     highest usable frequency and consider that as the token band ceiling.
5. Repeat at 1 m, 3 m, 5 m to gauge classroom-distance viability.
6. Record the highest reliably-detected frequency + distance in
   mobile/README.md (owner B keeps the results table).

WARNING: 18-20 kHz is near/above many adults' hearing limit but can be
audible (and annoying) to younger people and pets. Keep sessions short.
"""
from __future__ import annotations

import argparse
import math
import os
import struct
import subprocess
import sys
import tempfile
import wave

SAMPLE_RATE = 48000          # MacBook Air output runs at 48 kHz -> Nyquist 24 kHz
AMPLITUDE = 0.8              # 0..1 (0.8 leaves headroom to avoid clipping)
FADE_MS = 20                 # fade in/out to avoid click/pop transients


def _write_wav(path: str, samples: list[float]) -> None:
    with wave.open(path, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)          # 16-bit
        w.setframerate(SAMPLE_RATE)
        frames = bytearray()
        for s in samples:
            v = max(-1.0, min(1.0, s))
            frames += struct.pack("<h", int(v * 32767))
        w.writeframes(bytes(frames))


def _fade(samples: list[float]) -> list[float]:
    n = int(SAMPLE_RATE * FADE_MS / 1000)
    n = min(n, len(samples) // 2)
    for i in range(n):
        g = i / n
        samples[i] *= g
        samples[-1 - i] *= g
    return samples


def tone_samples(freq: float, secs: float) -> list[float]:
    total = int(SAMPLE_RATE * secs)
    out = [
        AMPLITUDE * math.sin(2 * math.pi * freq * (i / SAMPLE_RATE))
        for i in range(total)
    ]
    return _fade(out)


def sweep_samples(f0: float, f1: float, secs: float) -> list[float]:
    """Linear frequency sweep f0 -> f1 (Hz) over `secs` seconds."""
    total = int(SAMPLE_RATE * secs)
    out = []
    phase = 0.0
    for i in range(total):
        frac = i / total
        f = f0 + (f1 - f0) * frac
        phase += 2 * math.pi * f / SAMPLE_RATE
        out.append(AMPLITUDE * math.sin(phase))
    return _fade(out)


def _play(samples: list[float]) -> None:
    fd, path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        _write_wav(path, samples)
        subprocess.run(["afplay", path], check=True)
    finally:
        os.unlink(path)


def cmd_tone(args: argparse.Namespace) -> None:
    print(f"▶ Playing steady {args.freq:.0f} Hz for {args.secs:.1f}s "
          f"(SR={SAMPLE_RATE}). Point phone analyzer at the speaker.")
    _play(tone_samples(args.freq, args.secs))
    print("done.")


def cmd_sweep(args: argparse.Namespace) -> None:
    print(f"▶ Sweeping {args.f0:.0f} -> {args.f1:.0f} Hz over {args.secs:.1f}s. "
          f"Listen for where it becomes inaudible; watch analyzer for the ceiling.")
    _play(sweep_samples(args.f0, args.f1, args.secs))
    print("done.")


def cmd_steps(args: argparse.Namespace) -> None:
    freqs = [15000, 16000, 17000, 18000, 19000, 20000]
    print("▶ Stepping through frequencies, "
          f"{args.secs:.0f}s each. Note the highest one your phone still detects.")
    for f in freqs:
        print(f"   → {f} Hz")
        _play(tone_samples(f, args.secs))
    print("done. Record the highest reliably-detected freq + distance in mobile/README.md")


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="Stage-0 ultrasonic emit test (macOS).")
    sub = p.add_subparsers(dest="cmd", required=True)

    pt = sub.add_parser("tone", help="steady single tone")
    pt.add_argument("--freq", type=float, default=19000.0)
    pt.add_argument("--secs", type=float, default=5.0)
    pt.set_defaults(func=cmd_tone)

    ps = sub.add_parser("sweep", help="frequency sweep")
    ps.add_argument("--f0", type=float, default=12000.0)
    ps.add_argument("--f1", type=float, default=22000.0)
    ps.add_argument("--secs", type=float, default=8.0)
    ps.set_defaults(func=cmd_sweep)

    pp = sub.add_parser("steps", help="step 15..20 kHz")
    pp.add_argument("--secs", type=float, default=3.0)
    pp.set_defaults(func=cmd_steps)

    args = p.parse_args(argv)
    args.func(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
