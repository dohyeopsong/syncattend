#!/usr/bin/env python3
"""
Stage-1 PHYSICAL audio-loopback feasibility test — Syncattend V3.

Purpose
-------
Stage-0 proved the laptop speaker can EMIT 18-20 kHz and a phone can SEE it on a
spectrum analyzer. Stage-0 did NOT prove that a real nonce survives the physical
speaker -> air -> microphone path and DECODES back to the same value. That round
trip is the last unverified piece of the project's #1 technical risk (TR-0, the
ultrasonic proximity token).

This tool closes that gap WITHOUT needing an iPhone build:
  1. Encodes a hex nonce into a WAV using the EXACT emitter protocol
     (18-20 kHz, 16 tone slots, 60 ms symbol, highest slot = start marker,
     intra-symbol silent guard = the emitter's adjacent-nibble fix).
  2. PLAYS the WAV on the laptop speaker (afplay) while simultaneously RECORDING
     the laptop microphone (ffmpeg / avfoundation).  => real acoustic path.
  3. DECODES the recording with the SAME algorithm as the Flutter decoder
     (mobile/lib/features/attendance/audio_nonce_decoder.dart): Hann-window FFT
     per hop, band-median * threshold gate, oversampled run-segmentation.
  4. Reports per-nonce PASS/FAIL and an overall decode rate.

It is protocol-compatible by construction with BOTH:
  - web/src/lib/ultrasonicEmitter.ts   (owner C, emit half)
  - .../audio_nonce_decoder.dart        (owner B, decode half)

No pip installs: pure Python stdlib for synthesis + DFT, ffmpeg for capture,
afplay for playback (both already on this Mac).

USAGE
-----
  # One nonce, speaker+mic loopback, default distance (put phone/laptop close):
  python3 stage1_audio_loopback.py run --nonce a1b2c3d4

  # The standard test battery (incl. identical-adjacent nibbles) x repeats:
  python3 stage1_audio_loopback.py battery --repeats 3

  # Decode an already-captured WAV (skip playback/record) — for debugging:
  python3 stage1_audio_loopback.py decode --wav capture.wav --expect a1b2c3d4

  # Just synthesize the emit WAV (to inspect / play elsewhere):
  python3 stage1_audio_loopback.py emit --nonce a1b2c3d4 --out emit.wav

NOTES
-----
* Set laptop volume ~80-90%. Quiet room. Mic and speaker on the SAME laptop is
  the zero-distance baseline; to test proximity, play on the laptop and record
  on a second device, or move an external mic away.
* macOS will prompt for Microphone permission on first ffmpeg capture — allow it.
* 18-20 kHz is near/above many adults' hearing limit but audible/annoying to
  younger people and pets. Keep runs short.
* Record results in mobile/README.md (owner B keeps the Stage-1 results table).
"""
from __future__ import annotations

import argparse
import cmath
import math
import os
import struct
import subprocess
import sys
import tempfile
import wave

# --- Protocol (MUST match emitter + decoder) ---------------------------------
SAMPLE_RATE = 44100
BAND_LOW_HZ = 18000.0
BAND_HIGH_HZ = 20000.0
TONE_SLOTS = 16
SYMBOL_MS = 60
TONE_FRACTION = 0.6          # emitter default: tone for first 60% of symbol, then guard
RAMP_FRACTION = 0.15         # raised-cosine anti-click ramp
DETECTION_THRESHOLD = 4.0    # decoder default: bestMag >= median * threshold
HOPS_PER_SYMBOL = 4          # decoder capture default (oversampling)
MARKER_SLOT = TONE_SLOTS - 1


def slot_frequency(slot: int) -> float:
    step = (BAND_HIGH_HZ - BAND_LOW_HZ) / TONE_SLOTS
    return BAND_LOW_HZ + step * (slot + 0.5)


def nonce_to_nibbles(nonce: str) -> list[int]:
    out: list[int] = []
    for ch in nonce.strip().lower():
        try:
            v = int(ch, 16)
        except ValueError:
            continue
        out.append(0xE if v == 0xF else v)  # 0xF collides with marker -> remap
    return out


