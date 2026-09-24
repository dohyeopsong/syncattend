import { describe, expect, it } from "vitest";
import { nonceToNibbles, buildFramePcm, DEFAULT_PROTOCOL, markerSlot } from "@/lib/ultrasonicEmitter";

// STAGE-1 alignment: the backend now issues audio_nonce as pure hex nibbles
// 0..E (hex[0-e]{8}). These tests lock in that the emitter carries the WHOLE
// nonce losslessly (no silent drop of non-hex chars, which was the root cause
// when the backend still emitted base64url token_urlsafe).

describe("nonceToNibbles — full hex round-trip", () => {
  it("maps every hex[0-e]{8} char 1:1 to a nibble (nothing dropped)", () => {
    const nonce = "0e1d2c3b"; // 8 hex nibbles, all within 0..e
    const nibbles = nonceToNibbles(nonce);
    expect(nibbles).toEqual([0x0, 0xe, 0x1, 0xd, 0x2, 0xc, 0x3, 0xb]);
    // one nibble per input char — no loss
    expect(nibbles.length).toBe(nonce.length);
  });

  it("preserves length for a representative hex[0-e]{8} sample", () => {
    for (const nonce of ["deadbeee", "0a1b2c3d", "abcdeabc", "01234567"]) {
      const nibbles = nonceToNibbles(nonce);
      expect(nibbles.length).toBe(8);
      // each nibble equals parseInt of the corresponding char (no 0xf present)
      nonce.split("").forEach((ch, i) => {
        expect(nibbles[i]).toBe(parseInt(ch, 16));
      });
    }
  });

  it("defensively remaps a stray 0xF nibble to 0xE (never a false marker)", () => {
    // backend excludes 0xF, but if one leaked it must not equal the marker slot.
    const nibbles = nonceToNibbles("deadbeef");
    expect(nibbles).toEqual([0xd, 0xe, 0xa, 0xd, 0xb, 0xe, 0xe, 0xe]);
    expect(nibbles).not.toContain(markerSlot(DEFAULT_PROTOCOL)); // 15
  });

  it("frame prepends exactly one marker symbol before the nonce nibbles", () => {
    const nibbles = nonceToNibbles("0e1d2c3b");
    const pcm = buildFramePcm(DEFAULT_PROTOCOL, nibbles, {
      gain: 1,
      toneFraction: 0.6,
      rampFraction: 0.1,
    });
    const samplesPerSymbol = Math.floor(
      (DEFAULT_PROTOCOL.sampleRate * DEFAULT_PROTOCOL.symbolMs) / 1000,
    );
    // [marker] + 8 nibbles = 9 symbols
    expect(pcm.length).toBe(9 * samplesPerSymbol);
  });
});
