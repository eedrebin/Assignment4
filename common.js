// Shared BFSK framing + decoder for the alpha-channel screen-camera link.
// Used by tx.html, rx.html, and the Node test (simulate.js).
(function (root) {
  "use strict";

  // Bit-rate presets. Frequencies are integer multiples of 1/T so the two tones are
  // orthogonal over one bit. A camera at F fps can only see tones below F/2 (Nyquist).
  const PRESETS = {
    "2":   { label: "2 bps (f0=4, f1=6 Hz)",     T: 1 / 2,  f0: 4,   f1: 6,  minFps: 15 },
    "3":   { label: "3 bps (f0=3, f1=6 Hz)",     T: 1 / 3,  f0: 3,   f1: 6,  minFps: 15 },
    "4":   { label: "4 bps (f0=4, f1=8 Hz)",     T: 1 / 4,  f0: 4,   f1: 8,  minFps: 20 },
    "5":   { label: "5 bps (f0=5, f1=10 Hz)",    T: 1 / 5,  f0: 5,   f1: 10, minFps: 24 },
    "6":   { label: "6 bps (f0=6, f1=12 Hz)",    T: 1 / 6,  f0: 6,   f1: 12, minFps: 28 },
    "7.5": { label: "7.5 bps (f0=7.5, f1=15 Hz) needs ~60 fps", T: 2 / 15, f0: 7.5, f1: 15, minFps: 40 },
    "10":  { label: "10 bps (f0=10, f1=20 Hz) needs ~60 fps",   T: 1 / 10, f0: 10,  f1: 20, minFps: 50 },
  };

  const PREAMBLE = [1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 0, 1]; // Barker-13
  const GAP_BITS = 2;          // idle (no modulation) between repeated packets
  const BER_BITS = 64;         // payload length in BER-test mode
  const PREAMBLE_MIN_CONF = 0.3;

  function bytesToBits(bytes) {
    const out = [];
    for (const b of bytes) for (let i = 7; i >= 0; i--) out.push((b >> i) & 1);
    return out;
  }
  function bitsToBytes(bits) {
    const out = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      out.push(b);
    }
    return out;
  }

  // Deterministic pseudo-random test sequence (16-bit Fibonacci LFSR, fixed seed).
  function prbs(n) {
    let s = 0xACE1;
    const out = [];
    for (let i = 0; i < n; i++) {
      const bit = ((s >> 0) ^ (s >> 2) ^ (s >> 3) ^ (s >> 5)) & 1;
      s = (s >> 1) | (bit << 15);
      out.push(s & 1);
    }
    return out;
  }

  // Text packet: preamble | length (1 byte) | ASCII bytes | checksum (sum mod 256)
  function textPacket(text) {
    const bytes = Array.from(text.slice(0, 32)).map(c => c.charCodeAt(0) & 0x7f);
    const sum = bytes.reduce((a, b) => (a + b) & 0xff, 0);
    return PREAMBLE.concat(bytesToBits([bytes.length]), bytesToBits(bytes), bytesToBits([sum]));
  }
  function berPacket() {
    return PREAMBLE.concat(prbs(BER_BITS));
  }

  // Transmitter alpha at time t (s) since start. alpha swings between 1-dA and 1.
  function alphaAt(t, bits, preset, dA) {
    const T = preset.T;
    const cycle = (bits.length + GAP_BITS) * T;
    const pos = ((t % cycle) + cycle) % cycle;
    const idx = Math.floor(pos / T);
    if (idx >= bits.length) return { alpha: 1 - dA / 2, bit: null, idx };
    const tau = pos - idx * T;
    const f = bits[idx] ? preset.f1 : preset.f0;
    return { alpha: 1 - dA / 2 + (dA / 2) * Math.sin(2 * Math.PI * f * tau), bit: bits[idx], idx };
  }

  // ---------- Receiver ----------
  // times: seconds (increasing), values: brightness samples. Returns decoded packets.
  function decode(times, values, preset, mode, Fs = 60) {
    const n = times.length;
    if (n < 10) return { packets: [], fps: 0 };
    const fps = (n - 1) / (times[n - 1] - times[0]);

    // 1. resample to a uniform grid (camera frames arrive with jitter)
    const t0 = times[0], M = Math.floor((times[n - 1] - t0) * Fs);
    const x = new Float64Array(M);
    let j = 0;
    for (let i = 0; i < M; i++) {
      const t = t0 + i / Fs;
      while (j < n - 2 && times[j + 1] < t) j++;
      const a = (t - times[j]) / (times[j + 1] - times[j] || 1);
      x[i] = values[j] + Math.max(0, Math.min(1, a)) * (values[j + 1] - values[j]);
    }

    // 2. remove slow drift (auto-exposure, hand motion): subtract centred moving average
    const Ns = Math.round(preset.T * Fs);
    const cs = new Float64Array(M + 1);
    for (let i = 0; i < M; i++) cs[i + 1] = cs[i] + x[i];
    const y = new Float64Array(M);
    for (let i = 0; i < M; i++) {
      const lo = Math.max(0, i - (Ns >> 1)), hi = Math.min(M, i + (Ns >> 1) + 1);
      y[i] = x[i] - (cs[hi] - cs[lo]) / (hi - lo);
    }

    // 3. sliding DFT energy at f0 and f1 over one bit window (via complex prefix sums)
    function energies(f) {
      const re = new Float64Array(M + 1), im = new Float64Array(M + 1);
      const w = 2 * Math.PI * f / Fs;
      for (let i = 0; i < M; i++) {
        re[i + 1] = re[i] + y[i] * Math.cos(w * i);
        im[i + 1] = im[i] - y[i] * Math.sin(w * i);
      }
      const E = new Float64Array(Math.max(0, M - Ns + 1));
      for (let i = 0; i < E.length; i++) {
        const a = re[i + Ns] - re[i], b = im[i + Ns] - im[i];
        E[i] = a * a + b * b;
      }
      return E;
    }
    const E0 = energies(preset.f0), E1 = energies(preset.f1);
    const L = E0.length;
    const d = new Float64Array(L); // +1 => bit 1, -1 => bit 0
    for (let i = 0; i < L; i++) d[i] = (E1[i] - E0[i]) / (E1[i] + E0[i] + 1e-12);

    // 4. search for preamble alignments
    const P = PREAMBLE.length;
    const preambleScore = s => {
      let score = 0;
      for (let k = 0; k < P; k++) {
        const v = d[s + k * Ns];
        if ((v > 0) !== (PREAMBLE[k] === 1) || Math.abs(v) < PREAMBLE_MIN_CONF) return -1;
        score += Math.abs(v);
      }
      return score;
    };
    const bitsAt = (s, count) => {
      const out = [];
      for (let k = 0; k < count; k++) out.push(d[s + k * Ns] > 0 ? 1 : 0);
      return out;
    };

    const packets = [];
    let s = 0;
    while (s + P * Ns < L) {
      if (preambleScore(s) < 0) { s++; continue; }
      // refine: best alignment within one bit of the first hit
      let best = s, bestScore = preambleScore(s);
      for (let k = s + 1; k < s + Ns && k + P * Ns < L; k++) {
        const sc = preambleScore(k);
        if (sc > bestScore) { best = k; bestScore = sc; }
      }
      const start = best + P * Ns;
      let pkt = null, used = P;
      if (mode === "ber") {
        if (start + (BER_BITS - 1) * Ns < L) {
          const bits = bitsAt(start, BER_BITS), ref = prbs(BER_BITS);
          const errors = bits.reduce((e, b, i) => e + (b !== ref[i] ? 1 : 0), 0);
          pkt = { type: "ber", bits, errors, n: BER_BITS };
          used += BER_BITS;
        }
      } else if (start + 7 * Ns < L) {
        const len = bitsToBytes(bitsAt(start, 8))[0];
        const total = 8 + 8 * len + 8;
        if (len >= 1 && len <= 32 && start + (total - 1) * Ns < L) {
          const bytes = bitsToBytes(bitsAt(start, total));
          const body = bytes.slice(1, 1 + len);
          const ok = body.reduce((a, b) => (a + b) & 0xff, 0) === bytes[1 + len];
          pkt = { type: "text", text: String.fromCharCode(...body), ok };
          used += total;
        }
      }
      if (!pkt) break; // packet not fully received yet; wait for more samples
      pkt.time = t0 + best / Fs;
      pkt.confidence = bestScore / P;
      packets.push(pkt);
      s = best + used * Ns;
    }
    return { packets, fps, d, Fs };
  }

  const api = { PRESETS, PREAMBLE, GAP_BITS, BER_BITS, prbs, textPacket, berPacket, alphaAt, decode };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BFSK = api;
})(typeof window !== "undefined" ? window : globalThis);
