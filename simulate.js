// Offline channel simulation: 60 Hz screen -> 30 fps camera with jitter, exposure blur, drift, noise.
// Usage: node simulate.js
const B = require("./common.js");

function randn() { return Math.sqrt(-2 * Math.log(Math.random() + 1e-12)) * Math.cos(2 * Math.PI * Math.random()); }

function simulate({ presetKey, dA, mode, text, fps = 30, noise = 0.5, seconds = 0, contrast = 80 }) {
  const preset = B.PRESETS[presetKey];
  const bits = mode === "ber" ? B.berPacket() : B.textPacket(text);
  if (!seconds) seconds = 3.5 * (bits.length + B.GAP_BITS) * preset.T;
  const times = [], values = [];
  const startOffset = 1.234; // receiver starts mid-packet
  for (let k = 0; k < seconds * fps; k++) {
    const t = k / fps + (Math.random() - 0.5) * 0.006;          // frame timing jitter
    let acc = 0;
    for (let e = 0; e < 4; e++) {                               // ~1/60 s exposure window
      const ts = t + startOffset + e / 240;
      const tScreen = Math.floor(ts * 60) / 60;                  // 60 Hz screen sample-and-hold
      acc += B.alphaAt(tScreen, bits, preset, dA).alpha;
    }
    const drift = 5 * Math.sin(2 * Math.PI * 0.05 * t);
    times.push(t);
    values.push(20 + contrast * acc / 4 + drift + noise * randn());
  }
  return B.decode(times, values, preset, mode);
}

let fail = 0;
for (const dA of [0.5, 0.1]) {
  for (const key of ["2", "4", "5", "6"]) {
    const r = simulate({ presetKey: key, dA, mode: "text", text: "HELLO" });
    const ok = r.packets.filter(p => p.ok && p.text === "HELLO").length;
    const bad = r.packets.filter(p => !(p.ok && p.text === "HELLO")).length;
    const b = simulate({ presetKey: key, dA, mode: "ber" });
    const errs = b.packets.reduce((a, p) => a + p.errors, 0), tot = b.packets.reduce((a, p) => a + p.n, 0);
    console.log(`dA=${dA} ${key.padStart(3)} bps @30fps | text ok ${ok}, bad ${bad} | BER pkts ${b.packets.length}, BER ${(errs / Math.max(tot, 1)).toFixed(4)} | fps ${r.fps.toFixed(1)}`);
    if (ok === 0) fail++;
  }
}
// noisy case (far distance): weak signal
for (const noise of [1, 2, 4]) {
  const b = simulate({ presetKey: "4", dA: 0.1, mode: "ber", noise, contrast: 30 });
  const errs = b.packets.reduce((a, p) => a + p.errors, 0), tot = b.packets.reduce((a, p) => a + p.n, 0);
  console.log(`weak signal dA=0.1, 4 bps, noise=${noise}: BER pkts ${b.packets.length}, BER ${(errs / Math.max(tot, 1)).toFixed(4)}`);
}
// pure noise: should find no packets
const silent = simulate({ presetKey: "4", dA: 0, mode: "text", text: "X", noise: 1 });
console.log("false packets on pure noise:", silent.packets.length);
// 60 fps camera, faster presets
for (const key of ["7.5", "10"]) {
  const r = simulate({ presetKey: key, dA: 0.5, mode: "text", text: "HI", fps: 60 });
  console.log(`60fps ${key} bps text ok:`, r.packets.filter(p => p.ok).length);
}
process.exit(fail ? 1 : 0);
