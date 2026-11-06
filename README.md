# Real-time screen-camera communication using the alpha channel (BFSK)

A laptop screen shows a static picture whose **alpha (opacity)** is modulated over time.
A phone camera (iPhone or Android) watches the picture and decodes the bits **live in the browser**.
Inspired by HiLight (Li et al., MobiSys 2015).

| File | Purpose |
|---|---|
| `tx.html` | Transmitter: open on the laptop, full screen |
| `rx.html` | Receiver: open on the phone (iPhone: Safari, Android: Chrome) |
| `common.js` | Shared presets, packet framing and the BFSK decoder |
| `simulate.js` | Offline test: simulated 60 Hz screen to 30 fps camera (`node simulate.js`) |
| `analyze_results.py` | Plots BER and data rate vs Δα per distance from the receiver's CSV |

## How it works

**Modulation (BFSK on alpha).** The picture is drawn over black with opacity
`α(t) = 1 − Δα/2 + (Δα/2)·sin(2π f t)`, so α swings between `1−Δα` and `1`.
A `0` bit is sent with tone `f0` and a `1` with tone `f1` for one bit period `T`.
Both tones complete a whole number of cycles per bit, which makes them orthogonal.
Between repeats the alpha is held constant for 2 bit periods.

**Packets.** Each packet is a 13-bit Barker preamble followed by one of two payloads:
- **Text mode:** length byte, ASCII bytes, then a checksum byte (sum mod 256).
- **BER mode:** 64 known pseudo-random bits (16-bit LFSR with a fixed seed). The receiver knows the same sequence.

**Receiver.** Each camera frame is reduced to the mean luminance inside the green box.
The samples are resampled to 60 Hz and slow drift is removed with a moving average.
A sliding one-bit-window DFT then measures the energy at `f0` and `f1`.
The decision value is `d = (E1−E0)/(E1+E0)`.
The decoder searches for the preamble and only accepts it if every preamble bit has `|d| > 0.3`; on pure noise this gave no false packets.
After that, every following bit is read one bit period apart.

**Bit-rate presets.** A camera at F fps can only resolve tones below F/2 (Nyquist).

| Preset | T | f0 / f1 | Camera needed |
|---|---|---|---|
| 2 bps | 0.5 s | 4 / 6 Hz | 30 fps |
| 3 bps | 0.33 s | 3 / 6 Hz | 30 fps |
| 4 bps | 0.25 s | 4 / 8 Hz | 30 fps |
| 5 bps | 0.2 s | 5 / 10 Hz | 30 fps |
| 6 bps | 0.167 s | 6 / 12 Hz | 30 fps (close to the limit) |
| 7.5 bps | 0.133 s | 7.5 / 15 Hz | about 60 fps |
| 10 bps | 0.1 s | 10 / 20 Hz | about 60 fps |

The receiver shows the measured camera fps and warns you if a preset is too fast for it.

## Setup (GitHub Pages)

The phone's browser only allows camera access on **https** pages, so host the files with GitHub Pages:
1. Create a public repository (for example `alpha-bfsk`) and upload all the files to the root.
2. Go to **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / root → Save**.
3. After about a minute the site is live at `https://<your-username>.github.io/alpha-bfsk/`.
   - Open `tx.html` on the laptop.
   - Open `rx.html` on the phone: **Safari** on iPhone, **Chrome** on Android.

## Running it

1. **Laptop.** Open `tx.html`, choose a preset, Δα, mode and word, press **Start**, then **Fullscreen**, then press **H** to hide the panel. Set screen brightness to maximum.
2. **Phone.** Open `rx.html`, press **Start camera** and allow access.
   - Point the phone so the green box sits entirely on the picture.
   - Select the **same preset and mode** as the laptop.
   - Optionally press **Lock exposure**. Auto-exposure can partly cancel the brightness changes; not every phone supports locking. iPhones generally don't, so keep the phone still on a stand.
3. **Text mode.** Decoded words appear under *Received words*. One word takes one packet duration to arrive; the receiver shows the duration.
4. **BER mode.** Enter the distance and Δα, set the duration to at least 3 packet lengths (90–120 s is a good default), then press **Start trial**. Hold the phone still, ideally on a stand.

## Experiment (assignment protocol)

For each Δα in {0.1, 0.5} and each distance in {20, 40, 80, 120} cm, run one BER trial.
Repeat at faster presets until the flicker becomes visible to your eye, or until the link fails.
On iPhone, press **Share CSV** (AirDrop it, save it to Files, or email it to yourself) or **Copy CSV**. On Android, press **Download CSV**. Get the file onto the laptop, then run:

```
pip install pandas matplotlib
python analyze_results.py bfsk_results.csv
```

The script produces `ber_vs_alpha.png`, `rate_vs_alpha.png` and `summary.csv`.

**Metrics,** as defined in the assignment:
- **BER** = 1 − correct bits / transmitted bits.
  - Transmitted bits = 64 × the number of packets that were fully on screen during the trial.
  - A packet whose preamble was never found counts as 64 wrong bits.
- **Data rate** = correct payload bits / airtime of those packets.
  - Airtime includes the preamble and the gap, so the best possible value is below the raw `1/T` bit rate.
  - Example: at the 6 bps preset, 64 payload bits out of 79 bit slots gives at most 4.86 bit/s.

## Limitations to discuss in the report

- **Camera frame rate caps the data rate.** With a 30 fps browser camera, tones must stay below 15 Hz, which caps this design at about 6 bps.
  - HiLight used tones above the eye's flicker-fusion threshold together with high-frame-rate capture. That is why its changes were invisible while ours are visible.
  - Our tones (4–12 Hz) fall in the range where flicker is easy to see, especially at Δα = 0.5.
- **Smaller Δα and longer distance both shrink the received signal.**
  - Smaller Δα means a smaller brightness swing.
  - At longer distance the screen covers a smaller part of the camera image, so the green box picks up more background; the receiver also sees more noise and hand shake.
  - In both cases the signal-to-noise ratio drops, so BER rises and fewer preambles are detected.
- **Auto-exposure and screen dimming** can suppress or distort the modulation.
- **Timing jitter.** Frame timestamps come from `requestVideoFrameCallback`, and the decoder resamples them onto a uniform grid to absorb the jitter.

Run `node simulate.js` to reproduce the offline channel test.