# --- EMIT: synthesize PCM identical to ultrasonicEmitter.ts -------------------
def build_frame_pcm(nibbles: list[int], gain: float = 0.9) -> list[float]:
    samples_per_symbol = (SAMPLE_RATE * SYMBOL_MS) // 1000
    tone_samples = max(1, min(samples_per_symbol, int(samples_per_symbol * TONE_FRACTION)))
    ramp_len = max(1, min(int(tone_samples * RAMP_FRACTION), tone_samples // 2))
    symbols = [MARKER_SLOT] + nibbles
    out: list[float] = []
    for sym in symbols:
        slot = sym
        freq = slot_frequency(slot)
        for i in range(samples_per_symbol):
            if i < tone_samples:
                # raised-cosine ramp in/out (anti-click)
                if i < ramp_len:
                    env = 0.5 - 0.5 * math.cos(math.pi * i / ramp_len)
                elif i > tone_samples - ramp_len:
                    env = 0.5 - 0.5 * math.cos(math.pi * (tone_samples - i) / ramp_len)
                else:
                    env = 1.0
                out.append(gain * env * math.sin(2 * math.pi * freq * i / SAMPLE_RATE))
            else:
                out.append(0.0)  # intra-symbol silent guard (adjacent-nibble fix)
    # small lead/trail silence so playback start/stop transients don't clip the frame
    pad = [0.0] * (samples_per_symbol)
    return pad + out + pad


def write_wav(path: str, pcm: list[float]) -> None:
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        frames = bytearray()
        for s in pcm:
            v = int(max(-1.0, min(1.0, s)) * 32767)
            frames += struct.pack("<h", v)
        w.writeframes(bytes(frames))


def read_wav_mono(path: str) -> tuple[list[float], int]:
    with wave.open(path, "rb") as w:
        n_ch = w.getnchannels()
        sw = w.getsampwidth()
        sr = w.getframerate()
        raw = w.readframes(w.getnframes())
    if sw != 2:
        raise SystemExit(f"expected 16-bit WAV, got sampwidth={sw}")
    count = len(raw) // 2
    ints = struct.unpack("<" + "h" * count, raw)
    if n_ch == 1:
        samples = [x / 32768.0 for x in ints]
    else:  # downmix to mono
        samples = [sum(ints[i:i + n_ch]) / (n_ch * 32768.0)
                   for i in range(0, count, n_ch)]
    return samples, sr


# --- DECODE: mirrors AudioNonceDecoder (Hann FFT + median gate + runs) --------
def _fft_size_for_symbol(samples_per_symbol: int) -> int:
    p = 1
    while (p << 1) <= samples_per_symbol:
        p <<= 1
    return p


def _dft_magnitudes(frame: list[float]) -> list[float]:
    """Real-input DFT magnitudes for bins 0..N/2 (stdlib, no numpy).
    N is small (<=1024 for a 60 ms symbol at 44.1 kHz -> 512), so O(N^2) is fine."""
    n = len(frame)
    half = n // 2
    mags = [0.0] * (half + 1)
    for k in range(half + 1):
        acc = 0.0 + 0.0j
        coef = -2j * math.pi * k / n
        for t in range(n):
            acc += frame[t] * cmath.exp(coef * t)
        mags[k] = abs(acc)
    return mags


def decode_slot(window: list[float], sr: int, win_size: int) -> int | None:
    if len(window) < win_size:
        return None
    frame = [window[i] * (0.5 - 0.5 * math.cos(2 * math.pi * i / (win_size - 1)))
             for i in range(win_size)]
    mags = _dft_magnitudes(frame)
    bin_hz = sr / win_size
    low_bin = max(0, min(len(mags) - 1, int(BAND_LOW_HZ / bin_hz)))
    high_bin = max(0, min(len(mags) - 1, math.ceil(BAND_HIGH_HZ / bin_hz)))
    if high_bin <= low_bin:
        return None
    band = sorted(mags[low_bin:high_bin])
    median = band[len(band) // 2] if band else 0.0
    best_slot, best_mag = -1, 0.0
    for slot in range(TONE_SLOTS):
        b = max(0, min(len(mags) - 1, round(slot_frequency(slot) / bin_hz)))
        if mags[b] > best_mag:
            best_mag, best_slot = mags[b], slot
    if best_slot < 0:
        return None
    if median > 0 and best_mag < median * DETECTION_THRESHOLD:
        return None
    return best_slot


def decode_oversampled(samples: list[float], sr: int, nonce_nibbles: int = 8) -> str:
    samples_per_symbol = (sr * SYMBOL_MS) // 1000
    win_size = _fft_size_for_symbol(samples_per_symbol)
    hop = max(1, samples_per_symbol // HOPS_PER_SYMBOL)

    readings: list[int | None] = []
    for start in range(0, len(samples) - win_size, hop):
        readings.append(decode_slot(samples[start:start + win_size], sr, win_size))

    # segment into runs of equal slot; nulls (silence/guard) break runs
    runs: list[tuple[int, int]] = []
    cur, length = None, 0
    for r in readings:
        if r is None:
            if cur is not None and length > 0:
                runs.append((cur, length))
            cur, length = None, 0
        elif r == cur:
            length += 1
        else:
            if cur is not None and length > 0:
                runs.append((cur, length))
            cur, length = r, 1
    if cur is not None and length > 0:
        runs.append((cur, length))

    min_run = max(1, min(HOPS_PER_SYMBOL, HOPS_PER_SYMBOL // 2))
    symbols: list[int] = []
    receiving = False
    for slot, run_len in runs:
        if run_len < min_run and slot != MARKER_SLOT:
            continue
        repeats = max(1, min(8, round(run_len / HOPS_PER_SYMBOL)))
        for _ in range(repeats):
            if slot == MARKER_SLOT:
                receiving = True
                symbols = []
            elif receiving:
                symbols.append(slot)
        if len(symbols) >= nonce_nibbles:
            return "".join(format(s, "x") for s in symbols[:nonce_nibbles])
    return "".join(format(s, "x") for s in symbols[:nonce_nibbles])


# --- Physical loopback: play + record simultaneously --------------------------
def play_and_record(emit_wav: str, capture_wav: str, extra_secs: float = 0.6) -> None:
    with wave.open(emit_wav, "rb") as w:
        dur = w.getnframes() / w.getframerate()
    rec_secs = dur + extra_secs
    # Start recording first so we don't miss the frame start.
    rec = subprocess.Popen(
        ["ffmpeg", "-y", "-f", "avfoundation", "-i", ":0",
         "-t", f"{rec_secs:.2f}", "-ar", str(SAMPLE_RATE), "-ac", "1", capture_wav],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    import time
    time.sleep(0.35)  # let capture warm up
    subprocess.run(["afplay", emit_wav], check=False)
    rec.wait()


def _pass(expected: str, got: str) -> bool:
    return got == expected.lower()


def cmd_emit(args: argparse.Namespace) -> int:
    nibbles = nonce_to_nibbles(args.nonce)
    write_wav(args.out, build_frame_pcm(nibbles, gain=args.gain))
    print(f"wrote {args.out} ({len(nibbles)} nibbles, {SYMBOL_MS} ms/symbol)")
    return 0


def cmd_decode(args: argparse.Namespace) -> int:
    samples, sr = read_wav_mono(args.wav)
    got = decode_oversampled(samples, sr, nonce_nibbles=len(nonce_to_nibbles(args.expect)) or 8)
    ok = _pass(args.expect, got) if args.expect else None
    print(f"decoded: {got}" + (f"   expected: {args.expect.lower()}   -> {'PASS' if ok else 'FAIL'}"
                               if args.expect else ""))
    return 0 if (ok or args.expect is None) else 1


def _run_one(nonce: str, gain: float, keep: bool) -> bool:
    nibbles = nonce_to_nibbles(nonce)
    tmpdir = tempfile.mkdtemp(prefix="sdas_stage1_")
    emit = os.path.join(tmpdir, "emit.wav")
    cap = os.path.join(tmpdir, "capture.wav")
    write_wav(emit, build_frame_pcm(nibbles, gain=gain))
    play_and_record(emit, cap)
    samples, sr = read_wav_mono(cap)
    got = decode_oversampled(samples, sr, nonce_nibbles=len(nibbles))
    ok = _pass(nonce, got)
    print(f"  {nonce.lower():>10}  ->  {got:<10}  {'PASS' if ok else 'FAIL'}"
          + ("" if not keep else f"   [capture: {cap}]"))
    return ok


def cmd_run(args: argparse.Namespace) -> int:
    print(f"Stage-1 physical loopback (speaker->air->mic), gain={args.gain}")
    ok = _run_one(args.nonce, args.gain, args.keep)
    return 0 if ok else 1


def cmd_battery(args: argparse.Namespace) -> int:
    nonces = ["a1b2c3d4", "0e0e0e0e", "77777777", "aa11bb22", "deadbeef", "12345678"]
    total = passed = 0
    print(f"Stage-1 battery: {len(nonces)} nonces x {args.repeats} repeats, gain={args.gain}")
    print(f"  {'nonce':>10}  ->  {'decoded':<10}  result")
    for rep in range(args.repeats):
        for n in nonces:
            total += 1
            if _run_one(n, args.gain, args.keep):
                passed += 1
    rate = 100.0 * passed / total if total else 0.0
    print(f"\n  DECODE RATE: {passed}/{total} = {rate:.1f}%")
    print("  (record this in mobile/README.md Stage-1 results table)")
    return 0 if passed == total else 1


def main() -> int:
    p = argparse.ArgumentParser(description="Stage-1 physical ultrasonic loopback test")
    sub = p.add_subparsers(dest="cmd", required=True)

    pe = sub.add_parser("emit", help="synthesize emit WAV only")
    pe.add_argument("--nonce", required=True)
    pe.add_argument("--out", default="emit.wav")
    pe.add_argument("--gain", type=float, default=0.9)
    pe.set_defaults(func=cmd_emit)

    pd = sub.add_parser("decode", help="decode an existing capture WAV")
    pd.add_argument("--wav", required=True)
    pd.add_argument("--expect", default="")
    pd.set_defaults(func=cmd_decode)

    pr = sub.add_parser("run", help="play+record one nonce and decode")
    pr.add_argument("--nonce", required=True)
    pr.add_argument("--gain", type=float, default=0.9)
    pr.add_argument("--keep", action="store_true", help="keep capture WAV path")
    pr.set_defaults(func=cmd_run)

    pb = sub.add_parser("battery", help="standard nonce battery x repeats")
    pb.add_argument("--repeats", type=int, default=3)
    pb.add_argument("--gain", type=float, default=0.9)
    pb.add_argument("--keep", action="store_true")
    pb.set_defaults(func=cmd_battery)

    args = p.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
